import { describe, expect, it } from "vitest";
import { INVENTORY_UNIT, WalmartValidationError } from "../src/index.js";
import { apiCalls, createHarness, jsonRoute } from "./helpers.js";

const BODY = { sku: "SKU-1", quantity: { unit: "EACH", amount: 7 } };

describe("inventory.get", () => {
  it("reads the quantity for a SKU", async () => {
    const { client, calls } = createHarness([jsonRoute("GET", "/v3/inventory", BODY)]);
    const record = await client.inventory.get("SKU-1");

    expect(record).toMatchObject({ sku: "SKU-1", quantity: { unit: "EACH", amount: 7 } });
    expect(apiCalls(calls)[0]?.url.searchParams.get("sku")).toBe("SKU-1");
    expect(apiCalls(calls)[0]?.method).toBe("GET");
  });

  it("coerces a quoted amount", async () => {
    const { client } = createHarness([
      jsonRoute("GET", "/v3/inventory", { sku: "SKU-1", quantity: { unit: "EACH", amount: "12" } }),
    ]);
    const record = await client.inventory.get("SKU-1");
    expect(record.quantity.amount).toBe(12);
  });
});

describe("inventory.update", () => {
  it("PUTs the documented body with the sku in the query string", async () => {
    const { client, calls } = createHarness([
      jsonRoute("PUT", "/v3/inventory", { sku: "SKU-1", quantity: { unit: "EACH", amount: 25 } }),
    ]);
    const record = await client.inventory.update({ sku: "SKU-1", amount: 25 });

    const call = apiCalls(calls)[0];
    expect(call?.method).toBe("PUT");
    expect(call?.url.searchParams.get("sku")).toBe("SKU-1");
    expect(call?.headers.get("content-type")).toBe("application/json");
    expect(call?.bodyJson).toEqual({
      sku: "SKU-1",
      quantity: { unit: INVENTORY_UNIT, amount: 25 },
    });
    expect(record.quantity.amount).toBe(25);
  });

  it("allows zero (the documented way to take a listing out of stock)", async () => {
    const { client, calls } = createHarness([
      jsonRoute("PUT", "/v3/inventory", { sku: "SKU-1", quantity: { unit: "EACH", amount: 0 } }),
    ]);
    await client.inventory.update({ sku: "SKU-1", amount: 0 });
    expect(apiCalls(calls)[0]?.bodyJson).toMatchObject({ quantity: { amount: 0 } });
  });

  it("rejects a negative or fractional amount before sending", async () => {
    const { client, calls } = createHarness([]);
    await expect(client.inventory.update({ sku: "SKU-1", amount: -1 })).rejects.toBeInstanceOf(
      WalmartValidationError,
    );
    await expect(client.inventory.update({ sku: "SKU-1", amount: 1.5 })).rejects.toBeInstanceOf(
      WalmartValidationError,
    );
    expect(calls).toHaveLength(0);
  });
});
