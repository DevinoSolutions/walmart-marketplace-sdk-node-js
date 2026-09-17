import { defineConfig } from "vitest/config";

// Opt-in live smoke tests against the REAL Walmart Marketplace account.
// Gated inside the suite on WALMART_LIVE_TESTS plus credentials; never included in the
// default `npm test` run and never in CI. The suite is READ-ONLY — see
// scripts/check-live-readonly.ts, which fails the build if a mutating call appears here.
export default defineConfig({
  test: {
    name: "sdk-live",
    environment: "node",
    include: ["test/live/**/*.live.test.ts"],
    root: import.meta.dirname,
    testTimeout: 120_000,
  },
});
