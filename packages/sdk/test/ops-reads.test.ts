/**
 * Mocked coverage for the read endpoints added for the ops scripts: feed list, lag-time read,
 * catalog search, shipping templates and the report-request reads. Payloads are PLACEHOLDER
 * data shaped like the responses captured live on 2026-10-10 (keys, types and nulls verbatim;
 * every value invented).
 */
import { describe, expect, it } from "vitest";
import { OPERATIONS, WalmartApiError, WalmartValidationError } from "../src/index.js";
import { apiCalls, createHarness, errorRoute, jsonRoute } from "./helpers.js";

describe("feeds.list", () => {
  const feedRow = {
    feedId: "FEED-1@EXAMPLE",
    feedType: "lagtime",
    itemsReceived: 2,
    itemsSucceeded: 1,
    itemsFailed: 0,
    itemsProcessing: 1,
    feedStatus: "PROCESSED",
    feedDate: "1790000000000",
    modifiedDtm: "1790000006000",
    batchId: "null",
    fileName: "lagtime_example.json.json",
    itemDataErrorCount: 0,
    itemSystemErrorCount: 0,
    itemTimeoutErrorCount: 0,
    itemsInReviewCount: 0,
    channelType: "channel-placeholder",
    orgId: "org-placeholder",
    partnerId: "partner-placeholder",
    markets: [],
  };

  it("maps the feed history and converts epoch-millisecond dates", async () => {
    const { client, calls } = createHarness([
      jsonRoute("GET", "/v3/feeds", {
        totalResults: 3,
        offset: 0,
        limit: 2,
        results: {
          feed: [feedRow, { ...feedRow, feedId: "FEED-2@EXAMPLE", feedType: "MP_ITEM_MATCH" }],
        },
      }),
    ]);
    const page = await client.feeds.list({ limit: 2, offset: 0, feedType: "lagtime" });

    expect(page.totalResults).toBe(3);
    expect(page.feeds).toHaveLength(2);
    expect(page.feeds[0]).toMatchObject({
      feedId: "FEED-1@EXAMPLE",
      feedType: "lagtime",
      feedStatus: "PROCESSED",
      itemsReceived: 2,
      itemsProcessing: 1,
      submittedAt: new Date(1_790_000_000_000).toISOString(),
      modifiedAt: new Date(1_790_000_006_000).toISOString(),
    });
    expect(page.feeds[0]?.raw.partnerId).toBe("partner-placeholder");

    const url = apiCalls(calls)[0]?.url;
    expect(url?.pathname).toBe("/v3/feeds");
    expect(url?.searchParams.get("feedType")).toBe("lagtime");
    expect(url?.searchParams.get("limit")).toBe("2");
  });

  it("accepts the bare-object form Walmart uses for a single feed", async () => {
    const { client } = createHarness([
      jsonRoute("GET", "/v3/feeds", {
        totalResults: 1,
        offset: 0,
        limit: 50,
        results: { feed: feedRow },
      }),
    ]);
    expect((await client.feeds.list()).feeds.map((feed) => feed.feedId)).toEqual([
      "FEED-1@EXAMPLE",
    ]);
  });

  it("returns an empty page for an empty history", async () => {
    const { client } = createHarness([
      jsonRoute("GET", "/v3/feeds", { totalResults: 0, offset: 0, limit: 5, results: {} }),
    ]);
    await expect(client.feeds.list({ feedType: "nothing" })).resolves.toEqual({
      feeds: [],
      totalResults: 0,
      offset: 0,
      limit: 5,
    });
  });

  it("rejects an out-of-range limit before sending", async () => {
    const { client, calls } = createHarness([]);
    await expect(client.feeds.list({ limit: 0 })).rejects.toBeInstanceOf(WalmartValidationError);
    expect(apiCalls(calls)).toHaveLength(0);
  });
});

