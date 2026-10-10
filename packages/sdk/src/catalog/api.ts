import { z } from "zod";
import type {
  CatalogApi,
  CatalogItem,
  CatalogSearchParams,
  CatalogSearchResult,
  MoneyAmount,
  RequestOptions,
} from "../types.js";
import { OPERATIONS } from "../operations.js";
import type { WalmartHttpClient } from "../client/http.js";
import { parseInput } from "../schemas/validate.js";
import { asList, asNumber, asRecord, asString, getField, isRecord } from "../schemas/wire.js";

const searchSchema = z
  .looseObject({
    gtin: z.string().min(1).optional(),
    upc: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
  })
  .refine(
    (p) => [p.gtin, p.upc, p.query].filter((value) => value !== undefined).length === 1,
    "exactly one of gtin, upc or query is required",
  );

function parseMoney(value: unknown): MoneyAmount | undefined {
  if (!isRecord(value)) return undefined;
  const currency = asString(value.currency);
  const amount = asNumber(value.amount);
  return currency === undefined && amount === undefined ? undefined : { currency, amount };
}

function parseCatalogItem(entry: Record<string, unknown>): CatalogItem | undefined {
  const itemId = asString(entry.itemId);
  if (itemId === undefined) return undefined;
  return {
    itemId,
    title: asString(entry.title),
    brand: asString(entry.brand),
    productType: asString(entry.productType),
    standardUpc: asString(entry.standardUpc),
    isMarketPlaceItem:
      typeof entry.isMarketPlaceItem === "boolean" ? entry.isMarketPlaceItem : undefined,
    price: parseMoney(entry.price),
    imageUrls: asList(entry.images).flatMap((image) => {
      const url = asString(image.url);
      return url === undefined ? [] : [url];
    }),
    raw: entry,
  };
}

export class CatalogApiImpl implements CatalogApi {
  readonly #http: WalmartHttpClient;

  constructor(http: WalmartHttpClient) {
    this.#http = http;
  }

  async search(
    params: CatalogSearchParams,
    options: RequestOptions = {},
  ): Promise<CatalogSearchResult> {
    const p = parseInput(searchSchema, params, "catalog.search parameters");
    const result = await this.#http.request(
      {
        operation: OPERATIONS.catalogSearch,
        query: { gtin: p.gtin, upc: p.upc, query: p.query },
      },
      options,
    );
    const root = asRecord(result.json);
    const items = asList(root.items).flatMap((entry) => {
      const item = parseCatalogItem(entry);
      return item === undefined ? [] : [item];
    });
    const related = getField(root, "relatedQueries");
    return {
      items,
      relatedQueries: (Array.isArray(related) ? related : []).flatMap((q: unknown) => {
        const text = asString(q);
        return text === undefined ? [] : [text];
      }),
    };
  }
}
