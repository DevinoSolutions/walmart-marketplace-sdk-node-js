import { describe, expect, it } from "vitest";
import { WalmartApiError, WalmartValidationError } from "../src/index.js";
import type { MockRoute } from "../src/testing/index.js";
import { apiCalls, createHarness, errorRoute, jsonRoute, SAMPLE_ITEM } from "./helpers.js";

describe("items.list", () => {
  it("maps the ItemResponse envelope onto WalmartItem", async () => {
    const { client } = createHarness([
      jsonRoute("GET", "/v3/items", { ItemResponse: [SAMPLE_ITEM], totalItems: 1 }),
    ]);
    const page = await client.items.list();

    expect(page.totalItems).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      sku: "SKU-1",
      wpid: "0RCJ4CEXAMPLE",
      gtin: "00012345678905",
      productName: "Sample Widget",
      publishedStatus: "PUBLISHED",
      lifecycleStatus: "ACTIVE",
      price: { currency: "CAD", amount: 19.99 },
    });
    expect(page.items[0]?.raw).toEqual(SAMPLE_ITEM);
  });

  it("forwards the documented query parameters", async () => {
    const { client, calls } = createHarness([jsonRoute("GET", "/v3/items", { ItemResponse: [] })]);
    await client.items.list({ limit: 50, sku: "SKU-1", lifecycleStatus: "ACTIVE", offset: 10 });

    const url = apiCalls(calls)[0]?.url;
    expect(url?.searchParams.get("limit")).toBe("50");
    expect(url?.searchParams.get("sku")).toBe("SKU-1");
    expect(url?.searchParams.get("lifecycleStatus")).toBe("ACTIVE");
    expect(url?.searchParams.get("offset")).toBe("10");
  });

  // Live-verified 2026-09-16: a seller whose catalog is empty gets a 404, not an empty list.
  it("returns an empty page when Walmart answers 404 CONTENT_NOT_FOUND", async () => {
    const { client } = createHarness([
      // Captured verbatim from production on 2026-09-16 (empty catalog). Walmart grades it
      // severity INFO, not ERROR — it is telling us "no rows", not reporting a fault.
      errorRoute("GET", "/v3/items", 404, {
        error: [
          {
            code: "CONTENT_NOT_FOUND.GMP_ITEM_QUERY_API",
            field: "404_NOT_FOUND",
            description: "No Items found for the input parameters.",
            info: "Requested content could not be found.",
            severity: "INFO",
            category: "APPLICATION",
            causes: [],
            errorIdentifiers: {},
          },
        ],
      }),
    ]);

    await expect(client.items.list()).resolves.toEqual({
      items: [],
      totalItems: 0,
      nextCursor: undefined,
    });
  });

  it("still throws on a 404 that is not CONTENT_NOT_FOUND", async () => {
    const { client } = createHarness([
      errorRoute("GET", "/v3/items", 404, {
        error: [{ code: "INVALID_REQUEST.GMP_ITEM_QUERY_API", description: "Bad path." }],
      }),
    ]);

    await expect(client.items.list()).rejects.toBeInstanceOf(WalmartApiError);
  });

  it("stops listAll cleanly when the catalog is empty", async () => {
    const { client } = createHarness([
      errorRoute("GET", "/v3/items", 404, {
        error: [{ code: "CONTENT_NOT_FOUND.GMP_ITEM_QUERY_API", description: "No Items found." }],
      }),
    ]);

    const seen = [];
    for await (const item of client.items.listAll()) seen.push(item);
    expect(seen).toEqual([]);
  });

  it("rejects a limit above Walmart's cap before sending", async () => {
    const { client, calls } = createHarness([jsonRoute("GET", "/v3/items", { ItemResponse: [] })]);
    await expect(client.items.list({ limit: 500 })).rejects.toBeInstanceOf(WalmartValidationError);
    expect(calls).toHaveLength(0);
  });

  it("accepts a single item object without an envelope", async () => {
    const { client } = createHarness([jsonRoute("GET", "/v3/items", SAMPLE_ITEM)]);
    const page = await client.items.list();
    expect(page.items[0]?.sku).toBe("SKU-1");
  });
});

/** `GET /v3/items` entry as captured live 2026-10-10 (values replaced with placeholders). */
const LIVE_ITEM = {
  mart: "WALMART_CA",
  sku: "SKU-1",
  wpid: "0RCJ4CEXAMPLE",
  upc: "012345678905",
  gtin: "00012345678905",
  productName: "Sample Widget",
  shelf: '["Root","Electronics","Computer Components","RAM"]',
  productType: "RAM Memory",
  price: { currency: "CAD", amount: 19.99 },
  publishedStatus: "PUBLISHED",
  lifecycleStatus: "ACTIVE",
};

