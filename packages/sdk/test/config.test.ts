import { describe, expect, it } from "vitest";
import { createWalmartClient, WalmartConfigurationError } from "../src/index.js";
import { createMockFetch } from "../src/testing/index.js";
import { TEST_CLIENT_ID, TEST_CLIENT_SECRET, tokenRoute } from "./helpers.js";

function make(overrides: Record<string, unknown> = {}): unknown {
  const { fetch } = createMockFetch([tokenRoute()]);
  return createWalmartClient({
    clientId: TEST_CLIENT_ID,
    clientSecret: TEST_CLIENT_SECRET,
    fetch,
    ...overrides,
  } as Parameters<typeof createWalmartClient>[0]);
}

describe("createWalmartClient configuration", () => {
  it("defaults the market to ca", () => {
    const client = make() as { market: string };
    expect(client.market).toBe("ca");
  });

  it("exposes every API module", () => {
    const client = make() as Record<string, unknown>;
    for (const key of ["auth", "items", "feeds", "inventory", "price", "orders"]) {
      expect(client[key], key).toBeDefined();
    }
  });

  it("rejects a missing clientId", () => {
    expect(() => make({ clientId: "" })).toThrow(WalmartConfigurationError);
  });

  it("rejects a missing clientSecret", () => {
    expect(() => make({ clientSecret: undefined })).toThrow(WalmartConfigurationError);
  });

  it("rejects an unknown market", () => {
    expect(() => make({ market: "uk" })).toThrow(/must be one of/);
  });

  it("rejects a non-https baseUrl", () => {
    expect(() => make({ baseUrl: "http://marketplace.walmartapis.com" })).toThrow(
      WalmartConfigurationError,
    );
  });

  it("allows an http loopback baseUrl for local proxies", () => {
    expect(() => make({ baseUrl: "http://127.0.0.1:8080" })).not.toThrow();
  });

  it("rejects a non-positive timeoutMs", () => {
    expect(() => make({ timeoutMs: 0 })).toThrow(WalmartConfigurationError);
  });

  it("does not touch the network at construction time", () => {
    const { fetch, calls } = createMockFetch([tokenRoute()]);
    createWalmartClient({
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
      fetch,
    });
    expect(calls).toHaveLength(0);
  });
});
