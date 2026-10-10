import { z } from "zod";
import type {
  FeedIngestionError,
  FeedStatus,
  FeedStatusParams,
  FeedSubmitResult,
  FeedsApi,
  ItemIngestionStatus,
  RequestOptions,
  SubmitFeedInput,
} from "../types.js";
import type { ResolvedConfig } from "../client/config.js";
import { WalmartApiError, WalmartValidationError } from "../errors/index.js";
import { OPERATIONS } from "../operations.js";
import type { WalmartHttpClient } from "../client/http.js";
import { parseInput } from "../schemas/validate.js";
import { asIsoDate, asList, asNumber, asRecord, asString, getField } from "../schemas/wire.js";

/** The multipart part name Walmart expects. Anything else is rejected upstream. */
export const FEED_PART_NAME = "file";

/** Feed types a Canadian (and Mexican/Chilean) seller may submit. */
export const GLOBAL_FEED_TYPES = ["MP_ITEM_INTL", "MP_ITEM_MATCH", "MP_MAINTENANCE"] as const;

const submitSchema = z.looseObject({
  feedType: z.enum(["MP_ITEM_INTL", "MP_ITEM_MATCH", "MP_MAINTENANCE", "MP_ITEM"]),
  fileName: z.string().min(1).optional(),
});

const statusParamsSchema = z.looseObject({
  includeDetails: z.boolean().optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

function parseIngestionErrors(value: unknown): FeedIngestionError[] {
  return asList(value, "ingestionError").map((entry) => ({
    type: asString(entry.type),
    code: asString(entry.code),
    description: asString(entry.description),
    field: asString(entry.field),
  }));
}

/** Reads the shared `itemDetails.itemIngestionStatus[]` block used by feeds and price. */
export function parseItemDetails(value: unknown): ItemIngestionStatus[] {
  const details = getField(value, "itemDetails") ?? value;
  return asList(getField(details, "itemIngestionStatus"), "itemIngestionStatus").map((entry) => ({
    sku: asString(entry.sku),
    wpid: asString(entry.wpid),
    index: asNumber(entry.index),
    ingestionStatus: asString(entry.ingestionStatus),
    ingestionErrors: parseIngestionErrors(entry.ingestionErrors),
  }));
}

/** Converts the caller's feed payload into the multipart body part. */
function toFilePart(file: SubmitFeedInput["file"], fileName: string): Blob {
  if (file instanceof Blob) return file;
  if (file instanceof Uint8Array) {
    return new Blob([file], { type: "application/json" });
  }
  if (typeof file === "object" && file !== null) {
    return new Blob([JSON.stringify(file)], { type: "application/json" });
  }
  throw new WalmartValidationError(
    `Invalid feeds.submit file for "${fileName}": expected a Blob, Uint8Array, or JSON-serializable object.`,
    [{ path: "file", message: "unsupported feed payload type" }],
  );
}

export class FeedsApiImpl implements FeedsApi {
  readonly #http: WalmartHttpClient;
  readonly #config: ResolvedConfig;

  constructor(http: WalmartHttpClient, config: ResolvedConfig) {
    this.#http = http;
    this.#config = config;
  }

  async submit(input: SubmitFeedInput, options: RequestOptions = {}): Promise<FeedSubmitResult> {
    const parsed = parseInput(submitSchema, input, "feeds.submit input");
    // MP_ITEM is the US-only item feed; on ca/mx/cl it fails upstream with an opaque error, so
    // reject it here where the message can say why.
    if (parsed.feedType === "MP_ITEM" && this.#config.market !== "us") {
      throw new WalmartValidationError(
        `Feed type MP_ITEM is US-only; market "${this.#config.market}" must use one of ${GLOBAL_FEED_TYPES.join(", ")}.`,
        [{ path: "feedType", message: "MP_ITEM is not available outside the US market" }],
      );
    }

    const fileName = parsed.fileName ?? "feed.json";
    const form = new FormData();
    form.append(FEED_PART_NAME, toFilePart(input.file, fileName), fileName);

    const result = await this.#http.request(
      { operation: OPERATIONS.feedsSubmit, query: { feedType: parsed.feedType }, form },
      options,
    );

    const feedId = asString(getField(result.json, "feedId"));
    if (feedId === undefined) {
      throw new WalmartApiError("Walmart accepted the feed but returned no feedId.", {
        status: result.status,
        body: result.json,
        correlationId: result.correlationId,
      });
    }
    return { feedId };
  }

  async getStatus(
    feedId: string,
    params: FeedStatusParams = {},
    options: RequestOptions = {},
  ): Promise<FeedStatus> {
    const validId = parseInput(z.string().min(1), feedId, "feeds.getStatus feedId");
    const p = parseInput(statusParamsSchema, params, "feeds.getStatus parameters");
    const result = await this.#http.request(
      {
        operation: OPERATIONS.feedsGetStatus,
        pathParams: { feedId: validId },
        query: {
          includeDetails: p.includeDetails ?? true,
          offset: p.offset,
          limit: p.limit,
        },
      },
      options,
    );
    const root = asRecord(result.json);
    return {
      feedId: asString(root.feedId) ?? validId,
      feedStatus: asString(root.feedStatus),
      feedType: asString(root.feedType),
      submittedAt: asIsoDate(root.feedSubmissionDate),
      itemsReceived: asNumber(root.itemsReceived),
      itemsSucceeded: asNumber(root.itemsSucceeded),
      itemsFailed: asNumber(root.itemsFailed),
      itemsProcessing: asNumber(root.itemsProcessing),
      itemDetails: parseItemDetails(root),
      raw: root,
    };
  }
}
