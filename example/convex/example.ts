import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { FirecrawlClient } from "firecrawl-convex";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server.js";
import { components, internal } from "./_generated/api.js";
import { requireUser } from "./auth.js";

const firecrawl = new FirecrawlClient(components.firecrawl);

/**
 * Crawl-scoped operations go through this. Without it, anyone could read,
 * cancel, or delete anyone else's crawl by guessing an id — the component
 * has no notion of who owns what.
 */
async function requireOwnedCrawl(
  ctx: QueryCtx & { auth: any },
  crawlId: string,
): Promise<string> {
  const userId = await requireUser(ctx);
  const owner = await ctx.db
    .query("crawlOwners")
    .withIndex("crawlId", (q) => q.eq("crawlId", crawlId))
    .first();
  if (!owner || owner.userId !== userId) {
    throw new Error("No such crawl.");
  }
  return userId;
}

// ---------------------------------------------------------------------------
// One-shot calls — these spend Firecrawl credits, so they require a caller.
// A production app should also rate-limit them, e.g. with @convex-dev/ratelimiter.
// ---------------------------------------------------------------------------

export const scrapePage = action({
  args: { url: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    return await firecrawl.scrape(ctx, args.url, {
      formats: ["markdown"],
      onlyMainContent: true,
    });
  },
});

export const mapSite = action({
  args: { url: v.string(), search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    return await firecrawl.map(ctx, args.url, { search: args.search, limit: 100 });
  },
});

export const searchWeb = action({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    return await firecrawl.search(ctx, args.query, {
      limit: args.limit ?? 5,
      scrapeOptions: { formats: ["markdown"] },
    });
  },
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
    const userId = await requireUser(ctx);
    const started = await firecrawl.startCrawl(ctx, {
      url: args.url,
      options: {
        limit: args.limit ?? 10,
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      },
      onComplete: internal.example.onCrawlComplete,
      context: { userId, label: args.label },
    });
    await ctx.runMutation(internal.example.recordOwner, {
      crawlId: started.crawlId,
      userId,
      label: args.label,
    });
    return started;
  },
});

export const recordOwner = internalMutation({
  args: { crawlId: v.string(), userId: v.string(), label: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("crawlOwners", args);
    return null;
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
    unstored: v.optional(v.number()),
    error: v.optional(v.string()),
    context: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("crawlReports", {
      crawlId: args.crawlId,
      userId: args.context?.userId ?? "unknown",
      label: args.context?.label,
      status: args.status,
      pageCount: args.pageCount,
      // Non-zero means content was dropped — worth surfacing, not swallowing.
      unstored: args.unstored,
      error: args.error,
    });
    return null;
  },
});

/** Subscribe to this for live crawl progress. */
export const crawlProgress = query({
  args: { crawlId: v.string() },
  handler: async (ctx, args) => {
    await requireOwnedCrawl(ctx, args.crawlId);
    return await firecrawl.getCrawl(ctx, args.crawlId);
  },
});

/** Pages as they arrive. Pairs with React's `usePaginatedQuery`. */
export const crawlPages = query({
  args: { crawlId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireOwnedCrawl(ctx, args.crawlId);
    return await firecrawl.listPages(ctx, {
      crawlId: args.crawlId,
      paginationOpts: args.paginationOpts,
    });
  },
});

/** Only the caller's crawls — never the whole table. */
export const myCrawls = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const owned = await ctx.db
      .query("crawlOwners")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);
    return await Promise.all(
      owned.map(async (row) => ({
        label: row.label,
        crawl: await firecrawl.getCrawl(ctx, row.crawlId),
      })),
    );
  },
});

export const reports = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    return await ctx.db
      .query("crawlReports")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);
  },
});

export const cancelCrawl = action({
  args: { crawlId: v.string() },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.example.assertOwned, {
      crawlId: args.crawlId,
      userId: await requireUser(ctx),
    });
    return await firecrawl.cancelCrawl(ctx, args.crawlId);
  },
});

/** Ownership check callable from an action, which has no `ctx.db`. */
export const assertOwned = internalQuery({
  args: { crawlId: v.string(), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await ctx.db
      .query("crawlOwners")
      .withIndex("crawlId", (q) => q.eq("crawlId", args.crawlId))
      .first();
    if (!owner || owner.userId !== args.userId) throw new Error("No such crawl.");
    return null;
  },
});

export const resumeCrawl = mutation({
  args: { crawlId: v.string() },
  handler: async (ctx, args) => {
    await requireOwnedCrawl(ctx, args.crawlId);
    return await firecrawl.resumeCrawl(ctx, args.crawlId);
  },
});

export const deleteCrawl = mutation({
  args: { crawlId: v.string() },
  handler: async (ctx, args) => {
    await requireOwnedCrawl(ctx, args.crawlId);
    const owner = await ctx.db
      .query("crawlOwners")
      .withIndex("crawlId", (q) => q.eq("crawlId", args.crawlId))
      .first();
    if (owner) await ctx.db.delete("crawlOwners", owner._id);
    return await firecrawl.deleteCrawl(ctx, args.crawlId);
  },
});
