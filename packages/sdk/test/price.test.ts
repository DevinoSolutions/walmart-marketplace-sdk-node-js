import { describe, expect, it } from "vitest";
import { PRICE_MAX_ITEMS, WalmartApiError, WalmartValidationError } from "../src/index.js";
import type { MockRoute } from "../src/testing/index.js";
import { apiCalls, createHarness, errorRoute, jsonRoute } from "./helpers.js";

/** The synchronous `POST /v3/price` answer, as captured live on 2026-11-05 (SKU replaced). */
const RESPONSE = {
  feedStatus: "PROCESSED",
  feedSubmissionDate: 1_793_894_219_643,
  itemsReceived: 1,
  itemsSucceeded: 1,
  itemsFailed: 0,
  itemsProcessing: 0,
  itemDetails: {
    itemIngestionStatus: [{ martId: 1, sku: "SKU-1", ingestionStatus: "SUCCESS" }],
  },
};

const route = jsonRoute("POST", "/v3/price", RESPONSE);

type PriceBody = { MPItem: { Price: { sku: string } }[] };

describe("price.update", () => {
  it("sends the spec-5.0 MPItemFeedHeader and one MPItem[{Price}] entry", async () => {
    const { client, calls } = createHarness([route]);
    const result = await client.price.update({
      items: [{ sku: "SKU-1", price: 24.99, msrp: 29.99 }],
    });

    const call = apiCalls(calls)[0];
    expect(call?.method).toBe("POST");
    expect(call?.url.pathname).toBe("/v3/price");
    expect(call?.bodyJson).toEqual({
      MPItemFeedHeader: {
        mart: "WALMART_CA",
        locale: ["en", "fr"],
        version: "5.0.20250801-18_47_55-api",
        businessUnit: "WALMART_CA",
        tenant: "WALMART_CA",
      },
      MPItem: [{ Price: { sku: "SKU-1", price: 24.99, msrp: 29.99 } }],
    });
    expect(result).toMatchObject({
      feedStatus: "PROCESSED",
      itemsReceived: 1,
      itemsSucceeded: 1,
      itemsFailed: 0,
    });
    expect(result.feedId).toBeUndefined();
    expect(result.ingestionErrors).toEqual([]);
    expect(result.itemDetails[0]).toMatchObject({ sku: "SKU-1", ingestionStatus: "SUCCESS" });
  });

  it("derives the mart, businessUnit and tenant from the configured market", async () => {
    const { client, calls } = createHarness([route], { market: "mx" });
    await client.price.update({ items: [{ sku: "SKU-1", price: 10 }] });
    expect(apiCalls(calls)[0]?.bodyJson).toMatchObject({
      MPItemFeedHeader: { mart: "WALMART_MX", businessUnit: "WALMART_MX", tenant: "WALMART_MX" },
    });
  });

  it("lets the caller override any header field", async () => {
    const { client, calls } = createHarness([route]);
    await client.price.update({
      items: [{ sku: "SKU-1", price: 10 }],
      header: { locale: "fr", version: "5.1", tenant: "OTHER" },
    });
    expect(apiCalls(calls)[0]?.bodyJson).toMatchObject({
      MPItemFeedHeader: {
        mart: "WALMART_CA",
        locale: "fr",
        version: "5.1",
        businessUnit: "WALMART_CA",
        tenant: "OTHER",
      },
    });
  });

  it("omits msrp when it was not supplied", async () => {
    const { client, calls } = createHarness([route]);
    await client.price.update({ items: [{ sku: "SKU-1", price: 10 }] });
    const body = apiCalls(calls)[0]?.bodyJson as {
      MPItem: { Price: Record<string, unknown> }[];
    };
    expect(Object.keys(body.MPItem[0]?.Price ?? {})).toEqual(["sku", "price"]);
  });

  it("rejects an empty batch and a negative price before sending", async () => {
    const { client, calls } = createHarness([route]);
    await expect(client.price.update({ items: [] })).rejects.toBeInstanceOf(WalmartValidationError);
    await expect(
      client.price.update({ items: [{ sku: "SKU-1", price: -1 }] }),
    ).rejects.toBeInstanceOf(WalmartValidationError);
    expect(calls).toHaveLength(0);
  });

  it("caps the batch at the per-call limit", async () => {
    expect(PRICE_MAX_ITEMS).toBe(100);
    const { client, calls } = createHarness([route]);
    const items = Array.from({ length: PRICE_MAX_ITEMS + 1 }, (_, i) => ({
      sku: `SKU-${String(i)}`,
      price: 1,
    }));
    await expect(client.price.update({ items })).rejects.toBeInstanceOf(WalmartValidationError);
    expect(calls).toHaveLength(0);
  });

  it("rethrows a single-item HTTP failure as WalmartApiError", async () => {
    const { client } = createHarness([
      errorRoute("POST", "/v3/price", 520, { errors: { error: [{ code: "X" }] } }),
    ]);
    await expect(
      client.price.update({ items: [{ sku: "SKU-1", price: 10 }] }),
    ).rejects.toBeInstanceOf(WalmartApiError);
  });
});

