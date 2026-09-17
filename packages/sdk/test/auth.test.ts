import { describe, expect, it } from "vitest";
import { TOKEN_REFRESH_SKEW_MS, WalmartAuthError } from "../src/index.js";
import { createMockFetch, type MockRoute } from "../src/testing/index.js";
import { createWalmartClient } from "../src/index.js";
import {
  apiCalls,
  createHarness,
  jsonRoute,
  SAMPLE_ITEM,
  TEST_ACCESS_TOKEN,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  tokenCalls,
  tokenRoute,
  TOKEN_PATH,
} from "./helpers.js";

const itemsRoute = jsonRoute("GET", "/v3/items", { ItemResponse: [SAMPLE_ITEM] });

describe("token acquisition", () => {
  it("posts client_credentials with Basic auth over the key pair", async () => {
    const { client, calls } = createHarness();
    await client.auth.getAccessToken();

    const call = tokenCalls(calls)[0];
    expect(call?.method).toBe("POST");
    expect(call?.url.pathname).toBe(TOKEN_PATH);
    expect(call?.bodyText).toBe("grant_type=client_credentials");
    expect(call?.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    const expected = Buffer.from(`${TEST_CLIENT_ID}:${TEST_CLIENT_SECRET}`, "utf8").toString(
      "base64",
    );
    expect(call?.headers.get("authorization")).toBe(`Basic ${expected}`);
  });

  it("sends WM_MARKET, WM_SVC.NAME and a correlation id on the token call, but not WM_GLOBAL_VERSION", async () => {
    const { client, calls } = createHarness([], { market: "mx", svcName: "acme-integration" });
    await client.auth.getAccessToken();

    const call = tokenCalls(calls)[0];
    expect(call?.headers.get("WM_MARKET")).toBe("mx");
    expect(call?.headers.get("WM_SVC.NAME")).toBe("acme-integration");
    expect(call?.headers.get("WM_QOS.CORRELATION_ID")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(call?.headers.get("WM_GLOBAL_VERSION")).toBeNull();
  });

  it("derives an absolute expiry from expires_in", async () => {
    const start = 1_700_000_000_000;
    const { client } = createHarness([], { now: () => start });
    const token = await client.auth.getAccessToken();
    expect(token.accessToken).toBe(TEST_ACCESS_TOKEN);
    expect(token.tokenType).toBe("Bearer");
    expect(token.expiresAtMs).toBe(start + 900_000);
  });

  it("reuses the cached token across calls", async () => {
    const { client, calls } = createHarness([itemsRoute]);
    await client.items.list();
    await client.items.list();
    expect(tokenCalls(calls)).toHaveLength(1);
    expect(apiCalls(calls)).toHaveLength(2);
  });

  it("refreshes once the token is inside the 60 s skew window", async () => {
    let now = 1_700_000_000_000;
    const { client, calls } = createHarness([itemsRoute], { now: () => now });
    await client.items.list();
    // Still 61 s of life left: no refresh.
    now += 900_000 - TOKEN_REFRESH_SKEW_MS - 1_000;
    await client.items.list();
    expect(tokenCalls(calls)).toHaveLength(1);
    // Now inside the skew window.
    now += 2_000;
    await client.items.list();
    expect(tokenCalls(calls)).toHaveLength(2);
  });

  it("serializes concurrent refreshes into a single token request", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowToken: MockRoute = {
      method: "POST",
      pathPattern: TOKEN_PATH,
      reply: async () => {
        await gate;
        return {
          status: 200,
          body: { access_token: TEST_ACCESS_TOKEN, token_type: "Bearer", expires_in: 900 },
        };
      },
    };
    const { fetch, calls } = createMockFetch([itemsRoute, slowToken]);
    const client = createWalmartClient({
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
      fetch,
    });

    const pending = Promise.all([client.items.list(), client.items.list(), client.items.list()]);
    release?.();
    await pending;

    expect(tokenCalls(calls)).toHaveLength(1);
    expect(apiCalls(calls)).toHaveLength(3);
  });

  it("does not poison the cache when a token request fails", async () => {
    let attempt = 0;
    const flaky: MockRoute = {
      method: "POST",
      pathPattern: TOKEN_PATH,
      reply: () => {
        attempt += 1;
        if (attempt === 1) {
          return { status: 503, body: { error: [{ code: "SYSTEM_ERROR" }] } };
        }
        return {
          status: 200,
          body: { access_token: TEST_ACCESS_TOKEN, token_type: "Bearer", expires_in: 900 },
        };
      },
    };
    const { fetch } = createMockFetch([flaky]);
    const client = createWalmartClient({
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
      fetch,
    });

    await expect(client.auth.getAccessToken()).rejects.toBeInstanceOf(WalmartAuthError);
    await expect(client.auth.getAccessToken()).resolves.toMatchObject({
      accessToken: TEST_ACCESS_TOKEN,
    });
  });

  it("raises WalmartAuthError when the credentials are rejected", async () => {
    const { fetch } = createMockFetch([
      tokenRoute({ status: 401, body: { error: [{ code: "INVALID_CREDENTIAL" }] } }),
    ]);
    const rejected = createWalmartClient({
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
      fetch,
    });
    await expect(rejected.auth.getAccessToken()).rejects.toMatchObject({
      name: "WalmartAuthError",
      status: 401,
      upstreamCode: "INVALID_CREDENTIAL",
    });
  });

  it("raises WalmartAuthError when the token response has no access_token", async () => {
    const { fetch } = createMockFetch([tokenRoute({ body: { token_type: "Bearer" } })]);
    const client = createWalmartClient({
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
      fetch,
    });
    await expect(client.auth.getAccessToken()).rejects.toThrow(/without a usable access_token/);
  });

  it("drops the cached token after a 401 on a normal call", async () => {
    const { client, calls } = createHarness([
      { method: "GET", pathPattern: "/v3/items", reply: () => ({ status: 401, body: "" }) },
    ]);
    await expect(client.items.list()).rejects.toBeInstanceOf(WalmartAuthError);
    await expect(client.items.list()).rejects.toBeInstanceOf(WalmartAuthError);
    // Two token calls: the 401 invalidated the first token rather than replaying it.
    expect(tokenCalls(calls)).toHaveLength(2);
  });
});