describe("lagTime.get", () => {
  it("reads the stored lag time, zero included", async () => {
    const { client, calls } = createHarness([
      jsonRoute("GET", "/v3/lagtime", { sku: "SKU-1", fulfillmentLagTime: 0 }),
    ]);
    const record = await client.lagTime.get("SKU-1");
    expect(record).toEqual({
      sku: "SKU-1",
      fulfillmentLagTime: 0,
      raw: { sku: "SKU-1", fulfillmentLagTime: 0 },
    });
    expect(apiCalls(calls)[0]?.url.searchParams.get("sku")).toBe("SKU-1");
  });

  it("encodes SKUs with special characters", async () => {
    const { client, calls } = createHarness([
      jsonRoute("GET", "/v3/lagtime", { sku: "A B/C", fulfillmentLagTime: 2 }),
    ]);
    await client.lagTime.get("A B/C");
    expect(apiCalls(calls)[0]?.url.search).toBe("?sku=A+B%2FC");
  });

  it("resolves to null when Walmart holds no lag time (404 CONTENT_NOT_FOUND)", async () => {
    const { client } = createHarness([
      errorRoute("GET", "/v3/lagtime", 404, {
        status: "NOT_FOUND",
        header: { headerAttributes: {} },
        errors: [
          {
            code: "404.CONTENT_NOT_FOUND",
            field: "lagtime",
            description: "No item found with the given SKU.",
            info: "Requested content could not be found.",
            severity: "INFO",
            category: "APPLICATION",
            causes: [],
            errorIdentifiers: {},
          },
        ],
      }),
    ]);
    await expect(client.lagTime.get("SKU-1")).resolves.toBeNull();
  });

  it("still throws on the 520 Walmart answers for a SKU outside the catalog", async () => {
    const { client } = createHarness([
      errorRoute("GET", "/v3/lagtime", 520, {
        status: "FAIL",
        header: { headerAttributes: {} },
        errors: [
          {
            code: "500.SYSTEM_ERROR",
            field: null,
            description: "There is a temporary system error or service unavailable.",
            info: "System encountered some internal error.",
            severity: "ERROR",
            category: "SYSTEM",
            causes: [],
            errorIdentifiers: {},
          },
        ],
      }),
    ]);
    await expect(client.lagTime.get("NOT-A-SKU")).rejects.toBeInstanceOf(WalmartApiError);
  });

  it("does not swallow a 404 that is not CONTENT_NOT_FOUND", async () => {
    const { client } = createHarness([
      errorRoute("GET", "/v3/lagtime", 404, {
        error: [{ code: "URI_NOT_FOUND", description: "x" }],
      }),
    ]);
    await expect(client.lagTime.get("SKU-1")).rejects.toBeInstanceOf(WalmartApiError);
  });

  it("rejects a body without a lag time and an empty SKU", async () => {
    const { client } = createHarness([jsonRoute("GET", "/v3/lagtime", { sku: "SKU-1" })]);
    await expect(client.lagTime.get("SKU-1")).rejects.toBeInstanceOf(WalmartApiError);
    await expect(client.lagTime.get("")).rejects.toBeInstanceOf(WalmartValidationError);
  });
});

describe("catalog.search", () => {
  const gtinHit = {
    items: [
      {
        itemId: "1000000001",
        images: [{ url: "https://example.invalid/a.jpg" }],
        title: "Example product",
        brand: "ExampleBrand",
        productType: "Example Type",
        properties: { categories: ["Electronics"] },
      },
    ],
    relatedQueries: [],
  };

  it("searches by GTIN and maps the catalog hit", async () => {
    const { client, calls } = createHarness([
      jsonRoute("GET", "/v3/items/walmart/search", gtinHit),
    ]);
    const result = await client.catalog.search({ gtin: "00012345678905" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      itemId: "1000000001",
      title: "Example product",
      brand: "ExampleBrand",
      productType: "Example Type",
      imageUrls: ["https://example.invalid/a.jpg"],
    });
    expect(result.items[0]?.price).toBeUndefined();
    expect(result.relatedQueries).toEqual([]);
    expect(apiCalls(calls)[0]?.url.searchParams.get("gtin")).toBe("00012345678905");
  });

  it("maps the richer text-search hit with price and marketplace flag", async () => {
    const { client, calls } = createHarness([
      jsonRoute("GET", "/v3/items/walmart/search", {
        items: [
          {
            itemId: "1000000002",
            isMarketPlaceItem: true,
            images: [],
            customerRating: 4.5,
            price: { amount: 12.5, currency: "CAD" },
            title: "Another product",
            brand: "ExampleBrand",
            productType: "Example Type",
            standardUpc: "012345678905",
            properties: { numReviews: 3, categories: ["Electronics"] },
          },
        ],
        relatedQueries: ["example related"],
      }),
    ]);
    const result = await client.catalog.search({ query: "example product" });

    expect(result.items[0]).toMatchObject({
      itemId: "1000000002",
      isMarketPlaceItem: true,
      standardUpc: "012345678905",
      price: { amount: 12.5, currency: "CAD" },
      imageUrls: [],
    });
    expect(result.relatedQueries).toEqual(["example related"]);
    expect(apiCalls(calls)[0]?.url.searchParams.get("query")).toBe("example product");
  });

  it("returns an empty result for no match (a 200, not a 404)", async () => {
    const { client } = createHarness([
      jsonRoute("GET", "/v3/items/walmart/search", { items: [], relatedQueries: [] }),
    ]);
    await expect(client.catalog.search({ upc: "000000000000" })).resolves.toEqual({
      items: [],
      relatedQueries: [],
    });
  });

  it("requires exactly one search key", async () => {
    const { client, calls } = createHarness([]);
    await expect(client.catalog.search({})).rejects.toBeInstanceOf(WalmartValidationError);
    await expect(client.catalog.search({ gtin: "1", upc: "2" })).rejects.toBeInstanceOf(
      WalmartValidationError,
    );
    expect(apiCalls(calls)).toHaveLength(0);
  });
});

