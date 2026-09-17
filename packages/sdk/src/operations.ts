/**
 * The operation table: every HTTP call the SDK can make, with its method, path template and
 * read/write classification.
 *
 * This file is the single machine-readable source of truth for what mutates the seller
 * account. `scripts/check-live-readonly.ts` imports it directly and turns every `access:
 * "write"` entry into a forbidden token for `packages/sdk/test/live/`, so adding a mutating
 * operation here automatically extends the read-only guard.
 *
 * It deliberately has NO imports: the guard loads it standalone under tsx, and a dependency
 * chain would be a way for the guard to break silently.
 *
 * Classification is by EFFECT, not by HTTP verb: `auth.token` is a POST that mints a
 * short-lived token and changes nothing on the account, so it is a read.
 */

/** Whether an operation mutates the seller account. */
export type OperationAccess = "read" | "write";

/** One endpoint the SDK can call. */
export interface OperationSpec {
  /** Stable dotted id, matching the SDK method path (e.g. `orders.ship`). */
  readonly id: string;
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  /** Path template under the API origin; `{placeholders}` are filled per call. */
  readonly path: string;
  readonly access: OperationAccess;
}

/**
 * Every operation the SDK implements. See `docs/research/walmart-api-contracts.md` for the
 * wire shapes, headers and which fields are verified vs. **ASSUMPTION**.
 */
export const OPERATIONS = {
  token: { id: "auth.token", method: "POST", path: "/v3/token", access: "read" },
  itemsList: { id: "items.list", method: "GET", path: "/v3/items", access: "read" },
  itemsGet: { id: "items.get", method: "GET", path: "/v3/items/{sku}", access: "read" },
  feedsSubmit: { id: "feeds.submit", method: "POST", path: "/v3/feeds", access: "write" },
  feedsGetStatus: {
    id: "feeds.getStatus",
    method: "GET",
    path: "/v3/feeds/{feedId}",
    access: "read",
  },
  inventoryGet: { id: "inventory.get", method: "GET", path: "/v3/inventory", access: "read" },
  inventoryUpdate: {
    id: "inventory.update",
    method: "PUT",
    path: "/v3/inventory",
    access: "write",
  },
  priceUpdate: { id: "price.update", method: "POST", path: "/v3/price", access: "write" },
  ordersList: { id: "orders.list", method: "GET", path: "/v3/orders", access: "read" },
  ordersGet: {
    id: "orders.get",
    method: "GET",
    path: "/v3/orders/{purchaseOrderId}",
    access: "read",
  },
  ordersAcknowledge: {
    id: "orders.acknowledge",
    method: "POST",
    path: "/v3/orders/{purchaseOrderId}/acknowledge",
    access: "write",
  },
  ordersShip: {
    id: "orders.ship",
    method: "POST",
    path: "/v3/orders/{purchaseOrderId}/shipping",
    access: "write",
  },
  ordersCancel: {
    id: "orders.cancel",
    method: "POST",
    path: "/v3/orders/{purchaseOrderId}/cancel",
    access: "write",
  },
} as const satisfies Record<string, OperationSpec>;
