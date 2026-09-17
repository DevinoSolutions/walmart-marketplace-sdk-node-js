import { z } from "zod";
import type {
  ItemsApi,
  ItemsPage,
  ListItemsParams,
  MoneyAmount,
  RequestOptions,
  WalmartItem,
} from "../types.js";
import { WalmartApiError } from "../errors/index.js";
import { OPERATIONS } from "../operations.js";
import { applyCursor, type RequestSpec, type WalmartHttpClient } from "../client/http.js";
import { parseInput } from "../schemas/validate.js";
import { asArray, asNumber, asRecord, asString, getField, isRecord } from "../schemas/wire.js";

const listParamsSchema = z.looseObject({
  nextCursor: z.string().min(1).optional(),
  sku: z.string().min(1).optional(),
  gtin: z.string().min(1).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  lifecycleStatus: z.enum(["ACTIVE", "ARCHIVED", "RETIRED"]).optional(),
  publishedStatus: z.string().min(1).optional(),
});

function parsePrice(value: unknown): MoneyAmount | undefined {
  if (!isRecord(value)) return undefined;
  // `price` arrives either flat ({ currency, amount }) or nested under `amount`.
  const inner = isRecord(value.amount) ? value.amount : value;
  const currency = asString(getField(inner, "currency"));
  const amount = asNumber(getField(inner, "amount"));
  if (currency === undefined && amount === undefined) return undefined;
  return { currency, amount };
}

/** Maps one wire item onto {@link WalmartItem}, keeping the untouched object in `raw`. */
function parseItem(value: unknown): WalmartItem | undefined {
  if (!isRecord(value)) return undefined;
  const sku = asString(value.sku);
  if (sku === undefined) return undefined;
  return {
    sku,
    wpid: asString(value.wpid),
    gtin: asString(value.gtin),
    upc: asString(value.upc),
    productName: asString(value.productName),
    shelf: asString(value.shelf),
    productType: asString(value.productType),
    price: parsePrice(value.price),
    publishedStatus: asString(value.publishedStatus),
    lifecycleStatus: asString(value.lifecycleStatus),
    raw: value,
  };
}

/** Reads the `{ ItemResponse: [...], totalItems, nextCursor }` envelope. */
function parseItemsPage(json: unknown): ItemsPage {
  const root = asRecord(json);
  const container = root.ItemResponse ?? root.itemResponse ?? root.items ?? root.elements;
  const candidates = asArray(container);
  // A single-item GET may return the item object itself rather than an envelope.
  const source = candidates.length > 0 ? candidates : asArray(root.sku !== undefined ? root : []);
  const items: WalmartItem[] = [];
  for (const entry of source) {
    const item = parseItem(entry);
    if (item) items.push(item);
  }
  const nextCursor = asString(root.nextCursor);
  return {
    items,
    totalItems: asNumber(root.totalItems),
    nextCursor: nextCursor === "" ? undefined : nextCursor,
  };
}

/**
 * True for the specific 404 Walmart uses to mean "the query matched nothing".
 *
 * The code is matched on its `CONTENT_NOT_FOUND` prefix rather than the full
 * `CONTENT_NOT_FOUND.GMP_ITEM_QUERY_API` string, because the suffix names the internal service
 * answering the call and is not a stable part of the contract.
 */
function isNoItemsFound(error: unknown): boolean {
  if (!(error instanceof WalmartApiError) || error.status !== 404) return false;
  const codes = [error.upstreamCode, ...error.errors.map((e) => e.code)];
  return codes.some((c) => typeof c === "string" && c.startsWith("CONTENT_NOT_FOUND"));
}

export class ItemsApiImpl implements ItemsApi {
  readonly #http: WalmartHttpClient;

  constructor(http: WalmartHttpClient) {
    this.#http = http;
  }

  async list(params: ListItemsParams = {}, options: RequestOptions = {}): Promise<ItemsPage> {
    const p = parseInput(listParamsSchema, params, "items.list parameters");
    let spec: RequestSpec = {
      operation: OPERATIONS.itemsList,
      query: {
        sku: p.sku,
        gtin: p.gtin,
        offset: p.offset,
        limit: p.limit,
        lifecycleStatus: p.lifecycleStatus,
        publishedStatus: p.publishedStatus,
      },
    };
    if (p.nextCursor !== undefined) spec = applyCursor(spec, p.nextCursor);
    let result;
    try {
      result = await this.#http.request(spec, options);
    } catch (error) {
      // VERIFIED live 2026-09-16 against a shop with an empty catalog: Walmart answers
      // `404 CONTENT_NOT_FOUND.GMP_ITEM_QUERY_API — No Items found for the input parameters`
      // when nothing matches, including the perfectly ordinary "this seller has no items yet".
      // That is a result, not a fault, so it surfaces as an empty page. Any other 404 still
      // throws — swallowing them would hide a wrong path or a bad cursor.
      if (isNoItemsFound(error)) return { items: [], totalItems: 0, nextCursor: undefined };
      throw error;
    }
    return parseItemsPage(result.json);
  }

  async *listAll(
    params: ListItemsParams = {},
    options: RequestOptions = {},
  ): AsyncIterableIterator<WalmartItem> {
    let cursor = params.nextCursor;
    const seen = new Set<string>();
    for (;;) {
      const page: ItemsPage = await this.list({ ...params, nextCursor: cursor }, options);
      yield* page.items;
      const next = page.nextCursor;
      // Stop on an absent cursor, an empty page, or a cursor Walmart has already handed us —
      // a repeating cursor would otherwise spin forever.
      if (next === undefined || page.items.length === 0 || seen.has(next)) return;
      seen.add(next);
      cursor = next;
    }
  }

  async get(sku: string, options: RequestOptions = {}): Promise<WalmartItem> {
    const validSku = parseInput(z.string().min(1), sku, "items.get sku");
    const result = await this.#http.request(
      { operation: OPERATIONS.itemsGet, pathParams: { sku: validSku } },
      options,
    );
    const page = parseItemsPage(result.json);
    const item = page.items[0];
    if (item === undefined) {
      throw new WalmartApiError(`Walmart returned no item for SKU "${validSku}".`, {
        status: result.status,
        body: result.json,
        correlationId: result.correlationId,
      });
    }
    return item;
  }
}
