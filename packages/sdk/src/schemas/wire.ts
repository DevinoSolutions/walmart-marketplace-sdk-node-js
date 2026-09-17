/**
 * Tolerant readers for Walmart wire responses.
 *
 * Walmart's JSON is XML-derived, so a repeated element arrives as an array when there are
 * several and as a bare object when there is one, numbers sometimes arrive quoted, and list
 * containers are wrapped one level deeper than the docs suggest (`orderLines.orderLine`).
 * These helpers coerce defensively and never throw — a genuinely unusable payload is rejected
 * by the caller, not here.
 */
import { isRecord } from "../util.js";

export { isRecord };

/** Wraps a single value as a one-element array; `undefined`/`null` become an empty array. */
export function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** The value as a plain object, or an empty object when it is anything else. */
export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** Reads `value[key]` when `value` is an object. */
export function getField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/**
 * Reads a list that may be flat (`[...]`), singular (`{...}`), or wrapped in a repeated-element
 * container (`{ orderLine: [...] }`). Pass the inner key to unwrap the container.
 */
export function asList(value: unknown, innerKey?: string): Record<string, unknown>[] {
  let target = value;
  if (innerKey !== undefined && isRecord(value) && innerKey in value) target = value[innerKey];
  return asArray(target).filter(isRecord);
}

/** Walmart sends timestamps as epoch milliseconds; normalize to ISO-8601 UTC. */
export function asIsoDate(value: unknown): string | undefined {
  const n = asNumber(value);
  if (n !== undefined) {
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  const s = typeof value === "string" ? value.trim() : "";
  if (s === "") return undefined;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
