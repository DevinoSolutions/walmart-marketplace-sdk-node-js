import type { RequestOptions } from "../types.js";
import type { OperationSpec } from "../operations.js";
import type { ResolvedConfig } from "./config.js";
import type { TokenCache } from "../auth/index.js";
import { WalmartConfigurationError } from "../errors/index.js";
import { parseJsonSafe, toUpstreamError } from "../errors/parse-upstream.js";
import { buildApiHeaders } from "./headers.js";
import { sendRaw, type RequestBody } from "./transport.js";

/** Query values the SDK knows how to serialize; `undefined` entries are dropped. */
export type QueryValue = string | number | boolean | undefined;

/** One outbound call, described in terms of the operation table. */
export interface RequestSpec {
  operation: OperationSpec;
  /** Values for the `{placeholders}` in {@link OperationSpec.path}. */
  pathParams?: Record<string, string>;
  query?: Record<string, QueryValue>;
  /** JSON request body. Mutually exclusive with `form`. */
  json?: unknown;
  /** `multipart/form-data` body. `Content-Type` is left to `fetch` so the boundary is correct. */
  form?: FormData;
  /** Raw query string appended verbatim — used for opaque `nextCursor` values. */
  rawQuery?: string;
}

/** A completed 2xx response. */
interface HttpResult {
  status: number;
  json: unknown;
  correlationId: string;
}

/** Fills `{placeholders}` in an operation path, URL-encoding each value. */
function operationPath(op: OperationSpec, params: Record<string, string> = {}): string {
  return op.path.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined || value === "") {
      throw new WalmartConfigurationError(
        `Operation ${op.id} requires a non-empty "${key}" path parameter.`,
      );
    }
    return encodeURIComponent(value);
  });
}

/**
 * Applies an opaque pagination cursor.
 *
 * Walmart returns `nextCursor` in two observed forms: a bare token, and a ready-made query
 * string (`?limit=20&offset=20`). Both are passed back untouched — the first as the
 * `nextCursor` parameter, the second appended verbatim — so the SDK never has to understand
 * the cursor's contents.
 */
export function applyCursor(spec: RequestSpec, cursor: string): RequestSpec {
  if (cursor.startsWith("?")) return { ...spec, rawQuery: cursor.slice(1) };
  return { ...spec, query: { ...spec.query, nextCursor: cursor } };
}

/**
 * HTTP core: URL and header construction, token injection, and error mapping.
 *
 * Deliberately thin (ADR 0001) — one `fetch` per call, no retries, no rate-limit modelling.
 * Credentials only ever appear in outbound headers; response bodies are redacted before they
 * can reach an error object.
 */
export class WalmartHttpClient {
  readonly config: ResolvedConfig;
  readonly #tokens: TokenCache;

  constructor(config: ResolvedConfig, tokens: TokenCache) {
    this.config = config;
    this.#tokens = tokens;
  }

  buildUrl(spec: RequestSpec): URL {
    const url = new URL(`${this.config.baseUrl}${operationPath(spec.operation, spec.pathParams)}`);
    for (const [key, value] of Object.entries(spec.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    if (spec.rawQuery !== undefined && spec.rawQuery !== "") {
      for (const [key, value] of new URLSearchParams(spec.rawQuery)) {
        url.searchParams.set(key, value);
      }
    }
    return url;
  }

  async request(spec: RequestSpec, options: RequestOptions = {}): Promise<HttpResult> {
    const token = await this.#tokens.get(options);
    const correlationId = this.config.correlationId();
    const headers = buildApiHeaders(this.config, correlationId, token.accessToken);

    let body: RequestBody | undefined;
    if (spec.form !== undefined) {
      body = spec.form;
    } else if (spec.json !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(spec.json);
    }

    const response = await sendRaw({
      url: this.buildUrl(spec),
      method: spec.operation.method,
      headers,
      body,
      timeoutMs: options.timeoutMs ?? this.config.timeoutMs,
      signal: options.signal,
      fetch: this.config.fetch,
      correlationId,
    });

    const bodyText = this.config.secrets.redact(response.bodyText);

    if (response.status < 200 || response.status >= 300) {
      // A 401 means the cached token is no longer honoured; drop it so the next call re-mints
      // instead of replaying a dead credential for the rest of its nominal lifetime.
      if (response.status === 401) this.#tokens.clear();
      throw toUpstreamError({
        status: response.status,
        bodyText,
        correlationId,
        operationId: spec.operation.id,
      });
    }

    return { status: response.status, json: parseJsonSafe(bodyText), correlationId };
  }
}
