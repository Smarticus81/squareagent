/**
 * VoyceLab Venue Management Routes
 *
 * All routes require authentication (Bearer token).
 *
 * GET    /api/venues           — list current user's venues
 * POST   /api/venues           — create/update venue with Square credentials
 * DELETE /api/venues/:id       — disconnect & remove a venue
 * GET    /api/venues/:id/catalog — proxy catalog for a stored venue
 */

import { Router, Request, Response } from "express";
import { db, agentProfilesTable, serviceConnectionsTable, venuesTable } from "@workspace/db";
import { eq, and, desc, inArray, isNull, or } from "drizzle-orm";
import { requireAuth } from "./auth";
import { ensureUserOrganization } from "./v1/_helpers";
import { getCachedCredentials, invalidateCredentials } from "../lib/credential-cache";
import { encrypt, decrypt } from "../lib/secrets";
import { claimPendingSquareOAuthToken } from "../lib/square-oauth-claims";
import { squareFetch } from "../lib/square-helpers";

const router = Router();

const SQUARE_BASE = "https://connect.squareup.com/v2";

type VenueListRow = typeof venuesTable.$inferSelect;
type SquareConnectionSummary = {
  id: string;
  venueId: number | null;
  status: string;
};

function venueResponse(v: VenueListRow, connection: SquareConnectionSummary | null = null) {
  return {
    serviceConnectionId: connection?.id ?? null,
    serviceConnectionStatus: connection?.status ?? null,
    id: v.id,
    name: v.name,
    squareMerchantId: v.squareMerchantId,
    squareLocationId: v.squareLocationId,
    squareLocationName: v.squareLocationName,
    connectedAt: v.connectedAt,
  };
}

async function currentOrganizationId(req: Request): Promise<string | null> {
  const existing = (req as Request & { organization?: { id: string } | null }).organization?.id;
  if (existing) return existing;
  const user = (req as any).user;
  if (!user) return null;
  const org = await ensureUserOrganization(user);
  return org.id;
}

function venueTenantWhere(userId: number, organizationId: string | null) {
  return organizationId
    ? or(
        eq(venuesTable.organizationId, organizationId),
        and(eq(venuesTable.userId, userId), isNull(venuesTable.organizationId)),
      )
    : eq(venuesTable.userId, userId);
}

function venueIdTenantWhere(venueId: number, userId: number, organizationId: string | null) {
  return and(eq(venuesTable.id, venueId), venueTenantWhere(userId, organizationId));
}

async function syncSquareServiceConnection(params: {
  organizationId: string | null;
  venueId: number;
  accessToken: string;
  merchantId?: string | null;
  locationId: string;
  locationName?: string | null;
}) {
  if (!params.organizationId) return null;

  const credentials = {
    accessToken: encrypt(params.accessToken),
    merchantId: params.merchantId || undefined,
  };
  const config = {
    locationId: params.locationId,
    locationName: params.locationName || undefined,
  };

  const [existing] = await db
    .select()
    .from(serviceConnectionsTable)
    .where(
      and(
        eq(serviceConnectionsTable.organizationId, params.organizationId),
        eq(serviceConnectionsTable.provider, "square"),
        eq(serviceConnectionsTable.venueId, params.venueId),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(serviceConnectionsTable)
      .set({
        credentials,
        config,
        status: "available",
        lastHealthCheck: {
          status: "healthy",
          checkedAt: new Date().toISOString(),
          message: "Square OAuth connected.",
        },
        updatedAt: new Date(),
      })
      .where(eq(serviceConnectionsTable.id, existing.id))
      .returning();
    return updated;
  }

  const [inserted] = await db
    .insert(serviceConnectionsTable)
    .values({
      organizationId: params.organizationId,
      venueId: params.venueId,
      provider: "square",
      credentials,
      config,
      status: "available",
      lastHealthCheck: {
        status: "healthy",
        checkedAt: new Date().toISOString(),
        message: "Square OAuth connected.",
      },
    })
    .returning();
  return inserted;
}

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
  if (!db) {
    res.status(503).json({ error: "Database not configured" });
    return;
  }
  try {
    const organizationId = await currentOrganizationId(req);
    const venues = await db
      .select()
      .from(venuesTable)
      .where(venueTenantWhere(user.id, organizationId))
      .orderBy(desc(venuesTable.connectedAt), desc(venuesTable.updatedAt), desc(venuesTable.id)) as VenueListRow[];
    const venueIds = venues.map((v) => v.id);
    const squareConnections: SquareConnectionSummary[] = venueIds.length > 0 && organizationId
      ? await db
          .select({
            id: serviceConnectionsTable.id,
            venueId: serviceConnectionsTable.venueId,
            status: serviceConnectionsTable.status,
          })
          .from(serviceConnectionsTable)
          .where(
            and(
              eq(serviceConnectionsTable.organizationId, organizationId),
              eq(serviceConnectionsTable.provider, "square"),
              inArray(serviceConnectionsTable.venueId, venueIds),
            ),
          )
      : [];
    const connectionByVenueId = new Map<number, SquareConnectionSummary>();
    for (const conn of squareConnections) {
      if (conn.venueId !== null) connectionByVenueId.set(conn.venueId, conn);
    }
    if (organizationId) {
      for (const venue of venues) {
        if (connectionByVenueId.has(venue.id)) continue;
        if (!venue.squareAccessToken || !venue.squareLocationId) continue;
        const backfilled = await syncSquareServiceConnection({
          organizationId,
          venueId: venue.id,
          accessToken: decrypt(venue.squareAccessToken),
          merchantId: venue.squareMerchantId,
          locationId: venue.squareLocationId,
          locationName: venue.squareLocationName,
        });
        if (backfilled) {
          connectionByVenueId.set(venue.id, {
            id: backfilled.id,
            venueId: backfilled.venueId,
            status: backfilled.status,
          });
        }
      }
    }

    res.json({
      venues: venues.map((v) => venueResponse(v, connectionByVenueId.get(v.id) ?? null)),
    });
  } catch (e: any) {
    // Surface schema/connection errors so the client can show a useful message
    // instead of getting a generic 500 and retrying in a loop.
    console.error("[Venues] List error:", e?.message, e?.stack);
    res.status(500).json({ error: e?.message || "Failed to load venues" });
  }
});

