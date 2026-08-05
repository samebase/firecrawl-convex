import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Written by the `onComplete` callback when a crawl finishes, to show how an
  // app reacts to a crawl reaching a terminal state.
  crawlReports: defineTable({
    crawlId: v.string(),
    label: v.optional(v.string()),
    status: v.string(),
    pageCount: v.number(),
    error: v.optional(v.string()),
  }).index("crawlId", ["crawlId"]),
});
