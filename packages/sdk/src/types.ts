/**
 * Public types for `@devino/walmart-marketplace-sdk`. Everything here is re-exported from the
 * package root; `docs/research/sdk-public-api.md` is the binding description of this surface.
 */

/** Value of the `WM_MARKET` header. Canada is the default for this SDK. */
export type WalmartMarket = "ca" | "us" | "mx" | "cl";

/** Options accepted by every SDK method. */
export interface RequestOptions {
  /** Aborts the in-flight request. Independent of the client's own `timeoutMs`. */
  signal?: AbortSignal;
  /** Overrides `timeoutMs` for this call only. */
  timeoutMs?: number;
}

/** Configuration for {@link createWalmartClient}. */
export interface WalmartClientConfig {
  /** API key pair from Seller Center → Settings → API Key Management. */
  clientId: string;
  clientSecret: string;
  /** `WM_MARKET` header value. Defaults to `"ca"`. */
  market?: WalmartMarket;
  /** Defaults to `https://marketplace.walmartapis.com`. Sandbox: `https://sandbox.walmartapis.com`. */
  baseUrl?: string;
  /** `WM_SVC.NAME` header value. Defaults to `"devino-walmart-sdk"`. */
  svcName?: string;
  /** Injectable `fetch` (tests, proxies). Defaults to the global. */
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /** Injectable correlation-id factory. Defaults to `crypto.randomUUID()`. */
  correlationId?: () => string;
  /** Injectable clock (epoch ms) used by the token cache. Defaults to `Date.now`. */
  now?: () => number;
}

/** A cached OAuth token. `accessToken` is a bearer credential — never log it. */
export interface AccessToken {
  accessToken: string;
  /** Always `"Bearer"` in practice. */
  tokenType: string;
  /** Absolute expiry (epoch ms), derived from `expires_in` at the time of the token call. */
  expiresAtMs: number;
}