describe("items live-verified shapes (2026-10-10)", () => {
  it("keeps shelf as the JSON-encoded string and mart in raw", async () => {
    const { client } = createHarness([
      jsonRoute("GET", "/v3/items", { ItemResponse: [LIVE_ITEM], totalItems: 1 }),
    ]);
    const page = await client.items.list();
    expect(page.items[0]).toMatchObject({
      upc: "012345678905",
      shelf: '["Root","Electronics","Computer Components","RAM"]',
      productType: "RAM Memory",
      price: { currency: "CAD", amount: 19.99 },
    });
    expect(page.items[0]?.raw.mart).toBe("WALMART_CA");
    expect(page.nextCursor).toBeUndefined();
  });

  it("sends the first-page sentinel * as the nextCursor parameter", async () => {
    const { client, calls } = createHarness([
      jsonRoute("GET", "/v3/items", { ItemResponse: [LIVE_ITEM], totalItems: 1, nextCursor: "C" }),
    ]);
    const page = await client.items.list({ nextCursor: "*", limit: 20 });
    expect(apiCalls(calls)[0]?.url.searchParams.get("nextCursor")).toBe("*");
    expect(page.nextCursor).toBe("C");
  });

  it("raises WalmartApiError for a SKU Walmart does not know (404 CONTENT_NOT_FOUND)", async () => {
    const { client } = createHarness([
      errorRoute("GET", /\/v3\/items\//, 404, {
        error: [
          {
            code: "CONTENT_NOT_FOUND.GMP_ITEM_QUERY_API",
            field: "404_NOT_FOUND",
            description: "No Items found for the input parameters.",
            info: "Requested content could not be found.",
            severity: "INFO",
            category: "APPLICATION",
            causes: [],
            errorIdentifiers: {},
          },
        ],
      }),
    ]);
    await expect(client.items.get("SKU-404")).rejects.toMatchObject({
      status: 404,
      upstreamCode: "CONTENT_NOT_FOUND.GMP_ITEM_QUERY_API",
    });
  });
});

