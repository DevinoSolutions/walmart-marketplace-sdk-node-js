import { describe, expect, it } from "vitest";
import {
  createWalmartClient,
  REDACTED,
  WalmartApiError,
  WalmartAuthError,
  WalmartNetworkError,
} from "../src/index.js";
import { createMockFetch } from "../src/testing/index.js";
import {
  createHarness,
  errorRoute,
  TEST_ACCESS_TOKEN,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  tokenRoute,
} from "./helpers.js";

function walmartError(code: string, description: string): unknown {
  return { error: [{ code, description, severity: "ERROR", category: "DATA" }] };
}

describe("error mapping", () => {
  it.each([
    [400, "400"],
    [403, "403"],
    [404, "404"],
    [429, "429"],
    [500, "500"],
  ])("maps HTTP %i to WalmartApiError", async (status) => {
    const { client } = createHarness([
      errorRoute("GET", "/v3/items", status, walmartError("ERR_1", "something went wrong")),
    ]);
    const error = await client.items.list().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WalmartApiError);
    expect(error).toMatchObject({ status, upstreamCode: "ERR_1" });
    expect((error as WalmartApiError).message).toContain("something went wrong");
    expect((error as WalmartApiError).correlationId).toMatch(/[0-9a-f-]{36}/i);
  });

  it("maps 401 to WalmartAuthError", async () => {
    const { client } = createHarness([
      errorRoute("GET", "/v3/items", 401, walmartError("INVALID_TOKEN", "token expired")),
    ]);
    await expect(client.items.list()).rejects.toBeInstanceOf(WalmartAuthError);
  });

  it("marks 429 and 5xx retryable, 4xx not", async () => {
    const rateLimited = createHarness([errorRoute("GET", "/v3/items", 429, "")]);
    const badRequest = createHarness([errorRoute("GET", "/v3/items", 400, "")]);

    await expect(rateLimited.client.items.list()).rejects.toMatchObject({ retryable: true });
    await expect(badRequest.client.items.list()).rejects.toMatchObject({ retryable: false });
  });

  it("reads the { errors: { error: [...] } } wrapper too", async () => {
    const { client } = createHarness([
      errorRoute("GET", "/v3/items", 400, {
        errors: { error: { code: "NESTED", description: "wrapped shape" } },
      }),
    ]);
    await expect(client.items.list()).rejects.toMatchObject({
      upstreamCode: "NESTED",
      status: 400,
    });
  });

  it("falls back to the response text for a non-JSON body", async () => {
    const { client } = createHarness([
      errorRoute("GET", "/v3/items", 502, "<html>Bad Gateway</html>"),
    ]);
    const error = await client.items.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalmartApiError);
    expect((error as WalmartApiError).message).toContain("Bad Gateway");
    expect((error as WalmartApiError).body).toBe("<html>Bad Gateway</html>");
  });

  it("exposes every upstream error entry", async () => {
    const { client } = createHarness([
      errorRoute("GET", "/v3/items", 400, {
        error: [
          { code: "A", description: "first" },
          { code: "B", description: "second" },
        ],
      }),
    ]);
    const error = (await client.items.list().catch((e: unknown) => e)) as WalmartApiError;
    expect(error.errors).toHaveLength(2);
    expect(error.errors[1]).toMatchObject({ code: "B", description: "second" });
  });

  it("wraps a transport failure in WalmartNetworkError", async () => {
    const failing: typeof globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const client = createWalmartClient({
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
      fetch: failing,
    });
    const error = await client.items.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalmartNetworkError);
    expect((error as WalmartNetworkError).timeout).toBe(false);
  });

  it("reports a timeout as a timeout", async () => {
    const hanging: typeof globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("timed out", "TimeoutError"));
        });
      });
    const client = createWalmartClient({
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
      fetch: hanging,
      timeoutMs: 20,
    });
    const error = await client.items.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalmartNetworkError);
    expect((error as WalmartNetworkError).timeout).toBe(true);
  });

  it("propagates a caller abort unchanged", async () => {
    const controller = new AbortController();
    controller.abort();
    const { client } = createHarness([]);
    await expect(client.items.list({}, { signal: controller.signal })).rejects.toBeInstanceOf(
      DOMException,
    );
  });

  it("serializes to a JSON-safe object", async () => {
    const { client } = createHarness([
      errorRoute("GET", "/v3/items", 404, walmartError("NOT_FOUND", "missing")),
    ]);
    const error = (await client.items.list().catch((e: unknown) => e)) as WalmartApiError;
    const json = JSON.parse(JSON.stringify(error.toJSON())) as Record<string, unknown>;
    expect(json).toMatchObject({ name: "WalmartApiError", code: "api", status: 404 });
  });
});

describe("credential leakage", () => {
  it("redacts the client secret and access token out of upstream bodies", async () => {
    const echo = createMockFetch([
      {
        method: "GET",
        pathPattern: "/v3/items",
        reply: () => ({
          status: 400,
          body: {
            error: [
              {
                code: "ECHO",
                description: `rejected secret=${TEST_CLIENT_SECRET} token=${TEST_ACCESS_TOKEN}`,
              },
            ],
          },
        }),
      },
      tokenRoute(),
    ]);
    const client = createWalmartClient({
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
      fetch: echo.fetch,
    });

    const error = (await client.items.list().catch((e: unknown) => e)) as WalmartApiError;
    const serialized = JSON.stringify(error.toJSON());

    expect(error.message).not.toContain(TEST_CLIENT_SECRET);
    expect(error.message).not.toContain(TEST_ACCESS_TOKEN);
    expect(serialized).not.toContain(TEST_CLIENT_SECRET);
    expect(serialized).not.toContain(TEST_ACCESS_TOKEN);
    expect(error.message).toContain(REDACTED);
  });

  it("redacts the Basic credential from a token-endpoint error body", async () => {
    const basic = Buffer.from(`${TEST_CLIENT_ID}:${TEST_CLIENT_SECRET}`, "utf8").toString("base64");
    const { fetch } = createMockFetch([
      tokenRoute({
        status: 400,
        body: { error: [{ code: "BAD_CRED", description: `saw Basic ${basic}` }] },
      }),
    ]);
    const client = createWalmartClient({
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
      fetch,
    });

    const error = (await client.auth.getAccessToken().catch((e: unknown) => e)) as WalmartAuthError;
    expect(error).toBeInstanceOf(WalmartAuthError);
    expect(JSON.stringify(error.toJSON())).not.toContain(basic);
  });
});
