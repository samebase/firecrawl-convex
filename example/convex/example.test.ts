/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest, mockFetch } from "./setup.test.js";

const alice = { subject: "alice", issuer: "https://example.test" };
const bob = { subject: "bob", issuer: "https://example.test" };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("example app", () => {
  test("scrapePage returns markdown", async () => {
    const t = initConvexTest().withIdentity(alice);
    mockFetch([{ success: true, data: { markdown: "# Docs" } }]);

    expect(
      await t.action(api.example.scrapePage, { url: "https://a.com" }),
    ).toEqual({ markdown: "# Docs" });
  });

  test("a crawl reports progress and calls onComplete when it finishes", async () => {
    const t = initConvexTest().withIdentity(alice);
    mockFetch([
      { success: true, id: "job-1", url: "https://a.com" },
      {
        success: true,
        status: "completed",
        total: 1,
        completed: 1,
        creditsUsed: 1,
        data: [
          {
            markdown: "# One",
            metadata: { url: "https://a.com/one", statusCode: 200 },
          },
        ],
      },
    ]);

    const { crawlId } = await t.action(api.example.startCrawl, {
      url: "https://a.com",
      limit: 1,
      label: "docs",
    });

    expect(await t.query(api.example.crawlProgress, { crawlId })).toMatchObject({
      status: "scraping",
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.query(api.example.crawlProgress, { crawlId })).toMatchObject({
      status: "completed",
      pageCount: 1,
    });

    const pages = await t.query(api.example.crawlPages, {
      crawlId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(pages.page).toHaveLength(1);
    expect(pages.page[0].url).toBe("https://a.com/one");

    // The onComplete callback wrote an app-owned row, with our context intact.
    const reports = await t.query(api.example.reports, {});
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      crawlId,
      userId: "alice",
      label: "docs",
      status: "completed",
      pageCount: 1,
    });
  });
});

describe("authorization", () => {
  test("paid endpoints reject anonymous callers", async () => {
    const t = initConvexTest();
    const calls = mockFetch([{ success: true, data: { markdown: "# nope" } }]);

    await expect(
      t.action(api.example.scrapePage, { url: "https://a.com" }),
    ).rejects.toThrow(/Not signed in/);
    await expect(
      t.action(api.example.searchWeb, { query: "anything" }),
    ).rejects.toThrow(/Not signed in/);
    await expect(
      t.action(api.example.startCrawl, { url: "https://a.com" }),
    ).rejects.toThrow(/Not signed in/);

    // No credits were spent on the rejected calls.
    expect(calls).toHaveLength(0);
  });

  test("one user cannot read, cancel, or delete another's crawl", async () => {
    const t = initConvexTest();
    mockFetch([
      { success: true, id: "job-1", url: "https://a.com" },
      { success: true, status: "scraping", total: 1, completed: 0, data: [] },
    ]);

    const { crawlId } = await t
      .withIdentity(alice)
      .action(api.example.startCrawl, { url: "https://a.com", limit: 1 });

    const asBob = t.withIdentity(bob);
    await expect(
      asBob.query(api.example.crawlProgress, { crawlId }),
    ).rejects.toThrow(/No such crawl/);
    await expect(
      asBob.query(api.example.crawlPages, {
        crawlId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/No such crawl/);
    await expect(
      asBob.action(api.example.cancelCrawl, { crawlId }),
    ).rejects.toThrow(/No such crawl/);
    await expect(
      asBob.mutation(api.example.deleteCrawl, { crawlId }),
    ).rejects.toThrow(/No such crawl/);

    // Alice still can.
    expect(
      await t.withIdentity(alice).query(api.example.crawlProgress, { crawlId }),
    ).toMatchObject({ url: "https://a.com" });
  });

  test("listings are scoped to the caller", async () => {
    const t = initConvexTest();
    mockFetch([
      { success: true, id: "job-1", url: "https://alice.test" },
      { success: true, status: "scraping", total: 1, completed: 0, data: [] },
    ]);

    await t
      .withIdentity(alice)
      .action(api.example.startCrawl, { url: "https://alice.test", limit: 1 });

    expect(await t.withIdentity(alice).query(api.example.myCrawls, {})).toHaveLength(1);
    expect(await t.withIdentity(bob).query(api.example.myCrawls, {})).toHaveLength(0);
  });
});
