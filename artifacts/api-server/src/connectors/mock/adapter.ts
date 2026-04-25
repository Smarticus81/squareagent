import {
  type ConnectedServiceAdapter,
  type ServiceConnection,
  type ServiceContext,
  type CatalogItem as NormalizedCatalogItem,
  type CreateOrderInput,
  type CreateOrderResult,
  type UpdateOrderInput,
  type UpdateOrderResult,
  type SubmitOrderInput,
  type SubmitOrderResult,
  type InventoryQuery,
  type InventoryResult,
  type InventoryAdjustment,
  type InventoryAdjustmentResult,
  type ServiceLocation,
  type ConnectionHealth,
  type ReportQuery,
  type ReportResult,
} from "@workspace/voicelab-core/connected-service";

/** In-memory data — adapter instance is the source of truth for tests. */
const SAMPLE_CATALOG: NormalizedCatalogItem[] = [
  { id: "mock-coffee", name: "Coffee", priceCents: 350, currency: "USD", category: "drinks" },
  { id: "mock-latte", name: "Latte", priceCents: 500, currency: "USD", category: "drinks" },
  { id: "mock-bagel", name: "Bagel", priceCents: 400, currency: "USD", category: "food" },
];

const SAMPLE_LOCATIONS: ServiceLocation[] = [
  { id: "mock-loc-1", name: "Mock Cafe — Downtown", status: "active", currency: "USD" },
  { id: "mock-loc-2", name: "Mock Cafe — Eastside", status: "active", currency: "USD" },
];

interface MockOrder {
  orderId: string;
  state: "open" | "submitted" | "completed";
  locationId: string;
  lineItems: CreateOrderInput["lineItems"];
}

const orders = new Map<string, MockOrder>();
const inventory = new Map<string, number>([
  ["mock-loc-1:mock-coffee", 50],
  ["mock-loc-1:mock-latte", 25],
  ["mock-loc-1:mock-bagel", 12],
]);

export class MockAdapter implements ConnectedServiceAdapter {
  readonly provider = "mock" as const;
  readonly capabilities: ConnectedServiceAdapter["capabilities"] = [
    "locations:read",
    "catalog:read",
    "orders:create",
    "orders:update",
    "orders:submit",
    "inventory:read",
    "inventory:adjust",
  ];

  async validateConnection(_connection: ServiceConnection): Promise<ConnectionHealth> {
    return { ok: true, status: "healthy", checkedAt: new Date().toISOString() };
  }

  async listLocations(_connection: ServiceConnection): Promise<ServiceLocation[]> {
    return SAMPLE_LOCATIONS;
  }

  async getCatalog(_ctx: ServiceContext): Promise<NormalizedCatalogItem[]> {
    return SAMPLE_CATALOG;
  }

  async searchCatalog(_ctx: ServiceContext, query: string): Promise<NormalizedCatalogItem[]> {
    const q = query.toLowerCase();
    return SAMPLE_CATALOG.filter((i) => i.name.toLowerCase().includes(q));
  }

  async createOrder(_ctx: ServiceContext, input: CreateOrderInput): Promise<CreateOrderResult> {
    const orderId = `mock-order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    orders.set(orderId, { orderId, state: "open", locationId: input.locationId, lineItems: input.lineItems });
    return { orderId, state: "open" };
  }

  async updateOrder(_ctx: ServiceContext, input: UpdateOrderInput): Promise<UpdateOrderResult> {
    const existing = orders.get(input.orderId);
    if (!existing) return { orderId: input.orderId, state: "canceled" };
    if (input.lineItems) existing.lineItems = input.lineItems;
    return { orderId: input.orderId, state: existing.state === "completed" ? "completed" : "open" };
  }

  async submitOrder(_ctx: ServiceContext, input: SubmitOrderInput): Promise<SubmitOrderResult> {
    const existing = orders.get(input.orderId);
    if (existing) existing.state = "completed";
    return { orderId: input.orderId, state: "completed" };
  }

  async checkInventory(_ctx: ServiceContext, input: InventoryQuery): Promise<InventoryResult> {
    const ids = input.catalogItemIds ?? SAMPLE_CATALOG.map((i) => i.id);
    return {
      items: ids.map((id) => ({
        catalogItemId: id,
        quantity: inventory.get(`${input.locationId}:${id}`) ?? 0,
        locationId: input.locationId,
      })),
    };
  }

  async adjustInventory(
    _ctx: ServiceContext,
    input: InventoryAdjustment,
  ): Promise<InventoryAdjustmentResult> {
    const key = `${input.locationId}:${input.catalogItemId}`;
    const current = inventory.get(key) ?? 0;
    const next = Math.max(0, current + input.delta);
    inventory.set(key, next);
    return { catalogItemId: input.catalogItemId, newQuantity: next };
  }

  async getReports(_ctx: ServiceContext, input: ReportQuery): Promise<ReportResult> {
    return { kind: input.kind, rows: [], totalCents: 0 };
  }
}

/** Test helpers — exported so unit tests can reset between cases. */
export function __resetMockState(): void {
  orders.clear();
  inventory.clear();
  inventory.set("mock-loc-1:mock-coffee", 50);
  inventory.set("mock-loc-1:mock-latte", 25);
  inventory.set("mock-loc-1:mock-bagel", 12);
}
