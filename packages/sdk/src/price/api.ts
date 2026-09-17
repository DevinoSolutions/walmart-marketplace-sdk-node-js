import { z } from "zod";
import type {
  PriceApi,
  PriceFeedHeader,
  PriceUpdateInput,
  PriceUpdateResult,
  RequestOptions,
  WalmartMarket,
} from "../types.js";
import type { ResolvedConfig } from "../client/config.js";
import { OPERATIONS } from "../operations.js";
import type { WalmartHttpClient } from "../client/http.js";
import { parseItemDetails } from "../feeds/api.js";
import { parseInput } from "../schemas/validate.js";
import { asNumber, asRecord, asString } from "../schemas/wire.js";

/** Largest batch Walmart accepts in one price payload. */
export const PRICE_MAX_ITEMS = 10_000;

/**
 * `MPItemFeedHeader.mart` per market. **ASSUMPTION** — Walmart's Global reference documents
 * the header block but not the per-market enum; override via `input.header` if your account
 * expects a different value.
 */
const MART_BY_MARKET: Record<WalmartMarket, string> = {
  ca: "WALMART_CA",
  us: "WALMART_US",
  mx: "WALMART_MX",
  cl: "WALMART_CL",
};

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
      locale: z.string().min(1).optional(),
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
  const header: PriceFeedHeader = {
    mart: overrides.mart ?? MART_BY_MARKET[market],
    locale: overrides.locale ?? "en",
    version: overrides.version ?? "1.0",
  };
  if (overrides.businessUnit !== undefined) header.businessUnit = overrides.businessUnit;
  if (overrides.tenant !== undefined) header.tenant = overrides.tenant;
  return header;
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
    const body = {
      MPItemFeedHeader: buildPriceHeader(this.#config.market, p.header ?? {}),
      MPItem: p.items.map((item) => ({
        sku: item.sku,
        price: item.price,
        ...(item.msrp === undefined ? {} : { msrp: item.msrp }),
      })),
    };
    const result = await this.#http.request(
      { operation: OPERATIONS.priceUpdate, json: body },
      options,
    );
    const root = asRecord(result.json);
    return {
      feedId: asString(root.feedId),
      itemsReceived: asNumber(root.itemsReceived),
      itemsSucceeded: asNumber(root.itemsSucceeded),
      itemsFailed: asNumber(root.itemsFailed),
      itemDetails: parseItemDetails(root),
      raw: root,
    };
  }
}
