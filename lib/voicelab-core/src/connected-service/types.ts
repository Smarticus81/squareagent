/**
 * Connected service abstraction. VoyceLab is a bolt-on layer; connected
 * services (Square, Toast, Clover, etc.) remain the source of truth for
 * catalog, orders, inventory, payments, team, and reports.
 *
 * The voice agent only ever calls normalized tools that route through a
 * ConnectedServiceAdapter. No voice or skill code may import provider
 * SDKs directly.
 */

export type ConnectedServiceProvider =
  | "square"
  | "toast"
  | "clover"
  | "lightspeed"
  | "shopify_pos"
  | "gopayments_poynt"
  | "revel"
  | "generic_rest"
  | "webhook"
  | "mock";

export type ConnectedServiceCapability =
  | "locations:read"
  | "catalog:read"
  | "catalog:manage"
  | "orders:create"
  | "orders:update"
  | "orders:submit"
  | "terminal:checkout"
  | "inventory:read"
  | "inventory:adjust"
  | "reports:read"
  | "customers:read"
  | "payments:refund"
  | "team:read"
  | "team:clock";

export type ConnectedServiceAvailabilityStatus =
  | "available"
  | "needs_configuration"
  | "request_access"
  | "unavailable";

export interface ConnectedServiceProviderMetadata {
  provider: ConnectedServiceProvider;
  displayName: string;
  description: string;
  status: ConnectedServiceAvailabilityStatus;
  capabilities: ConnectedServiceCapability[];
  /** When status === "request_access" or "needs_configuration", what's missing. */
  notes?: string;
  /** Visible in admin UI as a contact link. */
  requestAccessUrl?: string;
}

export interface ConnectionHealth {
  ok: boolean;
  status: "healthy" | "degraded" | "down" | "unauthorized";
  message?: string;
  checkedAt: string;
}

export interface ServiceConnection {
  id: string;
  organizationId: string;
  venueId: string;
  provider: ConnectedServiceProvider;
  /** Provider-specific opaque blob — encrypted at rest by the API server. */
  credentials: Record<string, unknown>;
  /** Provider-specific config (location id, environment, etc.). */
  config: Record<string, unknown>;
  status: ConnectedServiceAvailabilityStatus;
  lastHealthCheck?: ConnectionHealth;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorizeContext {
  organizationId: string;
  venueId: string;
  returnUrl: string;
  state?: string;
}

export interface OAuthExchangeContext {
  organizationId: string;
  venueId: string;
  code: string;
  state?: string;
}

export interface ServiceContext {
  connection: ServiceConnection;
  /** Optional request id for correlation. */
  requestId?: string;
  /** Optional idempotency key for write operations. */
  idempotencyKey?: string;
}

// ── Normalized location/catalog/order/inventory/report shapes ─────────────────

export interface ServiceLocation {
  id: string;
  name: string;
  status?: "active" | "inactive";
  timezone?: string;
  currency?: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  /** Price in minor currency units (cents). */
  priceCents?: number;
  currency?: string;
  category?: string;
  modifiers?: CatalogModifier[];
  variations?: CatalogVariation[];
}

export interface CatalogVariation {
  id: string;
  name: string;
  priceCents?: number;
}

export interface CatalogModifier {
  id: string;
  name: string;
  priceCents?: number;
}

export interface OrderLineItem {
  catalogItemId: string;
  variationId?: string;
  name: string;
  quantity: number;
  /** Unit price in minor currency units (cents). */
  unitPriceCents: number;
  notes?: string;
  modifiers?: { id: string; name: string; priceCents?: number }[];
}

export interface CreateOrderInput {
  locationId: string;
  lineItems: OrderLineItem[];
  customerId?: string;
  notes?: string;
}

export interface CreateOrderResult {
  orderId: string;
  state: "draft" | "open" | "submitted" | "completed" | "canceled";
}

export interface UpdateOrderInput {
  orderId: string;
  locationId: string;
  /** Replace existing line items with this list. */
  lineItems?: OrderLineItem[];
  notes?: string;
}

export interface UpdateOrderResult {
  orderId: string;
  state: "draft" | "open" | "submitted" | "completed" | "canceled";
}

export interface SubmitOrderInput {
  orderId: string;
  locationId: string;
}

export interface SubmitOrderResult {
  orderId: string;
  state: "submitted" | "completed";
}

export interface TerminalCheckoutInput {
  orderId: string;
  locationId: string;
  deviceId?: string;
}

export interface TerminalCheckoutResult {
  checkoutId: string;
  status: "pending" | "in_progress" | "completed" | "canceled" | "failed";
}

export interface InventoryQuery {
  locationId: string;
  catalogItemIds?: string[];
}

export interface InventoryResult {
  items: { catalogItemId: string; quantity: number; locationId: string }[];
}

export interface InventoryAdjustment {
  locationId: string;
  catalogItemId: string;
  delta: number;
  reason?: string;
}

export interface InventoryAdjustmentResult {
  catalogItemId: string;
  newQuantity: number;
}

export interface ReportQuery {
  locationId: string;
  start: string;
  end: string;
  kind: "daily_sales" | "hourly_sales" | "item_performance" | "labor_summary";
}

export interface ReportResult {
  kind: ReportQuery["kind"];
  rows: Record<string, unknown>[];
  totalCents?: number;
}

// ── Adapter contract ──────────────────────────────────────────────────────────

export interface ConnectedServiceAdapter {
  provider: ConnectedServiceProvider;
  capabilities: ConnectedServiceCapability[];

  validateConnection(connection: ServiceConnection): Promise<ConnectionHealth>;

  authorizeUrl?(ctx: AuthorizeContext): Promise<string>;
  exchangeOAuthCode?(ctx: OAuthExchangeContext): Promise<ServiceConnection>;

  listLocations(connection: ServiceConnection): Promise<ServiceLocation[]>;

  getCatalog(ctx: ServiceContext): Promise<CatalogItem[]>;
  searchCatalog(ctx: ServiceContext, query: string): Promise<CatalogItem[]>;

  createOrder(ctx: ServiceContext, input: CreateOrderInput): Promise<CreateOrderResult>;
  updateOrder?(ctx: ServiceContext, input: UpdateOrderInput): Promise<UpdateOrderResult>;
  submitOrder?(ctx: ServiceContext, input: SubmitOrderInput): Promise<SubmitOrderResult>;
  sendToTerminal?(
    ctx: ServiceContext,
    input: TerminalCheckoutInput,
  ): Promise<TerminalCheckoutResult>;

  checkInventory?(ctx: ServiceContext, input: InventoryQuery): Promise<InventoryResult>;
  adjustInventory?(
    ctx: ServiceContext,
    input: InventoryAdjustment,
  ): Promise<InventoryAdjustmentResult>;

  getReports?(ctx: ServiceContext, input: ReportQuery): Promise<ReportResult>;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class ConnectedServiceError extends Error {
  readonly provider: ConnectedServiceProvider;
  readonly capability?: ConnectedServiceCapability;
  readonly retryable: boolean;
  constructor(
    provider: ConnectedServiceProvider,
    message: string,
    opts: { capability?: ConnectedServiceCapability; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "ConnectedServiceError";
    this.provider = provider;
    this.capability = opts.capability;
    this.retryable = opts.retryable ?? false;
  }
}

export class CapabilityNotSupportedError extends ConnectedServiceError {
  constructor(provider: ConnectedServiceProvider, capability: ConnectedServiceCapability) {
    super(provider, `Provider "${provider}" does not support capability "${capability}".`, {
      capability,
    });
    this.name = "CapabilityNotSupportedError";
  }
}
