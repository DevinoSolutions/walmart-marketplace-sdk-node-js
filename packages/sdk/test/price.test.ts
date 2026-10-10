import { describe, expect, it } from "vitest";
import { PRICE_MAX_ITEMS, WalmartValidationError } from "../src/index.js";
import { apiCalls, createHarness, jsonRoute } from "./helpers.js";

const RESPONSE = {
  feedId: "PRICE-FEED-1",
  itemsReceived: 1,
  itemsSucceeded: 1,
  itemsFailed: 0,
  itemDetails: {
    itemIngestionStatus: [{ sku: "SKU-1", ingestionStatus: "SUCCESS" }],
  },
};

const route = jsonRoute("POST", "/v3/price", RESPONSE);

describe("price.update", () => {
  it("sends the MPItemFeedHeader / MPItem payload with the CA mart", async () => {
    const { client, calls } = createHarness([route]);
    const result = await client.price.update({
      items: [{ sku: "SKU-1", price: 24.99, msrp: 29.99 }],
    });

    const call = apiCalls(calls)[0];
    expect(call?.method).toBe("POST");
    expect(call?.url.pathname).toBe("/v3/price");
    expect(call?.bodyJson).toEqual({
      MPItemFeedHeader: { mart: "WALMART_CA", locale: "en", version: "1.0" },
      MPItem: [{ sku: "SKU-1", price: 24.99, msrp: 29.99 }],
    });
    expect(result).toMatchObject({ feedId: "PRICE-FEED-1", itemsSucceeded: 1 });
    expect(result.itemDetails[0]).toMatchObject({ sku: "SKU-1", ingestionStatus: "SUCCESS" });
  });

  it("derives the mart from the configured market", async () => {
    const { client, calls } = createHarness([route], { market: "mx" });
    await client.price.update({ items: [{ sku: "SKU-1", price: 10 }] });
    expect(apiCalls(calls)[0]?.bodyJson).toMatchObject({
      MPItemFeedHeader: { mart: "WALMART_MX" },
    });
  });

  it("lets the caller override any header field", async () => {
    const { client, calls } = createHarness([route]);
    await client.price.update({
      items: [{ sku: "SKU-1", price: 10 }],
      header: { locale: "fr", version: "1.5", businessUnit: "WALMART_CA" },
    });
    expect(apiCalls(calls)[0]?.bodyJson).toMatchObject({
      MPItemFeedHeader: {
        mart: "WALMART_CA",
        locale: "fr",
        version: "1.5",
        businessUnit: "WALMART_CA",
      },
    });
  });

  it("omits msrp when it was not supplied", async () => {
    const { client, calls } = createHarness([route]);
    await client.price.update({ items: [{ sku: "SKU-1", price: 10 }] });
    const body = apiCalls(calls)[0]?.bodyJson as { MPItem: Record<string, unknown>[] };
    expect(Object.keys(body.MPItem[0] ?? {})).toEqual(["sku", "price"]);
  });

  it("rejects an empty batch and a negative price before sending", async () => {
    const { client, calls } = createHarness([route]);
    await expect(client.price.update({ items: [] })).rejects.toBeInstanceOf(WalmartValidationError);
    await expect(
      client.price.update({ items: [{ sku: "SKU-1", price: -1 }] }),
    ).rejects.toBeInstanceOf(WalmartValidationError);
    expect(calls).toHaveLength(0);
  });

  it("caps the batch at Walmart's documented maximum", () => {
    expect(PRICE_MAX_ITEMS).toBe(10_000);
  });
});

describe("price.update live failure shape (2026-10-10)", () => {
  // On the production Canadian account the price API answered HTTP 200 with only a top-level
  // ingestionErrors block (PDR-0016) and no feedId, for both the feed-shaped body and the
  // single-item `pricing` body. The call "succeeds" at the HTTP level, so the SDK surfaces the
  // errors on the result instead of leaving them buried in `raw`.
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
