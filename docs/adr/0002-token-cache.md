# ADR 0002 — Cache the access token in the client, and serialize refreshes

- **Status:** accepted
- **Date:** 2026-09-11

## Context

Walmart's Global API uses a two-step credential: `POST /v3/token` exchanges the API key pair
for a bearer token that lives 15 minutes and then must be sent as `WM_SEC.ACCESS_TOKEN` on
every other call.

Three naive designs all fail:

1. **Mint a token per call.** Doubles the request count, doubles latency, and the token
   endpoint is rate-limited. A bulk `items.listAll` over a large catalogue would spend half
   its requests on authentication.
2. **Make the caller manage the token.** Pushes an expiry clock and a refresh race into every
   consumer, and guarantees that one of them gets it wrong.
3. **Cache with no refresh margin.** A token that has 200 ms of life left when the request is
   built will be expired by the time it arrives, producing an intermittent `401` under load
   that is very hard to reproduce.

## Decision

The client owns a `TokenCache`:

- The token is cached with an **absolute** expiry, computed as `now() + expires_in * 1000` at
  the moment of the token call. `now` is injectable, which is what makes the expiry logic
  testable without waiting 15 minutes.
- A token is considered usable only while more than `TOKEN_REFRESH_SKEW_MS` (60 s) remain. The
  margin covers request build time, network latency, and a slow upstream.
- **Refreshes are serialized.** A cold cache hit by concurrent calls stores one in-flight
  promise and hands it to every waiter, so N parallel requests mint one token, not N.
- The in-flight slot is cleared on failure as well as success, so a transient token error does
  not poison the cache and permanently reject every later call.
- A `401` on a normal call clears the cached token. Walmart can revoke a token before its
  nominal expiry; without this, the client would replay a dead credential for up to 15
  minutes.
- The minted token is registered with the secret registry, so it is redacted out of any
  upstream response body before that body can reach an error object or a log.

Automatic refresh is safe here precisely because minting a token is classified as a **read**
in `src/operations.ts`: it changes nothing on the seller account. That is the only reason this
ADR does not conflict with [ADR 0001](0001-thin-fetch-client.md)'s no-retry rule.

## Consequences

- Callers never think about tokens. `auth.getAccessToken()` is exposed anyway, as a cheap
  startup preflight that proves the credentials work before real traffic begins.
- One extra request per 15 minutes per client instance, and one on a cold start.
- A long-lived client is the efficient usage pattern; constructing a client per request throws
  the cache away. This is called out in the README.
- The cache is per client instance and in memory. A multi-process deployment mints one token
  per process, which is well within the endpoint's budget and avoids introducing a shared
  store (and a place for a credential to sit at rest).
