# firecrawl-convex example

A Convex app that installs the component and exercises everything it exposes:
`scrape`, `map`, `search`, and a durable crawl with a completion callback.

Every function requires a signed-in caller, and crawls are owned: the app keeps
its own `crawlOwners` table and checks it before any crawl can be read,
cancelled, resumed, or deleted. The component can't do this for you — it never
sees `ctx.auth`.

The functions live in [`convex/example.ts`](convex/example.ts); the component is
installed in [`convex/convex.config.ts`](convex/convex.config.ts).

## Run it against the mock API

[`mock-firecrawl.mjs`](mock-firecrawl.mjs) implements the endpoints the component
uses and delivers signed crawl webhooks back to your deployment, so you can watch
a crawl progress without spending credits.

From the repo root:

```sh
npm install

# terminal 1 — the fake Firecrawl
FIRECRAWL_WEBHOOK_SECRET=whsec-mock npm run dev:mock

# terminal 2 — point the component at it, then start Convex
npx convex env set FIRECRAWL_API_KEY fc-mock-key
npx convex env set FIRECRAWL_API_URL http://127.0.0.1:4242
npx convex env set FIRECRAWL_WEBHOOK_SECRET whsec-mock
# The CLI calls functions unauthenticated; this lets the walkthrough run.
# Local deployments only — never set this on anything internet-reachable.
npx convex env set DEMO_ALLOW_ANONYMOUS true
npm run dev
```

## Run it against real Firecrawl

```sh
npx convex env remove FIRECRAWL_API_URL
npx convex env set FIRECRAWL_API_KEY fc-your-real-key
```

Real Firecrawl can't reach a local deployment, so crawls need `mode: "poll"`
locally (`startCrawl` in `example.ts` accepts whatever you pass through). On a
cloud deployment, webhook mode works as-is.

## Commands

```sh
# one-shot calls
npx convex run example:scrapePage '{"url":"https://firecrawl.dev"}'
npx convex run example:mapSite '{"url":"https://docs.firecrawl.dev"}'
npx convex run example:searchWeb '{"query":"convex components","limit":3}'

# a durable crawl
npx convex run example:startCrawl '{"url":"https://docs.firecrawl.dev","limit":5,"label":"docs"}'

# then, with the crawlId it printed
npx convex run example:crawlProgress '{"crawlId":"<crawlId>"}'
npx convex run example:crawlPages '{"crawlId":"<crawlId>","paginationOpts":{"numItems":10,"cursor":null}}'

# your crawls, and the rows written by the onComplete callback
npx convex run example:myCrawls '{}'
npx convex run example:reports '{}'

# housekeeping
npx convex run example:cancelCrawl '{"crawlId":"<crawlId>"}'
npx convex run example:resumeCrawl '{"crawlId":"<crawlId>"}'
npx convex run example:deleteCrawl '{"crawlId":"<crawlId>"}'
```

## Tests

[`convex/example.test.ts`](convex/example.test.ts) shows how an app tests code
that calls the component: register it with `firecrawl-convex/test`, stub `fetch`,
sign in with `t.withIdentity(...)`, and drive the scheduler with
`finishAllScheduledFunctions`. It also covers the authorization rules — anonymous
callers rejected, one user unable to touch another's crawl. Run from the repo
root with `npm test`.
