# Changelog

## 0.1.0

Initial release.

- `scrape`, `map`, and `search` actions over the Firecrawl v2 API, running in the
  Convex runtime (no `"use node"`, no bundled SDK).
- Durable crawls: `startCrawl` tracks a crawl in the component's own tables,
  advanced by Firecrawl webhooks with a poll watchdog behind them, and exposes
  reactive `getCrawl` / `listPages` queries plus an `onComplete` callback.
- Webhook deliveries verified by `X-Firecrawl-Signature` HMAC and a per-crawl
  token.
- Typed `FirecrawlClient` for app code, and a `firecrawl-convex/test` helper for
  registering the component in `convex-test`.
- Page documents are budgeted in UTF-8 bytes across every variable-sized field,
  so oversized `metadata`, `json`, `changeTracking`, or `links` can't push a
  write past Convex's 1MB limit. Pages that still can't be stored are counted as
  `unstored` on the crawl and in the `onComplete` payload rather than being lost
  silently, and a failed write no longer strands the crawl mid-poll.
- Crawls always reach a terminal state. After ~250 status checks the component
  finalizes as `failed` with an explanatory error instead of sitting in
  `scraping` forever; `resumeCrawl` picks tracking back up if the job is still
  running on Firecrawl.
