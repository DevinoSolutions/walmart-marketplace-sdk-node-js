import { createWalmartClient } from "../src/index.js";
import type { WalmartClient, WalmartClientConfig } from "../src/types.js";
import { createMockFetch, type MockRoute, type RecordedCall } from "../src/testing/index.js";

/** Obvious placeholders; `npm run check:secrets` knows these are not real credentials. */
export const TEST_CLIENT_ID = "test-client-id";
export const TEST_CLIENT_SECRET = "test-client-secret";
export const TEST_ACCESS_TOKEN = "test-access-token";

export const TOKEN_PATH = "/v3/token";

/** A `POST /v3/token` route returning a 15-minute token. */
export function tokenRoute(
  overrides: { accessToken?: string; expiresIn?: number; status?: number; body?: unknown } = {},
): MockRoute {
  return {
    method: "POST",
    pathPattern: TOKEN_PATH,
    reply: () => ({
      status: overrides.status ?? 200,
      body: overrides.body ?? {
        access_token: overrides.accessToken ?? TEST_ACCESS_TOKEN,
        token_type: "Bearer",
        expires_in: overrides.expiresIn ?? 900,
      },
      headers: { "Content-Type": "application/json" },
    }),
  };
}

export interface Harness {
  client: WalmartClient;
  /** Every request the client made, in order (including the token call). */
  calls: RecordedCall[];
}

/**
 * Builds a client wired to a mock `fetch`.
 *
 * Caller routes are matched first, so a test can override the token route by supplying its
 * own; otherwise a healthy 15-minute token is served.
 */
export function createHarness(
  routes: MockRoute[] = [],
  config: Partial<WalmartClientConfig> = {},
): Harness {
  const { fetch, calls } = createMockFetch([...routes, tokenRoute()]);
  const client = createWalmartClient({
    clientId: TEST_CLIENT_ID,
    clientSecret: TEST_CLIENT_SECRET,
    market: "ca",
    fetch,
    ...config,
  });
  return { client, calls };
}

/** The calls that were not the token request. */
export function apiCalls(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((c) => !c.url.pathname.endsWith(TOKEN_PATH));
}

/** The token requests only. */
export function tokenCalls(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((c) => c.url.pathname.endsWith(TOKEN_PATH));
}

/** A JSON reply route. */
export function jsonRoute(method: string, pathPattern: RegExp | string, body: unknown): MockRoute {
  return {
    method,
    pathPattern,
    reply: () => ({ status: 200, body, headers: { "Content-Type": "application/json" } }),
  };
}

/** A route that fails with the given status and body. */
export function errorRoute(
  method: string,
  pathPattern: RegExp | string,
  status: number,
  body: unknown,
): MockRoute {
  return { method, pathPattern, reply: () => ({ status, body }) };
}

/** A minimal `GET /v3/items` payload with one item. */
export const SAMPLE_ITEM = {
  sku: "SKU-1",
  wpid: "0RCJ4CEXAMPLE",
  gtin: "00012345678905",
  productName: "Sample Widget",
  price: { currency: "CAD", amount: 19.99 },
  publishedStatus: "PUBLISHED",
  lifecycleStatus: "ACTIVE",
};

/** A minimal order payload as it appears inside `list.elements.order[]`. */
export const SAMPLE_ORDER = {
  purchaseOrderId: "PO-1",
  customerOrderId: "CO-1",
  customerEmailId: "buyer@example.invalid",
  orderDate: 1_757_000_000_000,
  shippingInfo: { methodCode: "Standard" },
  orderLines: {
    orderLine: [
      {
        lineNumber: "1",
        item: { productName: "Sample Widget", sku: "SKU-1" },
        orderLineQuantity: { unitOfMeasurement: "EACH", amount: "2" },
        orderLineStatuses: { orderLineStatus: [{ status: "Created" }] },
      },
    ],
  },
};
