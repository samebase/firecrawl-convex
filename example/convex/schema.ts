import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  /**
   * The app owns the crawl → user mapping. The component deliberately doesn't
   * know about users (it can't see `ctx.auth`), so ownership lives here and is
   * checked on every crawl-scoped operation.
   */
  crawlOwners: defineTable({
    crawlId: v.string(),
    userId: v.string(),
    label: v.optional(v.string()),
  })
    .index("crawlId", ["crawlId"])
    .index("userId", ["userId"]),

  // Written by the `onComplete` callback when a crawl finishes, to show how an
  // app reacts to a crawl reaching a terminal state.
  crawlReports: defineTable({
    crawlId: v.string(),
    userId: v.string(),
    label: v.optional(v.string()),
    status: v.string(),
    pageCount: v.number(),
    unstored: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("crawlId", ["crawlId"])
    .index("userId", ["userId"]),
});
