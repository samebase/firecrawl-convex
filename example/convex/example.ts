import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { FirecrawlClient } from "firecrawl-convex";
import {
  action,
  internalMutation,
  mutation,
  query,
} from "./_generated/server.js";
import { components, internal } from "./_generated/api.js";

const firecrawl = new FirecrawlClient(components.firecrawl);

// ---------------------------------------------------------------------------
// One-shot calls
// ---------------------------------------------------------------------------

export const scrapePage = action({
  args: { url: v.string() },
  handler: async (ctx, args) =>
    await firecrawl.scrape(ctx, args.url, {
      formats: ["markdown"],
      onlyMainContent: true,
    }),
});

export const mapSite = action({
  args: { url: v.string(), search: v.optional(v.string()) },
  handler: async (ctx, args) =>
    await firecrawl.map(ctx, args.url, { search: args.search, limit: 100 }),
});

export const searchWeb = action({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) =>
    await firecrawl.search(ctx, args.query, {
      limit: args.limit ?? 5,
      scrapeOptions: { formats: ["markdown"] },
    }),
});

// ---------------------------------------------------------------------------
// Durable crawls
// ---------------------------------------------------------------------------

export const startCrawl = action({
  args: {
    url: v.string(),
    limit: v.optional(v.number()),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ crawlId: string; jobId: string }> => {
    // Components can't see `ctx.auth`, so the app authorizes first and passes
    // along whatever the component needs to know.
    const userId = (await ctx.auth.getUserIdentity())?.subject ?? "anonymous";
    return await firecrawl.startCrawl(ctx, {
      url: args.url,
      options: {
        limit: args.limit ?? 10,
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      },
      onComplete: internal.example.onCrawlComplete,
      context: { userId, label: args.label },
    });
  },
});

/**
 * Runs once, when the crawl reaches a terminal state. Whatever you passed as
 * `context` comes back untouched.
 */
export const onCrawlComplete = internalMutation({
  args: {
    crawlId: v.string(),
    jobId: v.optional(v.string()),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    pageCount: v.number(),
    error: v.optional(v.string()),
    context: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("crawlReports", {
      crawlId: args.crawlId,
      label: args.context?.label,
      status: args.status,
      pageCount: args.pageCount,
      error: args.error,
    });
    return null;
  },
});

/** Subscribe to this for live crawl progress. */
export const crawlProgress = query({
  args: { crawlId: v.string() },
  handler: async (ctx, args) => await firecrawl.getCrawl(ctx, args.crawlId),
});

/** Pages as they arrive. Pairs with React's `usePaginatedQuery`. */
export const crawlPages = query({
  args: { crawlId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) =>
    await firecrawl.listPages(ctx, {
      crawlId: args.crawlId,
      paginationOpts: args.paginationOpts,
    }),
});

export const recentCrawls = query({
  args: {},
  handler: async (ctx) => await firecrawl.listCrawls(ctx, { limit: 20 }),
});

export const reports = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("crawlReports").order("desc").take(20),
});

export const cancelCrawl = action({
  args: { crawlId: v.string() },
  handler: async (ctx, args) => await firecrawl.cancelCrawl(ctx, args.crawlId),
});

export const deleteCrawl = mutation({
  args: { crawlId: v.string() },
  handler: async (ctx, args) => await firecrawl.deleteCrawl(ctx, args.crawlId),
});
