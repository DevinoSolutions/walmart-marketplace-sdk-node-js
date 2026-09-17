import { z } from "zod";
import type {
  CancelOrderInput,
  ListOrdersParams,
  OrderLine,
  OrdersApi,
  OrdersPage,
  RequestOptions,
  ShipOrderInput,
  WalmartOrder,
} from "../types.js";
import { WalmartApiError } from "../errors/index.js";
import { OPERATIONS } from "../operations.js";
import { applyCursor, type RequestSpec, type WalmartHttpClient } from "../client/http.js";
import { parseInput } from "../schemas/validate.js";
import { asIsoDate, asList, asNumber, asRecord, asString, getField } from "../schemas/wire.js";

/** Default cancellation reason when the caller does not supply one. */
export const DEFAULT_CANCELLATION_REASON = "CANCEL_BY_SELLER";

const ORDER_STATUSES = [
  "CREATED",
  "ACKNOWLEDGED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUND",
] as const;

const listParamsSchema = z.looseObject({
  createdStartDate: z.string().min(1).optional(),
  createdEndDate: z.string().min(1).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  nextCursor: z.string().min(1).optional(),
  shipNodeType: z.string().min(1).optional(),
  purchaseOrderId: z.string().min(1).optional(),
  customerOrderId: z.string().min(1).optional(),
  sku: z.string().min(1).optional(),
});

const shipSchema = z.looseObject({
  lines: z
    .array(
      z.looseObject({
        lineNumber: z.string().min(1),
        quantity: z.number().int().min(1).optional(),
        shipDateTime: z.string().min(1).optional(),
        carrier: z.string().min(1),
        otherCarrier: z.string().min(1).optional(),
        methodCode: z.string().min(1).optional(),
        trackingNumber: z.string().min(1),
        trackingUrl: z.string().min(1).optional(),
      }),
    )
    .min(1),
});

const cancelSchema = z.looseObject({
  lineNumbers: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1).optional(),
});

function parseOrderLine(entry: Record<string, unknown>): OrderLine {
  const item = getField(entry, "item");
  const statuses = asList(getField(entry, "orderLineStatuses"), "orderLineStatus");
  return {
    lineNumber: asString(entry.lineNumber),
    sku: asString(getField(item, "sku")),
    productName: asString(getField(item, "productName")),
    quantityAmount: asNumber(getField(getField(entry, "orderLineQuantity"), "amount")),
    status: asString(statuses[0]?.status),
    raw: entry,
  };
}

/** Maps one wire order onto {@link WalmartOrder}. */
function parseOrder(value: unknown): WalmartOrder | undefined {
  const root = asRecord(value);
  const purchaseOrderId = asString(root.purchaseOrderId);
  if (purchaseOrderId === undefined) return undefined;
  const shippingInfo = getField(root, "shippingInfo");
  return {
    purchaseOrderId,
    customerOrderId: asString(root.customerOrderId),
    customerEmailId: asString(root.customerEmailId),
    orderDate: asIsoDate(root.orderDate),
    shippingMethod: asString(getField(shippingInfo, "methodCode")),
    orderLines: asList(getField(root, "orderLines"), "orderLine").map(parseOrderLine),
    raw: root,
  };
}

/** Reads the `{ list: { meta: {...}, elements: { order: [...] } } }` envelope. */
function parseOrdersPage(json: unknown): OrdersPage {
  const root = asRecord(json);
  const list = asRecord(root.list);
  const meta = asRecord(list.meta);
  const elements = list.elements ?? root.elements;
  const orders: WalmartOrder[] = [];
  for (const entry of asList(getField(elements, "order") ?? elements, "order")) {
    const order = parseOrder(entry);
    if (order) orders.push(order);
  }
  const nextCursor = asString(meta.nextCursor);
  return {
    orders,
    totalCount: asNumber(meta.totalCount),
    nextCursor: nextCursor === "" ? undefined : nextCursor,
  };
}

/** Reads the single-order `{ order: {...} }` envelope returned by get/acknowledge/ship/cancel. */
function parseSingleOrder(
  json: unknown,
  status: number,
  correlationId: string,
  label: string,
): WalmartOrder {
  const root = asRecord(json);
  const order = parseOrder(root.order) ?? parseOrder(root);
  if (order === undefined) {
    throw new WalmartApiError(`Walmart returned no order for ${label}.`, {
      status,
      body: json,
      correlationId,
    });
  }
  return order;
}

export class OrdersApiImpl implements OrdersApi {
  readonly #http: WalmartHttpClient;

  constructor(http: WalmartHttpClient) {
    this.#http = http;
  }

