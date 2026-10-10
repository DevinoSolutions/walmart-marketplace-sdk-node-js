import { z } from "zod";
import type {
  RequestOptions,
  ShippingApi,
  ShippingTemplate,
  ShippingTemplateMethod,
  ShippingTemplateSummary,
  ShippingTemplatesPage,
} from "../types.js";
import { WalmartApiError } from "../errors/index.js";
import { OPERATIONS } from "../operations.js";
import type { WalmartHttpClient } from "../client/http.js";
import { parseInput } from "../schemas/validate.js";
import { asIsoDate, asList, asNumber, asRecord, asString } from "../schemas/wire.js";

function parseSummary(entry: Record<string, unknown>): ShippingTemplateSummary | undefined {
  const id = asString(entry.id);
  if (id === undefined) return undefined;
  return {
    id,
    name: asString(entry.name),
    type: asString(entry.type),
    rateModelType: asString(entry.rateModelType),
    status: asString(entry.status),
    isMigrated: typeof entry.isMigrated === "boolean" ? entry.isMigrated : undefined,
  };
}

export class ShippingApiImpl implements ShippingApi {
  readonly #http: WalmartHttpClient;

  constructor(http: WalmartHttpClient) {
    this.#http = http;
  }

  async listTemplates(options: RequestOptions = {}): Promise<ShippingTemplatesPage> {
    const result = await this.#http.request(
      { operation: OPERATIONS.shippingTemplatesList },
      options,
    );
    const root = asRecord(result.json);
    return {
      totalRecords: asNumber(root.totalRecords),
      templates: asList(root.shippingTemplates).flatMap((entry) => {
        const summary = parseSummary(entry);
        return summary === undefined ? [] : [summary];
      }),
    };
  }

  async getTemplate(templateId: string, options: RequestOptions = {}): Promise<ShippingTemplate> {
    const validId = parseInput(z.string().min(1), templateId, "shipping.getTemplate templateId");
    const result = await this.#http.request(
      { operation: OPERATIONS.shippingTemplatesGet, pathParams: { templateId: validId } },
      options,
    );
    const root = asRecord(result.json);
    const summary = parseSummary(root);
    if (summary === undefined) {
      throw new WalmartApiError(`Walmart returned no shipping template "${validId}".`, {
        status: result.status,
        body: result.json,
        correlationId: result.correlationId,
      });
    }
    const shippingMethods: ShippingTemplateMethod[] = asList(root.shippingMethods).map(
      (method) => ({
        shipMethod: asString(method.shipMethod),
        status: asString(method.status),
        configurations: asList(method.configurations),
      }),
    );
    return {
      ...summary,
      shippingMethods,
      createdBy: asString(root.createdBy),
      modifiedBy: asString(root.modifiedBy),
      createdAt: asIsoDate(root.createdDate),
      modifiedAt: asIsoDate(root.modifiedDate),
      raw: root,
    };
  }
}
