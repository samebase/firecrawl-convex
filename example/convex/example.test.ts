/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest, mockFetch } from "./setup.test.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("example app", () => {
  test("scrapePage returns markdown", async () => {
    const t = initConvexTest();
    mockFetch([{ success: true, data: { markdown: "# Docs" } }]);

    expect(await t.action(api.example.scrapePage, { url: "https://a.com" })).toEqual(
      { markdown: "# Docs" },
    );
  });

  test("a crawl reports progress and calls onComplete when it finishes", async () => {
    const t = initConvexTest();
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
      label: "docs",
      status: "completed",
      pageCount: 1,
    });
  });
});
