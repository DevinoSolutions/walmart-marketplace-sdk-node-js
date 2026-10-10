import { describe, expect, it } from "vitest";
import { INVENTORY_UNIT, WalmartValidationError } from "../src/index.js";
import { apiCalls, createHarness, errorRoute, jsonRoute } from "./helpers.js";

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

describe("inventory.get live shape (2026-10-10)", () => {
  it("reads the exact { sku, quantity: { unit, amount } } body Walmart sends", async () => {
    const { client } = createHarness([
      jsonRoute("GET", "/v3/inventory", { sku: "SKU-1", quantity: { unit: "EACH", amount: 0 } }),
    ]);
    const record = await client.inventory.get("SKU-1");
    expect(record).toMatchObject({ sku: "SKU-1", quantity: { unit: "EACH", amount: 0 } });
    expect(Object.keys(record.raw).sort()).toEqual(["quantity", "sku"]);
  });
});

describe("inventory.update live shape (2026-10-10)", () => {
  it("echoes { sku, quantity: { unit, amount } } and keeps the wire object in raw", async () => {
    const { client, calls } = createHarness([
      jsonRoute("PUT", "/v3/inventory", { sku: "SKU-1", quantity: { unit: "EACH", amount: 0 } }),
    ]);
    const record = await client.inventory.update({ sku: "SKU-1", amount: 0, unit: "EACH" });

    expect(apiCalls(calls)[0]?.bodyJson).toEqual({
      sku: "SKU-1",
      quantity: { unit: "EACH", amount: 0 },
    });
    expect(record).toMatchObject({ sku: "SKU-1", quantity: { unit: "EACH", amount: 0 } });
    expect(Object.keys(record.raw).sort()).toEqual(["quantity", "sku"]);
  });

  it("raises WalmartApiError 404 while a freshly fed SKU is not in the catalogue yet", async () => {
    // Right after an MP_ITEM_MATCH / MP_ITEM_INTL feed reports SUCCESS the item may not exist
    // for up to ~30 minutes; the inventory PUT answers 404 until it does. Retry later.
    const { client } = createHarness([
      errorRoute("PUT", "/v3/inventory", 404, {
        errors: [
          {
            code: "CONTENT_NOT_FOUND.GMP_INVENTORY_API",
            field: null,
            description: "Placeholder description.",
          },
        ],
      }),
    ]);
    await expect(client.inventory.update({ sku: "SKU-1", amount: 1 })).rejects.toMatchObject({
      status: 404,
      upstreamCode: "CONTENT_NOT_FOUND.GMP_INVENTORY_API",
    });
  });
});
