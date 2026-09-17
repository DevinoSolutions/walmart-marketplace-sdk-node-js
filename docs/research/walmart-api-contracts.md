# Walmart Marketplace Global API — verified wire contracts

**Scope:** the Global Marketplace API as used by **Walmart Canada** sellers (`WM_MARKET: ca`).
Mexico (`mx`) and Chile (`cl`) share the same surface; the US (`us`) differs in several places
and those differences are called out.

**Source:** `developer.walmart.com` → Global Marketplace API reference, read **2026-09-11**.

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

## 4. Read / write classification

Classification is by **effect**, not by HTTP verb. This table is mirrored machine-readably in
`packages/sdk/src/operations.ts`, which `scripts/check-live-readonly.ts` imports to derive the
forbidden tokens for the live suite. Change one and the other follows.

| Operation id         | Method | Path                                       | Access    |
| -------------------- | ------ | ------------------------------------------ | --------- |
| `auth.token`         | POST   | `/v3/token`                                | **read**  |
| `items.list`         | GET    | `/v3/items`                                | read      |
| `items.get`          | GET    | `/v3/items/{sku}`                          | read      |
| `feeds.submit`       | POST   | `/v3/feeds`                                | **write** |
| `feeds.getStatus`    | GET    | `/v3/feeds/{feedId}`                       | read      |
| `inventory.get`      | GET    | `/v3/inventory`                            | read      |
| `inventory.update`   | PUT    | `/v3/inventory`                            | **write** |
| `price.update`       | POST   | `/v3/price`                                | **write** |
| `orders.list`        | GET    | `/v3/orders`                               | read      |
| `orders.get`         | GET    | `/v3/orders/{purchaseOrderId}`             | read      |
| `orders.acknowledge` | POST   | `/v3/orders/{purchaseOrderId}/acknowledge` | **write** |
| `orders.ship`        | POST   | `/v3/orders/{purchaseOrderId}/shipping`    | **write** |
| `orders.cancel`      | POST   | `/v3/orders/{purchaseOrderId}/cancel`      | **write** |

Note the trap: `/v3/inventory` is a read on GET and a write on PUT. Never classify an
operation here by looking at the URL alone.

## 5. Items — `GET /v3/items`

Query parameters: `nextCursor`, `sku`, `gtin`, `offset`, `limit`, `lifecycleStatus`,
`publishedStatus`. Rate limit 300 TPM.

Response:

```json
{
  "totalItems": 2,
  "nextCursor": "?limit=20&offset=20",
  "ItemResponse": [
    {
      "sku": "SKU-1",
      "wpid": "0RCJ4C…",
      "gtin": "00012345678905",
      "productName": "…",
      "price": { "currency": "CAD", "amount": 19.99 },
      "publishedStatus": "PUBLISHED",
      "lifecycleStatus": "ACTIVE"
    }
  ]
}
```

`lifecycleStatus` is `ACTIVE` | `ARCHIVED` | `RETIRED`.

**ASSUMPTION — `publishedStatus` enum.** The reference lists the parameter but not an
exhaustive value set for Canada, so the SDK types it as a free-form string rather than a union
that would reject a value Walmart adds later.

**ASSUMPTION — cursor form.** `nextCursor` has been observed both as an opaque token and as a
ready-made query string (`?limit=20&offset=20`). The SDK handles both: a value starting with
`?` is merged into the URL verbatim, anything else is sent back as the `nextCursor` parameter
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

This also fixes the error envelope: the live shape is `{ "error": [...] }` (singular `error`),
which is what `parseUpstreamErrors` already expected. A `{ "errors": [...] }` array form was
**not** observed and is not handled.

`GET /v3/items/{sku}` returns the same envelope with a single entry. **ASSUMPTION:** some
accounts return the bare item object instead of the envelope, so the SDK accepts both.

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

**ASSUMPTION — repeated-element wrapping.** `ingestionErrors` arrives both as an array and as
`{ ingestionError: [...] }` depending on the gateway that served the response. The SDK's
`asList` helper accepts either, and the same tolerance is applied to `orderLines` and
`orderLineStatuses`.

## 7. Inventory

Read: `GET /v3/inventory?sku=<sku>`.
Write: `PUT /v3/inventory?sku=<sku>` with

```json
{ "sku": "SKU-1", "quantity": { "unit": "EACH", "amount": 25 } }
```

Both return that same shape. `amount: 0` is the documented way to take a listing out of stock.

**ASSUMPTION — `GET /v3/inventory` on Canada.** The Global reference documents the PUT
explicitly; the GET is documented for the US surface and assumed to behave identically under
`WM_GLOBAL_VERSION: 3.1`. If it 404s on your account, the fallback is `items.get` plus a feed.

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

**ASSUMPTION — header values.** `mart` (`WALMART_CA` / `WALMART_US` / `WALMART_MX` /
`WALMART_CL`), `locale` (`en`) and `version` (`1.0`) are the SDK's defaults, inferred from the
documented field names rather than an enumerated list for Canada. `businessUnit` and `tenant`
are optional and omitted unless supplied. Every field is overridable through
`input.header`, so a wrong default is a one-line fix at the call site, not a code change.

## 9. Orders

### List — `GET /v3/orders`

Query: `createdStartDate` (ISO-8601 UTC; required on an uncursored call), `createdEndDate`,
`status`, `limit` (max 200), `nextCursor`, `shipNodeType` (e.g. `SellerFulfilled`),
`purchaseOrderId`, `customerOrderId`, `sku`.

`status`: `CREATED` | `ACKNOWLEDGED` | `SHIPPED` | `DELIVERED` | `CANCELLED` | `REFUND`.

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

`GET /v3/orders/{purchaseOrderId}` returns `{ "order": { … } }`.

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

The same payload also appears wrapped as `{ "errors": { "error": [...] } }` and occasionally as
a single bare object; all three are parsed (`src/errors/parse-upstream.ts`). A gateway error
may be plain text or HTML instead, in which case the response text becomes the error message.

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

| Surface                                        | Why                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `POST /v3/items/spec`                          | US-only                                                          |
| `MP_ITEM` feed on ca/mx/cl                     | US-only; rejected locally                                        |
| Returns / refunds                              | not yet mapped; `orders.refund` is pre-blocked in the live guard |
| Item retirement                                | not yet mapped; `items.retire` is pre-blocked in the live guard  |
| Reports, promotions, fulfilment centres, rules | out of scope for 0.1.0                                           |
