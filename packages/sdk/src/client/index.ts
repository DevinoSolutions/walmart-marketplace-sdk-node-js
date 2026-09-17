import type { WalmartClient, WalmartClientConfig } from "../types.js";
import { TokenCache } from "../auth/index.js";
import { FeedsApiImpl } from "../feeds/api.js";
import { InventoryApiImpl } from "../inventory/api.js";
import { ItemsApiImpl } from "../items/api.js";
import { OrdersApiImpl } from "../orders/api.js";
import { PriceApiImpl } from "../price/api.js";
import { resolveConfig } from "./config.js";
import { WalmartHttpClient } from "./http.js";

/**
 * Creates a Walmart Marketplace (Global API) client.
 *
 * Configuration is validated eagerly — an invalid field throws
 * {@link WalmartConfigurationError} here rather than at the first call — and no network access
 * happens at construction time. The first request mints an access token; subsequent requests
 * reuse it until it is within 60 s of expiry.
 *
 * @example
 * ```ts
 * const client = createWalmartClient({
 *   clientId: process.env.WALMART_CLIENT_ID!,
 *   clientSecret: process.env.WALMART_CLIENT_SECRET!,
 *   market: "ca",
 * });
 * for await (const item of client.items.listAll({ limit: 200 })) {
 *   console.error(item.sku, item.lifecycleStatus);
 * }
 * ```
 */
export function createWalmartClient(config: WalmartClientConfig): WalmartClient {
  const resolved = resolveConfig(config);
  const tokens = new TokenCache(resolved);
  const http = new WalmartHttpClient(resolved, tokens);

  return {
    market: resolved.market,
    auth: {
      getAccessToken: (options) => tokens.get(options),
    },
    items: new ItemsApiImpl(http),
    feeds: new FeedsApiImpl(http, resolved),
    inventory: new InventoryApiImpl(http),
    price: new PriceApiImpl(http, resolved),
    orders: new OrdersApiImpl(http),
  };
}
