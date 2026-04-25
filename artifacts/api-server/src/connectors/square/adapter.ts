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
  type TerminalCheckoutInput,
  type TerminalCheckoutResult,
  type InventoryQuery,
  type InventoryResult,
  type InventoryAdjustment,
  type InventoryAdjustmentResult,
  type ReportQuery,
  type ReportResult,
  type ServiceLocation,
  type ConnectionHealth,
  ConnectedServiceError,
} from "@workspace/voicelab-core/connected-service";
import {
  SQUARE_BASE,
  squareHeaders,
  syncLiveOrderToSquare,
  cancelLiveOrder,
  completeLiveOrder,
  pushToTerminal,
  getInventoryCount,
  listLocations as listSquareLocations,
  listRecentOrders,
  getSalesSummary,
  type LiveSession,
  type SessionOrderItem,
} from "../../lib/square-helpers";

interface SquareCredentials {
  accessToken: string;
  merchantId?: string;
}

interface SquareConnectionConfig {
  locationId: string;
  locationName?: string;
}

function readSquareCreds(connection: ServiceConnection): SquareCredentials {
  const c = connection.credentials as Record<string, unknown>;
  const accessToken = typeof c.accessToken === "string" ? c.accessToken : "";
  const merchantId = typeof c.merchantId === "string" ? c.merchantId : undefined;
  if (!accessToken) {
    throw new ConnectedServiceError("square", "Missing Square access token in connection credentials.");
  }
  return { accessToken, merchantId };
}

function readSquareConfig(connection: ServiceConnection): SquareConnectionConfig {
  const c = connection.config as Record<string, unknown>;
  const locationId = typeof c.locationId === "string" ? c.locationId : "";
  const locationName = typeof c.locationName === "string" ? c.locationName : undefined;
  if (!locationId) {
    throw new ConnectedServiceError("square", "Missing Square location id in connection config.");
  }
  return { locationId, locationName };
}

