import { z } from "zod";
import type { LagTimeApi, LagTimeRecord, RequestOptions } from "../types.js";
import { WalmartApiError } from "../errors/index.js";
import { OPERATIONS } from "../operations.js";
import type { WalmartHttpClient } from "../client/http.js";
import { parseInput } from "../schemas/validate.js";
import { asNumber, asRecord, asString } from "../schemas/wire.js";

/**
 * True for the 404 Walmart uses to mean "no lag time is stored for this SKU".
 *
 * Matched on the `CONTENT_NOT_FOUND` prefix of the error code rather than the whole string,
 * for the same reason `items.list` does: the suffix names an internal service.
 */
function isNoLagTime(error: unknown): boolean {
  if (!(error instanceof WalmartApiError) || error.status !== 404) return false;
  const codes = [error.upstreamCode, ...error.errors.map((e) => e.code)];
  return codes.some((c) => typeof c === "string" && c.includes("CONTENT_NOT_FOUND"));
}

export class LagTimeApiImpl implements LagTimeApi {
  readonly #http: WalmartHttpClient;

  constructor(http: WalmartHttpClient) {
    this.#http = http;
  }

  async get(sku: string, options: RequestOptions = {}): Promise<LagTimeRecord | null> {
    const validSku = parseInput(z.string().min(1), sku, "lagTime.get sku");
    let result;
    try {
      result = await this.#http.request(
        { operation: OPERATIONS.lagTimeGet, query: { sku: validSku } },
        options,
      );
    } catch (error) {
      if (isNoLagTime(error)) return null;
      throw error;
    }
    const root = asRecord(result.json);
    const fulfillmentLagTime = asNumber(root.fulfillmentLagTime);
    if (fulfillmentLagTime === undefined) {
      throw new WalmartApiError(`Walmart returned no lag time for SKU "${validSku}".`, {
        status: result.status,
        body: result.json,
        correlationId: result.correlationId,
      });
    }
    return { sku: asString(root.sku) ?? validSku, fulfillmentLagTime, raw: root };
  }
}
