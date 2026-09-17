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
