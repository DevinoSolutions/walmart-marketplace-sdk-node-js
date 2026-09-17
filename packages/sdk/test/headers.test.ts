import { describe, expect, it } from "vitest";
import { WM_GLOBAL_VERSION } from "../src/index.js";
import { apiCalls, createHarness, jsonRoute, SAMPLE_ITEM, TEST_ACCESS_TOKEN } from "./helpers.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const routes = [
  jsonRoute("GET", "/v3/items", { ItemResponse: [SAMPLE_ITEM] }),
  jsonRoute("GET", "/v3/inventory", { sku: "SKU-1", quantity: { unit: "EACH", amount: 3 } }),
  jsonRoute("GET", "/v3/orders", { list: { meta: {}, elements: { order: [] } } }),
];

describe("request headers", () => {
  it("sends the bearer token, service name, market and global version on every call", async () => {
    const { client, calls } = createHarness(routes, { svcName: "acme-integration" });
    await client.items.list();
    await client.inventory.get("SKU-1");
    await client.orders.list({ createdStartDate: "2026-08-12T00:00:00Z" });

    const api = apiCalls(calls);
    expect(api).toHaveLength(3);
    for (const call of api) {
      expect(call.headers.get("WM_SEC.ACCESS_TOKEN")).toBe(TEST_ACCESS_TOKEN);
      expect(call.headers.get("WM_SVC.NAME")).toBe("acme-integration");
      expect(call.headers.get("WM_MARKET")).toBe("ca");
      expect(call.headers.get("WM_GLOBAL_VERSION")).toBe(WM_GLOBAL_VERSION);
      expect(call.headers.get("accept")).toBe("application/json");
      expect(call.headers.get("WM_QOS.CORRELATION_ID")).toMatch(UUID_RE);
    }
  });

  it("pins WM_GLOBAL_VERSION to 3.1", () => {
    expect(WM_GLOBAL_VERSION).toBe("3.1");
  });

  it("uses a fresh correlation id for every request", async () => {
    const { client, calls } = createHarness(routes);
    await client.items.list();
    await client.items.list();
    await client.items.list();

    const ids = calls.map((c) => c.headers.get("WM_QOS.CORRELATION_ID"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("honours the configured market on API calls", async () => {
    const { client, calls } = createHarness(routes, { market: "cl" });
    await client.items.list();
    expect(apiCalls(calls)[0]?.headers.get("WM_MARKET")).toBe("cl");
  });

  it("never puts the client secret in an outbound header", async () => {
    const { client, calls } = createHarness(routes);
    await client.items.list();
    for (const header of apiCalls(calls)[0]?.headers.values() ?? []) {
      expect(header).not.toContain("test-client-secret");
    }
  });

  it("targets the configured base URL", async () => {
    const { client, calls } = createHarness(routes, { baseUrl: "https://sandbox.walmartapis.com" });
    await client.items.list();
    expect(calls[0]?.url.origin).toBe("https://sandbox.walmartapis.com");
    expect(apiCalls(calls)[0]?.url.origin).toBe("https://sandbox.walmartapis.com");
  });
});
