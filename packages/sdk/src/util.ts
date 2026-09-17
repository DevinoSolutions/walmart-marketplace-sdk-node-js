/** Narrowing guard for plain JSON objects. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the thrown value is an abort/timeout `DOMException` from `fetch`. */
export function isAbortError(err: unknown): err is DOMException {
  return err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError");
}
