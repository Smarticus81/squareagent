/**
 * Shared Square API helpers used by both POS and Inventory agents.
 */

export const SQUARE_BASE = "https://connect.squareup.com/v2";

export function squareHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Square-Version": "2024-12-18",
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CatalogItem {
  id: string;
  variationId?: string;
  name: string;
  price: number;
  category?: string;
}

export interface OrderItem {
  item_id?: string;
  item_name: string;
  quantity: number;
  price: number;
}

export interface SessionOrderItem {
  catalogItemId: string;
  variationId?: string;
  name: string;
  price: number;
  quantity: number;
}

export interface OrderCommand {
  action: "add" | "remove" | "clear" | "submit";
  item_id?: string;
  item_name?: string;
  quantity?: number;
  price?: number;
}

// ── Catalog / Inventory helpers ───────────────────────────────────────────────

export function findCatalogItem(catalog: CatalogItem[], name: string): CatalogItem | undefined {
  return (
    catalog.find((c) => c.name.toLowerCase() === name.toLowerCase()) ??
    catalog.find(
      (c) =>
        c.name.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(c.name.toLowerCase()),
    )
  );
}

export async function getInventoryCount(
  token: string,
  locationId: string,
  variationId: string,
): Promise<number> {
  const res = await fetch(`${SQUARE_BASE}/inventory/counts/batch-retrieve`, {
    method: "POST",
    headers: squareHeaders(token),
    body: JSON.stringify({
      catalog_object_ids: [variationId],
      location_ids: [locationId],
    }),
  });
  const data = (await res.json()) as any;
  const count = data.counts?.find(
    (c: any) => c.catalog_object_id === variationId && c.state === "IN_STOCK",
  );
  return count ? parseFloat(count.quantity) : 0;
}
