import { WalmartNetworkError } from "../errors/index.js";
import { isAbortError } from "../util.js";

/**
 * Request bodies the SDK produces: a form-encoded or JSON string, or multipart form data.
 * Narrower than the DOM `BodyInit` on purpose: nothing else is ever sent.
 */
export type RequestBody = string | FormData;

/** A fully-built request, ready for `fetch`. */
interface RawRequest {
  url: URL;
  method: string;
  headers: Headers;
  body?: RequestBody;
  timeoutMs: number;
  signal?: AbortSignal;
  fetch: typeof globalThis.fetch;
  correlationId: string;
}

/** The response as text; parsing is the caller's job. */
interface RawResponse {
  status: number;
  headers: Headers;
  bodyText: string;
}

/**
 * Performs one `fetch`, with the SDK timeout composed onto any caller signal.
 *
 * A caller-initiated abort propagates unchanged (so cancellation stays distinguishable);
 * every other failure — DNS, connection reset, our own timeout — becomes a
 * {@link WalmartNetworkError}. There is no retry here: see ADR 0001.
 */
export async function sendRaw(req: RawRequest): Promise<RawResponse> {
  const timeoutSignal = AbortSignal.timeout(req.timeoutMs);
  const signal = req.signal ? AbortSignal.any([req.signal, timeoutSignal]) : timeoutSignal;

  let response: Response;
  let bodyText: string;
  try {
    response = await req.fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal,
    });
    bodyText = await response.text();
  } catch (err) {
    if (req.signal?.aborted && isAbortError(err)) throw err;
    if (isAbortError(err)) {
      throw new WalmartNetworkError(`Walmart request timed out after ${req.timeoutMs} ms.`, {
        timeout: true,
        correlationId: req.correlationId,
        cause: err,
      });
    }
    throw new WalmartNetworkError("Walmart request failed before a response was received.", {
      correlationId: req.correlationId,
      cause: err,
    });
  }

  return { status: response.status, headers: response.headers, bodyText };
}
