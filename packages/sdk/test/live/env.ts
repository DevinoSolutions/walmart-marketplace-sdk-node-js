// Shared setup for the live suite.
//
// READ-ONLY BY CONSTRUCTION: this module only builds a client. Every live test must stay a
// read; `npm run check:live-readonly` scans this directory and fails on any mutating call.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createWalmartClient } from "../../src/index.js";
import type { WalmartClient, WalmartMarket } from "../../src/types.js";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..", "..");
const envFile = join(repoRoot, ".env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const clientId = process.env.WALMART_CLIENT_ID ?? "";
const clientSecret = process.env.WALMART_CLIENT_SECRET ?? "";
const market = (process.env.WALMART_MARKET ?? "ca") as WalmartMarket;

/**
 * The live suite runs only when explicitly enabled AND credentials are present. Everything
 * else skips cleanly, so `npm run test:live` is safe to run on a machine with no .env.
 */
export const liveEnabled =
  process.env.WALMART_LIVE_TESTS === "true" && clientId !== "" && clientSecret !== "";

/** Optional: an existing feed id, enabling the read-only feed status check. */
export const liveFeedId = process.env.WALMART_LIVE_TEST_FEED_ID ?? "";

let cached: WalmartClient | undefined;

/**
 * Lazily builds (and then reuses) the live client.
 *
 * It must be lazy: vitest still evaluates the body of a `describe.skipIf` block while
 * collecting tests, so constructing the client at module or describe scope would throw
 * `WalmartConfigurationError` on a machine with no credentials — turning a suite that should
 * skip cleanly into a red run. Call this inside a test, never at describe scope.
 *
 * Reusing one instance also keeps the token cache warm across the whole suite, so the live
 * run costs one token request rather than one per test.
 */
export function liveClient(): WalmartClient {
  cached ??= createWalmartClient({
    clientId,
    clientSecret,
    market,
    baseUrl: process.env.WALMART_BASE_URL,
    svcName: process.env.WALMART_SVC_NAME,
    timeoutMs: 60_000,
  });
  return cached;
}

/** ISO-8601 UTC timestamp `days` days in the past, for order queries. */
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