// ── POST /api/venues — create or update a venue with Square credentials ────
// Body: { squareOAuthClaim, merchantId, locationId, locationName, name? }

router.post("/", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user;
  const {
    squareOAuthClaim,
    merchantId: rawMerchantId,
    locationId,
    locationName,
    name,
  } = req.body ?? {};

  if (!squareOAuthClaim) {
    res.status(400).json({ error: "squareOAuthClaim is required" });
    return;
  }
  if (!locationId) {
    res.status(400).json({ error: "locationId is required" });
    return;
  }

  try {
    // Check if user already has a venue with this location — update instead of duplicate
    const organizationId = await currentOrganizationId(req);
    const claimedOAuth = squareOAuthClaim
      ? claimPendingSquareOAuthToken({
          claimId: String(squareOAuthClaim),
          userId: user.id,
          organizationId,
        })
      : null;
    if (squareOAuthClaim && !claimedOAuth) {
      res.status(404).json({ error: "Square connection expired. Please connect again." });
      return;
    }
    if (!claimedOAuth) {
      res.status(404).json({ error: "Square connection expired. Please connect again." });
      return;
    }
    const accessToken = claimedOAuth.token;
    const merchantId = claimedOAuth?.merchantId || rawMerchantId;

    const [existing] = await db
      .select()
      .from(venuesTable)
      .where(and(venueTenantWhere(user.id, organizationId), eq(venuesTable.squareLocationId, locationId)));

    const [existingMerchantVenue] = !existing && merchantId
      ? await db
          .select()
          .from(venuesTable)
          .where(and(venueTenantWhere(user.id, organizationId), eq(venuesTable.squareMerchantId, merchantId)))
          .orderBy(desc(venuesTable.connectedAt), desc(venuesTable.updatedAt), desc(venuesTable.id))
      : [undefined];

    if (existing) {
      const [updated] = await db
        .update(venuesTable)
        .set({
          squareAccessToken: encrypt(accessToken),
          squareMerchantId: merchantId || existing.squareMerchantId,
          squareLocationName: locationName || existing.squareLocationName,
          organizationId: existing.organizationId ?? organizationId,
          connectedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(venuesTable.id, existing.id))
        .returning();
      const serviceConnection = await syncSquareServiceConnection({
        organizationId,
        venueId: updated.id,
        accessToken,
        merchantId: merchantId || updated.squareMerchantId,
        locationId,
        locationName: locationName || updated.squareLocationName,
      });
      invalidateCredentials(user.id, updated.id);

      res.json({
        venue: {
          serviceConnectionId: serviceConnection?.id ?? null,
          serviceConnectionStatus: serviceConnection?.status ?? null,
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
          squareAccessToken: encrypt(accessToken),
          squareMerchantId: merchantId || existingMerchantVenue.squareMerchantId,
          squareLocationId: locationId,
          squareLocationName: locationName || existingMerchantVenue.squareLocationName,
          organizationId: existingMerchantVenue.organizationId ?? organizationId,
          connectedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(venuesTable.id, existingMerchantVenue.id))
        .returning();
      const serviceConnection = await syncSquareServiceConnection({
        organizationId,
        venueId: updated.id,
        accessToken,
        merchantId: merchantId || updated.squareMerchantId,
        locationId,
        locationName: locationName || updated.squareLocationName,
      });
      invalidateCredentials(user.id, updated.id);

      res.json({
        venue: {
          serviceConnectionId: serviceConnection?.id ?? null,
          serviceConnectionStatus: serviceConnection?.status ?? null,
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
        organizationId,
        name: venueName,
        squareAccessToken: encrypt(accessToken),
        squareMerchantId: merchantId || null,
        squareLocationId: locationId,
        squareLocationName: locationName || null,
        connectedAt: new Date(),
      })
      .returning();
    const serviceConnection = await syncSquareServiceConnection({
      organizationId,
      venueId: venue.id,
      accessToken,
      merchantId: merchantId || venue.squareMerchantId,
      locationId,
      locationName: locationName || venue.squareLocationName,
    });
    invalidateCredentials(user.id, venue.id);

    res.json({
      venue: {
        serviceConnectionId: serviceConnection?.id ?? null,
        serviceConnectionStatus: serviceConnection?.status ?? null,
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
    const organizationId = await currentOrganizationId(req);
    if (!organizationId) {
      res.status(403).json({ error: "Organization context required" });
      return;
    }
    const [venue] = await db
      .select()
      .from(venuesTable)
      .where(venueIdTenantWhere(venueId, user.id, organizationId));

    if (!venue) {
      res.status(404).json({ error: "Venue not found" });
      return;
    }

    // Revoke Square token if present. Prefer service_connections; fall back
    // through getCachedCredentials so migrated venues are handled too.
    const creds = await getCachedCredentials(user.id, venueId, organizationId);
    if (creds?.squareToken) {
      try {
        const appId = process.env.SQUARE_APPLICATION_ID;
        if (appId) {
          await squareFetch("https://connect.squareup.com/oauth2/revoke", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Square-Version": "2024-12-18",
              Authorization: `Client ${process.env.SQUARE_APPLICATION_SECRET}`,
            },
            body: JSON.stringify({
              client_id: appId,
              access_token: creds.squareToken,
            }),
          });
        }
      } catch {
        // Token revocation is best-effort
      }
    }

    await db.delete(venuesTable).where(venueIdTenantWhere(venueId, user.id, organizationId));
    invalidateCredentials(user.id, venueId);
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[Venues] Delete error:", e.message);
    res.status(500).json({ error: "Failed to remove venue" });
  }
});

// ── GET /api/venues/:id/credentials — get launch metadata for a venue ──────
// Square credentials stay server-side; clients use authenticated venue routes.

router.get("/:id/credentials", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user;
  const venueId = parseInt(req.params.id as string, 10);

  if (isNaN(venueId)) {
    res.status(400).json({ error: "Invalid venue ID" });
    return;
  }

  try {
    const organizationId = await currentOrganizationId(req);
    if (!organizationId) {
      res.status(403).json({ error: "Organization context required" });
      return;
    }
    const [venue] = await db
      .select()
      .from(venuesTable)
      .where(venueIdTenantWhere(venueId, user.id, organizationId));

    if (!venue) {
      res.status(404).json({ error: "Venue not found" });
      return;
    }

    const creds = await getCachedCredentials(user.id, venueId, organizationId);
    if (!creds) {
      res.status(400).json({ error: "Venue not connected to Square" });
      return;
    }

    const requestedProfileId =
      typeof req.query.agentProfileId === "string" && req.query.agentProfileId.trim()
        ? req.query.agentProfileId.trim()
        : null;

    const profileQuery = db
      .select({
        id: agentProfilesTable.id,
        venueId: agentProfilesTable.venueId,
        displayName: agentProfilesTable.displayName,
        wakePhrase: agentProfilesTable.wakePhrase,
        wakeMode: agentProfilesTable.wakeMode,
        noiseMode: agentProfilesTable.noiseMode,
        orderHandlingMode: agentProfilesTable.orderHandlingMode,
        voicePipelineProvider: agentProfilesTable.voicePipelineProvider,
        voicePipelineConfig: agentProfilesTable.voicePipelineConfig,
      })
      .from(agentProfilesTable)
      .where(
        requestedProfileId
          ? and(
              eq(agentProfilesTable.organizationId, organizationId),
              eq(agentProfilesTable.venueId, venueId),
              eq(agentProfilesTable.id, requestedProfileId),
            )
          : and(
              eq(agentProfilesTable.organizationId, organizationId),
              eq(agentProfilesTable.venueId, venueId),
            ),
      );

    const [profile] = requestedProfileId
      ? await profileQuery.limit(1)
      : await profileQuery.orderBy(desc(agentProfilesTable.updatedAt)).limit(1);

    res.json({
      locationId: creds.squareLocationId,
      locationName: venue.squareLocationName,
      merchantId: venue.squareMerchantId,
      connected: true,
      agentProfile: profile ?? null,
      wakePhrase: profile?.wakePhrase ?? null,
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
    const organizationId = await currentOrganizationId(req);
    const [venue] = await db
      .select()
      .from(venuesTable)
      .where(venueIdTenantWhere(venueId, user.id, organizationId));

    if (!venue) {
      res.status(404).json({ error: "Venue not found or not connected" });
      return;
    }

    const creds = await getCachedCredentials(user.id, venueId, organizationId);
    if (!creds) {
      res.status(404).json({ error: "Venue not found or not connected" });
      return;
    }

    const plainToken = creds.squareToken;
    const items: any[] = [];
    let cursor: string | undefined;

    do {
      const url = `${SQUARE_BASE}/catalog/list?types=ITEM&include_deleted_objects=false${cursor ? `&cursor=${cursor}` : ""}`;
      const response = await squareFetch(url, { headers: squareHeaders(plainToken) });
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

// ── POST /api/venues/:id/orders — create order using stored credentials ───────

router.post("/:id/orders", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user;
  const venueId = parseInt(req.params.id as string, 10);

  if (isNaN(venueId)) {
    res.status(400).json({ error: "Invalid venue ID" });
    return;
  }

  try {
    const organizationId = await currentOrganizationId(req);
    const [venue] = await db
      .select()
      .from(venuesTable)
      .where(venueIdTenantWhere(venueId, user.id, organizationId));

    if (!venue) {
      res.status(404).json({ error: "Venue not found or not connected" });
      return;
    }

    const creds = await getCachedCredentials(user.id, venueId, organizationId);
    if (!creds) {
      res.status(404).json({ error: "Venue not found or not connected" });
      return;
    }

    const { items } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "No items provided" });
      return;
    }

    const plainToken = creds.squareToken;
    const lineItems = items.map((item: any) => ({
      quantity: String(item.quantity ?? 1),
      catalog_object_id: item.variationId || item.catalogItemId,
      base_price_money: item.variationId ? undefined : {
        amount: Math.round(Number(item.price ?? 0) * 100),
        currency: "USD",
      },
    }));

    const orderRes = await squareFetch(`${SQUARE_BASE}/orders`, {
      method: "POST",
      headers: squareHeaders(plainToken),
      body: JSON.stringify({
        idempotency_key: `order-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        order: {
          location_id: creds.squareLocationId,
          reference_id: `VOICE-${Date.now()}`,
          line_items: lineItems,
        },
      }),
    });
    const orderData = await orderRes.json() as any;
    if (!orderRes.ok) {
      res.status(orderRes.status).json({ error: orderData.errors?.[0]?.detail || "Failed to create order" });
      return;
    }

    const orderId = orderData.order?.id;
    const orderTotal = orderData.order?.total_money?.amount ?? 0;
    const paymentRes = await squareFetch(`${SQUARE_BASE}/payments`, {
      method: "POST",
      headers: squareHeaders(plainToken),
      body: JSON.stringify({
        idempotency_key: `payment-${orderId}`,
        source_id: "EXTERNAL",
        amount_money: { amount: orderTotal, currency: "USD" },
        order_id: orderId,
        location_id: creds.squareLocationId,
        external_details: { type: "OTHER", source: "Pre-paid Event Package" },
        note: "Voice order - pre-paid event package",
      }),
    });
    const paymentData = await paymentRes.json() as any;
    const paymentError = !paymentRes.ok
      ? paymentData.errors?.[0]?.detail || "Order created but external payment could not be recorded"
      : null;

    res.json({
      success: true,
      orderId,
      total: orderTotal / 100,
      paymentRecorded: !paymentError,
      paymentId: paymentData.payment?.id,
      warning: paymentError,
    });
  } catch (e: any) {
    console.error("[Venues] Order error:", e.message);
    res.status(500).json({ error: "Failed to create order" });
  }
});

export default router;
