import { z } from "zod";
import type { AccessToken, RequestOptions } from "../types.js";
import type { ResolvedConfig } from "../client/config.js";
import { buildTokenHeaders } from "../client/headers.js";
import { sendRaw } from "../client/transport.js";
import { WalmartAuthError } from "../errors/index.js";
import { parseJsonSafe, toUpstreamError } from "../errors/parse-upstream.js";
import { OPERATIONS } from "../operations.js";

/**
 * Refresh the token when fewer than this many milliseconds remain. Walmart issues 15-minute
 * tokens; a 60 s margin keeps a token from expiring mid-flight on a slow call.
 */
export const TOKEN_REFRESH_SKEW_MS = 60_000;

/** Fallback lifetime when Walmart omits `expires_in` (documented as 900 s). */
const DEFAULT_EXPIRES_IN_SECONDS = 900;

const tokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.union([z.number(), z.string()]).optional(),
});

function toSeconds(value: number | string | undefined): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_EXPIRES_IN_SECONDS;
}

/**
 * Caches the OAuth token and serializes refreshes.
 *
 * Walmart's token endpoint is rate-limited and every minted token invalidates nothing, but a
 * burst of parallel API calls on a cold cache would otherwise fire one token request each.
 * Concurrent callers therefore await a single in-flight request; the slot is cleared on both
 * success and failure so a transient token error does not poison the cache.
 */
export class TokenCache {
  readonly #config: ResolvedConfig;
  #token: AccessToken | undefined;
  #inflight: Promise<AccessToken> | undefined;

  constructor(config: ResolvedConfig) {
    this.#config = config;
  }

  /** Test/diagnostic hook: drops the cached token so the next call mints a fresh one. */
  clear(): void {
    this.#token = undefined;
  }

  async get(options: RequestOptions = {}): Promise<AccessToken> {
    const cached = this.#token;
    if (cached && cached.expiresAtMs - this.#config.now() > TOKEN_REFRESH_SKEW_MS) return cached;
    const inflight = this.#inflight;
    if (inflight) return inflight;

    const pending = this.#mint(options).finally(() => {
      this.#inflight = undefined;
    });
    this.#inflight = pending;
    return pending;
  }

  async #mint(options: RequestOptions): Promise<AccessToken> {
    const config = this.#config;
    const correlationId = config.correlationId();
    const issuedAtMs = config.now();

    const response = await sendRaw({
      url: new URL(`${config.baseUrl}${OPERATIONS.token.path}`),
      method: OPERATIONS.token.method,
      headers: buildTokenHeaders(config, correlationId),
      body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
      timeoutMs: options.timeoutMs ?? config.timeoutMs,
      signal: options.signal,
      fetch: config.fetch,
      correlationId,
    });

    const bodyText = config.secrets.redact(response.bodyText);

    if (response.status < 200 || response.status >= 300) {
      throw toUpstreamError({
        status: response.status,
        bodyText,
        correlationId,
        operationId: OPERATIONS.token.id,
        isTokenCall: true,
      });
    }

    const parsed = tokenResponseSchema.safeParse(parseJsonSafe(response.bodyText));
    if (!parsed.success) {
      throw new WalmartAuthError(
        "Walmart returned a token response without a usable access_token.",
        { status: response.status, correlationId },
      );
    }

    const token: AccessToken = {
      accessToken: parsed.data.access_token,
      tokenType: parsed.data.token_type ?? "Bearer",
      expiresAtMs: issuedAtMs + toSeconds(parsed.data.expires_in) * 1000,
    };
    // Redact the bearer token out of any future upstream body, same as the client secret.
    config.secrets.add(token.accessToken);
    this.#token = token;
    return token;
  }
}
