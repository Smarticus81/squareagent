/**
 * Bevpro Venue Management Routes
 *
 * All routes require authentication (Bearer token).
 *
 * GET    /api/venues           — list current user's venues
 * POST   /api/venues           — create/update venue with Square credentials
 * DELETE /api/venues/:id       — disconnect & remove a venue
 * GET    /api/venues/:id/catalog — proxy catalog for a stored venue
 */

import { Router, Request, Response } from "express";
import { db, venuesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "./auth";

const router = Router();

const SQUARE_BASE = "https://connect.squareup.com/v2";

function squareHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Square-Version": "2024-12-18",
  };
}

// ── GET /api/venues — list all venues for current user ─────────────────────

router.get("/", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user;
  try {
    const venues = await db
      .select()
      .from(venuesTable)
      .where(eq(venuesTable.userId, user.id))
      .orderBy(desc(venuesTable.connectedAt), desc(venuesTable.updatedAt), desc(venuesTable.id));

    res.json({
      venues: venues.map((v: any) => ({
        id: v.id,
        name: v.name,
        squareMerchantId: v.squareMerchantId,
        squareLocationId: v.squareLocationId,
        squareLocationName: v.squareLocationName,
        connectedAt: v.connectedAt,
      })),
    });
  } catch (e: any) {
    console.error("[Venues] List error:", e.message);
    res.status(500).json({ error: "Failed to load venues" });
  }
});

// ── POST /api/venues — create or update a venue with Square credentials ────
// Body: { accessToken, merchantId, locationId, locationName, name? }

router.post("/", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user;
  const { accessToken, merchantId, locationId, locationName, name } = req.body ?? {};

  if (!accessToken) {
    res.status(400).json({ error: "accessToken is required" });
    return;
  }
  if (!locationId) {
    res.status(400).json({ error: "locationId is required" });
    return;
  }

  try {
    // Check if user already has a venue with this location — update instead of duplicate
    const [existing] = await db
      .select()
      .from(venuesTable)
      .where(and(eq(venuesTable.userId, user.id), eq(venuesTable.squareLocationId, locationId)));

    const [existingMerchantVenue] = !existing && merchantId
      ? await db
          .select()
          .from(venuesTable)
          .where(and(eq(venuesTable.userId, user.id), eq(venuesTable.squareMerchantId, merchantId)))
          .orderBy(desc(venuesTable.connectedAt), desc(venuesTable.updatedAt), desc(venuesTable.id))
      : [undefined];

    if (existing) {
      const [updated] = await db
        .update(venuesTable)
        .set({
          squareAccessToken: accessToken,
          squareMerchantId: merchantId || existing.squareMerchantId,
          squareLocationName: locationName || existing.squareLocationName,
          connectedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(venuesTable.id, existing.id))
        .returning();

      res.json({
        venue: {
          id: updated.id,
          name: updated.name,
          squareMerchantId: updated.squareMerchantId,
          squareLocationId: updated.squareLocationId,
          squareLocationName: updated.squareLocationName,
          connectedAt: updated.connectedAt,
        },
      });
      return;
    }

    if (existingMerchantVenue) {
      const [updated] = await db
        .update(venuesTable)
        .set({
          name: name || locationName || existingMerchantVenue.name,
          squareAccessToken: accessToken,
          squareMerchantId: merchantId || existingMerchantVenue.squareMerchantId,
          squareLocationId: locationId,
          squareLocationName: locationName || existingMerchantVenue.squareLocationName,
          connectedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(venuesTable.id, existingMerchantVenue.id))
        .returning();

      res.json({
        venue: {
          id: updated.id,
          name: updated.name,
          squareMerchantId: updated.squareMerchantId,
          squareLocationId: updated.squareLocationId,
          squareLocationName: updated.squareLocationName,
          connectedAt: updated.connectedAt,
        },
      });
      return;
    }

    // Determine venue name — use provided name, locationName, or merchant business name
    const venueName = name || locationName || "My Venue";

    const [venue] = await db
      .insert(venuesTable)
      .values({
        userId: user.id,
        name: venueName,
        squareAccessToken: accessToken,
        squareMerchantId: merchantId || null,
        squareLocationId: locationId,
        squareLocationName: locationName || null,
        connectedAt: new Date(),
      })
      .returning();

    res.json({
      venue: {
        id: venue.id,
        name: venue.name,
        squareMerchantId: venue.squareMerchantId,
        squareLocationId: venue.squareLocationId,
        squareLocationName: venue.squareLocationName,
        connectedAt: venue.connectedAt,
      },
    });
  } catch (e: any) {
    console.error("[Venues] Create error:", e.message);
    res.status(500).json({ error: "Failed to save venue" });
  }
});

// ── DELETE /api/venues/:id — disconnect and remove a venue ─────────────────

router.delete("/:id", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user;
  const venueId = parseInt(req.params.id as string, 10);

  if (isNaN(venueId)) {
    res.status(400).json({ error: "Invalid venue ID" });
    return;
  }

  try {
    const [venue] = await db
      .select()
      .from(venuesTable)
      .where(and(eq(venuesTable.id, venueId), eq(venuesTable.userId, user.id)));

    if (!venue) {
      res.status(404).json({ error: "Venue not found" });
      return;
    }

    // Revoke Square token if present
    if (venue.squareAccessToken) {
      try {
        const appId = process.env.SQUARE_APPLICATION_ID;
        if (appId) {
          await fetch("https://connect.squareup.com/oauth2/revoke", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Square-Version": "2024-12-18",
              Authorization: `Client ${process.env.SQUARE_APPLICATION_SECRET}`,
            },
            body: JSON.stringify({
              client_id: appId,
              access_token: venue.squareAccessToken,
            }),
          });
        }
      } catch {
        // Token revocation is best-effort
      }
    }

    await db.delete(venuesTable).where(eq(venuesTable.id, venueId));
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[Venues] Delete error:", e.message);
    res.status(500).json({ error: "Failed to remove venue" });
  }
});

