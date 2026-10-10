import { describe, expect, it } from "vitest";
import { DEFAULT_CANCELLATION_REASON, WalmartValidationError } from "../src/index.js";
import type { MockRoute } from "../src/testing/index.js";
import { apiCalls, createHarness, jsonRoute, SAMPLE_ORDER } from "./helpers.js";

const listBody = {
  list: {
    meta: { totalCount: 1, limit: 200 },
    elements: { order: [SAMPLE_ORDER] },
  },
};

describe("orders.list", () => {
  it("maps the list envelope onto WalmartOrder", async () => {
    const { client } = createHarness([jsonRoute("GET", "/v3/orders", listBody)]);
    const page = await client.orders.list({ createdStartDate: "2026-08-12T00:00:00Z" });

    expect(page.totalCount).toBe(1);
    expect(page.orders).toHaveLength(1);
    expect(page.orders[0]).toMatchObject({
      purchaseOrderId: "PO-1",
      customerOrderId: "CO-1",
      shippingMethod: "Standard",
    });
    expect(page.orders[0]?.orderLines[0]).toMatchObject({
      lineNumber: "1",
      sku: "SKU-1",
      productName: "Sample Widget",
      quantityAmount: 2,
      status: "Created",
    });
  });

  it("converts the epoch-millisecond orderDate to ISO-8601 UTC", async () => {
    const { client } = createHarness([jsonRoute("GET", "/v3/orders", listBody)]);
    const page = await client.orders.list();
    expect(page.orders[0]?.orderDate).toBe(new Date(1_757_000_000_000).toISOString());
  });

  it("forwards the documented query parameters", async () => {
    const { client, calls } = createHarness([jsonRoute("GET", "/v3/orders", listBody)]);
    await client.orders.list({
      createdStartDate: "2026-08-12T00:00:00Z",
      status: "CREATED",
      limit: 5,
      shipNodeType: "SellerFulfilled",
    });

    const url = apiCalls(calls)[0]?.url;
    expect(url?.searchParams.get("createdStartDate")).toBe("2026-08-12T00:00:00Z");
    expect(url?.searchParams.get("status")).toBe("CREATED");
    expect(url?.searchParams.get("limit")).toBe("5");
    expect(url?.searchParams.get("shipNodeType")).toBe("SellerFulfilled");
  });

  it("rejects an unknown status before sending", async () => {
    const { client, calls } = createHarness([]);
    await expect(client.orders.list({ status: "PENDING" as never })).rejects.toBeInstanceOf(
      WalmartValidationError,
    );
    expect(calls).toHaveLength(0);
  });

  it("walks pages in listAll", async () => {
    const paged: MockRoute = {
      method: "GET",
      pathPattern: "/v3/orders",
      reply: (req) =>
        req.url.searchParams.get("nextCursor") === "c2"
          ? {
              status: 200,
              body: {
                list: {
                  meta: {},
                  elements: { order: [{ ...SAMPLE_ORDER, purchaseOrderId: "PO-2" }] },
                },
              },
            }
          : {
              status: 200,
              body: {
                list: { meta: { nextCursor: "c2" }, elements: { order: [SAMPLE_ORDER] } },
              },
            },
    };
    const { client, calls } = createHarness([paged]);
    const ids: string[] = [];
    for await (const order of client.orders.listAll()) ids.push(order.purchaseOrderId);

    expect(ids).toEqual(["PO-1", "PO-2"]);
    expect(apiCalls(calls)).toHaveLength(2);
  });
});

describe("orders.get", () => {
  it("reads the single-order envelope", async () => {
    const { client, calls } = createHarness([
      jsonRoute("GET", "/v3/orders/PO-1", { order: SAMPLE_ORDER }),
    ]);
    const order = await client.orders.get("PO-1");
    expect(order.purchaseOrderId).toBe("PO-1");
    expect(apiCalls(calls)[0]?.url.pathname).toBe("/v3/orders/PO-1");
  });

  it("raises when the payload holds no order", async () => {
    const { client } = createHarness([jsonRoute("GET", "/v3/orders/PO-1", {})]);
    await expect(client.orders.get("PO-1")).rejects.toThrow(/no order/);
  });
});

