# CLAUDE.md — agent instructions for this repo

TypeScript monorepo: `packages/sdk` (`@devino/walmart-marketplace-sdk`), npm workspaces,
ESM/NodeNext, Node >= 22.12. An MCP server package will be added under `packages/` later.

Target API: the Walmart Marketplace **Global API** as used by Walmart **Canada** sellers
(`WM_MARKET: ca`).

## Hard rules (safety — never break these)

1. **The live test suite is READ-ONLY.** Files in `packages/sdk/test/live/` hit the REAL
   Walmart seller account. Never add a mutating call (`feeds.submit`, `inventory.update`,
   `price.update`, `orders.acknowledge`, `orders.ship`, `orders.cancel`, any raw
   POST/PUT/DELETE other than the token call). Enforced by `npm run check:live-readonly`.
   That guard **derives** its forbidden list from `packages/sdk/src/operations.ts`, so the way
   to extend it is to add the new operation to that table with `access: "write"` — do not
   weaken the guard to make a test pass.
2. **Never perform ANY write against the real Walmart account** (SDK call, curl, probe
   script, MCP tool) without the owner explicitly authorizing that specific write in the
   current session. Reads (token fetch, items list, orders list, feed status) are fine.
3. **Secrets never leave `.env`.** Never print, log, commit, or hardcode credentials or values
   derived from them — including `base64(clientId:clientSecret)` and any access token. Real
   SKUs, purchase order ids and feed ids discovered live stay out of the repo too. Enforced by
   `npm run check:secrets`, which scans the WORKING TREE — keep it that way.
4. **Response bodies are redacted before they reach an error.** Every upstream body passes
   through `SecretRegistry.redact` (`packages/sdk/src/client/redact.ts`) on its way into
   `WalmartApiError.body` / the error message. Do not bypass it when adding an endpoint.
5. **The SDK never retries** (ADR 0001). `retryable` is advice for the caller, not behaviour.
   Adding a retry loop around a write is how you double-ship an order.
6. **When the MCP server package lands, write tools register only behind an explicit env gate**
   and go through a preview→apply flow. New mutating tools follow the same gate.

## Binding contracts

- `docs/research/sdk-public-api.md` — the SDK's public surface (a future MCP server consumes
  only this).
- `docs/research/walmart-api-contracts.md` — verified wire shapes. When adding an endpoint,
  extend it from the official reference (cite the page and the date; mark gaps
  **ASSUMPTION**). Several shapes are currently assumptions — read the markers before
  debugging a `400`.
- ADRs in `docs/adr/` — thin fetch client (0001), token cache (0002). Follow them.

## Toolchain pins (do not upgrade without owner sign-off)

TypeScript `~6.0.3` · zod `^4` (**zod-4 API**: `z.looseObject()`, not `.passthrough()`; most
online examples are zod-3) · vitest `^4` · ESLint flat config · knip `5.88.1` · typedoc with
`treatWarningsAsErrors`.

## Conventions

- Strict TS everywhere (`noUncheckedIndexedAccess` — index access yields `T | undefined`).
- `any` is banned (`@typescript-eslint/no-explicit-any: error`); use `unknown` + narrowing.
- Relative imports in `src/` carry `.js` extensions (ESM NodeNext).
- No `console.*` in `packages/*/src` except `console.error` (stdout belongs to a future MCP
  stdio transport). Tests and scripts may log.
- Walmart wire quirks are the norm, not the exception: a repeated element arrives as an array
  when there are several and a bare object when there is one (`orderLines.orderLine`,
  `ingestionErrors.ingestionError`), numbers arrive quoted, `orderDate` is epoch milliseconds,
  and error bodies may be a JSON object, a nested `{ errors: { error: [] } }`, or plain HTML.
  Reuse `schemas/wire.ts` and `errors/parse-upstream.ts` — never hand-roll parsing.
- Every response type keeps the untouched wire object in `raw`, so an unmodelled field is
  still reachable. Preserve that when adding parsers.
- HTTP verbs don't imply safety here: `POST /v3/token` is a READ (it changes nothing on the
  account) and `/v3/inventory` is read-on-GET / write-on-PUT. Classify operations by
  `src/operations.ts`, not by the verb.
- `WM_GLOBAL_VERSION: 3.1` goes on every call except the token call. Omitting it silently
  routes to the US contract.

## Commands

```bash
npm run build            # tsc, sdk workspace
npm run typecheck        # scripts + all workspaces
npm run lint / format:check
npm test                 # mocked suites only (93+); no credentials needed
npm run check:secrets    # working-tree secret scan
npm run check:live-readonly
npm run verify:exports   # requires a fresh build
npm run check:deadcode   # knip
npm run docs:api         # typedoc, warnings are errors; requires a fresh build
WALMART_LIVE_TESTS=true npm run test:live   # READ-ONLY live suite (needs .env creds)
```

All of these must exit 0 before claiming work is done. Trust exit codes, not output
prettiness (an output proxy may collapse vitest output to `PASS (n) FAIL (n)`).

## Environment gotchas (primary dev machine: Windows + OneDrive)

- OneDrive can silently roll `dist/` back to stale artifacts and has injected NUL bytes into a
  source file. After `npm run build`, confirm dist mtimes are newer than src before trusting
  dist-dependent checks (`verify:exports`, `docs:api`); bizarre `tsc` parse errors at 1:1 →
  check for NUL bytes.
- Long commands: prefer the Bash tool. A killed long-running command can wedge the PowerShell
  tool session (every later command times out) — switch backends, don't retry.
- The repo may have few/no commits; `check:secrets` deliberately scans the working tree so it
  stays honest either way.
- Never add AI/assistant attribution to commits, docs, or code comments.