// ── GET /api/venues/:id/credentials — get Square token for a venue ─────────
// Used by the voice agent to load credentials without exposing token in URLs

router.get("/:id/credentials", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user;
  const venueId = parseInt(req.params.id as string, 10);

  if (isNaN(venueId)) {
    res.status(400).json({ error: "Invalid venue ID" });
    return;
  }

  try {
    const [venue] = await db
      .select()
      .from(venuesTable)
      .where(and(eq(venuesTable.id, venueId), eq(venuesTable.userId, user.id)));

    if (!venue) {
      res.status(404).json({ error: "Venue not found" });
      return;
    }

    if (!venue.squareAccessToken || !venue.squareLocationId) {
      res.status(400).json({ error: "Venue not connected to Square" });
      return;
    }

    res.json({
      accessToken: venue.squareAccessToken,
      locationId: venue.squareLocationId,
      locationName: venue.squareLocationName,
      merchantId: venue.squareMerchantId,
    });
  } catch (e: any) {
    console.error("[Venues] Credentials error:", e.message);
    res.status(500).json({ error: "Failed to load credentials" });
  }
});

// ── GET /api/venues/:id/catalog — load catalog using stored credentials ────

router.get("/:id/catalog", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user;
  const venueId = parseInt(req.params.id as string, 10);

  if (isNaN(venueId)) {
    res.status(400).json({ error: "Invalid venue ID" });
    return;
  }

  try {
    const [venue] = await db
      .select()
      .from(venuesTable)
      .where(and(eq(venuesTable.id, venueId), eq(venuesTable.userId, user.id)));

    if (!venue || !venue.squareAccessToken) {
      res.status(404).json({ error: "Venue not found or not connected" });
      return;
    }

    const items: any[] = [];
    let cursor: string | undefined;

    do {
      const url = `${SQUARE_BASE}/catalog/list?types=ITEM&include_deleted_objects=false${cursor ? `&cursor=${cursor}` : ""}`;
      const response = await fetch(url, { headers: squareHeaders(venue.squareAccessToken) });
      const data = (await response.json()) as any;

      if (!response.ok) {
        res.status(response.status).json({ error: data.errors?.[0]?.detail || "Failed to load catalog" });
        return;
      }

      for (const obj of data.objects || []) {
        if (obj.type !== "ITEM") continue;
        const itemData = obj.item_data;
        if (!itemData) continue;
        const variations = itemData.variations || [];
        if (variations.length === 0) continue;

        if (variations.length === 1) {
          const varData = variations[0].item_variation_data;
          items.push({
            id: obj.id,
            variationId: variations[0].id,
            name: itemData.name,
            price: varData?.price_money ? varData.price_money.amount / 100 : 0,
            category: itemData.category_id,
            description: itemData.description || "",
          });
        } else {
          for (const variation of variations) {
            const varData = variation.item_variation_data;
            if (!varData) continue;
            const varName =
              varData.name && varData.name !== "Regular"
                ? `${itemData.name} (${varData.name})`
                : itemData.name;
            items.push({
              id: obj.id,
              variationId: variation.id,
              name: varName,
              price: varData.price_money ? varData.price_money.amount / 100 : 0,
              category: itemData.category_id,
              description: itemData.description || "",
            });
          }
        }
      }
      cursor = data.cursor;
    } while (cursor);

    res.json({ items, count: items.length });
  } catch (e: any) {
    console.error("[Venues] Catalog error:", e.message);
    res.status(500).json({ error: "Failed to load catalog" });
  }
});

export default router;
