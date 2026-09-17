import type { WalmartClientConfig, WalmartMarket } from "../types.js";
import { WalmartConfigurationError } from "../errors/index.js";
import { defaultUserAgent } from "../version.js";
import { SecretRegistry } from "./redact.js";

const DEFAULT_BASE_URL = "https://marketplace.walmartapis.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SVC_NAME = "devino-walmart-sdk";
const MARKETS: readonly WalmartMarket[] = ["ca", "us", "mx", "cl"];

/** Fully-resolved, validated configuration used internally by the client. */
export interface ResolvedConfig {
  clientId: string;
  clientSecret: string;
  /** `base64(clientId:clientSecret)` — the `Authorization: Basic` value for the token call. */
  basicCredential: string;
  market: WalmartMarket;
  /** Origin with no trailing slash; operation paths are absolute (`/v3/...`). */
  baseUrl: string;
  svcName: string;
  timeoutMs: number;
  userAgent: string;
  fetch: typeof globalThis.fetch;
  correlationId: () => string;
  now: () => number;
  secrets: SecretRegistry;
}

function fail(message: string): never {
  throw new WalmartConfigurationError(message);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`Configuration field "${field}" must be a non-empty string.`);
  }
  return value;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function resolveBaseUrl(raw: string | undefined): string {
  const value = raw ?? DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('Configuration field "baseUrl" must be a valid absolute URL.');
  }
  const httpsOk = url.protocol === "https:";
  const httpLoopbackOk = url.protocol === "http:" && isLoopbackHost(url.hostname);
  if (!httpsOk && !httpLoopbackOk) {
    fail(
      'Configuration field "baseUrl" must use https (http is allowed only for localhost/127.0.0.1).',
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Validates and resolves client configuration. Throws {@link WalmartConfigurationError} on any
 * invalid field. No network access happens here — the credentials are encoded for the
 * `Authorization` header and registered for redaction, nothing more.
 */
export function resolveConfig(config: WalmartClientConfig): ResolvedConfig {
  if (config === null || typeof config !== "object") {
    fail("Configuration object is required.");
  }
  const clientId = requireNonEmptyString(config.clientId, "clientId");
  const clientSecret = requireNonEmptyString(config.clientSecret, "clientSecret");

  const market = config.market ?? "ca";
  if (!MARKETS.includes(market)) {
    fail('Configuration field "market" must be one of "ca", "us", "mx", "cl".');
  }

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    fail('Configuration field "timeoutMs" must be a positive number.');
  }

  const fetchImpl: typeof globalThis.fetch = config.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    fail("No fetch implementation available; provide config.fetch or run on Node >= 22.");
  }

  const basicCredential = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");

  const secrets = new SecretRegistry();
  secrets.add(clientSecret);
  secrets.add(basicCredential);

  return {
    clientId,
    clientSecret,
    basicCredential,
    market,
    baseUrl: resolveBaseUrl(config.baseUrl),
    svcName: config.svcName ?? DEFAULT_SVC_NAME,
    timeoutMs,
    userAgent: defaultUserAgent(),
    fetch: fetchImpl,
    correlationId: config.correlationId ?? (() => crypto.randomUUID()),
    now: config.now ?? (() => Date.now()),
    secrets,
  };
}
