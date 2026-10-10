// READ-ONLY live smoke tests against the REAL Walmart Marketplace account.
//
// Enable with WALMART_LIVE_TESTS=true plus credentials in .env. Never runs in CI.
// Every assertion here is a read. Adding anything that changes the account is a hard failure
// of `npm run check:live-readonly`, not a judgement call.
//
// The client is built inside each test, not at describe scope: vitest evaluates a skipped
// describe body during collection, so an eager client would throw on a machine with no
// credentials instead of skipping.
import { describe, expect, it } from "vitest";
import { daysAgoIso, liveClient, liveEnabled, liveFeedId } from "./env.js";

describe.skipIf(!liveEnabled)("live (read-only)", () => {
  it("mints an access token", async () => {
    const token = await liveClient().auth.getAccessToken();
    expect(token.accessToken.length).toBeGreaterThan(0);
    expect(token.tokenType).toBe("Bearer");
    expect(token.expiresAtMs).toBeGreaterThan(Date.now());
  });

  it("reuses the cached token on a second call", async () => {
    const first = await liveClient().auth.getAccessToken();
    const second = await liveClient().auth.getAccessToken();
    expect(second.expiresAtMs).toBe(first.expiresAtMs);
  });

  it("lists items, then reads one item and its inventory by SKU", async () => {
    const page = await liveClient().items.list({ limit: 5 });
    expect(Array.isArray(page.items)).toBe(true);
    for (const item of page.items) {
      expect(typeof item.sku).toBe("string");
      expect(item.sku.length).toBeGreaterThan(0);
    }
    const first = page.items[0];
    if (first === undefined) return; // an empty catalog is a valid account state
    const item = await liveClient().items.get(first.sku);
    expect(item.sku).toBe(first.sku);
    const inventory = await liveClient().inventory.get(first.sku);
    expect(inventory.sku).toBe(first.sku);
    expect(inventory.quantity.unit).toBe("EACH");
    expect(Number.isInteger(inventory.quantity.amount)).toBe(true);
  });

  it("lists recent orders, then reads one order by id", async () => {
    const page = await liveClient().orders.list({
      createdStartDate: daysAgoIso(30),
      limit: 5,
    });
    expect(Array.isArray(page.orders)).toBe(true);
    for (const order of page.orders) {
      expect(typeof order.purchaseOrderId).toBe("string");
    }
    const first = page.orders[0];
    if (first === undefined) return; // no orders in the window
    const order = await liveClient().orders.get(first.purchaseOrderId);
    expect(order.purchaseOrderId).toBe(first.purchaseOrderId);
    expect(order.orderLines.length).toBeGreaterThan(0);
  });

  it("reads the feed history, one item's lag time and its catalog entry", async () => {
    const feeds = await liveClient().feeds.list({ limit: 2 });
    expect(Array.isArray(feeds.feeds)).toBe(true);
    for (const feed of feeds.feeds) expect(typeof feed.feedId).toBe("string");

    const first = (await liveClient().items.list({ limit: 1 })).items[0];
    if (first === undefined) return; // an empty catalog is a valid account state
    const lag = await liveClient().lagTime.get(first.sku);
    if (lag !== null) expect(Number.isInteger(lag.fulfillmentLagTime)).toBe(true);

    if (first.gtin === undefined) return;
    const found = await liveClient().catalog.search({ gtin: first.gtin });
    expect(Array.isArray(found.items)).toBe(true);
    for (const hit of found.items) expect(typeof hit.itemId).toBe("string");
  });

  it("reads the shipping templates", async () => {
    const page = await liveClient().shipping.listTemplates();
    expect(Array.isArray(page.templates)).toBe(true);
    const first = page.templates[0];
    if (first === undefined) return;
    const template = await liveClient().shipping.getTemplate(first.id);
    expect(template.id).toBe(first.id);
    expect(Array.isArray(template.shippingMethods)).toBe(true);
  });

  it("reads the report requests and one download link (never fetched or printed)", async () => {
    const page = await liveClient().reports.list({ limit: 5 });
    expect(Array.isArray(page.requests)).toBe(true);
    const ready = page.requests.find((request) => request.requestStatus === "READY");
    if (ready === undefined) return;
    const request = await liveClient().reports.get(ready.requestId);
    expect(request.requestId).toBe(ready.requestId);
    const download = await liveClient().reports.getDownload(ready.requestId);
    expect(download.downloadUrl.startsWith("https://")).toBe(true);
  });

  it.skipIf(liveFeedId === "")("reads the status of an existing feed", async () => {
    const status = await liveClient().feeds.getStatus(liveFeedId, { includeDetails: false });
    expect(status.feedId).toBe(liveFeedId);
    expect(typeof status.feedStatus).toBe("string");
  });
});
