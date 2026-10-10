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
  /** The category path as Walmart sends it: a JSON-encoded array STRING, not an array. */
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
  /**
   * Opaque cursor. Pass `*` for the first page, then {@link ItemsPage.nextCursor} straight
   * back. Walmart returns the SAME cursor on every page and advances it server-side per use,
   * and returns no cursor at all on an uncursored call; prefer `offset` + `limit` for paging.
   */
  nextCursor?: string;
  sku?: string;
  gtin?: string;
  offset?: number;
  /** Page size (Walmart defaults to 20). The SDK caps it at 200, as orders enforce upstream. */
  limit?: number;
  lifecycleStatus?: LifecycleStatus;
  /** Observed: `PUBLISHED`, `UNPUBLISHED`, `SYSTEM_PROBLEM`. Free-form: Walmart adds values. */
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
  /**
   * Walks every page, yielding items one at a time. Pages by `offset` (stateless; stops at
   * `totalItems`) unless `params.nextCursor` is given, in which case it follows the cursor.
   */
  listAll(params?: ListItemsParams, options?: RequestOptions): AsyncIterableIterator<WalmartItem>;
  get(sku: string, options?: RequestOptions): Promise<WalmartItem>;
}

// ---------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------

/**
 * Feed types. `MP_ITEM_INTL` (full item setup), `MP_ITEM_MATCH` (match by GTIN) and
 * `MP_MAINTENANCE` are valid for Canada; `MP_ITEM` is US-only and `feeds.submit` rejects it
 * on a non-US market before sending. `lagtime` sets the fulfillment lag time (handling days)
 * and, unlike every other type, is sent as a plain JSON body rather than multipart.
 */
export type WalmartFeedType =
  "MP_ITEM_INTL" | "MP_ITEM_MATCH" | "MP_MAINTENANCE" | "MP_ITEM" | "lagtime";

/** Feed payload: a `Blob`, raw bytes, or a JSON-serializable object/array. */
export type FeedFile = Blob | Uint8Array | Record<string, unknown> | readonly unknown[];

export interface SubmitFeedInput {
  feedType: WalmartFeedType;
  /**
   * Sent as the multipart part named `file`. For `feedType: "lagtime"` it must be a plain
   * object (`{ LagTimeHeader: { version: "1.0" }, lagTime: [{ sku, fulfillmentLagTime }] }`)
   * and is sent as the JSON request body instead.
   */
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
  /** Not sent by `GET /v3/feeds/{feedId}` (only by the feed list); usually `undefined`. */
  feedType?: string;
  /** ISO-8601 UTC, from `feedSubmissionDate` (epoch milliseconds on the wire). */
  submittedAt?: string;
  itemsReceived?: number;
  itemsSucceeded?: number;
  itemsFailed?: number;
  itemsProcessing?: number;
  itemDetails: ItemIngestionStatus[];
  raw: Record<string, unknown>;
}

/** Parameters for `feeds.list`. */
export interface ListFeedsParams {
  /** Restricts the history to one feed type, e.g. `lagtime` or `MP_ITEM_MATCH`. */
  feedType?: string;
  offset?: number;
  /** Page size. Walmart's own default applies when omitted. */
  limit?: number;
}

/** One row of the account-wide feed history (`GET /v3/feeds`). */
export interface FeedSummary {
  feedId: string;
  /** The only place `feedType` appears: `MP_ITEM_MATCH`, `MP_ITEM_INTL`, `lagtime`, … */
  feedType?: string;
  /** `RECEIVED` | `INPROGRESS` | `PROCESSED` | `ERROR`. */
  feedStatus?: string;
  /** ISO-8601 UTC, from `feedDate` (epoch milliseconds, as a string, on the wire). */
  submittedAt?: string;
  /** ISO-8601 UTC, from `modifiedDtm`. */
  modifiedAt?: string;
  itemsReceived?: number;
  itemsSucceeded?: number;
  itemsFailed?: number;
  itemsProcessing?: number;
  fileName?: string;
  raw: Record<string, unknown>;
}

/** One page of the feed history. */
export interface FeedsPage {
  feeds: FeedSummary[];
  totalResults?: number;
  offset?: number;
  limit?: number;
}

export interface FeedsApi {
  /**
   * WRITE. Uploads a feed as `multipart/form-data` with a single part named `file` (the
   * `lagtime` feed type is the exception: a plain JSON body).
   */
  submit(input: SubmitFeedInput, options?: RequestOptions): Promise<FeedSubmitResult>;
  getStatus(
    feedId: string,
    params?: FeedStatusParams,
    options?: RequestOptions,
  ): Promise<FeedStatus>;
  /**
   * `GET /v3/feeds`: the account-wide feed history, newest first. An empty history (or a
   * `feedType` that matches nothing) is an empty page, not an error.
   */
  list(params?: ListFeedsParams, options?: RequestOptions): Promise<FeedsPage>;
}

// ---------------------------------------------------------------------------
// Lag time
// ---------------------------------------------------------------------------

/** The stored fulfillment lag time of one SKU. */
export interface LagTimeRecord {
  sku: string;
  /** Days between order and shipment; `0` means same day. */
  fulfillmentLagTime: number;
  raw: Record<string, unknown>;
}

export interface LagTimeApi {
  /**
   * `GET /v3/lagtime?sku=`. Resolves to `null` when Walmart holds no lag time for the SKU (it
   * answers `404 CONTENT_NOT_FOUND`, which is the ordinary state of a SKU whose lag time was
   * never set). A SKU that is not in the catalog at all is NOT that case: Walmart answers
   * `520 500.SYSTEM_ERROR`, which surfaces as a `WalmartApiError`. Setting a lag time is
   * a `feeds.submit` with feed type `lagtime`.
   */
  get(sku: string, options?: RequestOptions): Promise<LagTimeRecord | null>;
}

