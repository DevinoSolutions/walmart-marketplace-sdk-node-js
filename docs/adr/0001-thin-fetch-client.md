# ADR 0001 — A thin fetch client: one request per call, no retries

- **Status:** accepted
- **Date:** 2026-09-11

## Context

The SDK wraps a marketplace API where several operations are not idempotent. `orders.ship`
attaches tracking and moves lines to `SHIPPED`. `feeds.submit` enqueues a feed that may
create or change listings. `price.update` and `inventory.update` overwrite state.

An HTTP client has to decide what to do when a request fails ambiguously: the socket was
reset, or Walmart answered `503` after reading the body. The request may or may not have
taken effect.

A retry layer is the conventional answer, and it is the wrong default here. Retrying a
`503` on `orders.ship` can produce two shipments against one line. Retrying `feeds.submit`
can submit the same feed twice, and Walmart will process both. The failure mode is silent,
happens in production, and costs real money to unwind.

## Decision

The HTTP core performs exactly one `fetch` per SDK call. It does not retry, does not model
rate limits, and does not queue.

`WalmartApiError.retryable` is set for `429` and `5xx`, but it is _advice_, not behaviour: it
says a retry is permissible from the protocol's point of view. The caller, who knows whether
the operation was a read or a write and whether a duplicate is acceptable, decides.

A failure with no HTTP response becomes `WalmartNetworkError`, with `timeout` distinguishing
our own deadline from a transport error. Its documentation states the consequence plainly: on
a write, re-read the resource before retrying.

The only automatic behaviour is token acquisition and refresh, which is safe because minting a
token has no effect on the account (see [ADR 0002](0002-token-cache.md)).

## Consequences

- Nothing the SDK does can duplicate a write. That property is worth more than the
  convenience of a built-in retry.
- Callers who want retries add them at the call site, where the read/write distinction is
  visible. A generic wrapper around every method would lose exactly that information.
- The HTTP layer stays small enough to read in one sitting, which matters because it is where
  credentials are handled.
- Rate limits (300 TPM on items, for example) surface as `429` with `retryable: true` rather
  than being absorbed. A caller that needs throughput adds a limiter; the SDK does not
  pretend to know the caller's concurrency budget.
