/**
 * `@devino/walmart-marketplace-sdk` — transport-independent TypeScript SDK for the Walmart
 * Marketplace **Global API**, as used by Walmart Canada sellers.
 *
 * The public surface is described by `docs/research/sdk-public-api.md`, and the wire contracts
 * (with every **ASSUMPTION** called out) by `docs/research/walmart-api-contracts.md`. Testing
 * helpers are exported separately from `@devino/walmart-marketplace-sdk/testing`.
 */

// Public types (interfaces, unions) — all type-only.
export type * from "./types.js";

// Error hierarchy (classes are values, used with `instanceof`).
export * from "./errors/index.js";

// Factory.
export { createWalmartClient } from "./client/index.js";

// The operation table: method, path and read/write classification for every endpoint.
export { OPERATIONS, type OperationAccess, type OperationSpec } from "./operations.js";

// Documented constants.
export { SDK_VERSION } from "./version.js";
export { WM_GLOBAL_VERSION } from "./client/headers.js";
export { REDACTED } from "./client/redact.js";
export { TOKEN_REFRESH_SKEW_MS } from "./auth/index.js";
export { FEED_PART_NAME, GLOBAL_FEED_TYPES } from "./feeds/api.js";
export { INVENTORY_UNIT } from "./inventory/api.js";
export { PRICE_MAX_ITEMS } from "./price/api.js";
export { DEFAULT_CANCELLATION_REASON } from "./orders/api.js";
