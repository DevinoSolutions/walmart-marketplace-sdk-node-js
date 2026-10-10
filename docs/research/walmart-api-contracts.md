# Walmart Marketplace Global API — verified wire contracts

**Scope:** the Global Marketplace API as used by **Walmart Canada** sellers (`WM_MARKET: ca`).
Mexico (`mx`) and Chile (`cl`) share the same surface; the US (`us`) differs in several places
and those differences are called out.

**Source:** `developer.walmart.com` → Global Marketplace API reference, read **2026-09-11**.

**Live verification.** Every read the SDK wraps (token, items list/get, inventory get, orders
list/get, feed status) was exercised against the production Walmart Canada account on
**2026-10-10** (GET requests plus the token call only) and is marked **VERIFIED 2026-10-10
(live)** below.

**Write verification (2026-10-10, from past ops writes).** No write was made to verify the
contract. Instead, the request and response of writes the operator had already made (with
authorization) through this SDK and small helper scripts between 2026-09-16 and 2026-10-10 were
compared with the SDK, and rows are marked **VERIFIED 2026-10-10 (from live ops writes, <date
of the write>)**. Verified that way: `feeds.submit` for `MP_ITEM_MATCH` v1.06 and
`MP_ITEM_INTL` v3.16, the `lagtime` feed, and `inventory.update`. `price.update` was exercised
but only ever answered with a failure (`PDR-0016`, §8). `orders.acknowledge` / `ship` / `cancel`
were never called and stay **ASSUMPTION**.

**How to read this document.** Anything not explicitly marked **ASSUMPTION** was taken from
that reference. **ASSUMPTION** means the SDK sends a shape that the reference did not fully
specify for Canada: it is the best available reading, it has not been confirmed against a live
CA account, and it is the first thing to check when a call fails. Confirming one is a two-line
change: delete the marker and note the date and the response you saw.

This document is a **binding contract**. Adding an endpoint to the SDK means extending this
document in the same change, citing the reference page and the date.

---

## 1. Origins and versioning

| Environment | Origin                                |
| ----------- | ------------------------------------- |
| Production  | `https://marketplace.walmartapis.com` |
| Sandbox     | `https://sandbox.walmartapis.com`     |

Every path lives under `/v3`. The SDK stores the origin with any trailing slash removed and
joins absolute operation paths onto it (`packages/sdk/src/client/config.ts`).

`WM_MARKET` accepts `us`, `ca`, `mx`, `cl`. The SDK defaults to `ca`.

## 2. Authentication — `POST /v3/token`

Request:

| Part                    | Value                                 |
| ----------------------- | ------------------------------------- |
| Method + path           | `POST /v3/token`                      |
| `Authorization`         | `Basic base64(clientId:clientSecret)` |
| `Content-Type`          | `application/x-www-form-urlencoded`   |
| `Accept`                | `application/json`                    |
| `WM_SVC.NAME`           | your integration name                 |
| `WM_QOS.CORRELATION_ID` | a fresh UUID v4                       |
| `WM_MARKET`             | `ca`                                  |
| Body                    | `grant_type=client_credentials`       |

`WM_GLOBAL_VERSION` is **not** sent on the token call.

Response:

```json
{ "access_token": "…", "token_type": "Bearer", "expires_in": 900 }
```

**VERIFIED 2026-10-10 (live):** `200`, body keys exactly `access_token`, `token_type`
(`Bearer`), `expires_in` (`900`).

`expires_in` is seconds; 900 (15 minutes) in practice. The SDK converts it to an absolute
expiry using the injected clock, caches the token, and refreshes when fewer than 60 s remain
(`TOKEN_REFRESH_SKEW_MS`). Concurrent callers share one in-flight token request — see
[ADR 0002](../adr/0002-token-cache.md).

**Classification: READ.** The call is a POST but mints a short-lived credential and changes
nothing on the seller account. `src/operations.ts` records it as `access: "read"` for exactly
this reason, and the live read-only guard depends on that distinction.

## 3. Headers on every other call

