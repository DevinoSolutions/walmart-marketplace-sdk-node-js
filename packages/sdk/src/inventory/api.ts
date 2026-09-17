import { z } from "zod";
import type {
  InventoryApi,
  InventoryRecord,
  RequestOptions,
  UpdateInventoryInput,
} from "../types.js";
import { OPERATIONS } from "../operations.js";
import type { WalmartHttpClient } from "../client/http.js";
import { parseInput } from "../schemas/validate.js";
import { asNumber, asRecord, asString, getField } from "../schemas/wire.js";

/** Walmart's only unit of measurement for marketplace inventory. */
export const INVENTORY_UNIT = "EACH";

const updateSchema = z.looseObject({
  sku: z.string().min(1),
  amount: z.number().int().min(0),
  unit: z.string().min(1).optional(),
});

/** Reads the `{ sku, quantity: { unit, amount } }` shape shared by the GET and the PUT. */
function parseInventory(json: unknown, fallbackSku: string): InventoryRecord {
  const root = asRecord(json);
  const quantity = getField(root, "quantity");
  return {
    sku: asString(root.sku) ?? fallbackSku,
    quantity: {
      unit: asString(getField(quantity, "unit")) ?? INVENTORY_UNIT,
      amount: asNumber(getField(quantity, "amount")) ?? 0,
    },
    raw: root,
  };
}

export class InventoryApiImpl implements InventoryApi {
  readonly #http: WalmartHttpClient;

  constructor(http: WalmartHttpClient) {
    this.#http = http;
  }

  async get(sku: string, options: RequestOptions = {}): Promise<InventoryRecord> {
    const validSku = parseInput(z.string().min(1), sku, "inventory.get sku");
    const result = await this.#http.request(
      { operation: OPERATIONS.inventoryGet, query: { sku: validSku } },
      options,
    );
    return parseInventory(result.json, validSku);
  }

  async update(
    input: UpdateInventoryInput,
    options: RequestOptions = {},
  ): Promise<InventoryRecord> {
    const p = parseInput(updateSchema, input, "inventory.update input");
    const body = {
      sku: p.sku,
      quantity: { unit: p.unit ?? INVENTORY_UNIT, amount: p.amount },
    };
    const result = await this.#http.request(
      { operation: OPERATIONS.inventoryUpdate, query: { sku: p.sku }, json: body },
      options,
    );
    return parseInventory(result.json, p.sku);
  }
}
