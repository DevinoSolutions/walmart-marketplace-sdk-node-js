import { describe, expect, it } from "vitest";
import { FEED_PART_NAME, WalmartApiError, WalmartValidationError } from "../src/index.js";
import { apiCalls, createHarness, jsonRoute } from "./helpers.js";

const submitRoute = jsonRoute("POST", "/v3/feeds", { feedId: "FEED-123" });

const STATUS_BODY = {
  feedId: "FEED-123",
  feedStatus: "PROCESSED",
  feedType: "MP_ITEM_INTL",
  itemsReceived: 2,
  itemsSucceeded: 1,
  itemsFailed: 1,
  itemsProcessing: 0,
  itemDetails: {
    itemIngestionStatus: [
      { sku: "SKU-1", wpid: "W1", index: 0, ingestionStatus: "SUCCESS" },
      {
        sku: "SKU-2",
        index: 1,
        ingestionStatus: "DATA_ERROR",
        ingestionErrors: {
          ingestionError: [
            { type: "DATA_ERROR", code: "CONTENT_ERROR", description: "missing brand" },
          ],
        },
      },
    ],
  },
};

describe("feeds.submit", () => {
  it("uploads the payload as a multipart part named file", async () => {
    const { client, calls } = createHarness([submitRoute]);
    const result = await client.feeds.submit({
      feedType: "MP_ITEM_INTL",
      file: { MPItemFeedHeader: { version: "4.2" }, MPItem: [] },
      fileName: "items.json",
    });

    expect(result.feedId).toBe("FEED-123");
    const call = apiCalls(calls)[0];
    expect(call?.method).toBe("POST");
    expect(call?.formParts).toEqual([FEED_PART_NAME]);
    expect(FEED_PART_NAME).toBe("file");
    expect(JSON.parse(call?.formValues?.file ?? "{}")).toMatchObject({
      MPItemFeedHeader: { version: "4.2" },
    });
  });

  it("puts feedType in the query string", async () => {
    const { client, calls } = createHarness([submitRoute]);
    await client.feeds.submit({ feedType: "MP_MAINTENANCE", file: { MPItem: [] } });
    expect(apiCalls(calls)[0]?.url.searchParams.get("feedType")).toBe("MP_MAINTENANCE");
  });

  it("accepts raw bytes as the feed payload", async () => {
    const { client, calls } = createHarness([submitRoute]);
    await client.feeds.submit({
      feedType: "MP_ITEM_MATCH",
      file: new TextEncoder().encode('{"MPItem":[]}'),
    });
    expect(apiCalls(calls)[0]?.formValues?.file).toBe('{"MPItem":[]}');
  });

  it("does not set Content-Type itself, so fetch can add the multipart boundary", async () => {
    const { client, calls } = createHarness([submitRoute]);
    await client.feeds.submit({ feedType: "MP_ITEM_INTL", file: { MPItem: [] } });
    expect(apiCalls(calls)[0]?.headers.get("content-type")).toBeNull();
  });

  it("rejects the US-only MP_ITEM feed on a Canadian account", async () => {
    const { client, calls } = createHarness([submitRoute]);
    await expect(
      client.feeds.submit({ feedType: "MP_ITEM", file: { MPItem: [] } }),
    ).rejects.toThrow(/US-only/);
    expect(calls).toHaveLength(0);
  });

  it("allows MP_ITEM on the US market", async () => {
    const { client } = createHarness([submitRoute], { market: "us" });
    await expect(
      client.feeds.submit({ feedType: "MP_ITEM", file: { MPItem: [] } }),
    ).resolves.toMatchObject({ feedId: "FEED-123" });
  });

  it("rejects an unknown feed type before sending", async () => {
    const { client, calls } = createHarness([submitRoute]);
    await expect(
      client.feeds.submit({
        feedType: "MP_WHATEVER" as never,
        file: { MPItem: [] },
      }),
    ).rejects.toBeInstanceOf(WalmartValidationError);
    expect(calls).toHaveLength(0);
  });

  it("raises WalmartApiError when Walmart answers without a feedId", async () => {
    const { client } = createHarness([jsonRoute("POST", "/v3/feeds", { accepted: true })]);
    await expect(
      client.feeds.submit({ feedType: "MP_ITEM_INTL", file: { MPItem: [] } }),
    ).rejects.toBeInstanceOf(WalmartApiError);
  });
});

describe("feeds.getStatus", () => {
  it("parses the status envelope and the nested ingestion errors", async () => {
    const { client } = createHarness([jsonRoute("GET", "/v3/feeds/FEED-123", STATUS_BODY)]);
    const status = await client.feeds.getStatus("FEED-123");

    expect(status).toMatchObject({
      feedId: "FEED-123",
      feedStatus: "PROCESSED",
      itemsReceived: 2,
      itemsSucceeded: 1,
      itemsFailed: 1,
    });
    expect(status.itemDetails).toHaveLength(2);
    expect(status.itemDetails[1]?.ingestionErrors[0]).toMatchObject({
      code: "CONTENT_ERROR",
      description: "missing brand",
    });
    expect(status.itemDetails[0]?.ingestionErrors).toEqual([]);
  });

  it("defaults includeDetails to true and forwards paging", async () => {
    const { client, calls } = createHarness([jsonRoute("GET", "/v3/feeds/", STATUS_BODY)]);
    await client.feeds.getStatus("FEED-123", { limit: 50, offset: 0 });

    const url = apiCalls(calls)[0]?.url;
    expect(url?.pathname).toBe("/v3/feeds/FEED-123");
    expect(url?.searchParams.get("includeDetails")).toBe("true");
    expect(url?.searchParams.get("limit")).toBe("50");
    expect(url?.searchParams.get("offset")).toBe("0");
  });

  it("rejects an empty feed id before sending", async () => {
    const { client, calls } = createHarness([]);
    await expect(client.feeds.getStatus("")).rejects.toBeInstanceOf(WalmartValidationError);
    expect(calls).toHaveLength(0);
  });
});