describe("items.listAll", () => {
  /** Offset-paged route over `total` items, like an uncursored live call (no nextCursor). */
  function offsetRoute(total: number): MockRoute {
    return {
      method: "GET",
      pathPattern: "/v3/items",
      reply: (req) => {
        const offset = Number(req.url.searchParams.get("offset") ?? "0");
        const limit = Number(req.url.searchParams.get("limit") ?? "20");
        if (offset >= total) {
          return {
            status: 404,
            body: {
              error: [{ code: "CONTENT_NOT_FOUND.GMP_ITEM_QUERY_API", severity: "INFO" }],
            },
          };
        }
        const items = Array.from({ length: Math.min(limit, total - offset) }, (_, i) => ({
          ...LIVE_ITEM,
          sku: `SKU-${offset + i + 1}`,
        }));
        return { status: 200, body: { ItemResponse: items, totalItems: total } };
      },
    };
  }

  it("walks every page by offset and stops at totalItems", async () => {
    const { client, calls } = createHarness([offsetRoute(5)]);
    const skus: string[] = [];
    for await (const item of client.items.listAll({ limit: 2 })) skus.push(item.sku);

    expect(skus).toEqual(["SKU-1", "SKU-2", "SKU-3", "SKU-4", "SKU-5"]);
    const offsets = apiCalls(calls).map((c) => c.url.searchParams.get("offset"));
    expect(offsets).toEqual(["0", "2", "4"]);
  });

  it("honours a starting offset", async () => {
    const { client } = createHarness([offsetRoute(5)]);
    const skus: string[] = [];
    for await (const item of client.items.listAll({ limit: 2, offset: 3 })) skus.push(item.sku);
    expect(skus).toEqual(["SKU-4", "SKU-5"]);
  });

  it("ends cleanly when the offset runs past the end with no totalItems (404)", async () => {
    const route: MockRoute = {
      method: "GET",
      pathPattern: "/v3/items",
      reply: (req) =>
        req.url.searchParams.get("offset") === "0"
          ? { status: 200, body: { ItemResponse: [LIVE_ITEM] } }
          : {
              status: 404,
              body: { error: [{ code: "CONTENT_NOT_FOUND.GMP_ITEM_QUERY_API" }] },
            },
    };
    const { client } = createHarness([route]);
    const skus: string[] = [];
    for await (const item of client.items.listAll()) skus.push(item.sku);
    expect(skus).toEqual(["SKU-1"]);
  });

  it("follows Walmart's constant, server-advanced cursor when started with one", async () => {
    // Live behaviour: the cursor value never changes between pages; each use advances it.
    let uses = 0;
    const route: MockRoute = {
      method: "GET",
      pathPattern: "/v3/items",
      reply: (req) => {
        const cursor = req.url.searchParams.get("nextCursor");
        if (cursor === "*") {
          return {
            status: 200,
            body: { ItemResponse: [{ ...LIVE_ITEM, sku: "SKU-1" }], nextCursor: "C" },
          };
        }
        uses += 1;
        return uses === 1
          ? {
              status: 200,
              body: { ItemResponse: [{ ...LIVE_ITEM, sku: "SKU-2" }], nextCursor: "C" },
            }
          : { status: 200, body: { ItemResponse: [{ ...LIVE_ITEM, sku: "SKU-3" }] } };
      },
    };
    const { client, calls } = createHarness([route]);
    const skus: string[] = [];
    for await (const item of client.items.listAll({ nextCursor: "*", limit: 1 })) {
      skus.push(item.sku);
    }

    expect(skus).toEqual(["SKU-1", "SKU-2", "SKU-3"]);
    expect(apiCalls(calls)).toHaveLength(3);
  });

  it("merges a query-string cursor into the URL", async () => {
    const route: MockRoute = {
      method: "GET",
      pathPattern: "/v3/items",
      reply: (req) =>
        req.url.searchParams.get("offset") === "20"
          ? { status: 200, body: { ItemResponse: [{ ...LIVE_ITEM, sku: "SKU-B" }] } }
          : {
              status: 200,
              body: {
                ItemResponse: [{ ...LIVE_ITEM, sku: "SKU-A" }],
                nextCursor: "?limit=20&offset=20",
              },
            },
    };
    const { client, calls } = createHarness([route]);
    const first = await client.items.list();
    const second = await client.items.list({ nextCursor: first.nextCursor });

    expect(second.items[0]?.sku).toBe("SKU-B");
    expect(apiCalls(calls)[1]?.url.searchParams.get("offset")).toBe("20");
  });

  it("stops when Walmart stops advancing instead of looping forever", async () => {
    const route = jsonRoute("GET", "/v3/items", {
      ItemResponse: [SAMPLE_ITEM],
      totalItems: 99,
      nextCursor: "same",
    });
    const { client, calls } = createHarness([route]);
    const skus: string[] = [];
    for await (const item of client.items.listAll()) skus.push(item.sku);
    expect(skus).toEqual(["SKU-1"]);
    expect(apiCalls(calls)).toHaveLength(2);

    const { client: cursored } = createHarness([route]);
    const viaCursor: string[] = [];
    for await (const item of cursored.items.listAll({ nextCursor: "*" })) viaCursor.push(item.sku);
    expect(viaCursor).toEqual(["SKU-1"]);
  });
});

describe("items.get", () => {
  it("requests the SKU path and returns the item", async () => {
    const { client, calls } = createHarness([
      jsonRoute("GET", /\/v3\/items\/SKU-1/, { ItemResponse: [SAMPLE_ITEM] }),
    ]);
    const item = await client.items.get("SKU-1");
    expect(item.sku).toBe("SKU-1");
    expect(apiCalls(calls)[0]?.url.pathname).toBe("/v3/items/SKU-1");
  });

  it("url-encodes a SKU containing a slash", async () => {
    const { client, calls } = createHarness([
      jsonRoute("GET", /\/v3\/items\//, { ItemResponse: [{ ...SAMPLE_ITEM, sku: "A/B" }] }),
    ]);
    await client.items.get("A/B");
    expect(apiCalls(calls)[0]?.url.pathname).toBe("/v3/items/A%2FB");
  });

  it("raises WalmartApiError when the response holds no item", async () => {
    const { client } = createHarness([jsonRoute("GET", /\/v3\/items\//, { ItemResponse: [] })]);
    await expect(client.items.get("SKU-404")).rejects.toBeInstanceOf(WalmartApiError);
  });

  it("rejects an empty SKU before sending", async () => {
    const { client, calls } = createHarness([]);
    await expect(client.items.get("")).rejects.toBeInstanceOf(WalmartValidationError);
    expect(calls).toHaveLength(0);
  });
});
