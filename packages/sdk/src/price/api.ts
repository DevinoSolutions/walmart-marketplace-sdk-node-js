import { z } from "zod";
import type {
  ItemIngestionStatus,
  PriceApi,
  PriceFeedHeader,
  PriceUpdateInput,
  PriceUpdateItem,
  PriceUpdateResult,
  RequestOptions,
  WalmartMarket,
} from "../types.js";
import type { ResolvedConfig } from "../client/config.js";
import { WalmartApiError } from "../errors/index.js";
import { OPERATIONS } from "../operations.js";
import type { WalmartHttpClient } from "../client/http.js";
import { parseIngestionErrors, parseItemDetails } from "../feeds/api.js";
import { parseInput } from "../schemas/validate.js";
import { asNumber, asRecord, asString } from "../schemas/wire.js";

/**
 * Largest batch one `price.update` call accepts. The endpoint takes a single item per request
 * (two answer HTTP 520 "Item(s) Not Supported more than 1"), so the SDK sends one request per
 * item and this bound keeps a call from fanning out into thousands of sequential writes.
 */
export const PRICE_MAX_ITEMS = 100;

/**
 * `MPItemFeedHeader.mart` per market. VERIFIED for `ca` (live 2026-11-05); the other markets are
 * an **ASSUMPTION** — Walmart's Global reference documents the header block but not a per-market
 * enum. Override via `input.header` if your account expects a different value.
 */
const MART_BY_MARKET: Record<WalmartMarket, string> = {
  ca: "WALMART_CA",
  us: "WALMART_US",
  mx: "WALMART_MX",
  cl: "WALMART_CL",
};

/** Spec version of the Canadian sync price payload (`CA-sync price.json`, 5.0.20250801). */
const PRICE_SPEC_VERSION = "5.0.20250801-18_47_55-api";

const updateSchema = z.looseObject({
  items: z
    .array(
      z.looseObject({
        sku: z.string().min(1),
        price: z.number().min(0),
        msrp: z.number().min(0).optional(),
      }),
    )
    .min(1)
    .max(PRICE_MAX_ITEMS),
  header: z
    .looseObject({
      mart: z.string().min(1).optional(),
      locale: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
      version: z.string().min(1).optional(),
      businessUnit: z.string().min(1).optional(),
      tenant: z.string().min(1).optional(),
    })
    .optional(),
});

/** Builds the `MPItemFeedHeader` block, letting the caller override any field. */
function buildPriceHeader(
  market: WalmartMarket,
  overrides: Partial<PriceFeedHeader> = {},
): PriceFeedHeader {
  const mart = overrides.mart ?? MART_BY_MARKET[market];
  return {
    mart,
    locale: overrides.locale ?? ["en", "fr"],
    version: overrides.version ?? PRICE_SPEC_VERSION,
    businessUnit: overrides.businessUnit ?? mart,
    tenant: overrides.tenant ?? mart,
  };
}

/** True when a parsed response reports the item as not applied. */
function hasFailed(result: PriceUpdateResult): boolean {
  return result.ingestionErrors.length > 0 || (result.itemsFailed ?? 0) > 0;
}

/** Turns an HTTP-level rejection of one item into a failed-item entry. */
function rejectedItem(sku: string, index: number, error: WalmartApiError): ItemIngestionStatus {
  const upstream = error.errors.map((e) => ({
    code: e.code,
    description: e.description,
    field: e.field,
  }));
  return {
    sku,
    index,
    ingestionStatus: "ERROR",
    ingestionErrors: upstream.length > 0 ? upstream : [{ description: error.message }],
  };
}

export class PriceApiImpl implements PriceApi {
  readonly #http: WalmartHttpClient;
  readonly #config: ResolvedConfig;

  constructor(http: WalmartHttpClient, config: ResolvedConfig) {
    this.#http = http;
    this.#config = config;
  }

  async update(input: PriceUpdateInput, options: RequestOptions = {}): Promise<PriceUpdateResult> {
    const p = parseInput(updateSchema, input, "price.update input");
    const header = buildPriceHeader(this.#config.market, p.header ?? {});

    // One request per item: the endpoint refuses more than one. Sequential and never retried
    // (ADR 0001) — a repeated write is a repeated price change.
    const results: PriceUpdateResult[] = [];
    const details: ItemIngestionStatus[] = [];
    const responses: unknown[] = [];
    let succeeded = 0;
    let failed = 0;
    for (const [index, item] of p.items.entries()) {
      try {
        const one = await this.#sendOne(header, item, options);
        results.push(one);
        responses.push(one.raw);
        if (hasFailed(one)) {
          failed += 1;
          details.push(
            ...(one.itemDetails.length > 0
              ? one.itemDetails
              : [
                  {
                    sku: item.sku,
                    index,
                    ingestionStatus: "ERROR",
                    ingestionErrors: one.ingestionErrors,
                  },
                ]),
          );
        } else {
          succeeded += 1;
          details.push(...one.itemDetails);
        }
      } catch (error) {
        // A lone item keeps the plain throw; in a batch the earlier items are already applied,
        // so a rejected item is reported in the result and the rest are still attempted.
        if (p.items.length === 1 || !(error instanceof WalmartApiError)) throw error;
        failed += 1;
        details.push(rejectedItem(item.sku, index, error));
        responses.push({ status: error.status, body: error.body });
      }
    }

    const [only] = results;
    if (p.items.length === 1 && only !== undefined) return only;
    return {
      feedStatus: results.findLast((r) => r.feedStatus !== undefined)?.feedStatus,
      ingestionErrors: results.flatMap((r) => r.ingestionErrors),
      itemsReceived: p.items.length,
      itemsSucceeded: succeeded,
      itemsFailed: failed,
      itemDetails: details,
      raw: { responses },
    };
  }

  async #sendOne(
    header: PriceFeedHeader,
    item: PriceUpdateItem,
    options: RequestOptions,
  ): Promise<PriceUpdateResult> {
    const body = {
      MPItemFeedHeader: header,
      MPItem: [
        {
          Price: {
            sku: item.sku,
            price: item.price,
            ...(item.msrp === undefined ? {} : { msrp: item.msrp }),
          },
        },
      ],
    };
    const result = await this.#http.request(
      { operation: OPERATIONS.priceUpdate, json: body },
      options,
    );
    const root = asRecord(result.json);
    return {
      feedId: asString(root.feedId),
      feedStatus: asString(root.feedStatus),
      ingestionErrors: parseIngestionErrors(root.ingestionErrors),
      itemsReceived: asNumber(root.itemsReceived),
      itemsSucceeded: asNumber(root.itemsSucceeded),
      itemsFailed: asNumber(root.itemsFailed),
      itemDetails: parseItemDetails(root),
      raw: root,
    };
  }
}
