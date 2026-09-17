# `@devino/walmart-marketplace-sdk` — public API

This document is the **binding** description of the package's public surface. Anything not
listed here is internal and may change without a major version. A future MCP server package
consumes only what is on this page.

Two automated gates hold it honest: `npm run verify:exports` loads the built ESM entry points
and asserts the named exports exist, and `npm run check:deadcode` (knip) treats
`src/index.ts` and `src/testing/index.ts` as the only entry points, so anything unreachable
from them is reported as dead.

---

## Entry points

| Specifier                                 | Contents                                                      |
| ----------------------------------------- | ------------------------------------------------------------- |
| `@devino/walmart-marketplace-sdk`         | the client factory, types, errors, operation table, constants |
| `@devino/walmart-marketplace-sdk/testing` | `createMockFetch` and its types                               |

## Factory

```ts
function createWalmartClient(config: WalmartClientConfig): WalmartClient;
```

Validates configuration eagerly and throws `WalmartConfigurationError` on an invalid field. It
performs no network access, so constructing a client is always safe.

### `WalmartClientConfig`

| Field           | Default                               | Notes                                     |
| --------------- | ------------------------------------- | ----------------------------------------- |
| `clientId`      | required                              |                                           |
| `clientSecret`  | required                              | never logged, never attached to an error  |
| `market`        | `"ca"`                                | `ca` \| `us` \| `mx` \| `cl`              |
| `baseUrl`       | `https://marketplace.walmartapis.com` | https only, except an http loopback host  |
| `svcName`       | `"devino-walmart-sdk"`                | sent as `WM_SVC.NAME`                     |
| `fetch`         | global `fetch`                        | injection point for tests and proxies     |
| `timeoutMs`     | `30000`                               | per request                               |
| `correlationId` | `crypto.randomUUID`                   | injectable for deterministic tests        |
| `now`           | `Date.now`                            | injectable clock, used by the token cache |

Every method also accepts `RequestOptions` (`signal`, `timeoutMs`) as its last argument.

## Modules

```ts
interface WalmartClient {
  readonly market: WalmartMarket;
  readonly auth: AuthApi; // getAccessToken
  readonly items: ItemsApi; // list, listAll, get
  readonly feeds: FeedsApi; // submit (WRITE), getStatus
  readonly inventory: InventoryApi; // get, update (WRITE)
  readonly price: PriceApi; // update (WRITE)
  readonly orders: OrdersApi; // list, listAll, get, acknowledge/ship/cancel (WRITE)
}
```

`items.listAll` and `orders.listAll` are async iterators that walk `nextCursor` to the last
page. They stop on an absent cursor, an empty page, or a cursor Walmart has already returned,
so a misbehaving cursor cannot spin forever.

Write methods are marked above and in the operation table. `feeds.submit` takes a `Blob`,
`Uint8Array` or JSON-serializable object and uploads it as the multipart part named `file`.

## Errors

All errors extend `WalmartError`, carry a `code` and the request's `correlationId`, and have a
JSON-safe `toJSON()`.

| Class                       | `code`           | Extra fields                                                |
| --------------------------- | ---------------- | ----------------------------------------------------------- |
| `WalmartConfigurationError` | `configuration`  |                                                             |
| `WalmartValidationError`    | `validation`     | `issues: { path, message }[]`                               |
| `WalmartAuthError`          | `authentication` | `status?`, `upstreamCode?`, `body?`                         |
| `WalmartNetworkError`       | `network`        | `timeout`                                                   |
| `WalmartApiError`           | `api`            | `status`, `upstreamCode?`, `body?`, `errors[]`, `retryable` |

`WalmartUpstreamError` describes one entry of Walmart's `error[]` array.

The SDK never retries. `retryable` states whether a retry is _permissible_, and the caller
decides — deliberately, because retrying a write here can double-ship an order. See
[ADR 0001](../adr/0001-thin-fetch-client.md).

## Types

Exported type-only from the root: `WalmartMarket`, `RequestOptions`, `WalmartClientConfig`,
`AccessToken`, `AuthApi`, `MoneyAmount`, `LifecycleStatus`, `WalmartItem`, `ListItemsParams`,
`ItemsPage`, `ItemsApi`, `WalmartFeedType`, `FeedFile`, `SubmitFeedInput`, `FeedSubmitResult`,
`ItemIngestionStatus`, `FeedIngestionError`, `FeedStatusParams`, `FeedStatus`, `FeedsApi`,
`InventoryQuantity`, `InventoryRecord`, `UpdateInventoryInput`, `InventoryApi`,
`PriceFeedHeader`, `PriceUpdateItem`, `PriceUpdateInput`, `PriceUpdateResult`, `PriceApi`,
`OrderStatus`, `OrderLine`, `WalmartOrder`, `ListOrdersParams`, `OrdersPage`, `ShipmentLine`,
`ShipOrderInput`, `CancelOrderInput`, `OrdersApi`, `WalmartClient`.

Every response type carries a `raw` field holding the untouched wire object, so a field the
SDK does not model yet is still reachable without a patch release.

## Operation table

```ts
const OPERATIONS: Record<string, OperationSpec>;
interface OperationSpec {
  readonly id: string;
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly path: string;
  readonly access: "read" | "write";
}
```

This is the machine-readable read/write classification. `scripts/check-live-readonly.ts`
imports it to derive what the live test suite may not call, so it is public on purpose: a
consumer building a permission gate should read it rather than re-deriving the list.

## Constants

| Export                        | Value                                                 |
| ----------------------------- | ----------------------------------------------------- |
| `SDK_VERSION`                 | `"0.1.0"`                                             |
| `WM_GLOBAL_VERSION`           | `"3.1"`                                               |
| `TOKEN_REFRESH_SKEW_MS`       | `60000`                                               |
| `FEED_PART_NAME`              | `"file"`                                              |
| `GLOBAL_FEED_TYPES`           | `["MP_ITEM_INTL", "MP_ITEM_MATCH", "MP_MAINTENANCE"]` |
| `INVENTORY_UNIT`              | `"EACH"`                                              |
| `PRICE_MAX_ITEMS`             | `10000`                                               |
| `DEFAULT_CANCELLATION_REASON` | `"CANCEL_BY_SELLER"`                                  |
| `REDACTED`                    | `"[redacted]"`                                        |

## Testing subpath

```ts
function createMockFetch(routes: MockRoute[]): {
  fetch: typeof globalThis.fetch;
  calls: RecordedCall[];
};
```

Routes match on method plus path pattern. Each `RecordedCall` records the URL, headers, and
either the JSON/text body or the multipart part names and their contents — which is how the
test suite asserts that the feed part is named `file`. An unmatched request returns `501` in
Walmart's error shape so a misconfigured test fails instead of hanging.
