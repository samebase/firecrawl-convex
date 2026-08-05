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