// ---------------------------------------------------------------------------
// Catalog search
// ---------------------------------------------------------------------------

/** Exactly one of `gtin`, `upc` or `query` is required. */
export interface CatalogSearchParams {
  /** A GTIN-14 (zero-pad a 12-digit UPC to 14 digits). */
  gtin?: string;
  upc?: string;
  /** Free-text search. */
  query?: string;
}

/** One hit from the Walmart.ca catalog (any seller's item, not only ours). */
export interface CatalogItem {
  itemId: string;
  title?: string;
  brand?: string;
  productType?: string;
  /** Present on text-search hits, absent on GTIN / UPC hits. */
  standardUpc?: string;
  /** Present on text-search hits. `true` for a third-party (marketplace) offer. */
  isMarketPlaceItem?: boolean;
  price?: MoneyAmount;
  imageUrls: string[];
  raw: Record<string, unknown>;
}

export interface CatalogSearchResult {
  /** Empty when nothing matches (a `200`, not a `404`). */
  items: CatalogItem[];
  relatedQueries: string[];
}

export interface CatalogApi {
  /** `GET /v3/items/walmart/search`: look a product up in the public catalog. */
  search(params: CatalogSearchParams, options?: RequestOptions): Promise<CatalogSearchResult>;
}

// ---------------------------------------------------------------------------
// Shipping templates
// ---------------------------------------------------------------------------

/** One entry of the shipping-template list. */
export interface ShippingTemplateSummary {
  id: string;
  name?: string;
  /** Seen: `DEFAULT`. */
  type?: string;
  /** Seen: `PER_SHIPMENT_PRICING`. */
  rateModelType?: string;
  /** Seen: `ACTIVE`. */
  status?: string;
  isMigrated?: boolean;
}

export interface ShippingTemplatesPage {
  totalRecords?: number;
  templates: ShippingTemplateSummary[];
}

/** One shipping method of a template, with its per-region configurations. */
export interface ShippingTemplateMethod {
  /** Seen: `STANDARD`. */
  shipMethod?: string;
  status?: string;
  /** Regions, transit times and charges; the tree is deep and left as the wire sends it. */
  configurations: Record<string, unknown>[];
}

/** A full shipping template. */
export interface ShippingTemplate extends ShippingTemplateSummary {
  shippingMethods: ShippingTemplateMethod[];
  createdBy?: string;
  modifiedBy?: string;
  /** ISO-8601 UTC, from epoch milliseconds. */
  createdAt?: string;
  modifiedAt?: string;
  raw: Record<string, unknown>;
}

export interface ShippingApi {
  /** `GET /v3/settings/shipping/templates`. */
  listTemplates(options?: RequestOptions): Promise<ShippingTemplatesPage>;
  /** `GET /v3/settings/shipping/templates/{templateId}`. */
  getTemplate(templateId: string, options?: RequestOptions): Promise<ShippingTemplate>;
}

// ---------------------------------------------------------------------------
// Reports (read side only)
// ---------------------------------------------------------------------------

/** Parameters for `reports.list`. */
export interface ListReportsParams {
  /** e.g. `BUYBOX`, `ITEM_CA`. */
  reportType?: string;
  limit?: number;
  page?: number;
}

/** One report request, as listed or fetched by id. */
export interface ReportRequest {
  requestId: string;
  /** Seen: `READY`. Others are Walmart's (`RECEIVED`, `INPROGRESS`, `ERROR`: **ASSUMPTION**). */
  requestStatus?: string;
  reportType?: string;
  reportVersion?: string;
  /** ISO-8601 UTC, when Walmart sends a parseable date. */
  submittedAt?: string;
  raw: Record<string, unknown>;
}

export interface ReportsPage {
  page?: number;
  totalCount?: number;
  limit?: number;
  requests: ReportRequest[];
}

/** Where a READY report can be downloaded from. */
export interface ReportDownload {
  requestId: string;
  requestStatus?: string;
  /**
   * A short-lived, pre-signed URL. Treat it as a credential: do not log it. This SDK never
   * fetches it for you; a plain `fetch(downloadUrl)` returns the file.
   */
  downloadUrl: string;
  /** ISO-8601 UTC, when the URL stops working. */
  expiresAt?: string;
  raw: Record<string, unknown>;
}

export interface ReportsApi {
  /** `GET /v3/reports/reportRequests`: the report requests the seller has made. */
  list(params?: ListReportsParams, options?: RequestOptions): Promise<ReportsPage>;
  /** `GET /v3/reports/reportRequests/{requestId}`. An unknown or expired id answers `404`. */
  get(requestId: string, options?: RequestOptions): Promise<ReportRequest>;
  /** `GET /v3/reports/downloadReport?requestId=`: the pre-signed download link. */
  getDownload(requestId: string, options?: RequestOptions): Promise<ReportDownload>;
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

/**
 * `POST /v3/price` answers with a feed-shaped ingestion report. A failure can arrive as HTTP
 * 200 with only a top-level `ingestionErrors` block and no `feedId`; check
 * {@link PriceUpdateResult.ingestionErrors} before assuming the price changed.
 */
export interface PriceUpdateResult {
  feedId?: string;
  /** Top-level ingestion errors (e.g. `PDR-0016`); empty when the call was accepted. */
  ingestionErrors: FeedIngestionError[];
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
  /**
   * ISO-8601 UTC, e.g. `2026-08-12T00:00:00Z`. Optional: without it Walmart applies its own
   * default window, which returns fewer orders than an explicit wide range.
   */
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
  readonly lagTime: LagTimeApi;
  readonly catalog: CatalogApi;
  readonly shipping: ShippingApi;
  readonly reports: ReportsApi;
}
