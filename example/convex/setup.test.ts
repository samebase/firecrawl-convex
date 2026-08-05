/// <reference types="vite/client" />
import { test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import firecrawl from "firecrawl-convex/test";

const modules = import.meta.glob("./**/*.*s");

/**
 * Apps that install the component register it in their tests with the helper
 * exported from `firecrawl-convex/test`.
 */
export function initConvexTest() {
  process.env.FIRECRAWL_API_KEY = "fc-test-key";
  const t = convexTest(schema, modules);
  firecrawl.register(t);
  return t;
}

export function mockFetch(bodies: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(bodies.shift() ?? { success: true }), {
          status: 200,
        }),
    ),
  );
}

test("setup", () => {});
