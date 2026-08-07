import { defineApp } from "convex/server";
import { v } from "convex/values";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";

const app = defineApp({
  env: {
    FIRECRAWL_API_KEY: v.string(),
    FIRECRAWL_WEBHOOK_SECRET: v.optional(v.string()),
    // Point at a self-hosted Firecrawl, or at the mock server used by
    // `npm run verify`. Defaults to https://api.firecrawl.dev.
    FIRECRAWL_API_URL: v.optional(v.string()),
  },
});

app.use(firecrawl, {
  // Mounts the component's webhook route at <site>/firecrawl/webhook.
  // Required for crawls in webhook mode.
  httpPrefix: "/firecrawl/",
  env: {
    FIRECRAWL_API_KEY: app.env.FIRECRAWL_API_KEY,
    FIRECRAWL_WEBHOOK_SECRET: app.env.FIRECRAWL_WEBHOOK_SECRET,
    FIRECRAWL_API_URL: app.env.FIRECRAWL_API_URL,
  },
});

export default app;