| Header                  | Value                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `WM_SEC.ACCESS_TOKEN`   | the bearer token from §2                                                                |
| `WM_QOS.CORRELATION_ID` | a **fresh** UUID v4 per request                                                         |
| `WM_SVC.NAME`           | your integration name                                                                   |
| `WM_MARKET`             | `ca`                                                                                    |
| `WM_GLOBAL_VERSION`     | `3.1`                                                                                   |
| `Accept`                | `application/json`                                                                      |
| `Content-Type`          | `application/json` for JSON bodies; unset for multipart (the boundary is `fetch`'s job) |

Omitting `WM_GLOBAL_VERSION` silently routes the request to the US-shaped contract, which is
why the SDK pins it as a constant rather than an option.

**VERIFIED 2026-10-10 (live), header behaviour on `GET /v3/items`** (the account has a
non-empty catalog, so the difference is visible):

| Variation                     | Result                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| all headers as above          | `200`                                                                                                                                              |
| no `WM_GLOBAL_VERSION`        | `404 CONTENT_NOT_FOUND.GMP_ITEM_QUERY_API` — the request is served by the US contract, which has no items for this seller                          |
| no `WM_SVC.NAME`              | `400`, `{ "error": [{ "code": "400", "field": "WM_SVC.NAME", "description": "WM_SVC.NAME set blank or null", … }] }`                               |
| no `WM_QOS.CORRELATION_ID`    | `200` — not enforced; the SDK still sends a fresh one per request for traceability                                                                 |
| invalid `WM_SEC.ACCESS_TOKEN` | `401`, `{ "error": [{ "code": "UNAUTHORIZED.GMP_GATEWAY_API", "field": "UNAUTHORIZED", "description": "Unauthorized", … }] }` → `WalmartAuthError` |

Responses are `application/json`. No other header was needed for any read below.

## 4. Read / write classification

Classification is by **effect**, not by HTTP verb. This table is mirrored machine-readably in
`packages/sdk/src/operations.ts`, which `scripts/check-live-readonly.ts` imports to derive the
forbidden tokens for the live suite. Change one and the other follows.

| Operation id             | Method | Path                                           | Access    |
| ------------------------ | ------ | ---------------------------------------------- | --------- |
| `auth.token`             | POST   | `/v3/token`                                    | **read**  |
| `items.list`             | GET    | `/v3/items`                                    | read      |
| `items.get`              | GET    | `/v3/items/{sku}`                              | read      |
| `feeds.submit`           | POST   | `/v3/feeds`                                    | **write** |
| `feeds.getStatus`        | GET    | `/v3/feeds/{feedId}`                           | read      |
| `feeds.list`             | GET    | `/v3/feeds`                                    | read      |
| `lagTime.get`            | GET    | `/v3/lagtime`                                  | read      |
| `catalog.search`         | GET    | `/v3/items/walmart/search`                     | read      |
| `shipping.listTemplates` | GET    | `/v3/settings/shipping/templates`              | read      |
| `shipping.getTemplate`   | GET    | `/v3/settings/shipping/templates/{templateId}` | read      |
| `reports.list`           | GET    | `/v3/reports/reportRequests`                   | read      |
| `reports.get`            | GET    | `/v3/reports/reportRequests/{requestId}`       | read      |
| `reports.getDownload`    | GET    | `/v3/reports/downloadReport`                   | read      |
| `inventory.get`          | GET    | `/v3/inventory`                                | read      |
| `inventory.update`       | PUT    | `/v3/inventory`                                | **write** |
| `price.update`           | POST   | `/v3/price`                                    | **write** |
| `orders.list`            | GET    | `/v3/orders`                                   | read      |
| `orders.get`             | GET    | `/v3/orders/{purchaseOrderId}`                 | read      |
| `orders.acknowledge`     | POST   | `/v3/orders/{purchaseOrderId}/acknowledge`     | **write** |
| `orders.ship`            | POST   | `/v3/orders/{purchaseOrderId}/shipping`        | **write** |
| `orders.cancel`          | POST   | `/v3/orders/{purchaseOrderId}/cancel`          | **write** |

Note the trap: `/v3/inventory` is a read on GET and a write on PUT. Never classify an
operation here by looking at the URL alone.

## 5. Items — `GET /v3/items`

Query parameters: `nextCursor`, `sku`, `gtin`, `offset`, `limit`, `lifecycleStatus`,
`publishedStatus`. Rate limit 300 TPM.

**VERIFIED 2026-10-10 (live)** — response (values replaced with placeholders):

```json
{
  "totalItems": 45,
  "ItemResponse": [
    {
      "mart": "WALMART_CA",
      "sku": "SKU-1",
      "wpid": "0RCJ4C…",
      "upc": "012345678905",
      "gtin": "00012345678905",
      "productName": "…",
      "shelf": "[\"Root\",\"Electronics\",\"Computer Components\",\"RAM\"]",
      "productType": "RAM Memory",
      "price": { "currency": "CAD", "amount": 19.99 },
      "publishedStatus": "PUBLISHED",
      "lifecycleStatus": "ACTIVE"
    }
  ]
}
```

- `price` is flat `{ currency, amount }` with `amount` a JSON **number**.
- `shelf` is a JSON-encoded array **string**, not an array. `upc` is 11–12 digits, `gtin` 14.
- `mart` is extra (always `WALMART_CA` here); it stays reachable through `raw`.
- There is **no** `nextCursor` key unless the request itself carried a `nextCursor` parameter.
- `lifecycleStatus` is `ACTIVE` | `ARCHIVED` | `RETIRED`; `RETIRED` (and any filter that
  matches nothing) answers the `404` below.

### Pagination — VERIFIED 2026-10-10 (live)

| Style  | Behaviour                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| offset | `limit` + `offset` is stateless and deterministic: with `limit=20`, offsets 0/20/40 returned 20/20/5 distinct items (45 total, `totalItems: 45` on every page). An offset past the end is the `404 CONTENT_NOT_FOUND` below. Default page size with no `limit` is 20.     |
| cursor | `nextCursor=*` requests the first page and the response then carries `nextCursor` — a UUID that is **the same value on every page** and **advances server-side each time it is used** (sending it twice returned two different pages). The last page has no `nextCursor`. |

Consequences, all implemented in `items.listAll`:

- walking by cursor cannot use "I have seen this cursor before" as a stop signal (page 2 repeats
  page 1's cursor), and an uncursored call returns no cursor to follow at all — so `listAll`
  pages by **offset** and stops at `totalItems` (or on the empty-result `404`);
- a cursor-started walk (`nextCursor: "*"`) stops when `nextCursor` disappears, or when a page
  yields no SKU it has not already yielded (a cursor that stopped advancing);
- the cursor is stateful, so two concurrent cursor walks of the same query would steal pages
  from each other. Prefer offsets.

`limit`: `limit=500` was **accepted** (returned all 45). The SDK still rejects `limit > 200`
locally — that is the value the orders API enforces (§9) and a conservative choice here; Walmart's
real ceiling for items is **ASSUMPTION** (not probed beyond 500 on a 45-item catalog).

`publishedStatus` values accepted as filters and returning rows: `PUBLISHED`, `UNPUBLISHED`,
`SYSTEM_PROBLEM`. **ASSUMPTION — full enum:** the set is not exhaustive (the reference does not
list one), so the SDK types it as a free-form string rather than a union that would reject a
value Walmart adds later.

### Cursor form (orders) — VERIFIED 2026-10-10 (live)

Orders hand back `meta.nextCursor` as a ready-made query string
(`?limit=1&hasMoreElements=true&soIndex=…&poIndex=…&orgId=…&partnerId=…`); following it
verbatim returned the next order and the final page had no `nextCursor`. The SDK merges a value
starting with `?` into the URL verbatim and sends anything else as the `nextCursor` parameter
(`applyCursor` in `src/client/http.ts`). It never parses the cursor's contents.

### Empty catalog answers `404`, not an empty list — **VERIFIED 2026-09-16**

A query that matches nothing — including the entirely ordinary case of a seller who has not
listed anything yet — fails with HTTP `404` rather than returning `{"ItemResponse": []}`.
Captured verbatim from production against the Devino CA account:

```json
{
  "error": [
    {
      "code": "CONTENT_NOT_FOUND.GMP_ITEM_QUERY_API",
      "field": "404_NOT_FOUND",
      "description": "No Items found for the input parameters.",
      "info": "Requested content could not be found.",
      "severity": "INFO",
      "category": "APPLICATION",
      "causes": [],
      "errorIdentifiers": {}
    }
  ]
}
```

Note `severity: "INFO"` — Walmart itself does not grade this as an error. `items.list`
therefore maps any `404` whose code starts with `CONTENT_NOT_FOUND` onto an empty page
(`{ items: [], totalItems: 0 }`), and `items.listAll` terminates cleanly on it. Every other
`404` still throws, so a wrong path or a stale cursor is not silently swallowed.

This also fixes the error envelope for the items API: the live shape is `{ "error": [...] }`
(singular `error`). Other APIs use other envelopes — see §10.

**Re-verified 2026-10-10 (live)** on an account that now has a catalog: the same `404` answers
an offset past the end, a `lifecycleStatus=RETIRED` filter with no matches, and
`GET /v3/items/{sku}` for an unknown SKU. For the single-SKU call it is not mapped to an empty
result — `items.get` throws `WalmartApiError` (`status: 404`, `upstreamCode:
CONTENT_NOT_FOUND.GMP_ITEM_QUERY_API`).

`GET /v3/items/{sku}` — **VERIFIED 2026-10-10 (live)** — returns the list envelope with a single
entry: `{ "ItemResponse": [ {…} ], "totalItems": 1 }`. The same holds for `?sku=` and `?gtin=`
filters on the list call. **ASSUMPTION:** some accounts might return the bare item object
instead; that form was never observed, but the SDK still accepts both.

`POST /v3/items/spec` (spec download) is **US-only** and deliberately not implemented.

## 6. Feeds — `POST /v3/feeds`

| Part           | Value                                                   |
| -------------- | ------------------------------------------------------- |
| Method + path  | `POST /v3/feeds?feedType=<type>`                        |
| `Content-Type` | `multipart/form-data` (boundary set by the HTTP client) |
| Body           | one part named **`file`**, holding the JSON feed        |

Limits: 10,000 items and 25 MB per feed.

Feed types valid for Canada:

| Feed type        | Purpose                                  | Markets     |
| ---------------- | ---------------------------------------- | ----------- |
| `MP_ITEM_INTL`   | full item setup                          | CA, MX, CL  |
| `MP_ITEM_MATCH`  | match an existing catalogue item by GTIN | global      |
| `MP_MAINTENANCE` | maintain existing items                  | global      |
| `MP_ITEM`        | full item setup                          | **US only** |

`feeds.submit` rejects `MP_ITEM` locally on a non-US market, because upstream it fails with an
error that does not say why.

Response: `{ "feedId": "…" }`. Nothing else — processing is asynchronous.

**VERIFIED 2026-10-10 (from live ops writes, 2026-09-16 to 2026-10-08) — `POST
/v3/feeds`.** `feeds.submit` with the multipart `file` part was accepted (`200`, body exactly
`{ "feedId": "…" }`, feed id shaped `<hex>@<suffix>`) for `MP_ITEM_MATCH` (many feeds,
one to five items each) and `MP_ITEM_INTL` (single-item feeds). Observed bodies:

`MP_ITEM_MATCH` — the Canadian spec is `CA_MP_ITEM_MATCH` **v1.06**. Every other `version`
value is rejected, and the error echoes the version after a `|`; an empty echo means a header
_shape_ error, a non-empty echo a bad version _value_.

```json
{
  "MPItemFeedHeader": {
    "sellingChannel": "mpsetupbymatch",
    "mart": "WALMART_CA",
    "version": "1.06",
    "processMode": "REPLACE",
    "subset": "EXTERNAL",
    "locale": ["en", "fr"]
  },
  "MPItem": [
    {
      "Item": {
        "sku": "SKU-1",
        "productIdentifiers": { "productIdType": "GTIN", "productId": "00000000000000" },
        "price": 99.99,
        "ShippingWeight": { "measure": 0.5, "unit": "lb" },
        "productTaxCode": 2038710,
        "productCategory": "Computer Components"
      }
    }
  ]
}
```

- `locale` must be an **array** (`["en", "fr"]`). A bare string parses but reports an empty
  version.
- `productTaxCode` is **required** and an integer. `price` is a bare number (no currency).
  `ShippingWeight` is an object (`{ measure, unit }`, `unit: "lb"`); do not copy the US
  v4.2 shape, where it is a bare number. `productId` is the GTIN zero-padded to 14 digits.
- A match feed carries **no quantity** and no `condition`, images, title or description: the
  matched listing inherits Walmart's catalogue content, and the item publishes at
  **quantity 0**. Listing is therefore two steps: the match feed, then `inventory.update` (§7).
- Resending the same feed with a new `price` re-prices the item and leaves quantity alone. This
  is the working fallback while `POST /v3/price` fails (§8).
- The item may show `UNPUBLISHED` or `SYSTEM_PROBLEM` for a while after a successful feed; the
  feed status says `SUCCESS` regardless.

`MP_ITEM_INTL` — creates a new catalogue record. Header `sellingChannel: "marketplace"`,
`version: "3.16"`, `subCategory`, `mart: "WALMART_CA"`, `processMode: "REPLACE"`, `subset:
"EXTERNAL"`, `locale: ["en", "fr"]`, plus `requestId` / `requestBatchId` / `feedDate`. Each
`MPItem[]` entry is `{ "Orderable": {…}, "Visible": { "<product type>": {…} } }` (no inner
`Item` wrapper); `Orderable` carries `sku`, `productIdentifiers`, per-locale `productName`,
`brand`, `price`, `productTaxCode`, `ShippingWeight`, `shortDescription`, `mainImageUrl`,
`countryOfOriginAssembly` and more. The body is large and category-specific, so the SDK passes
it through untouched; take the field list from the `CA_MP_ITEM_INTL_SPEC` file.

**Lag time — `POST /v3/feeds?feedType=lagtime` — VERIFIED 2026-10-10 (from live ops writes,
2026-10-05 to 2026-10-09).** Sets the handling days per SKU. The accepted request is a bare
JSON body with `Content-Type: application/json` (**not** multipart), and `feeds.submit` sends
`feedType: "lagtime"` that way:

```json
{ "LagTimeHeader": { "version": "1.0" }, "lagTime": [{ "sku": "SKU-1", "fulfillmentLagTime": 0 }] }
```

Response `200`, `{ "feedId": "…" }`; `GET /v3/feeds/{feedId}` reports it like any feed. It takes
effect asynchronously: `GET /v3/lagtime?sku=SKU-1` answers `{ "sku": "SKU-1",
"fulfillmentLagTime": 0 }` once applied and `404 { "errors": [ { "code":
"404.CONTENT_NOT_FOUND", "field": "lagtime", … } ] }` before (seen on a SKU still 404 90
seconds after the feed). That read is not wrapped by the SDK. Whether the multipart form is also
accepted for `lagtime` is **ASSUMPTION** (never tried).

### Feed status — `GET /v3/feeds/{feedId}`

Query: `includeDetails` (the SDK defaults it to `true`), `limit`, `offset`.

```json
{
  "feedId": "…",
  "feedStatus": "PROCESSED",
  "itemsReceived": 2,
  "itemsSucceeded": 1,
  "itemsFailed": 1,
  "itemsProcessing": 0,
  "itemDetails": {
    "itemIngestionStatus": [
      { "sku": "SKU-1", "wpid": "…", "index": 0, "ingestionStatus": "SUCCESS" },
      {
        "sku": "SKU-2",
        "index": 1,
        "ingestionStatus": "DATA_ERROR",
        "ingestionErrors": { "ingestionError": [{ "type": "…", "code": "…", "description": "…" }] }
      }
    ]
  }
}
```

`feedStatus`: `RECEIVED` | `INPROGRESS` | `PROCESSED` | `ERROR`.
`ingestionStatus`: `INPROGRESS` | `SUCCESS` | `DATA_ERROR` | `SYSTEM_ERROR` | `TIMEOUT_ERROR`.

Note that `PROCESSED` means _finished_, not _successful_: a feed with
`itemsFailed > 0` still reports `PROCESSED`. Always read the per-item statuses.

**VERIFIED 2026-10-10 (live) — `GET /v3/feeds/{feedId}`.** Read against existing
`MP_ITEM_MATCH` feeds (one fully successful, one with `DATA_ERROR` items). Corrections to the
example above:

```json
{
  "feedId": "…",
  "feedStatus": "PROCESSED",
  "feedSubmissionDate": 1757000000000,
  "itemsReceived": 2,
  "itemsSucceeded": 2,
  "itemsFailed": 0,
  "itemsProcessing": 0,
  "offset": 0,
  "limit": 50,
  "itemDetails": {
    "itemIngestionStatus": [
      {
        "martId": 0,
        "sku": "SKU-1",
        "wpid": "0RCJ4C…",
        "index": 0,
        "itemid": "",
        "productIdentifiers": {},
        "ingestionStatus": "SUCCESS"
      }
    ]
  }
}
```

- There is **no `feedType`** on the status response (it exists only in the feed list below);
  `FeedStatus.feedType` is therefore normally `undefined`. `feedSubmissionDate` is epoch
  milliseconds, exposed as `FeedStatus.submittedAt` (ISO-8601 UTC).
- `offset` / `limit` are echoed; the default `limit` is 50. `includeDetails=false` still sends
  `itemDetails.itemIngestionStatus`, as an **empty array**.
- Observed `feedStatus` values: `PROCESSED` (on the status call), `ERROR` (in the list).
  Observed `ingestionStatus` values: `SUCCESS`, `DATA_ERROR`.
- A failed item adds `ingestionErrors: { "ingestionError": [ { "type": "DATA_ERROR", "code":
"EXT_DATA_ERROR_…", "field": "…", "description": "…" } ] }` — the wrapped-in-
  `ingestionError` array form, exactly as the SDK parses it. The bare-array form was not
  observed (**ASSUMPTION:** it may still occur; the SDK tolerates it, as it does for
  `orderLines` / `orderLineStatuses`, whose wrapped form _is_ verified in §9).
- **`MP_ITEM_INTL` status lists each SKU twice.** One row is the in-flight record
  (`index: 0`, `ingestionStatus: "INPROGRESS"`, empty `itemid` and `productIdentifiers`), the
  other the resolved one (`index: 1`, `SUCCESS`, a non-empty `itemid` and
  `productIdentifiers.productIdentifier[]` listing GTIN and UPC). So a one-item feed reports
  `itemsReceived: 2`, and the feed sits at `feedStatus: "PROCESSED"` with `itemsProcessing: 1`
  (or even `INPROGRESS`) for 20 minutes or more. Poll until `itemsProcessing` is 0, or stop
  waiting on the feed and poll `items.get` for the SKU instead. `MP_ITEM_MATCH` feeds
  resolve to a single row per SKU within about a minute.
- Unknown feed id → `404`, `{ "error": [ { "code": "CONTENT_NOT_FOUND.GMP_DATA_STATUS_API",
"severity": "INFO", … } ] }` → `WalmartApiError`.

**`GET /v3/feeds` (feed list) - `client.feeds.list`, VERIFIED 2026-10-10 (live)** (see §12).
`?limit=` / `?offset=` / `?feedType=` accepted; returns `{ "totalResults", "offset", "limit", "results": { "feed": [ { "feedId",
"feedType", "feedStatus", "feedDate", "modifiedDtm", "itemsReceived", "itemsSucceeded",
"itemsFailed", "itemsProcessing", "fileName", … } ] } }`. Feed types seen: `MP_ITEM_MATCH`,
`MP_ITEM_INTL`, `lagtime`, `PRICE_AND_PROMOTION` (so lag and price feeds appear here, in the
account-wide feed history). The list is the only place `feedType` appears.

## 7. Inventory

Read: `GET /v3/inventory?sku=<sku>`.
Write: `PUT /v3/inventory?sku=<sku>` with

```json
{ "sku": "SKU-1", "quantity": { "unit": "EACH", "amount": 25 } }
```

Both return that same shape. `amount: 0` is the documented way to take a listing out of stock.

**`PUT /v3/inventory` — VERIFIED 2026-10-10 (from live ops writes, 2026-09-20 to
2026-10-09).** `inventory.update` was used many times to set quantities (including `0` and
`1`..`9`). The body above, `sku` repeated in the query string and `unit: "EACH"`, is accepted
(2xx); the response echoes `{ "sku": "SKU-1", "quantity": { "unit": "EACH", "amount": N } }`,
with `amount` the value just sent. Gotchas:

- **It is asynchronous.** The response echoes the _requested_ amount, but `GET /v3/inventory`
  keeps returning the old amount for a while (seen: still old right after the call, new
  after about a minute for most SKUs, still old at 90 seconds for another; operationally allow
  up to about 30 minutes). Read back with a delay before concluding a write was lost, and do
  not resend in a tight loop.
- **A SKU that is not in the catalogue yet answers `404`,
  `CONTENT_NOT_FOUND.GMP_INVENTORY_API`**, even right after its `MP_ITEM_MATCH` /
  `MP_ITEM_INTL` feed reported `SUCCESS`. Retry every few minutes for up to about 30 minutes.
- A newly matched item sits at quantity 0, so this call (not the feed) is what makes it sellable.
- An `UNPUBLISHED` item accepts the call (quantity 1 read back while it was still
  unpublished). Whether an item in `SYSTEM_PROBLEM` does is unknown: the retry helper waited
  for it to leave that state first.

**`GET /v3/inventory` on Canada — VERIFIED 2026-10-10 (live).** Works under
`WM_GLOBAL_VERSION: 3.1` and answers exactly `{ "sku": "SKU-1", "quantity": { "unit": "EACH",
"amount": 0 } }` (`amount` a JSON integer; no other keys). The `PUT` was not called for this read check;
its shape is verified separately from earlier ops writes, above.

Errors (both use the `errors` **array** envelope, see §10):

| Case                          | Result                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SKU not on the account        | `404`, `CONTENT_NOT_FOUND.GMP_INVENTORY_API`, `severity: "INFO"`, description names the SKU and `partnerID - null`                                                                                                                                  |
| `sku` query parameter omitted | `520` (!), `SYSTEM_ERROR.GMP_INVENTORY_API`, "Required request parameter 'sku' … is not present" — a missing parameter surfaces as a 5xx, which the SDK would mark `retryable`; it never sends this because `inventory.get` validates `sku` locally |

## 8. Price — `POST /v3/price`

CA/MX/CL use a feed-shaped payload rather than the US single-item body:

```json
{
  "MPItemFeedHeader": { "mart": "WALMART_CA", "locale": "en", "version": "1.0" },
  "MPItem": [{ "sku": "SKU-1", "price": 24.99, "msrp": 29.99 }]
}
```

The response is feed-shaped: `feedId`, `itemsReceived`/`Succeeded`/`Failed`, and
`itemDetails.itemIngestionStatus[]` as in §6.

**Live outcome, 2026-09-26 to 2026-10-07 — not working on this account.** `price.update`
(the body above) and the single-item `{ "sku", "pricing": [{ "currentPrice": { "currency":
"CAD", "amount": 24.99 }, "currentPriceType": "BASE" }] }` body both answered **HTTP `200`
with no `feedId`**, only

```json
{
  "ingestionErrors": {
    "ingestionError": [
      { "type": "SYSTEM_ERROR", "code": "PDR-0016", "description": "INTERNAL SERVER ERROR" }
    ]
  }
}
```

The raw response above was captured on 2026-10-07 for the `pricing` body; the feed-shaped
body (this SDK's `price.update`) hit the same `PDR-0016` block on 2026-09-26 and 2026-10-05
(all six SKUs of one batch), and retry loops over several minutes did not clear it. No price
change was applied through this endpoint. A successful `/v3/price` response was therefore **never observed**, so
the request body and the success response shape stay **ASSUMPTION**. The SDK parses the
top-level block into `PriceUpdateResult.ingestionErrors` (empty when accepted) because the
failure is an HTTP-level success. The working ways to re-price on Canada are resending the
`MP_ITEM_MATCH` feed with the new `price` (§6) or editing the price cell in Seller Center.

**ASSUMPTION — header values.** `mart` (`WALMART_CA` / `WALMART_US` / `WALMART_MX` /
`WALMART_CL`), `locale` (`en`) and `version` (`1.0`) are the SDK's defaults, inferred from the
documented field names rather than an enumerated list for Canada. `businessUnit` and `tenant`
are optional and omitted unless supplied. Every field is overridable through
`input.header`, so a wrong default is a one-line fix at the call site, not a code change.

## 9. Orders

### List — `GET /v3/orders`

Query: `createdStartDate` (ISO-8601 UTC), `createdEndDate`, `status`, `limit` (max 200),
`nextCursor`, `shipNodeType` (e.g. `SellerFulfilled`), `purchaseOrderId`, `customerOrderId`,
`sku`.

`status`: `CREATED` | `ACKNOWLEDGED` | `SHIPPED` | `DELIVERED` | `CANCELLED` | `REFUND`.

**VERIFIED 2026-10-10 (live) — `GET /v3/orders`:**

- All six `status` filter values above were accepted (`200`) — **upper-case**. `Delivered` /
  `Created` (the casing of the order-line status in the _response_) are rejected with
  `400 INVALID_REQUEST_PARAM.GMP_ORDER_API`, `field: "status"`.
- `limit` above 200 → `400 INVALID_REQUEST_PARAM.GMP_ORDER_API`, `field: "limit"`,
  "limit cannot be greater than 200". The SDK enforces the same cap locally.
- `createdStartDate` is **not required**: a call without it returned `200`, but with a
  narrower default window than an explicit 400-day start (1 order vs 2). Pass it explicitly
  whenever the window matters. The exact default is **ASSUMPTION** (not determined).
- `shipNodeType=SellerFulfilled`, `sku`, `purchaseOrderId`, and `createdEndDate` (a recent
  value) were accepted and filtered. A `createdEndDate` far before `createdStartDate`'s
  window answered `400 INVALID_REQUEST_PARAM`; `customerOrderId` was not exercised.
- `meta` is `{ totalCount, limit }`, plus `nextCursor` **only when more pages remain**; the
  cursor is the query-string form described in §5 and is followed verbatim.
- Order-line `status` is **capitalised** on the wire (`Created`, `Acknowledged`, `Shipped`,
  `Delivered`, `Cancelled`; `Delivered` observed) — unlike the upper-case request filter.
- Explicit `null` is common for absent optional fields (`address2`, `cancellationReason`,
  `refund`, `storeId`, `carrier.otherCarrier`, …) and `customerEmailId` is omitted entirely on
  some orders. Every order line also carries `charges.charge[]`, `fulfillment`, `statusDate`
  and (once shipped) `trackingInfo` and `shipmentPackages.shipmentPackage[]`; all of that stays
  in `raw`.
- `orderLines.orderLine[]` and `orderLineStatuses.orderLineStatus[]` arrived as arrays (one
  element each in the sample).
- Unknown purchase order id → `404`, `{ "errors": { "error": [ { "code":
"404.ORDER_SERVICE.ORDER_NOT_FOUND", "description": "Order Not found", "severity": "ERROR",
"category": "REQUEST" } ] } }` (the nested envelope, §10).

```json
{
  "list": {
    "meta": { "totalCount": 1, "limit": 200, "nextCursor": "…" },
    "elements": {
      "order": [
        {
          "purchaseOrderId": "…",
          "customerOrderId": "…",
          "customerEmailId": "…",
          "orderDate": 1757000000000,
          "shippingInfo": { "methodCode": "Standard", "postalAddress": {} },
          "orderLines": {
            "orderLine": [
              {
                "lineNumber": "1",
                "item": { "productName": "…", "sku": "SKU-1" },
                "orderLineQuantity": { "unitOfMeasurement": "EACH", "amount": "2" },
                "orderLineStatuses": { "orderLineStatus": [{ "status": "Created" }] }
              }
            ]
          }
        }
      ]
    }
  }
}
```

`orderDate` is **epoch milliseconds**, not a date string; the SDK normalizes it to ISO-8601
UTC. Quantities arrive quoted (`"2"`), so read them with the coercing helpers.

`GET /v3/orders/{purchaseOrderId}` returns `{ "order": { … } }` — **VERIFIED 2026-10-10
(live)**, same order object as the list element.

### Write — acknowledge

`POST /v3/orders/{purchaseOrderId}/acknowledge`, no request body. Returns the updated order.

### Write — ship

`POST /v3/orders/{purchaseOrderId}/shipping`:

```json
{
  "orderShipment": {
    "orderLines": {
      "orderLine": [
        {
          "lineNumber": "1",
          "orderLineStatuses": {
            "orderLineStatus": [
              {
                "status": "Shipped",
                "statusQuantity": { "unitOfMeasurement": "EACH", "amount": "2" },
                "trackingInfo": {
                  "shipDateTime": "2026-09-11T12:00:00Z",
                  "carrierName": { "carrier": "UPS" },
                  "methodCode": "Standard",
                  "trackingNumber": "1Z999",
                  "trackingURL": "…"
                }
              }
            ]
          }
        }
      ]
    }
  }
}
```

A carrier outside Walmart's list goes in `carrierName.otherCarrier` instead of
`carrierName.carrier`.

**ASSUMPTION — the whole shipping body on Canada.** The structure above is documented for the
US surface; the Global reference names the endpoint but does not spell out the CA body. Treat a
`400` here as a contract problem, not a data problem, and fix this section first.

### Write — cancel

`POST /v3/orders/{purchaseOrderId}/cancel`:

```json
{
  "orderCancellation": {
    "orderLines": {
      "orderLine": [
        {
          "lineNumber": "1",
          "orderLineStatuses": {
            "orderLineStatus": [{ "status": "Cancelled", "cancellationReason": "CANCEL_BY_SELLER" }]
          }
        }
      ]
    }
  }
}
```

**ASSUMPTION — endpoint, body and reason codes.** All three are inferred from the shipping
shape and the US cancellation contract. `CANCEL_BY_SELLER` is the SDK default and is
overridable.

## 10. Errors

Walmart's documented error body:

```json
{
  "error": [
    {
      "code": "…",
      "field": "…",
      "description": "…",
      "info": "…",
      "severity": "ERROR",
      "category": "DATA"
    }
  ]
}
```

**VERIFIED 2026-10-10 (live):** the envelope depends on the API that answered, and three
forms occur — all parsed (`src/errors/parse-upstream.ts`):

| Envelope                           | Seen on                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `{ "error": [ … ] }`               | items (`404`), feeds (`404`), gateway (`401` bad token, `400` missing `WM_SVC.NAME`)    |
| `{ "errors": { "error": [ … ] } }` | orders (`400` bad `status` / `limit`, `404` unknown order)                              |
| `{ "errors": [ … ] }`              | inventory (`404` unknown SKU, `520` missing `sku`) — **a bare array, no inner `error`** |

A single bare `error` object is also accepted (not observed). Entries carry extra keys the SDK
ignores (`causes`, `errorIdentifiers`, `component`, `serviceName`, `gatewayErrorCategory`);
`field` may be `null`. `severity: "INFO"` marks the "no rows" `404`s — Walmart itself does not
treat those as faults. A gateway error may be plain text or HTML instead, in which case the
response text becomes the error message.

SDK mapping:

| Condition                     | Error                                                           |
| ----------------------------- | --------------------------------------------------------------- |
| token call fails (any status) | `WalmartAuthError`                                              |
| `401` on any call             | `WalmartAuthError`, and the cached token is dropped             |
| any other non-2xx             | `WalmartApiError` (`retryable` for `429` and `5xx`)             |
| no HTTP response              | `WalmartNetworkError` (`timeout` distinguishes our own timeout) |
| input rejected locally        | `WalmartValidationError`, before anything is sent               |

Response bodies are passed through the secret registry before they reach an error object, so
an echoed credential becomes `[redacted]` rather than an entry in someone's log aggregator.

## 11. Not implemented

| Surface                                             | Why                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `POST /v3/items/spec`                               | US-only                                                                  |
| `MP_ITEM` feed on ca/mx/cl                          | US-only; rejected locally                                                |
| Report creation (`POST /v3/reports/reportRequests`) | a POST that starts a server-side job; the SDK wraps only the reads (§12) |
| Item taxonomy / spec (`GET /v3/items/taxonomy`)     | ~1.6 MB research payload, no ops use beyond probes                       |
| Returns / refunds                                   | not yet mapped; `orders.refund` is pre-blocked in the live guard         |
| Item retirement                                     | not yet mapped; `items.retire` is pre-blocked in the live guard          |
| Promotions, fulfilment centres, rules               | out of scope for 0.1.0                                                   |

Since 2026-10-10 the feed list, the lag-time read, catalog search, shipping templates and the
report-request reads are wrapped; see §12.

## 12. Read endpoints added for the ops scripts — VERIFIED 2026-10-10 (live)

These were being called with raw `fetch` by the owner's ops scripts. Each was re-called
read-only on 2026-10-10 (about 40 calls in all, four of them token mints, spaced >= 0.6 s, no 429) and the shapes below are the observed ones (every value is a placeholder). All use the
standard headers of §3.

### Feed list - `GET /v3/feeds` (`client.feeds.list`)

Shape in §6. Re-called with `limit`, `offset` and `feedType=lagtime`: `200` with `totalResults`,
`offset`, `limit` and `results.feed[]`. Each row also carries `batchId` (the string `"null"`),
`itemDataErrorCount`, `itemSystemErrorCount`, `itemTimeoutErrorCount`, `itemsInReviewCount`,
`channelType`, `orgId`, `partnerId` and `markets: []` - account identifiers, kept in `raw`
only. `feedDate` and `modifiedDtm` are epoch milliseconds **as strings**. A `feedType` filter
that matches nothing answers `200` with `results: {}` (an empty history is not a `404`). The
`limit` maximum is **ASSUMPTION** (the SDK allows 1..1000, as for feed status).

### Lag time - `GET /v3/lagtime?sku=<sku>` (`client.lagTime.get`)

- `200 { "sku": "SKU-1", "fulfillmentLagTime": 0 }` - days between order and shipment, `0` =
  same day. Works for PUBLISHED, SYSTEM_PROBLEM and UNPUBLISHED SKUs alike.
- `404` when no lag time is stored: `{ "status": "NOT_FOUND", "header": { "headerAttributes": {} },
"errors": [ { "code": "404.CONTENT_NOT_FOUND", "field": "lagtime", "description": "No item
found with the given SKU.", "severity": "INFO", … } ] }`. The description is misleading: the
  SKU exists, it just has no stored lag time. This is the ordinary state (4 of 6 SKUs sampled
  across the three statuses), so the SDK resolves it to `null`. Note the body shape differs
  from the `{ "error": [...] }` form other 404s use; the error parser handles both.
- `520 { "status": "FAIL", "errors": [ { "code": "500.SYSTEM_ERROR", … } ] }` for a SKU that is
  not in the catalog at all, and for a call without `sku` (`Required request parameter 'sku'
for method parameter type String is not present`). `gtin=` is not an accepted parameter.
  These surface as `WalmartApiError`.
- Setting a lag time is the `lagtime` feed (§6); the lag feed shows up in the feed list.

### Catalog search - `GET /v3/items/walmart/search` (`client.catalog.search`)

Exactly one of `gtin` (a 14-digit GTIN; zero-pad a 12-digit UPC), `upc` or `query`. Always
`200`; no match is `{ "items": [], "relatedQueries": [] }`, **not** a `404`. A GTIN or UPC hit is
`{ itemId, images: [{ url }], title, brand, productType, properties: { categories: [...] } }`.
A text-query hit also carries `isMarketPlaceItem` (boolean), `customerRating`, `price`
(`{ amount, currency }`), `standardUpc` and `properties.numReviews`; a 3-word query returned 18
hits, all marketplace items with a price. The catalog is Walmart.ca's whole public catalog, so a
hit is not necessarily our own item. Other parameters (paging, filters) are **ASSUMPTION** and
not exposed.

### Shipping templates - `GET /v3/settings/shipping/templates[/{id}]` (`client.shipping`)

- List: `200 { "totalRecords": 1, "shippingTemplates": [ { "id", "name": "Default Template",
"type": "DEFAULT", "rateModelType": "PER_SHIPMENT_PRICING", "status": "ACTIVE",
"isMigrated": true } ] }`.
- Detail: the summary fields plus `shippingMethods[] { shipMethod: "STANDARD", status,
configurations[] }` (ten configurations on the one method seen), `createdBy`, `modifiedBy`,
  `createdDate` / `modifiedDate` (epoch milliseconds, numbers). Each configuration is
  `{ regions[] { regionCode, regionName, subRegions[] { subRegionCode, subRegionName, states[]
{ stateCode, stateName, stateSubregions[] } } }, addressTypes[], transitTime (days),
perShippingCharge { unitOfMeasure, shippingAndHandling, chargePerWeight },
tieredShippingCharges[] }`. The SDK types only the envelope and keeps each configuration as a
  loose object. Read-only; changing a template is not wrapped.
- Probed paths that do **not** exist on the CA gateway (`404 CONTENT_NOT_FOUND.GMP_GATEWAY_API`):
  `/v3/settings/shippingtemplates`, `/v3/settings/shipping/{template,nodes,promotions}`,
  `/v3/settings/{lagtime,fulfillment,seller}`, `/v3/fulfillment/centers`.

### Reports, read side - `GET /v3/reports/reportRequests[/{id}]`, `GET /v3/reports/downloadReport` (`client.reports`)

- List: `200 { "page", "totalCount", "limit", "requests": [ { "requestId", "requestStatus":
"READY", "requestSubmissionDate": "2026-01-02T03:04:05Z", "reportType": "BUYBOX" | "ITEM_CA",
"reportVersion": "v1", "reportSummary", "src": "API", "channelType", "payload": {},
"reportGenerationDate"? } ] }`. `reportGenerationDate` is absent on some rows. The
  `reportType` filter is accepted (an unmatched type is `200` with an empty list). The echoed
  `limit` was `0`/the requested value inconsistently, so do not trust it.
- Get: `200`, the same keys without `reportGenerationDate`. An unknown or expired id (or one
  belonging to another seller) answers `404 { "errors": [ { "code": "CONTENT_NOT_FOUND",
"field": "requestId", "severity": "ERROR", "category": "DATA", … } ] }`.
- Download: `200 { requestId, requestStatus, requestSubmissionDate, reportType, reportVersion,
downloadURL, downloadURLExpirationTime }` - a pre-signed link on a `*.walmartapis.com` host
  that stops working at `downloadURLExpirationTime` (ISO-8601 UTC). The SDK returns the link and
  never fetches it; it is a credential, so do not log it. The same unknown-id `404` applies.
- **Creating** a report (`POST /v3/reports/reportRequests?reportType=BUYBOX&reportVersion=v1`
  with `{ rowFilters: [], excludeColumns: [] }`) answered `200 { requestId, requestStatus:
"RECEIVED", requestSubmissionDate, … }` in earlier ops runs, and `reportType=BUY_BOX` was a
  `404`. It starts a server-side job, so it is **not wrapped** and was not re-called.

### Verified absent (no SDK surface to add)

- **No price read endpoint.** The current price is the `price` object on the item payload
  (`items.get` / `items.list`); every price-looking GET probed on the gateway is a `404`.
- **No unpublished-reason field.** Across all 45 items (35 `PUBLISHED`, 4 `SYSTEM_PROBLEM`, 6
  `UNPUBLISHED`) every item had the identical key set `gtin, lifecycleStatus, mart, price,
productName, productType, publishedStatus, shelf, sku, upc, wpid` - no `unpublishedReasons`,
  `unpublishReasons` or similar, whether the item is listed or fetched by SKU, and the
  `publishedStatus` filter returns the same shape. The `/v3/ca/insights/items/*` family
  (`unpublished`, `buybox`, `listingQuality`, `trending`, `competitor`) all answer `404`. The
  reason text for an unpublished or system-problem item is therefore only visible in Walmart
  Seller Center, not through this API (**as of 2026-10-10**).
- `GET /v3/returns/policies` and `/v3/returns` answer `404` on the CA gateway.
