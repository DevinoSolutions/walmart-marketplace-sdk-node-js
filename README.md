# Walmart Marketplace SDK (Node.js / TypeScript)

A transport-independent TypeScript SDK for the Walmart Marketplace **Global API**, written for
**Walmart Canada** sellers (`WM_MARKET: ca`) and usable for Mexico, Chile and the US.

- **Package:** `@devino/walmart-marketplace-sdk`
- **Node:** >= 22.12 (uses the platform `fetch`, `FormData`, `crypto.randomUUID`)
- **Zero runtime dependencies** other than `zod`
- Strict TypeScript, no `any`, ESM only

```bash
npm install @devino/walmart-marketplace-sdk
```

## Quick start

```ts
import { createWalmartClient } from "@devino/walmart-marketplace-sdk";

const client = createWalmartClient({
  clientId: process.env.WALMART_CLIENT_ID!,
  clientSecret: process.env.WALMART_CLIENT_SECRET!,
  market: "ca",
});

// Optional startup preflight: proves the credentials work before real traffic.
await client.auth.getAccessToken();

for await (const item of client.items.listAll({ limit: 200, lifecycleStatus: "ACTIVE" })) {
  console.log(item.sku, item.price?.amount, item.publishedStatus);
}
```

Keep **one long-lived client**. It caches the 15-minute access token and refreshes it for you;
constructing a client per request throws that cache away and doubles your request count.

## What it covers

| Module      | Methods                                                              |
| ----------- | -------------------------------------------------------------------- |
| `auth`      | `getAccessToken` (cached, auto-refreshed)                            |
| `items`     | `list`, `listAll`, `get`                                             |
| `feeds`     | `submit` (write), `getStatus`                                        |
| `inventory` | `get`, `update` (write)                                              |
| `price`     | `update` (write)                                                     |
| `orders`    | `list`, `listAll`, `get`, `acknowledge` / `ship` / `cancel` (writes) |

The full surface, including every exported type and constant, is documented in
[`docs/research/sdk-public-api.md`](docs/research/sdk-public-api.md). The wire shapes, and
which of them are still **ASSUMPTION**s for Canada, are in
[`docs/research/walmart-api-contracts.md`](docs/research/walmart-api-contracts.md). Read that
file before debugging a `400`.

## Reading data

```ts
// One page at a time, with a cursor you hand straight back.
const page = await client.items.list({ limit: 50 });
const next = page.nextCursor ? await client.items.list({ nextCursor: page.nextCursor }) : undefined;

// Orders from the last 30 days.
const since = new Date(Date.now() - 30 * 864e5).toISOString();
for await (const order of client.orders.listAll({ createdStartDate: since, status: "CREATED" })) {
  console.log(order.purchaseOrderId, order.orderLines.length);
}
```

`orderDate` arrives from Walmart as epoch milliseconds and is normalized to an ISO-8601 UTC
string. Quantities arrive quoted and are coerced to numbers. Every response object keeps the
untouched wire payload in `raw`, so a field the SDK does not model yet is still reachable.

## Writing data

```ts
await client.inventory.update({ sku: "SKU-1", amount: 25 }); // amount: 0 takes it out of stock

await client.price.update({
  items: [{ sku: "SKU-1", price: 24.99, msrp: 29.99 }],
});

const { feedId } = await client.feeds.submit({
  feedType: "MP_ITEM_INTL", // MP_ITEM is US-only and rejected locally on ca/mx/cl
  file: { MPItemFeedHeader: { version: "4.2" }, MPItem: [] },
});
const status = await client.feeds.getStatus(feedId);
```

Feed processing is asynchronous, and `feedStatus: "PROCESSED"` means _finished_, not
_successful_ — a feed with `itemsFailed > 0` still reports `PROCESSED`. Always read
`status.itemDetails[].ingestionStatus`.

## Errors and retries

```ts
import { WalmartApiError, WalmartNetworkError } from "@devino/walmart-marketplace-sdk";

try {
  await client.orders.ship(poId, { lines });
} catch (err) {
  if (err instanceof WalmartNetworkError) {
    // No HTTP response came back. On a write this is INDETERMINATE: the request may still
    // have landed. Re-read the order before retrying.
  }
  if (err instanceof WalmartApiError && err.retryable) {
    // 429 or 5xx. `retryable` is advice, not behaviour — the SDK never retries on its own.
  }
}
```

The SDK issues exactly one request per call and never retries. That is deliberate: several
Walmart operations are not idempotent, so an automatic retry on an ambiguous `5xx` can produce
two shipments for one order line. See [ADR 0001](docs/adr/0001-thin-fetch-client.md).

Every error carries the request's `WM_QOS.CORRELATION_ID`, which is what Walmart support asks
for. Credentials never appear in an error: the client secret, the derived Basic credential and
every minted access token are redacted out of upstream response bodies before those bodies can
reach an error object or a log.

## Testing against the SDK

```ts
import { createMockFetch } from "@devino/walmart-marketplace-sdk/testing";

const { fetch, calls } = createMockFetch([
  {
    method: "GET",
    pathPattern: "/v3/items",
    reply: () => ({ status: 200, body: { ItemResponse: [] } }),
  },
  {
    method: "POST",
    pathPattern: "/v3/token",
    reply: () => ({ status: 200, body: { access_token: "t", expires_in: 900 } }),
  },
]);

const client = createWalmartClient({ clientId: "id", clientSecret: "secret", fetch });
```

`calls` records the URL, headers and body of every request, including the multipart part names
for feed uploads. An unmatched request comes back as `501` in Walmart's error shape, so a
misconfigured test fails loudly instead of hanging.

## Configuration

Copy `.env.example` to `.env` and fill in the key pair from Seller Center → Settings → API Key
Management. `.env` is gitignored and `npm run check:secrets` fails the build if any value from
it appears anywhere in the working tree.

| Variable                                      | Purpose                                         |
| --------------------------------------------- | ----------------------------------------------- |
| `WALMART_CLIENT_ID` / `WALMART_CLIENT_SECRET` | API key pair                                    |
| `WALMART_MARKET`                              | `ca` \| `us` \| `mx` \| `cl`                    |
| `WALMART_BASE_URL`                            | production or `https://sandbox.walmartapis.com` |
| `WALMART_SVC_NAME`                            | sent as `WM_SVC.NAME`                           |
| `WALMART_LIVE_TESTS`                          | `true` to enable the read-only live suite       |
| `WALMART_LIVE_TEST_FEED_ID`                   | optional feed id for the live feed-status read  |

## Development

```bash
npm install
npm run build
npm test                 # 93 mocked tests, no credentials needed
npm run typecheck && npm run lint && npm run format:check
npm run check:secrets && npm run check:live-readonly
npm run check:deadcode && npm run verify:exports && npm run docs:api
```

The live suite in `packages/sdk/test/live/` hits a real seller account and is **read-only by
policy and by gate**: `npm run check:live-readonly` loads the operation table from
`packages/sdk/src/operations.ts`, derives every `access: "write"` operation, and fails the
build if one is referenced there. It also fails if the directory is empty, so the guard cannot
pass vacuously. Run the suite with:

```bash
WALMART_LIVE_TESTS=true npm run test:live
```

It skips cleanly without credentials and never runs in CI.

## License

MIT