describe("order writes", () => {
  it("acknowledges with an empty POST to the acknowledge path", async () => {
    const { client, calls } = createHarness([
      jsonRoute("POST", "/acknowledge", { order: SAMPLE_ORDER }),
    ]);
    await client.orders.acknowledge("PO-1");

    const call = apiCalls(calls)[0];
    expect(call?.method).toBe("POST");
    expect(call?.url.pathname).toBe("/v3/orders/PO-1/acknowledge");
    expect(call?.bodyText).toBeUndefined();
  });

  it("builds the orderShipment body with tracking info", async () => {
    const { client, calls } = createHarness([
      jsonRoute("POST", "/shipping", { order: SAMPLE_ORDER }),
    ]);
    await client.orders.ship("PO-1", {
      lines: [
        {
          lineNumber: "1",
          quantity: 2,
          carrier: "UPS",
          trackingNumber: "1Z999",
          shipDateTime: "2026-09-11T12:00:00Z",
          methodCode: "Standard",
        },
      ],
    });

    const call = apiCalls(calls)[0];
    expect(call?.url.pathname).toBe("/v3/orders/PO-1/shipping");
    expect(call?.bodyJson).toEqual({
      orderShipment: {
        orderLines: {
          orderLine: [
            {
              lineNumber: "1",
              orderLineStatuses: {
                orderLineStatus: [
                  {
                    status: "Shipped",
                    statusQuantity: { unitOfMeasurement: "EACH", amount: "2" },
                    trackingInfo: {
                      shipDateTime: "2026-09-11T12:00:00Z",
                      carrierName: { carrier: "UPS" },
                      methodCode: "Standard",
                      trackingNumber: "1Z999",
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    });
  });

  it("uses otherCarrier when the carrier is not on Walmart's list", async () => {
    const { client, calls } = createHarness([
      jsonRoute("POST", "/shipping", { order: SAMPLE_ORDER }),
    ]);
    await client.orders.ship("PO-1", {
      lines: [{ lineNumber: "1", carrier: "OTHER", otherCarrier: "Loomis", trackingNumber: "L1" }],
    });
    const body = JSON.stringify(apiCalls(calls)[0]?.bodyJson);
    expect(body).toContain('"otherCarrier":"Loomis"');
  });

  it("rejects a shipment without a tracking number before sending", async () => {
    const { client, calls } = createHarness([]);
    await expect(
      client.orders.ship("PO-1", {
        lines: [{ lineNumber: "1", carrier: "UPS", trackingNumber: "" }],
      }),
    ).rejects.toBeInstanceOf(WalmartValidationError);
    expect(calls).toHaveLength(0);
  });

  it("builds the orderCancellation body with the default reason", async () => {
    const { client, calls } = createHarness([
      jsonRoute("POST", "/cancel", { order: SAMPLE_ORDER }),
    ]);
    await client.orders.cancel("PO-1", { lineNumbers: ["1"] });

    const call = apiCalls(calls)[0];
    expect(call?.url.pathname).toBe("/v3/orders/PO-1/cancel");
    expect(call?.bodyJson).toEqual({
      orderCancellation: {
        orderLines: {
          orderLine: [
            {
              lineNumber: "1",
              orderLineStatuses: {
                orderLineStatus: [
                  { status: "Cancelled", cancellationReason: DEFAULT_CANCELLATION_REASON },
                ],
              },
            },
          ],
        },
      },
    });
  });

  it("rejects a cancellation with no line numbers", async () => {
    const { client, calls } = createHarness([]);
    await expect(client.orders.cancel("PO-1", { lineNumbers: [] })).rejects.toBeInstanceOf(
      WalmartValidationError,
    );
    expect(calls).toHaveLength(0);
  });
});

// An order as captured live 2026-10-10 (values replaced with placeholders). Note the nulls:
// Walmart sends explicit `null` for absent optional fields, and `customerEmailId` is omitted
// entirely on some orders.
const LIVE_ORDER = {
  purchaseOrderId: "PO-1",
  customerOrderId: "CO-1",
  orderDate: 1_757_000_000_000,
  shippingInfo: {
    phone: "0000000000",
    estimatedDeliveryDate: 1_757_500_000_000,
    estimatedShipDate: 1_757_100_000_000,
    methodCode: "Standard",
    postalAddress: {
      name: "<name>",
      address1: "<address1>",
      address2: null,
      city: "<city>",
      state: "<province>",
      postalCode: "<postal>",
      country: "CA",
      addressType: "RESIDENTIAL",
    },
    carrierMethodName: null,
  },
  orderLines: {
    orderLine: [
      {
        lineNumber: "1",
        shipFromCountry: "CA",
        item: { productName: "Sample Widget", sku: "SKU-1" },
        charges: {
          charge: [
            {
              chargeType: "PRODUCT",
              chargeName: "ItemPrice",
              chargeAmount: { currency: "CAD", amount: 19.99 },
              tax: { taxName: "GST", taxAmount: { currency: "CAD", amount: 1 } },
              isDiscount: false,
            },
          ],
        },
        orderLineQuantity: { unitOfMeasurement: "EACH", amount: "2" },
        statusDate: 1_757_300_000_000,
        orderLineStatuses: {
          orderLineStatus: [
            {
              status: "Delivered",
              subSellerId: null,
              statusQuantity: { unitOfMeasurement: "EACH", amount: "2" },
              cancellationReason: null,
              trackingInfo: {
                shipDateTime: 1_757_200_000_000,
                carrierName: { otherCarrier: null, carrier: "CPC" },
                methodCode: "Standard",
                trackingNumber: "TRACK-1",
                trackingURL: "https://example.invalid/track/TRACK-1",
                packageStatus: "DELIVERED",
              },
              returnCenterAddress: null,
              sellerOrderId: null,
            },
          ],
        },
        refund: null,
        fulfillment: { fulfillmentOption: "S2H", shipMethod: "STANDARD", storeId: null },
      },
    ],
  },
};

describe("orders live shapes (2026-10-10)", () => {
  it("parses a Delivered order with explicit nulls and no customerEmailId", async () => {
    const { client } = createHarness([
      jsonRoute("GET", "/v3/orders", {
        list: { meta: { totalCount: 1, limit: 1 }, elements: { order: [LIVE_ORDER] } },
      }),
    ]);
    const page = await client.orders.list({ limit: 1 });
    const order = page.orders[0];

    expect(order).toMatchObject({
      purchaseOrderId: "PO-1",
      customerOrderId: "CO-1",
      shippingMethod: "Standard",
    });
    expect(order?.customerEmailId).toBeUndefined();
    expect(order?.orderLines[0]).toMatchObject({
      lineNumber: "1",
      sku: "SKU-1",
      quantityAmount: 2,
      status: "Delivered",
    });
    expect(page.nextCursor).toBeUndefined();
  });

  it("works without createdStartDate (Walmart applies its own default window)", async () => {
    const { client, calls } = createHarness([
      jsonRoute("GET", "/v3/orders", {
        list: { meta: { totalCount: 1, limit: 1 }, elements: { order: [LIVE_ORDER] } },
      }),
    ]);
    await client.orders.list({ limit: 1 });
    expect(apiCalls(calls)[0]?.url.searchParams.has("createdStartDate")).toBe(false);
  });

  it("follows the query-string nextCursor verbatim and stops when it disappears", async () => {
    const cursor = "?limit=1&hasMoreElements=true&soIndex=1&poIndex=1&orgId=ORG&partnerId=P";
    const route: MockRoute = {
      method: "GET",
      pathPattern: "/v3/orders",
      reply: (req) =>
        req.url.searchParams.get("hasMoreElements") === "true"
          ? {
              status: 200,
              body: {
                list: {
                  meta: { totalCount: 2, limit: 1 },
                  elements: { order: [{ ...LIVE_ORDER, purchaseOrderId: "PO-2" }] },
                },
              },
            }
          : {
              status: 200,
              body: {
                list: {
                  meta: { totalCount: 2, limit: 1, nextCursor: cursor },
                  elements: { order: [LIVE_ORDER] },
                },
              },
            },
    };
    const { client, calls } = createHarness([route]);
    const ids: string[] = [];
    for await (const order of client.orders.listAll({ limit: 1 })) ids.push(order.purchaseOrderId);

    expect(ids).toEqual(["PO-1", "PO-2"]);
    const second = apiCalls(calls)[1]?.url;
    expect(second?.searchParams.get("soIndex")).toBe("1");
    expect(second?.searchParams.get("partnerId")).toBe("P");
  });

  it.each(["CREATED", "ACKNOWLEDGED", "SHIPPED", "DELIVERED", "CANCELLED", "REFUND"] as const)(
    "sends the upper-case %s status filter as given",
    async (status) => {
      const { client, calls } = createHarness([
        jsonRoute("GET", "/v3/orders", { list: { meta: { totalCount: 0 }, elements: {} } }),
      ]);
      const page = await client.orders.list({ status });
      expect(apiCalls(calls)[0]?.url.searchParams.get("status")).toBe(status);
      expect(page.orders).toEqual([]);
    },
  );
});