describe("shipping templates", () => {
  const templateSummary = {
    id: "TEMPLATE-1",
    name: "Default Template",
    type: "DEFAULT",
    rateModelType: "PER_SHIPMENT_PRICING",
    status: "ACTIVE",
    isMigrated: true,
  };

  it("lists the templates", async () => {
    const { client, calls } = createHarness([
      jsonRoute("GET", "/v3/settings/shipping/templates", {
        totalRecords: 1,
        shippingTemplates: [templateSummary],
      }),
    ]);
    const page = await client.shipping.listTemplates();
    expect(page.totalRecords).toBe(1);
    expect(page.templates).toEqual([templateSummary]);
    expect(apiCalls(calls)[0]?.url.pathname).toBe("/v3/settings/shipping/templates");
  });

  it("reads one template with its methods and dates", async () => {
    const { client, calls } = createHarness([
      jsonRoute("GET", "/v3/settings/shipping/templates/TEMPLATE-1", {
        ...templateSummary,
        shippingMethods: [
          {
            shipMethod: "STANDARD",
            status: "ACTIVE",
            configurations: [
              {
                regions: [{ regionCode: "0001", regionName: "Example Region", subRegions: [] }],
                addressTypes: ["STREET"],
                transitTime: 3,
                perShippingCharge: { unitOfMeasure: "EACH", shippingAndHandling: 0 },
                tieredShippingCharges: [],
              },
            ],
          },
        ],
        createdBy: "creator-placeholder",
        modifiedBy: "modifier-placeholder",
        createdDate: 1_780_000_000_000,
        modifiedDate: 1_790_000_000_000,
        isMigrated: true,
      }),
    ]);
    const template = await client.shipping.getTemplate("TEMPLATE-1");

    expect(template).toMatchObject({ id: "TEMPLATE-1", status: "ACTIVE", isMigrated: true });
    expect(template.shippingMethods).toHaveLength(1);
    expect(template.shippingMethods[0]?.shipMethod).toBe("STANDARD");
    expect(template.shippingMethods[0]?.configurations[0]?.transitTime).toBe(3);
    expect(template.createdAt).toBe(new Date(1_780_000_000_000).toISOString());
    expect(template.modifiedAt).toBe(new Date(1_790_000_000_000).toISOString());
    expect(apiCalls(calls)[0]?.url.pathname).toBe("/v3/settings/shipping/templates/TEMPLATE-1");
  });

  it("rejects an empty id and a body without one", async () => {
    const { client } = createHarness([
      jsonRoute("GET", "/v3/settings/shipping/templates/TEMPLATE-2", { name: "no id" }),
    ]);
    await expect(client.shipping.getTemplate("")).rejects.toBeInstanceOf(WalmartValidationError);
    await expect(client.shipping.getTemplate("TEMPLATE-2")).rejects.toBeInstanceOf(WalmartApiError);
  });
});

