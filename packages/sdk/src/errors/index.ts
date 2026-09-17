/** Machine-readable category shared by every SDK error. */
export type WalmartErrorCode =
  "configuration" | "validation" | "authentication" | "network" | "api";

/** One entry from Walmart's `{ error: [...] }` payload. */
export interface WalmartUpstreamError {
  code?: string;
  description?: string;
  info?: string;
  severity?: string;
  category?: string;
  field?: string;
}

export interface WalmartErrorInit {
  correlationId?: string;
  cause?: unknown;
}

/**
 * Base class for every error thrown by the SDK.
 *
 * All fields are JSON-safe and credential-free: the client secret, the Basic credential and
 * the access token are redacted out of upstream bodies before any error is constructed, and
 * outbound headers are never attached to errors.
 */
export class WalmartError extends Error {
  readonly code: WalmartErrorCode;
  /** The `WM_QOS.CORRELATION_ID` sent with the failing request; quote it to Walmart support. */
  readonly correlationId?: string;

  constructor(code: WalmartErrorCode, message: string, init: WalmartErrorInit = {}) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = "WalmartError";
    this.code = code;
    this.correlationId = init.correlationId;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      correlationId: this.correlationId,
    };
  }
}

/** Invalid client configuration — thrown eagerly by `createWalmartClient`, before any I/O. */
export class WalmartConfigurationError extends WalmartError {
  constructor(message: string, init: WalmartErrorInit = {}) {
    super("configuration", message, init);
    this.name = "WalmartConfigurationError";
  }
}

/** A single input-validation failure, addressed by dotted path. */
export interface WalmartValidationIssue {
  path: string;
  message: string;
}

/** Caller input rejected by the SDK's zod schemas, before the request is sent. */
export class WalmartValidationError extends WalmartError {
  readonly issues: WalmartValidationIssue[];
  constructor(message: string, issues: WalmartValidationIssue[], init: WalmartErrorInit = {}) {
    super("validation", message, init);
    this.name = "WalmartValidationError";
    this.issues = issues;
  }
  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), issues: this.issues };
  }
}

export interface WalmartAuthErrorInit extends WalmartErrorInit {
  status?: number;
  upstreamCode?: string;
  body?: unknown;
}

/**
 * The credentials were rejected: a failing `POST /v3/token`, an unparsable token response, or
 * a `401` on any other call (the cached token was revoked or the key pair lost its
 * entitlement). Never carries the client secret or the Basic credential.
 */
export class WalmartAuthError extends WalmartError {
  readonly status?: number;
  readonly upstreamCode?: string;
  readonly body?: unknown;
  constructor(message: string, init: WalmartAuthErrorInit = {}) {
    super("authentication", message, init);
    this.name = "WalmartAuthError";
    this.status = init.status;
    this.upstreamCode = init.upstreamCode;
    this.body = init.body;
  }
  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      status: this.status,
      upstreamCode: this.upstreamCode,
      body: this.body,
    };
  }
}

export interface WalmartNetworkErrorInit extends WalmartErrorInit {
  /** True when the request was aborted by the SDK's own timeout. */
  timeout?: boolean;
}

/**
 * The request never produced an HTTP response (DNS failure, connection reset, timeout).
 *
 * A network failure on a WRITE is *indeterminate*: the request may still have reached
 * Walmart. Re-read the resource (`feeds.getStatus`, `orders.get`) before retrying rather than
 * resubmitting blind.
 */
export class WalmartNetworkError extends WalmartError {
  readonly timeout: boolean;
  constructor(message: string, init: WalmartNetworkErrorInit = {}) {
    super("network", message, init);
    this.name = "WalmartNetworkError";
    this.timeout = init.timeout ?? false;
  }
  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), timeout: this.timeout };
  }
}

export interface WalmartApiErrorInit extends WalmartErrorInit {
  status: number;
  /** First `error[].code` from the response body, when Walmart supplied one. */
  upstreamCode?: string;
  /** Parsed body when it was JSON, otherwise the (redacted) response text. */
  body?: unknown;
  errors?: WalmartUpstreamError[];
  retryable?: boolean;
}

/**
 * A non-2xx HTTP response from Walmart (other than the `401`/token failures that become
 * {@link WalmartAuthError}). `retryable` is set for `429` and `5xx`; the SDK never retries on
 * its own, so the caller decides — and must treat a retry of a write as potentially duplicate.
 */
export class WalmartApiError extends WalmartError {
  readonly status: number;
  readonly upstreamCode?: string;
  readonly body?: unknown;
  readonly errors: WalmartUpstreamError[];
  readonly retryable: boolean;
  constructor(message: string, init: WalmartApiErrorInit) {
    super("api", message, init);
    this.name = "WalmartApiError";
    this.status = init.status;
    this.upstreamCode = init.upstreamCode;
    this.body = init.body;
    this.errors = init.errors ?? [];
    this.retryable = init.retryable ?? false;
  }
  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      status: this.status,
      upstreamCode: this.upstreamCode,
      body: this.body,
      errors: this.errors,
      retryable: this.retryable,
    };
  }
}
