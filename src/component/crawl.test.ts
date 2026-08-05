/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import { initConvexTest, mockFetch, TEST_SITE_URL } from "./setup.test.js";
import { TOKEN_HEADER, _test } from "./crawl.js";
import type { Id } from "./_generated/dataModel.js";
import { sign } from "./signature.js";

function doc(url: string, markdown = "# page") {
  return { markdown, metadata: { url, statusCode: 200, title: url } };
}

const startResponse = {
  body: { success: true, id: "job-1", url: "https://a.com" },
};

function statusResponse(
  overrides: Record<string, unknown> = {},
): { body: Record<string, unknown> } {
  return {
    body: {
      success: true,
      status: "completed",
      total: 2,
      completed: 2,
      creditsUsed: 2,
      data: [doc("https://a.com/one"), doc("https://a.com/two")],
      ...overrides,
    },
  };
}

/** Read internal fields the public API deliberately hides. */
async function readToken(t: any, crawlId: string): Promise<string> {
  return await t.run(async (ctx: any) => {
    const crawl = await ctx.db.get("crawls", crawlId);
    return crawl.token;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.FIRECRAWL_WEBHOOK_SECRET;
});

describe("poll mode", () => {
  test("starts a crawl, polls to completion, and stores pages", async () => {
    const t = initConvexTest();
    const { calls } = mockFetch([startResponse, statusResponse()]);

    const { crawlId, jobId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      options: { limit: 2 },
      mode: "poll",
    });
    expect(jobId).toBe("job-1");
    expect(calls[0].body.webhook).toBeUndefined();
    expect(calls[0].body.limit).toBe(2);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl).toMatchObject({
      status: "completed",
      finalized: true,
      total: 2,
      completed: 2,
      creditsUsed: 2,
      pageCount: 2,
    });
    expect(calls[1].url).toBe("https://api.firecrawl.dev/v2/crawl/job-1");
    expect(calls[1].method).toBe("GET");

    const pages = await t.query(api.crawl.listPages, {
      crawlId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(pages.page.map((page: any) => page.url)).toEqual([
      "https://a.com/one",
      "https://a.com/two",
    ]);
    expect(pages.page[0].markdown).toBe("# page");
    expect(pages.isDone).toBe(true);
  });

  test("follows the `next` cursor before finalizing", async () => {
    const t = initConvexTest();
    const { calls } = mockFetch([
      startResponse,
      statusResponse({
        status: "scraping",
        next: "https://api.firecrawl.dev/v2/crawl/job-1?skip=2",
        data: [doc("https://a.com/one")],
      }),
      statusResponse({ data: [doc("https://a.com/two")] }),
    ]);

    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls[2].url).toBe(
      "https://api.firecrawl.dev/v2/crawl/job-1?skip=2",
    );
    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl).toMatchObject({ status: "completed", pageCount: 2 });
  });

  test("stores metadata only when storeContent is false", async () => {
    const t = initConvexTest();
    mockFetch([startResponse, statusResponse()]);

    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
      storeContent: false,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const page = await t.query(api.crawl.getPage, {
      crawlId,
      url: "https://a.com/one",
    });
    expect(page!.markdown).toBeUndefined();
    expect(page!.metadata.title).toBe("https://a.com/one");
  });

  test("marks the crawl failed when starting it fails", async () => {
    const t = initConvexTest();
    mockFetch([{ status: 401, body: { success: false, error: "bad key" } }]);

    await expect(
      t.action(api.crawl.start, { url: "https://a.com", mode: "poll" }),
    ).rejects.toThrow(/bad key/);

    const crawls = await t.query(api.crawl.listCrawls, {});
    expect(crawls).toHaveLength(1);
    expect(crawls[0]).toMatchObject({ status: "failed", finalized: true });
    expect(crawls[0].error).toMatch(/bad key/);
  });

  test("reports a failed crawl from the status endpoint", async () => {
    const t = initConvexTest();
    mockFetch([startResponse, statusResponse({ status: "failed", data: [] })]);

    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl).toMatchObject({ status: "failed", finalized: true });
  });
});

