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

  it("lists items", async () => {
    const page = await liveClient().items.list({ limit: 5 });
    expect(Array.isArray(page.items)).toBe(true);
    for (const item of page.items) {
      expect(typeof item.sku).toBe("string");
      expect(item.sku.length).toBeGreaterThan(0);
    }
  });

  it("lists recent orders", async () => {
    const page = await liveClient().orders.list({
      createdStartDate: daysAgoIso(30),
      limit: 5,
    });
    expect(Array.isArray(page.orders)).toBe(true);
    for (const order of page.orders) {
      expect(typeof order.purchaseOrderId).toBe("string");
    }
  });

  it.skipIf(liveFeedId === "")("reads the status of an existing feed", async () => {
    const status = await liveClient().feeds.getStatus(liveFeedId, { includeDetails: false });
    expect(status.feedId).toBe(liveFeedId);
    expect(typeof status.feedStatus).toBe("string");
  });
});