/** Fetch and normalize the Square catalog. */
async function fetchSquareCatalog(token: string): Promise<NormalizedCatalogItem[]> {
  const res = await fetch(`${SQUARE_BASE}/catalog/list?types=ITEM`, {
    headers: squareHeaders(token),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ConnectedServiceError("square", `catalog list failed: ${JSON.stringify(err)}`, {
      capability: "catalog:read",
      retryable: res.status >= 500,
    });
  }
  const data = (await res.json()) as { objects?: Record<string, unknown>[] };
  const items: NormalizedCatalogItem[] = [];
  for (const obj of data.objects ?? []) {
    if ((obj as { type?: string }).type !== "ITEM") continue;
    const itemData = (obj as { item_data?: Record<string, unknown> }).item_data;
    if (!itemData) continue;
    const variations = (itemData.variations as Record<string, unknown>[] | undefined) ?? [];
    const firstVar = variations[0];
    const priceMoney = firstVar
      ? ((firstVar as { item_variation_data?: { price_money?: { amount?: number; currency?: string } } })
          .item_variation_data?.price_money)
      : undefined;
    items.push({
      id: String((obj as { id: string }).id),
      name: String(itemData.name ?? "Unnamed"),
      priceCents: priceMoney?.amount,
      currency: priceMoney?.currency,
      category:
        typeof itemData.category_id === "string" ? (itemData.category_id as string) : undefined,
      variations: variations.map((v) => {
        const vd = (v as { item_variation_data?: { name?: string; price_money?: { amount?: number } } })
          .item_variation_data;
        return {
          id: String((v as { id: string }).id),
          name: String(vd?.name ?? "Regular"),
          priceCents: vd?.price_money?.amount,
        };
      }),
    });
  }
  return items;
}

export class SquareAdapter implements ConnectedServiceAdapter {
  readonly provider = "square" as const;
  readonly capabilities: ConnectedServiceAdapter["capabilities"] = [
    "locations:read",
    "catalog:read",
    "orders:create",
    "orders:update",
    "orders:submit",
    "terminal:checkout",
    "inventory:read",
    "inventory:adjust",
    "reports:read",
  ];

  async validateConnection(connection: ServiceConnection): Promise<ConnectionHealth> {
    try {
      const creds = readSquareCreds(connection);
      const cfg = readSquareConfig(connection);
      const res = await fetch(`${SQUARE_BASE}/locations/${cfg.locationId}`, {
        headers: squareHeaders(creds.accessToken),
      });
      const checkedAt = new Date().toISOString();
      if (res.status === 401 || res.status === 403) {
        return { ok: false, status: "unauthorized", message: "Square token rejected", checkedAt };
      }
      if (!res.ok) {
        return { ok: false, status: "down", message: `Square HTTP ${res.status}`, checkedAt };
      }
      return { ok: true, status: "healthy", checkedAt };
    } catch (e) {
      return {
        ok: false,
        status: "down",
        message: e instanceof Error ? e.message : "unknown",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async listLocations(connection: ServiceConnection): Promise<ServiceLocation[]> {
    const creds = readSquareCreds(connection);
    const result = await listSquareLocations(creds.accessToken);
    if (!result.ok) {
      throw new ConnectedServiceError("square", result.error ?? "list locations failed", {
        capability: "locations:read",
      });
    }
    return (result.locations ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      status: l.status === "ACTIVE" ? "active" : "inactive",
    }));
  }

  async getCatalog(ctx: ServiceContext): Promise<NormalizedCatalogItem[]> {
    const creds = readSquareCreds(ctx.connection);
    return fetchSquareCatalog(creds.accessToken);
  }

  async searchCatalog(ctx: ServiceContext, query: string): Promise<NormalizedCatalogItem[]> {
    const all = await this.getCatalog(ctx);
    const q = query.toLowerCase();
    return all.filter(
      (i) => i.name.toLowerCase().includes(q) || (i.category ?? "").toLowerCase().includes(q),
    );
  }

  async createOrder(ctx: ServiceContext, input: CreateOrderInput): Promise<CreateOrderResult> {
    const creds = readSquareCreds(ctx.connection);
    const session: LiveSession = {
      items: input.lineItems.map<SessionOrderItem>((li) => ({
        catalogItemId: li.catalogItemId,
        variationId: li.variationId,
        name: li.name,
        price: (li.unitPriceCents ?? 0) / 100,
        quantity: li.quantity,
      })),
    };
    const result = await syncLiveOrderToSquare(session, creds.accessToken, input.locationId);
    if (!result.ok || !result.squareOrderId) {
      throw new ConnectedServiceError("square", result.error ?? "createOrder failed", {
        capability: "orders:create",
      });
    }
    return { orderId: result.squareOrderId, state: "open" };
  }

  async updateOrder(ctx: ServiceContext, input: UpdateOrderInput): Promise<UpdateOrderResult> {
    const creds = readSquareCreds(ctx.connection);
    const session: LiveSession = {
      squareOrderId: input.orderId,
      items: (input.lineItems ?? []).map<SessionOrderItem>((li) => ({
        catalogItemId: li.catalogItemId,
        variationId: li.variationId,
        name: li.name,
        price: (li.unitPriceCents ?? 0) / 100,
        quantity: li.quantity,
      })),
    };
    const result = await syncLiveOrderToSquare(session, creds.accessToken, input.locationId);
    if (!result.ok) {
      throw new ConnectedServiceError("square", result.error ?? "updateOrder failed", {
        capability: "orders:update",
      });
    }
    return { orderId: input.orderId, state: "open" };
  }

  async submitOrder(ctx: ServiceContext, input: SubmitOrderInput): Promise<SubmitOrderResult> {
    const creds = readSquareCreds(ctx.connection);
    const session: LiveSession = { squareOrderId: input.orderId, items: [] };
    const result = await completeLiveOrder(session, creds.accessToken, input.locationId);
    if (result.error) {
      throw new ConnectedServiceError("square", result.error, { capability: "orders:submit" });
    }
    return { orderId: input.orderId, state: "completed" };
  }

  async sendToTerminal(
    ctx: ServiceContext,
    input: TerminalCheckoutInput,
  ): Promise<TerminalCheckoutResult> {
    const creds = readSquareCreds(ctx.connection);
    if (!input.deviceId) {
      throw new ConnectedServiceError("square", "deviceId required for terminal checkout", {
        capability: "terminal:checkout",
      });
    }
    // Total is unknown here; fetch the order to determine the amount.
    const orderRes = await fetch(`${SQUARE_BASE}/orders/batch-retrieve`, {
      method: "POST",
      headers: squareHeaders(creds.accessToken),
      body: JSON.stringify({ location_id: input.locationId, order_ids: [input.orderId] }),
    });
    const orderJson = (await orderRes.json()) as { orders?: { total_money?: { amount?: number } }[] };
    const totalCents = orderJson.orders?.[0]?.total_money?.amount ?? 0;
    const result = await pushToTerminal(
      creds.accessToken,
      input.locationId,
      input.deviceId,
      input.orderId,
      totalCents,
    );
    if (result.error || !result.checkoutId) {
      throw new ConnectedServiceError("square", result.error ?? "terminal checkout failed", {
        capability: "terminal:checkout",
      });
    }
    return { checkoutId: result.checkoutId, status: "pending" };
  }

  async checkInventory(ctx: ServiceContext, input: InventoryQuery): Promise<InventoryResult> {
    const creds = readSquareCreds(ctx.connection);
    if (!input.catalogItemIds || input.catalogItemIds.length === 0) {
      return { items: [] };
    }
    const items = await Promise.all(
      input.catalogItemIds.map(async (id) => {
        const qty = await getInventoryCount(creds.accessToken, input.locationId, id);
        return { catalogItemId: id, quantity: qty, locationId: input.locationId };
      }),
    );
    return { items };
  }

  async adjustInventory(
    ctx: ServiceContext,
    input: InventoryAdjustment,
  ): Promise<InventoryAdjustmentResult> {
    const creds = readSquareCreds(ctx.connection);
    const fromState = input.delta >= 0 ? "NONE" : "IN_STOCK";
    const toState = input.delta >= 0 ? "IN_STOCK" : "WASTE";
    const res = await fetch(`${SQUARE_BASE}/inventory/changes/batch-create`, {
      method: "POST",
      headers: squareHeaders(creds.accessToken),
      body: JSON.stringify({
        idempotency_key: `adjust-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        changes: [
          {
            type: "ADJUSTMENT",
            adjustment: {
              from_state: fromState,
              to_state: toState,
              location_id: input.locationId,
              catalog_object_id: input.catalogItemId,
              quantity: Math.abs(input.delta).toString(),
              occurred_at: new Date().toISOString(),
            },
          },
        ],
      }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new ConnectedServiceError("square", `adjustInventory failed: ${JSON.stringify(err)}`, {
        capability: "inventory:adjust",
      });
    }
    const newQty = await getInventoryCount(
      creds.accessToken,
      input.locationId,
      input.catalogItemId,
    );
    return { catalogItemId: input.catalogItemId, newQuantity: newQty };
  }

  async getReports(ctx: ServiceContext, input: ReportQuery): Promise<ReportResult> {
    const creds = readSquareCreds(ctx.connection);
    if (input.kind === "daily_sales" || input.kind === "item_performance") {
      const summary = await getSalesSummary(creds.accessToken, input.locationId, input.start, input.end);
      if (!summary.ok || !summary.summary) {
        throw new ConnectedServiceError("square", summary.error ?? "reports failed", {
          capability: "reports:read",
        });
      }
      const rows: Record<string, unknown>[] = input.kind === "item_performance"
        ? summary.summary.topItems.map((t) => ({ name: t.name, qty: t.qty, revenue: t.revenue }))
        : [
            {
              totalOrders: summary.summary.totalOrders,
              totalRevenue: summary.summary.totalRevenue,
              avgOrder: summary.summary.avgOrder,
            },
          ];
      return {
        kind: input.kind,
        rows,
        totalCents: Math.round((summary.summary.totalRevenue ?? 0) * 100),
      };
    }
    if (input.kind === "hourly_sales") {
      const orders = await listRecentOrders(creds.accessToken, input.locationId, 200);
      if (!orders.ok) {
        throw new ConnectedServiceError("square", orders.error ?? "reports failed", {
          capability: "reports:read",
        });
      }
      const buckets = new Map<number, number>();
      for (const o of orders.orders ?? []) {
        const at = (o as { created_at?: string }).created_at;
        const total = (o as { total_money?: { amount?: number } }).total_money?.amount ?? 0;
        if (!at) continue;
        const hour = new Date(at).getHours();
        buckets.set(hour, (buckets.get(hour) ?? 0) + total);
      }
      return {
        kind: "hourly_sales",
        rows: Array.from(buckets.entries()).map(([hour, cents]) => ({ hour, revenue: cents / 100 })),
      };
    }
    throw new ConnectedServiceError("square", `report kind ${input.kind} not implemented`, {
      capability: "reports:read",
    });
  }
}

/** Build a ServiceConnection from a legacy venue row (for the migration path). */
export function squareConnectionFromVenue(venue: {
  id: number;
  squareAccessToken?: string | null;
  squareMerchantId?: string | null;
  squareLocationId?: string | null;
  squareLocationName?: string | null;
  userId: number;
  createdAt?: Date;
  updatedAt?: Date;
}): ServiceConnection {
  return {
    id: `legacy-venue-${venue.id}`,
    organizationId: `user-${venue.userId}`,
    venueId: String(venue.id),
    provider: "square",
    credentials: {
      accessToken: venue.squareAccessToken ?? "",
      merchantId: venue.squareMerchantId ?? undefined,
    },
    config: {
      locationId: venue.squareLocationId ?? "",
      locationName: venue.squareLocationName ?? undefined,
    },
    status: venue.squareAccessToken ? "available" : "needs_configuration",
    createdAt: (venue.createdAt ?? new Date()).toISOString(),
    updatedAt: (venue.updatedAt ?? new Date()).toISOString(),
  };
}

/** Used by `cancelLiveOrder` callers — re-exported so callers don't import square-helpers directly. */
export const squareCancelLiveOrder = cancelLiveOrder;
