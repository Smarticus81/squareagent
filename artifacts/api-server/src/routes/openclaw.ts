/**
 * OpenClaw Bridge — REST endpoint for OpenClaw skill tool execution
 *
 * POST /api/openclaw/tool  → Execute a VoyceLab tool call from OpenClaw agent
 * GET  /api/openclaw/catalog → Get the full catalog for a venue
 * POST /api/openclaw/session/end → End a session and cancel open orders
 *
 * Delegates all tool execution to the shared tool registry (../tools),
 * eliminating the previous 330-line duplicated switch statement.
 */

import { Router } from "express";
import { requireAuth, requirePlan } from "./auth";
import {
  cancelLiveOrder,
  type CatalogItem,
  type LiveSession,
} from "../lib/square-helpers";
import { SquareClient } from "../lib/square-client";
import { getCachedCredentials } from "../lib/credential-cache";
import { getCachedCatalog } from "../lib/catalog-cache";
import { executeToolCall } from "../tools";

const router = Router();

// ── Per-session state (keyed by session_id from OpenClaw) ─────────────────────

interface OpenClawSession {
  liveSession: LiveSession;
  catalog: CatalogItem[];
  squareToken: string;
  squareLocationId: string;
  lastAccess: number;
}

const sessions = new Map<string, OpenClawSession>();

// Clean up stale sessions every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour
  let cleaned = 0;
  for (const [key, sess] of sessions) {
    if (sess.lastAccess < cutoff) {
      if (sess.liveSession.squareOrderId) {
        cancelLiveOrder(sess.liveSession, sess.squareToken, sess.squareLocationId).catch(() => {});
      }
      sessions.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`[OpenClaw] Cleaned ${cleaned} stale session(s). Active: ${sessions.size}`);
}, 30 * 60 * 1000);

// ── Session management ──────────────────────────────────────────────────────

async function getOrCreateSession(
  sessionId: string,
  userId: number,
  venueId: number,
): Promise<OpenClawSession | null> {
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.lastAccess = Date.now();
    return existing;
  }

  const creds = await getCachedCredentials(userId, venueId);
  if (!creds) return null;

  const catalog = await getCachedCatalog(creds.squareToken, creds.squareLocationId);

  const session: OpenClawSession = {
    liveSession: { items: [] },
    catalog,
    squareToken: creds.squareToken,
    squareLocationId: creds.squareLocationId,
    lastAccess: Date.now(),
  };
  sessions.set(sessionId, session);
  return session;
}

// ── POST /tool — Execute a tool call from OpenClaw ────────────────────────────

router.post("/tool", requireAuth as any, requirePlan() as any, async (req: any, res: any) => {
  const { tool_name, arguments: args = {}, venue_id, session_id } = req.body ?? {};

  if (!tool_name) {
    res.status(400).json({ error: "tool_name is required" });
    return;
  }
  if (!venue_id) {
    res.status(400).json({ error: "venue_id is required" });
    return;
  }

  const sid = session_id || `openclaw-${req.user.id}-${venue_id}`;

  try {
    const sess = await getOrCreateSession(sid, req.user.id, Number(venue_id));
    if (!sess) {
      res.status(404).json({ error: "Venue not found or not authorized" });
      return;
    }

    const squareClient = sess.squareToken
      ? new SquareClient(sess.squareToken, sess.squareLocationId)
      : undefined;

    const { result, command } = await executeToolCall(tool_name, args, {
      catalog: sess.catalog,
      order: [],
      squareToken: sess.squareToken,
      squareLocationId: sess.squareLocationId,
      session: sess.liveSession,
      squareClient,
      requestId: sid,
    });

    res.json({
      result,
      ...(command ? { command } : {}),
    });
  } catch (e: any) {
    console.error("[OpenClaw] Tool error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /catalog — Get the catalog for a venue ────────────────────────────────

router.get("/catalog", requireAuth as any, requirePlan() as any, async (req: any, res: any) => {
  const venueId = Number(req.query.venue_id);
  if (!venueId) {
    res.status(400).json({ error: "venue_id is required" });
    return;
  }

  const creds = await getCachedCredentials(req.user.id, venueId);
  if (!creds) {
    res.status(404).json({ error: "Venue not found or not authorized" });
    return;
  }

  const catalog = await getCachedCatalog(creds.squareToken, creds.squareLocationId);
  res.json({ catalog });
});

// ── POST /session/end — End an OpenClaw session (cancel open orders) ──────────

router.post("/session/end", requireAuth as any, async (req: any, res: any) => {
  const { session_id } = req.body ?? {};
  if (!session_id) {
    res.status(400).json({ error: "session_id is required" });
    return;
  }

  const sess = sessions.get(session_id);
  if (sess) {
    if (sess.liveSession.squareOrderId) {
      await cancelLiveOrder(sess.liveSession, sess.squareToken, sess.squareLocationId);
    }
    sessions.delete(session_id);
  }

  res.json({ ok: true });
});

export default router;