  async list(params: ListOrdersParams = {}, options: RequestOptions = {}): Promise<OrdersPage> {
    const p = parseInput(listParamsSchema, params, "orders.list parameters");
    let spec: RequestSpec = {
      operation: OPERATIONS.ordersList,
      query: {
        createdStartDate: p.createdStartDate,
        createdEndDate: p.createdEndDate,
        status: p.status,
        limit: p.limit,
        shipNodeType: p.shipNodeType,
        purchaseOrderId: p.purchaseOrderId,
        customerOrderId: p.customerOrderId,
        sku: p.sku,
      },
    };
    if (p.nextCursor !== undefined) spec = applyCursor(spec, p.nextCursor);
    const result = await this.#http.request(spec, options);
    return parseOrdersPage(result.json);
  }

  async *listAll(
    params: ListOrdersParams = {},
    options: RequestOptions = {},
  ): AsyncIterableIterator<WalmartOrder> {
    let cursor = params.nextCursor;
    const seen = new Set<string>();
    for (;;) {
      const page: OrdersPage = await this.list({ ...params, nextCursor: cursor }, options);
      yield* page.orders;
      const next = page.nextCursor;
      if (next === undefined || page.orders.length === 0 || seen.has(next)) return;
      seen.add(next);
      cursor = next;
    }
  }

  async get(purchaseOrderId: string, options: RequestOptions = {}): Promise<WalmartOrder> {
    const id = parseInput(z.string().min(1), purchaseOrderId, "orders.get purchaseOrderId");
    const result = await this.#http.request(
      { operation: OPERATIONS.ordersGet, pathParams: { purchaseOrderId: id } },
      options,
    );
    return parseSingleOrder(result.json, result.status, result.correlationId, `order ${id}`);
  }

  async acknowledge(purchaseOrderId: string, options: RequestOptions = {}): Promise<WalmartOrder> {
    const id = parseInput(z.string().min(1), purchaseOrderId, "orders.acknowledge purchaseOrderId");
    const result = await this.#http.request(
      { operation: OPERATIONS.ordersAcknowledge, pathParams: { purchaseOrderId: id } },
      options,
    );
    return parseSingleOrder(
      result.json,
      result.status,
      result.correlationId,
      `acknowledged order ${id}`,
    );
  }

  async ship(
    purchaseOrderId: string,
    input: ShipOrderInput,
    options: RequestOptions = {},
  ): Promise<WalmartOrder> {
    const id = parseInput(z.string().min(1), purchaseOrderId, "orders.ship purchaseOrderId");
    const p = parseInput(shipSchema, input, "orders.ship input");
    const shipDefault = new Date().toISOString();
    const body = {
      orderShipment: {
        orderLines: {
          orderLine: p.lines.map((line) => ({
            lineNumber: line.lineNumber,
            orderLineStatuses: {
              orderLineStatus: [
                {
                  status: "Shipped",
                  statusQuantity: {
                    unitOfMeasurement: "EACH",
                    amount: String(line.quantity ?? 1),
                  },
                  trackingInfo: {
                    shipDateTime: line.shipDateTime ?? shipDefault,
                    carrierName:
                      line.otherCarrier === undefined
                        ? { carrier: line.carrier }
                        : { otherCarrier: line.otherCarrier },
                    methodCode: line.methodCode ?? "Standard",
                    trackingNumber: line.trackingNumber,
                    ...(line.trackingUrl === undefined ? {} : { trackingURL: line.trackingUrl }),
                  },
                },
              ],
            },
          })),
        },
      },
    };
    const result = await this.#http.request(
      { operation: OPERATIONS.ordersShip, pathParams: { purchaseOrderId: id }, json: body },
      options,
    );
    return parseSingleOrder(
      result.json,
      result.status,
      result.correlationId,
      `shipped order ${id}`,
    );
  }

  async cancel(
    purchaseOrderId: string,
    input: CancelOrderInput,
    options: RequestOptions = {},
  ): Promise<WalmartOrder> {
    const id = parseInput(z.string().min(1), purchaseOrderId, "orders.cancel purchaseOrderId");
    const p = parseInput(cancelSchema, input, "orders.cancel input");
    const body = {
      orderCancellation: {
        orderLines: {
          orderLine: p.lineNumbers.map((lineNumber) => ({
            lineNumber,
            orderLineStatuses: {
              orderLineStatus: [
                {
                  status: "Cancelled",
                  cancellationReason: p.reason ?? DEFAULT_CANCELLATION_REASON,
                },
              ],
            },
          })),
        },
      },
    };
    const result = await this.#http.request(
      { operation: OPERATIONS.ordersCancel, pathParams: { purchaseOrderId: id }, json: body },
      options,
    );
    return parseSingleOrder(
      result.json,
      result.status,
      result.correlationId,
      `cancelled order ${id}`,
    );
  }
}
