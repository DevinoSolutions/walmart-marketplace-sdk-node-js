import { z } from "zod";
import type {
  ListReportsParams,
  ReportDownload,
  ReportRequest,
  ReportsApi,
  ReportsPage,
  RequestOptions,
} from "../types.js";
import { WalmartApiError } from "../errors/index.js";
import { OPERATIONS } from "../operations.js";
import type { WalmartHttpClient } from "../client/http.js";
import { parseInput } from "../schemas/validate.js";
import { asIsoDate, asList, asNumber, asRecord, asString } from "../schemas/wire.js";

const listParamsSchema = z.looseObject({
  reportType: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  page: z.number().int().min(1).optional(),
});

function parseRequest(entry: Record<string, unknown>): ReportRequest | undefined {
  const requestId = asString(entry.requestId);
  if (requestId === undefined) return undefined;
  return {
    requestId,
    requestStatus: asString(entry.requestStatus),
    reportType: asString(entry.reportType),
    reportVersion: asString(entry.reportVersion),
    submittedAt: asIsoDate(entry.requestSubmissionDate),
    raw: entry,
  };
}

export class ReportsApiImpl implements ReportsApi {
  readonly #http: WalmartHttpClient;

  constructor(http: WalmartHttpClient) {
    this.#http = http;
  }

  async list(params: ListReportsParams = {}, options: RequestOptions = {}): Promise<ReportsPage> {
    const p = parseInput(listParamsSchema, params, "reports.list parameters");
    const result = await this.#http.request(
      {
        operation: OPERATIONS.reportsList,
        query: { reportType: p.reportType, limit: p.limit, page: p.page },
      },
      options,
    );
    const root = asRecord(result.json);
    return {
      page: asNumber(root.page),
      totalCount: asNumber(root.totalCount),
      limit: asNumber(root.limit),
      requests: asList(root.requests).flatMap((entry) => {
        const request = parseRequest(entry);
        return request === undefined ? [] : [request];
      }),
    };
  }

  async get(requestId: string, options: RequestOptions = {}): Promise<ReportRequest> {
    const validId = parseInput(z.string().min(1), requestId, "reports.get requestId");
    const result = await this.#http.request(
      { operation: OPERATIONS.reportsGet, pathParams: { requestId: validId } },
      options,
    );
    const request = parseRequest(asRecord(result.json));
    if (request === undefined) {
      throw new WalmartApiError(`Walmart returned no report request "${validId}".`, {
        status: result.status,
        body: result.json,
        correlationId: result.correlationId,
      });
    }
    return request;
  }

  async getDownload(requestId: string, options: RequestOptions = {}): Promise<ReportDownload> {
    const validId = parseInput(z.string().min(1), requestId, "reports.getDownload requestId");
    const result = await this.#http.request(
      { operation: OPERATIONS.reportsGetDownload, query: { requestId: validId } },
      options,
    );
    const root = asRecord(result.json);
    const downloadUrl = asString(root.downloadURL);
    if (downloadUrl === undefined) {
      throw new WalmartApiError(`Walmart returned no download link for report "${validId}".`, {
        status: result.status,
        body: result.json,
        correlationId: result.correlationId,
      });
    }
    return {
      requestId: asString(root.requestId) ?? validId,
      requestStatus: asString(root.requestStatus),
      downloadUrl,
      expiresAt: asIsoDate(root.downloadURLExpirationTime),
      raw: root,
    };
  }
}
