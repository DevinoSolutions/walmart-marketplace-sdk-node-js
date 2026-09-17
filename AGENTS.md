# AGENTS.md

Full agent instructions live in **[CLAUDE.md](./CLAUDE.md)** — read it before changing code.

Non-negotiables (duplicated here so no tool misses them):

1. `packages/sdk/test/live/` is READ-ONLY against a REAL seller account — never add writes
   there. `npm run check:live-readonly` enforces this and derives its forbidden list from
   `packages/sdk/src/operations.ts`; extend the table, never weaken the guard.
2. Never write to the real Walmart account in any form without the owner explicitly
   authorizing that specific write in the current session.
3. Never print/commit credentials or live-discovered identifiers, including
   `base64(clientId:clientSecret)` and access tokens. `npm run check:secrets` scans the
   working tree and must stay that way.
4. Upstream response bodies stay redacted on their way into errors.
5. The SDK never retries (ADR 0001) — a retry around a write can double-ship an order.
6. Classify operations by `src/operations.ts`, not by HTTP verb: the token POST is a read and
   `/v3/inventory` is read-on-GET / write-on-PUT.

Before claiming done: `npm run format:check && npm run typecheck && npm run lint &&
npm run build && npm test && npm run verify:exports && npm run check:secrets &&
npm run check:live-readonly && npm run check:deadcode && npm run docs:api` — all exit 0.

Never add AI/assistant attribution anywhere.