/** Token acquisition. The client calls this for you; it is exposed for preflight checks. */
export interface AuthApi {
  /**
   * Returns a valid access token, minting a new one only when the cached token is missing or
   * within 60 s of expiry. Concurrent callers share a single in-flight token request.
   */
  getAccessToken(options?: RequestOptions): Promise<AccessToken>;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** Money as Walmart returns it. */
export interface MoneyAmount {
  currency?: string;
  amount?: number;
}

/** Item lifecycle state. */
export type LifecycleStatus = "ACTIVE" | "ARCHIVED" | "RETIRED";

/** One item from `GET /v3/items`. `raw` carries every field Walmart sent, unmodified. */
export interface WalmartItem {
  sku: string;
  wpid?: string;
  gtin?: string;
  upc?: string;
  productName?: string;
  shelf?: string;
  productType?: string;
  price?: MoneyAmount;
  /** e.g. `PUBLISHED`, `UNPUBLISHED`, `IN_PROGRESS`. Free-form: Walmart adds values. */
  publishedStatus?: string;
  lifecycleStatus?: string;
  raw: Record<string, unknown>;
}

/** Query parameters for `items.list`. */
export interface ListItemsParams {
  /** Opaque cursor from a previous page. Pass {@link ItemsPage.nextCursor} straight back. */
  nextCursor?: string;
  sku?: string;
  gtin?: string;
  offset?: number;
  /** Walmart caps this at 200 per page. */
  limit?: number;
  lifecycleStatus?: LifecycleStatus;
  publishedStatus?: string;
}

/** One page of items. */
export interface ItemsPage {
  items: WalmartItem[];
  /** Total across all pages when Walmart reports it. */
  totalItems?: number;
  /** Absent on the last page. */
  nextCursor?: string;
}

export interface ItemsApi {
  list(params?: ListItemsParams, options?: RequestOptions): Promise<ItemsPage>;
  /** Walks every page via `nextCursor`, yielding items one at a time. */
  listAll(params?: ListItemsParams, options?: RequestOptions): AsyncIterableIterator<WalmartItem>;
  get(sku: string, options?: RequestOptions): Promise<WalmartItem>;
}

// ---------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------

/**
 * Feed types. `MP_ITEM_INTL` (full item setup), `MP_ITEM_MATCH` (match by GTIN) and
 * `MP_MAINTENANCE` are valid for Canada; `MP_ITEM` is US-only and `feeds.submit` rejects it
 * on a non-US market before sending.
 */
export type WalmartFeedType = "MP_ITEM_INTL" | "MP_ITEM_MATCH" | "MP_MAINTENANCE" | "MP_ITEM";

/** Feed payload: a `Blob`, raw bytes, or a JSON-serializable object/array. */
export type FeedFile = Blob | Uint8Array | Record<string, unknown> | readonly unknown[];

export interface SubmitFeedInput {
  feedType: WalmartFeedType;
  /** Sent as the multipart part named `file`. */
  file: FeedFile;
  /** Multipart filename. Defaults to `feed.json`. */
  fileName?: string;
}

/** `POST /v3/feeds` acknowledges with a feed id only; processing is asynchronous. */
export interface FeedSubmitResult {
  feedId: string;
}

/** Per-item outcome inside a feed status response. */
export interface ItemIngestionStatus {
  sku?: string;
  wpid?: string;
  index?: number;
  /** `INPROGRESS` | `SUCCESS` | `DATA_ERROR` | `SYSTEM_ERROR` | `TIMEOUT_ERROR`. */
  ingestionStatus?: string;
  ingestionErrors: FeedIngestionError[];
}

export interface FeedIngestionError {
  type?: string;
  code?: string;
  description?: string;
  field?: string;
}

/** Parameters for `feeds.getStatus`. */
export interface FeedStatusParams {
  /** Include per-item `itemDetails`. Defaults to `true`. */
  includeDetails?: boolean;
  offset?: number;
  limit?: number;
}

export interface FeedStatus {
  feedId: string;
  /** `RECEIVED` | `INPROGRESS` | `PROCESSED` | `ERROR`. */
  feedStatus?: string;
  feedType?: string;
  itemsReceived?: number;
  itemsSucceeded?: number;
  itemsFailed?: number;
  itemsProcessing?: number;
  itemDetails: ItemIngestionStatus[];
  raw: Record<string, unknown>;
}

export interface FeedsApi {
  /** WRITE. Uploads a feed as `multipart/form-data` with a single part named `file`. */
  submit(input: SubmitFeedInput, options?: RequestOptions): Promise<FeedSubmitResult>;
  getStatus(
    feedId: string,
    params?: FeedStatusParams,
    options?: RequestOptions,
  ): Promise<FeedStatus>;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export interface InventoryQuantity {
  /** Walmart's unit of measure; `EACH` for everything this SDK supports. */
  unit: string;
  amount: number;
}

export interface InventoryRecord {
  sku: string;
  quantity: InventoryQuantity;
  raw: Record<string, unknown>;
}

export interface UpdateInventoryInput {
  sku: string;
  /** Non-negative integer. */
  amount: number;
  /** Defaults to `EACH`. */
  unit?: string;
}

export interface InventoryApi {
  get(sku: string, options?: RequestOptions): Promise<InventoryRecord>;
  /** WRITE. Sets the on-hand quantity for one SKU. */
  update(input: UpdateInventoryInput, options?: RequestOptions): Promise<InventoryRecord>;
}

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

/** Header block of the CA/MX/CL price payload. Defaults come from the client's market. */
export interface PriceFeedHeader {
  mart: string;
  locale: string;
  version: string;
  businessUnit?: string;
  tenant?: string;
}

export interface PriceUpdateItem {
  sku: string;
  price: number;
  msrp?: number;
}

export interface PriceUpdateInput {
  items: PriceUpdateItem[];
  /** Overrides for the generated {@link PriceFeedHeader}. */
  header?: Partial<PriceFeedHeader>;
}

/** `POST /v3/price` answers with a feed-shaped ingestion report. */
export interface PriceUpdateResult {
  feedId?: string;
  itemsReceived?: number;
  itemsSucceeded?: number;
  itemsFailed?: number;
  itemDetails: ItemIngestionStatus[];
  raw: Record<string, unknown>;
}

export interface PriceApi {
  /** WRITE. Submits new prices for up to 10,000 SKUs. */
  update(input: PriceUpdateInput, options?: RequestOptions): Promise<PriceUpdateResult>;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type OrderStatus =
  "CREATED" | "ACKNOWLEDGED" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "REFUND";

export interface OrderLine {
  lineNumber?: string;
  sku?: string;
  productName?: string;
  quantityAmount?: number;
  status?: string;
  raw: Record<string, unknown>;
}

export interface WalmartOrder {
  purchaseOrderId: string;
  customerOrderId?: string;
  customerEmailId?: string;
  /** Walmart sends epoch milliseconds; converted to an ISO-8601 UTC string. */
  orderDate?: string;
  shippingMethod?: string;
  orderLines: OrderLine[];
  raw: Record<string, unknown>;
}

export interface ListOrdersParams {
  /** ISO-8601 UTC, e.g. `2026-08-12T00:00:00Z`. Walmart requires it on an uncursored call. */
  createdStartDate?: string;
  createdEndDate?: string;
  status?: OrderStatus;
  /** Walmart caps this at 200. */
  limit?: number;
  nextCursor?: string;
  /** e.g. `SellerFulfilled`. */
  shipNodeType?: string;
  purchaseOrderId?: string;
  customerOrderId?: string;
  sku?: string;
}

export interface OrdersPage {
  orders: WalmartOrder[];
  totalCount?: number;
  nextCursor?: string;
}

/** One tracked package for `orders.ship`. */
export interface ShipmentLine {
  lineNumber: string;
  /** Defaults to the line's ordered quantity when omitted by Walmart. */
  quantity?: number;
  /** ISO-8601 UTC. Defaults to now. */
  shipDateTime?: string;
  carrier: string;
  /** Required when `carrier` is `OTHER`. */
  otherCarrier?: string;
  methodCode?: string;
  trackingNumber: string;
  trackingUrl?: string;
}

export interface ShipOrderInput {
  lines: ShipmentLine[];
}

export interface CancelOrderInput {
  /** Line numbers to cancel. */
  lineNumbers: string[];
  /** Walmart's cancellation reason code. Defaults to `CANCEL_BY_SELLER`. */
  reason?: string;
}

export interface OrdersApi {
  list(params?: ListOrdersParams, options?: RequestOptions): Promise<OrdersPage>;
  /** Walks every page via `nextCursor`, yielding orders one at a time. */
  listAll(params?: ListOrdersParams, options?: RequestOptions): AsyncIterableIterator<WalmartOrder>;
  get(purchaseOrderId: string, options?: RequestOptions): Promise<WalmartOrder>;
  /** WRITE. Moves an order from `CREATED` to `ACKNOWLEDGED`. */
  acknowledge(purchaseOrderId: string, options?: RequestOptions): Promise<WalmartOrder>;
  /** WRITE. Attaches tracking and moves lines to `SHIPPED`. */
  ship(
    purchaseOrderId: string,
    input: ShipOrderInput,
    options?: RequestOptions,
  ): Promise<WalmartOrder>;
  /** WRITE. Cancels the given lines. */
  cancel(
    purchaseOrderId: string,
    input: CancelOrderInput,
    options?: RequestOptions,
  ): Promise<WalmartOrder>;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** The object returned by {@link createWalmartClient}. */
export interface WalmartClient {
  readonly market: WalmartMarket;
  readonly auth: AuthApi;
  readonly items: ItemsApi;
  readonly feeds: FeedsApi;
  readonly inventory: InventoryApi;
  readonly price: PriceApi;
  readonly orders: OrdersApi;
}
