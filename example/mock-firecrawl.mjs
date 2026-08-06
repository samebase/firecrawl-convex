#!/usr/bin/env node
/**
 * A stand-in for the Firecrawl API, so the example app can be exercised
 * end to end — including real webhook deliveries — without spending credits.
 *
 *   node example/mock-firecrawl.mjs            # listens on http://127.0.0.1:4242
 *   PORT=5000 node example/mock-firecrawl.mjs
 *
 * Point the component at it:
 *   npx convex env set FIRECRAWL_API_URL http://127.0.0.1:4242
 *
 * Implements the shapes the component depends on: /v2/scrape, /v2/map,
 * /v2/search, POST + GET + DELETE /v2/crawl, and crawl webhook deliveries
 * signed with X-Firecrawl-Signature.
 */
import { createServer } from "node:http";
import { createHmac } from "node:crypto";

const PORT = Number(process.env.PORT ?? 4242);
const WEBHOOK_SECRET = process.env.FIRECRAWL_WEBHOOK_SECRET;
/** Pages the fake crawler "discovers". */
const PAGE_COUNT = Number(process.env.MOCK_PAGE_COUNT ?? 3);
/** Pad page markdown to this many bytes, to exercise the document-size guard. */
const PAGE_BYTES = Number(process.env.MOCK_PAGE_BYTES ?? 0);

const crawls = new Map();

function pageDocument(base, index) {
  const url = `${base.replace(/\/$/, "")}/page-${index}`;
  const body = `# Page ${index}\n\nMock content for ${url}.`;
  return {
    markdown: PAGE_BYTES > body.length ? body + "x".repeat(PAGE_BYTES - body.length) : body,
    metadata: {
      url,
      sourceURL: url,
      title: `Page ${index}`,
      statusCode: 200,
      creditsUsed: 1,
    },
  };
}

async function deliver(webhook, payload) {
  if (!webhook?.url) return;
  const body = JSON.stringify(payload);
  const headers = {
    "content-type": "application/json",
    ...(webhook.headers ?? {}),
  };
  if (WEBHOOK_SECRET) {
    headers["x-firecrawl-signature"] = `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;
  }
  try {
    const response = await fetch(webhook.url, { method: "POST", headers, body });
    console.log(`  → ${payload.type} delivered: ${response.status}`);
  } catch (error) {
    console.log(`  → ${payload.type} delivery failed: ${error.message}`);
  }
}

/** Walk a crawl through started → page… → completed, pushing webhooks as it goes. */
async function runCrawl(id) {
  const crawl = crawls.get(id);
  const { webhook, url } = crawl;
  const metadata = webhook?.metadata ?? {};

  await deliver(webhook, {
    success: true,
    type: "crawl.started",
    id,
    data: [],
    metadata,
  });

  for (let index = 1; index <= PAGE_COUNT; index++) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const document = pageDocument(url, index);
    crawl.documents.push(document);
    crawl.completed = index;
    await deliver(webhook, {
      success: true,
      type: "crawl.page",
      id,
      data: [document],
      metadata,
    });
  }

  crawl.status = "completed";
  await deliver(webhook, {
    success: true,
    type: "crawl.completed",
    id,
    data: [],
    metadata,
  });
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  const body = raw ? JSON.parse(raw) : {};
  console.log(`${request.method} ${url.pathname}`);

  if (!request.headers.authorization?.startsWith("Bearer ")) {
    return json(response, 401, { success: false, error: "no api key" });
  }

  if (request.method === "POST" && url.pathname === "/v2/scrape") {
    return json(response, 200, {
      success: true,
      data: pageDocument(body.url ?? "https://mock.test", 1),
    });
  }

  if (request.method === "POST" && url.pathname === "/v2/map") {
    return json(response, 200, {
      success: true,
      id: "mock-map",
      links: Array.from({ length: PAGE_COUNT }, (_, i) => ({
        url: `${(body.url ?? "https://mock.test").replace(/\/$/, "")}/page-${i + 1}`,
        title: `Page ${i + 1}`,
      })),
    });
  }

  if (request.method === "POST" && url.pathname === "/v2/search") {
    return json(response, 200, {
      success: true,
      data: {
        web: Array.from({ length: Math.min(body.limit ?? 3, PAGE_COUNT) }, (_, i) => ({
          url: `https://mock.test/result-${i + 1}`,
          title: `Result ${i + 1} for ${body.query}`,
          description: "Mock search result.",
        })),
      },
    });
  }

  if (request.method === "POST" && url.pathname === "/v2/crawl") {
    const id = `mock-crawl-${crawls.size + 1}`;
    crawls.set(id, {
      id,
      url: body.url,
      status: "scraping",
      webhook: typeof body.webhook === "object" ? body.webhook : undefined,
      documents: [],
      completed: 0,
    });
    console.log(`  crawl ${id} started (webhook: ${body.webhook?.url ?? "none"})`);
    void runCrawl(id);
    return json(response, 200, { success: true, id, url: body.url });
  }

  const crawlMatch = url.pathname.match(/^\/v2\/crawl\/([^/]+)$/);
  if (crawlMatch) {
    const crawl = crawls.get(crawlMatch[1]);
    if (!crawl) return json(response, 404, { success: false, error: "not found" });

    if (request.method === "DELETE") {
      crawl.status = "cancelled";
      return json(response, 200, { success: true, status: "cancelled" });
    }

    // Serve results in two chunks so the `next` cursor gets exercised.
    const skip = Number(url.searchParams.get("skip") ?? 0);
    const chunk = crawl.documents.slice(skip, skip + 2);
    const nextSkip = skip + chunk.length;
    const hasMore = nextSkip < crawl.documents.length;
    return json(response, 200, {
      success: true,
      status: crawl.status,
      total: PAGE_COUNT,
      completed: crawl.completed,
      creditsUsed: crawl.documents.length,
      next: hasMore
        ? `http://127.0.0.1:${PORT}/v2/crawl/${crawl.id}?skip=${nextSkip}`
        : null,
      data: chunk,
    });
  }

  return json(response, 404, { success: false, error: `no route ${url.pathname}` });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock Firecrawl listening on http://127.0.0.1:${PORT}`);
  console.log(
    WEBHOOK_SECRET
      ? "signing webhooks with FIRECRAWL_WEBHOOK_SECRET"
      : "not signing webhooks (set FIRECRAWL_WEBHOOK_SECRET to test signatures)",
  );
});