describe("reports (read side)", () => {
  const request = {
    requestId: "11111111-2222-3333-4444-555555555555",
    requestStatus: "READY",
    requestSubmissionDate: "2026-01-02T03:04:05Z",
    reportType: "BUYBOX",
    reportVersion: "v1",
    reportSummary: "reportSummary",
    src: "API",
    channelType: "channel-placeholder",
    payload: {},
  };

  it("lists report requests", async () => {
    const { client, calls } = createHarness([
      jsonRoute("GET", "/v3/reports/reportRequests", {
        page: 1,
        totalCount: 1,
        limit: 5,
        requests: [request],
      }),
    ]);
    const page = await client.reports.list({ reportType: "BUYBOX", limit: 5 });

    expect(page).toMatchObject({ page: 1, totalCount: 1, limit: 5 });
    expect(page.requests[0]).toMatchObject({
      requestId: request.requestId,
      requestStatus: "READY",
      reportType: "BUYBOX",
      reportVersion: "v1",
      submittedAt: "2026-01-02T03:04:05.000Z",
    });
    const url = apiCalls(calls)[0]?.url;
    expect(url?.searchParams.get("reportType")).toBe("BUYBOX");
    expect(url?.searchParams.get("limit")).toBe("5");
  });

  it("reads one request by id", async () => {
    const { client, calls } = createHarness([
      jsonRoute("GET", `/v3/reports/reportRequests/${request.requestId}`, request),
    ]);
    const got = await client.reports.get(request.requestId);
    expect(got.requestStatus).toBe("READY");
    expect(apiCalls(calls)[0]?.url.pathname).toBe(
      `/v3/reports/reportRequests/${request.requestId}`,
    );
  });

  it("surfaces the 404 for an unknown or expired id", async () => {
    const { client } = createHarness([
      errorRoute("GET", /^\/v3\/reports\/reportRequests\//, 404, {
        errors: [
          {
            code: "CONTENT_NOT_FOUND",
            field: "requestId",
            description: "The requestId could not be found.",
            severity: "ERROR",
            category: "DATA",
          },
        ],
      }),
    ]);
    await expect(client.reports.get("unknown")).rejects.toMatchObject({ status: 404 });
  });

  it("returns the pre-signed download link without fetching it", async () => {
    const { client, calls } = createHarness([
      jsonRoute("GET", "/v3/reports/downloadReport", {
        requestId: request.requestId,
        requestStatus: "READY",
        requestSubmissionDate: "2026-01-02T03:04:05Z",
        reportType: "BUYBOX",
        reportVersion: "v1",
        downloadURL: "https://download.example.invalid/report.csv?signature=placeholder",
        downloadURLExpirationTime: "2026-01-02T04:04:05Z",
      }),
    ]);
    const download = await client.reports.getDownload(request.requestId);

    expect(download.downloadUrl).toContain("download.example.invalid");
    expect(download.expiresAt).toBe("2026-01-02T04:04:05.000Z");
    expect(download.requestStatus).toBe("READY");
    expect(apiCalls(calls)).toHaveLength(1);
    expect(apiCalls(calls)[0]?.url.searchParams.get("requestId")).toBe(request.requestId);
  });

  it("rejects a download response without a link", async () => {
    const { client } = createHarness([
      jsonRoute("GET", "/v3/reports/downloadReport", { requestId: "x", requestStatus: "RECEIVED" }),
    ]);
    await expect(client.reports.getDownload("x")).rejects.toBeInstanceOf(WalmartApiError);
  });

  it("exposes no way to request a report", () => {
    const { client } = createHarness([]);
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(client.reports)).filter(
      (name) => name !== "constructor",
    );
    expect(methods.sort()).toEqual(["get", "getDownload", "list"]);
  });
});

describe("operation table (ops read coverage)", () => {
  it("registers every new endpoint as a GET read", () => {
    const expected = {
      feedsList: ["feeds.list", "/v3/feeds"],
      lagTimeGet: ["lagTime.get", "/v3/lagtime"],
      catalogSearch: ["catalog.search", "/v3/items/walmart/search"],
      shippingTemplatesList: ["shipping.listTemplates", "/v3/settings/shipping/templates"],
      shippingTemplatesGet: [
        "shipping.getTemplate",
        "/v3/settings/shipping/templates/{templateId}",
      ],
      reportsList: ["reports.list", "/v3/reports/reportRequests"],
      reportsGet: ["reports.get", "/v3/reports/reportRequests/{requestId}"],
      reportsGetDownload: ["reports.getDownload", "/v3/reports/downloadReport"],
    } as const;
    for (const [key, [id, path]] of Object.entries(expected)) {
      const spec = OPERATIONS[key as keyof typeof OPERATIONS];
      expect(spec.id, key).toBe(id);
      expect(spec.path, key).toBe(path);
      expect(spec.method, key).toBe("GET");
      expect(spec.access, key).toBe("read");
    }
  });
});
