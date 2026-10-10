import { WalmartApiError, WalmartAuthError, type WalmartUpstreamError } from "./index.js";
import { isRecord } from "../util.js";

/**
 * Extracts Walmart's error entries. Every live shape is accepted: `{ error: [...] }` (items,
 * feeds, gateway), `{ errors: { error: [...] } }` (orders), `{ errors: [...] }` (inventory),
 * and a bare single `error` object.
 */
function parseUpstreamErrors(json: unknown): WalmartUpstreamError[] {
  if (!isRecord(json)) return [];
  if (Array.isArray(json.errors)) return toEntries(json.errors);
  const container = isRecord(json.errors) ? json.errors : json;
  const raw = container.error;
  return toEntries(Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]);
}

function toEntries(list: unknown[]): WalmartUpstreamError[] {
  const out: WalmartUpstreamError[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const str = (key: string): string | undefined =>
      typeof entry[key] === "string" ? entry[key] : undefined;
    out.push({
      code: str("code"),
      description: str("description"),
      info: str("info"),
      severity: str("severity"),
      category: str("category"),
      field: str("field"),
    });
  }
  return out;
}

/** Best-effort JSON parse; returns `undefined` for empty or non-JSON bodies. */
export function parseJsonSafe(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/** Human-readable summary for the error message. Falls back to the (redacted) body text. */
function summarize(errors: WalmartUpstreamError[], bodyText: string): string {
  if (errors.length > 0) {
    const parts = errors.map((e) => {
      const label = e.code ?? e.category ?? "error";
      return e.description ? `${label}: ${e.description}` : label;
    });
    return parts.join("; ");
  }
  const trimmed = bodyText.trim();
  if (trimmed === "") return "no response body";
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
}

interface UpstreamErrorContext {
  status: number;
  /** Already redacted. */
  bodyText: string;
  correlationId: string;
  operationId: string;
  /** Token-endpoint failures are always auth failures, whatever the status code. */
  isTokenCall?: boolean;
}

/**
 * Maps a non-2xx response to an SDK error: `401` and any token-endpoint failure become a
 * {@link WalmartAuthError}; everything else becomes a {@link WalmartApiError}, marked
 * `retryable` for `429` and `5xx`.
 */
export function toUpstreamError(ctx: UpstreamErrorContext): WalmartApiError | WalmartAuthError {
  const json = parseJsonSafe(ctx.bodyText);
  const errors = parseUpstreamErrors(json);
  const body = json ?? (ctx.bodyText.trim() === "" ? undefined : ctx.bodyText);
  const upstreamCode = errors[0]?.code;
  const summary = summarize(errors, ctx.bodyText);

  if (ctx.isTokenCall === true || ctx.status === 401) {
    return new WalmartAuthError(
      `Walmart rejected the credentials on ${ctx.operationId} (HTTP ${ctx.status}): ${summary}`,
      { status: ctx.status, upstreamCode, body, correlationId: ctx.correlationId },
    );
  }

  return new WalmartApiError(
    `Walmart returned HTTP ${ctx.status} for ${ctx.operationId}: ${summary}`,
    {
      status: ctx.status,
      upstreamCode,
      body,
      errors,
      retryable: ctx.status === 429 || ctx.status >= 500,
      correlationId: ctx.correlationId,
    },
  );
}