describe("price.update with several items", () => {
  // Live 2026-11-05: the endpoint takes ONE item per request; two items answered HTTP 520
  // "Item(s) Not Supported more than 1". The SDK therefore sends one request per item, in
  // order, and never retries (ADR 0001).
  function perSkuRoute(failSku?: string): MockRoute {
    return {
      method: "POST",
      pathPattern: "/v3/price",
      reply: (req) => {
        const sku = (req.bodyJson as PriceBody).MPItem[0]?.Price.sku ?? "";
        if (sku === failSku) {
          return {
            status: 520,
            body: { errors: { error: [{ code: "PDR-0001", description: "rejected" }] } },
          };
        }
        return {
          status: 200,
          body: {
            ...RESPONSE,
            itemDetails: { itemIngestionStatus: [{ sku, ingestionStatus: "SUCCESS" }] },
          },
          headers: { "Content-Type": "application/json" },
        };
      },
    };
  }

  it("sends one request per item and aggregates the outcome", async () => {
    const { client, calls } = createHarness([perSkuRoute()]);
    const result = await client.price.update({
      items: [
        { sku: "SKU-1", price: 10 },
        { sku: "SKU-2", price: 20 },
      ],
    });

    const sent = apiCalls(calls).map((c) => (c.bodyJson as PriceBody).MPItem[0]?.Price.sku);
    expect(sent).toEqual(["SKU-1", "SKU-2"]);
    expect(result).toMatchObject({ itemsReceived: 2, itemsSucceeded: 2, itemsFailed: 0 });
    expect(result.itemDetails.map((d) => d.sku)).toEqual(["SKU-1", "SKU-2"]);
    expect(result.feedStatus).toBe("PROCESSED");
  });

  it("records a rejected item as failed, keeps going, and never retries", async () => {
    const { client, calls } = createHarness([perSkuRoute("SKU-1")]);
    const result = await client.price.update({
      items: [
        { sku: "SKU-1", price: 10 },
        { sku: "SKU-2", price: 20 },
      ],
    });

    expect(apiCalls(calls)).toHaveLength(2);
    expect(result).toMatchObject({ itemsReceived: 2, itemsSucceeded: 1, itemsFailed: 1 });
    expect(result.itemDetails[0]).toMatchObject({ sku: "SKU-1", ingestionStatus: "ERROR" });
    expect(result.itemDetails[0]?.ingestionErrors[0]).toMatchObject({ code: "PDR-0001" });
    expect(result.itemDetails[1]).toMatchObject({ sku: "SKU-2", ingestionStatus: "SUCCESS" });
  });

  it("counts a 200 carrying only ingestionErrors as a failed item", async () => {
    const { client } = createHarness([
      jsonRoute("POST", "/v3/price", {
        ingestionErrors: {
          ingestionError: [{ type: "SYSTEM_ERROR", code: "PDR-0016", description: "ISE" }],
        },
      }),
    ]);
    const result = await client.price.update({
      items: [
        { sku: "SKU-1", price: 10 },
        { sku: "SKU-2", price: 20 },
      ],
    });
    expect(result).toMatchObject({ itemsReceived: 2, itemsSucceeded: 0, itemsFailed: 2 });
    expect(result.ingestionErrors).toHaveLength(2);
  });
});

describe("price.update live failure shape (2026-10-10)", () => {
  // Before the spec-5.0 header and the `Price` item wrapper, the production Canadian account
  // answered HTTP 200 with only a top-level ingestionErrors block (PDR-0016) and no feedId. A
  // body the account rejects can still arrive that way, so the SDK surfaces the errors on the
  // result instead of leaving them buried in `raw`.
  const PDR_FAILURE = {
    ingestionErrors: {
      ingestionError: [
        { type: "SYSTEM_ERROR", code: "PDR-0016", description: "INTERNAL SERVER ERROR" },
      ],
    },
  };

  it("exposes top-level ingestionErrors and leaves feedId undefined", async () => {
    const { client } = createHarness([jsonRoute("POST", "/v3/price", PDR_FAILURE)]);
    const result = await client.price.update({ items: [{ sku: "SKU-1", price: 10 }] });

    expect(result.feedId).toBeUndefined();
    expect(result.itemDetails).toEqual([]);
    expect(result.ingestionErrors).toEqual([
      { type: "SYSTEM_ERROR", code: "PDR-0016", description: "INTERNAL SERVER ERROR" },
    ]);
    expect(result.raw).toEqual(PDR_FAILURE);
  });

  it("reports no ingestion errors for an accepted call", async () => {
    const { client } = createHarness([route]);
    const result = await client.price.update({ items: [{ sku: "SKU-1", price: 10 }] });
    expect(result.ingestionErrors).toEqual([]);
  });
});