describe("webhook mode", () => {
  test("registers a webhook pointing at the mounted route", async () => {
    const t = initConvexTest();
    const { calls } = mockFetch([startResponse, statusResponse()]);

    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
    });

    const token = await readToken(t, crawlId);
    expect(calls[0].body.webhook).toEqual({
      url: `${TEST_SITE_URL}/webhook`,
      headers: { [TOKEN_HEADER]: token },
      metadata: { crawlId },
      events: ["started", "page", "completed", "failed"],
    });
  });

  test("stores a page from a crawl.page delivery", async () => {
    const t = initConvexTest();
    mockFetch([startResponse]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
    });
    const token = await readToken(t, crawlId);

    const response = await t.fetch("/webhook", {
      method: "POST",
      headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
      body: JSON.stringify({
        success: true,
        type: "crawl.page",
        id: "job-1",
        data: [doc("https://a.com/one")],
        metadata: { crawlId },
      }),
    });

    expect(response.status).toBe(200);
    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl).toMatchObject({ status: "scraping", pageCount: 1 });
  });

  test("rejects a delivery with the wrong token", async () => {
    const t = initConvexTest();
    mockFetch([startResponse]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
    });

    const response = await t.fetch("/webhook", {
      method: "POST",
      headers: { [TOKEN_HEADER]: "nope", "content-type": "application/json" },
      body: JSON.stringify({
        success: true,
        type: "crawl.page",
        id: "job-1",
        data: [doc("https://a.com/one")],
        metadata: { crawlId },
      }),
    });

    expect(response.status).toBe(401);
    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl!.pageCount).toBe(0);
  });

  test("reconciles through the status endpoint on crawl.completed", async () => {
    const t = initConvexTest();
    mockFetch([startResponse, statusResponse()]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
    });
    const token = await readToken(t, crawlId);

    await t.fetch("/webhook", {
      method: "POST",
      headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
      body: JSON.stringify({
        success: true,
        type: "crawl.completed",
        id: "job-1",
        data: [],
        metadata: { crawlId },
      }),
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The two pages we never got `page` deliveries for are still stored.
    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl).toMatchObject({
      status: "completed",
      finalized: true,
      pageCount: 2,
    });
  });

  test("requires a valid signature when a webhook secret is set", async () => {
    const t = initConvexTest();
    process.env.FIRECRAWL_WEBHOOK_SECRET = "whsec-test";
    mockFetch([startResponse]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
    });
    const token = await readToken(t, crawlId);
    const body = JSON.stringify({
      success: true,
      type: "crawl.page",
      id: "job-1",
      data: [doc("https://a.com/one")],
      metadata: { crawlId },
    });

    const unsigned = await t.fetch("/webhook", {
      method: "POST",
      headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
      body,
    });
    expect(unsigned.status).toBe(401);

    const signed = await t.fetch("/webhook", {
      method: "POST",
      headers: {
        [TOKEN_HEADER]: token,
        "content-type": "application/json",
        "x-firecrawl-signature": await sign("whsec-test", body),
      },
      body,
    });
    expect(signed.status).toBe(200);
    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl!.pageCount).toBe(1);
  });
});

describe("housekeeping", () => {
  test("a page delivered twice is stored once", async () => {
    const t = initConvexTest();
    mockFetch([startResponse]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
    });

    for (let i = 0; i < 2; i++) {
      await t.mutation(internal.crawl.ingestPages, {
        crawlId: crawlId as Id<"crawls">,
        documents: [doc("https://a.com/one", `# take ${i}`)],
      });
    }

    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl!.pageCount).toBe(1);
    const page = await t.query(api.crawl.getPage, {
      crawlId,
      url: "https://a.com/one",
    });
    expect(page!.markdown).toBe("# take 1");
  });

  test("cancel tells Firecrawl and finalizes locally", async () => {
    const t = initConvexTest();
    const { calls } = mockFetch([startResponse, { body: { success: true } }]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
    });

    await t.action(api.crawl.cancel, { crawlId });

    expect(calls[1].method).toBe("DELETE");
    expect(calls[1].url).toBe("https://api.firecrawl.dev/v2/crawl/job-1");
    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl).toMatchObject({ status: "cancelled", finalized: true });
  });

  test("deleteCrawl removes the crawl and its pages", async () => {
    const t = initConvexTest();
    mockFetch([startResponse, statusResponse()]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.mutation(api.crawl.deleteCrawl, { crawlId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.query(api.crawl.get, { crawlId })).toBeNull();
    const remaining = await t.run(async (ctx: any) =>
      await ctx.db.query("pages").collect(),
    );
    expect(remaining).toHaveLength(0);
  });

  test("hides internal bookkeeping from the public crawl document", async () => {
    const t = initConvexTest();
    mockFetch([startResponse]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
    });

    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl).not.toHaveProperty("token");
    expect(crawl).not.toHaveProperty("onComplete");
    expect(crawl).not.toHaveProperty("nextUrl");
    expect(crawl).not.toHaveProperty("pollAttempt");
  });
});

describe("content handling", () => {
  test("keys pages off metadata.url, falling back to sourceURL", () => {
    expect(
      _test.toPageFields({ metadata: { sourceURL: "https://a.com/x" } }, true)
        ?.url,
    ).toBe("https://a.com/x");
    expect(_test.toPageFields({ metadata: {} }, true)).toBeNull();
  });

  test("truncates oversized text and drops oversized screenshots", () => {
    const clamped = _test.clampContent({
      url: "https://a.com",
      markdown: "m".repeat(300_000),
      screenshot: "s".repeat(300_000),
      truncated: false,
    });
    expect(clamped.truncated).toBe(true);
    expect(clamped.markdown!.length).toBe(200_000);
    expect(clamped.screenshot).toBeUndefined();
  });

  test("leaves content within limits untouched", () => {
    const clamped = _test.clampContent({
      url: "https://a.com",
      markdown: "short",
      truncated: false,
    });
    expect(clamped).toEqual({
      url: "https://a.com",
      markdown: "short",
      truncated: false,
    });
  });

  test("backs off faster in poll mode than behind webhooks", () => {
    expect(_test.nextDelayMs("poll", 0)).toBe(2_000);
    expect(_test.nextDelayMs("webhook", 0)).toBe(30_000);
    expect(_test.nextDelayMs("poll", 20)).toBe(30_000);
    expect(_test.nextDelayMs("webhook", 20)).toBe(300_000);
  });
});
