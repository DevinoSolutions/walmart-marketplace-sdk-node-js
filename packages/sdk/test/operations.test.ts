import { describe, expect, it } from "vitest";
import { OPERATIONS, type OperationSpec } from "../src/index.js";

const all: OperationSpec[] = Object.values(OPERATIONS);

describe("operation table", () => {
  it("classifies every operation as read or write", () => {
    for (const op of all) {
      expect(["read", "write"], op.id).toContain(op.access);
    }
  });

  it("puts every path under /v3", () => {
    for (const op of all) expect(op.path, op.id).toMatch(/^\/v3\//);
  });

  it("uses unique operation ids", () => {
    const ids = all.map((op) => op.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks the mutating endpoints as writes", () => {
    const writes = all.filter((op) => op.access === "write").map((op) => op.id);
    expect(writes.sort()).toEqual([
      "feeds.submit",
      "inventory.update",
      "orders.acknowledge",
      "orders.cancel",
      "orders.ship",
      "price.update",
    ]);
  });

  it("classifies the token call as a read despite being a POST", () => {
    expect(OPERATIONS.token.method).toBe("POST");
    expect(OPERATIONS.token.access).toBe("read");
  });

  it("keeps inventory read and write on the same path but different verbs", () => {
    expect(OPERATIONS.inventoryGet.path).toBe(OPERATIONS.inventoryUpdate.path);
    expect(OPERATIONS.inventoryGet.method).toBe("GET");
    expect(OPERATIONS.inventoryUpdate.method).toBe("PUT");
  });
});
