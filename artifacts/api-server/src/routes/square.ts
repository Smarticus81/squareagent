import { Router, type IRouter, Request, Response } from "express";

const router: IRouter = Router();

const SQUARE_BASE = "https://connect.squareup.com/v2";

function squareHeaders(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Square-Version": "2024-12-18",
  };
}

// GET /api/square/locations
router.get("/locations", async (req: Request, res: Response) => {
  const token = req.headers["x-square-token"] as string;
  if (!token) return res.status(401).json({ error: "Missing Square access token" });

  try {
    const response = await fetch(`${SQUARE_BASE}/locations`, {
      headers: squareHeaders(token),
    });
    const data = await response.json() as any;

    if (!response.ok) {
      return res.status(response.status).json({ error: data.errors?.[0]?.detail || "Failed to load locations" });
    }

    const locations = (data.locations || []).map((loc: any) => ({
      id: loc.id,
      name: loc.name,
      address: loc.address ? `${loc.address.address_line_1 || ""}, ${loc.address.locality || ""}`.trim() : undefined,
    }));

    res.json({ locations });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to load locations" });
  }
});

// GET /api/square/catalog
router.get("/catalog", async (req: Request, res: Response) => {
  const token = req.headers["x-square-token"] as string;
  const locationId = req.headers["x-square-location"] as string;
  if (!token) return res.status(401).json({ error: "Missing Square access token" });

  try {
    // Fetch catalog items
    const response = await fetch(
      `${SQUARE_BASE}/catalog/list?types=ITEM&include_deleted_objects=false`,
      { headers: squareHeaders(token) }
    );

    const data = await response.json() as any;

    if (!response.ok) {
      return res.status(response.status).json({ error: data.errors?.[0]?.detail || "Failed to load catalog" });
    }

    const items: any[] = [];

    for (const obj of data.objects || []) {
      if (obj.type !== "ITEM") continue;
      const itemData = obj.item_data;
      if (!itemData) continue;

      // Get the first active variation with price
      for (const variation of itemData.variations || []) {
        const varData = variation.item_variation_data;
        if (!varData) continue;

        const priceMoney = varData.price_money;
        const price = priceMoney ? priceMoney.amount / 100 : 0;

        items.push({
          id: obj.id,
          variationId: variation.id,
          name: itemData.name,
          price,
          category: itemData.category_id,
          description: itemData.description || "",
        });

        break; // Use only first variation for simplicity
      }
    }

    res.json({ items });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to load catalog" });
  }
});

// POST /api/square/orders
router.post("/orders", async (req: Request, res: Response) => {
  const token = req.headers["x-square-token"] as string;
  const locationId = req.headers["x-square-location"] as string;
  if (!token) return res.status(401).json({ error: "Missing Square access token" });
  if (!locationId) return res.status(400).json({ error: "Missing location ID" });

  try {
    const { items } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ error: "No items provided" });
    }

    const lineItems = items.map((item: any) => ({
      quantity: item.quantity.toString(),
      catalog_object_id: item.variationId || item.catalogItemId,
      base_price_money: item.variationId ? undefined : {
        amount: Math.round(item.price * 100),
        currency: "USD",
      },
    }));

    const idempotencyKey = `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const response = await fetch(`${SQUARE_BASE}/orders`, {
      method: "POST",
      headers: squareHeaders(token),
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        order: {
          location_id: locationId,
          line_items: lineItems,
        },
      }),
    });

    const data = await response.json() as any;

    if (!response.ok) {
      return res.status(response.status).json({ error: data.errors?.[0]?.detail || "Failed to create order" });
    }

    res.json({
      success: true,
      orderId: data.order?.id,
      total: data.order?.total_money?.amount
        ? data.order.total_money.amount / 100
        : 0,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to create order" });
  }
});

export default router;
