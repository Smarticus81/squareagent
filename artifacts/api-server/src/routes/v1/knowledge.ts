/**
 * REST surface for the general assistant's data sources.
 *  - Knowledge documents: upload text, list, delete (chunks + embeddings).
 *  - External Postgres connection for the query_database tool.
 *  - Outbound email credentials for the send_email tool.
 *
 * All routes are scoped to the authenticated user (req.user.id). Multi-tenant
 * org scoping can be layered on later.
 */

import { Router, type Request, type Response } from "express";
import { and, eq, desc } from "drizzle-orm";
import {
  db,
  knowledgeDocumentsTable,
  knowledgeChunksTable,
  externalDbConnectionsTable,
  emailCredentialsTable,
} from "@workspace/db";
import { requireAuth } from "../auth";
import { embedBatch, chunkText } from "../../lib/embeddings";

const router = Router();

router.use(requireAuth as any);

// ── Knowledge documents ───────────────────────────────────────────────────────

router.post("/documents", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as number;
  const { title, text, sourceType = "text", sourceUri } = req.body ?? {};
  if (!title || typeof title !== "string") {
    res.status(400).json({ error: "title is required" });
    return;
  }
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  if (text.length > 1_500_000) {
    res.status(413).json({ error: "Document too large (max 1.5MB of text)" });
    return;
  }

  try {
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      res.status(400).json({ error: "Document produced 0 chunks" });
      return;
    }

    let embeddings: number[][];
    try {
      embeddings = await embedBatch(chunks);
    } catch (e: any) {
      res.status(502).json({ error: "Embedding service failed", detail: e.message });
      return;
    }

    const [doc] = await db
      .insert(knowledgeDocumentsTable)
      .values({
        userId,
        title: title.trim().slice(0, 200),
        sourceType: String(sourceType).slice(0, 32),
        sourceUri: typeof sourceUri === "string" ? sourceUri.slice(0, 1000) : null,
        byteCount: Buffer.byteLength(text, "utf8"),
        chunkCount: chunks.length,
      })
      .returning();

    await db.insert(knowledgeChunksTable).values(
      chunks.map((c, i) => ({
        documentId: doc.id,
        userId,
        chunkIndex: i,
        text: c,
        embedding: embeddings[i],
      })),
    );

    res.status(201).json({
      id: doc.id,
      title: doc.title,
      chunkCount: doc.chunkCount,
      byteCount: doc.byteCount,
      createdAt: doc.createdAt,
    });
  } catch (e: any) {
    console.error("[Knowledge] upload error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/documents", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as number;
  const docs = await db
    .select({
      id: knowledgeDocumentsTable.id,
      title: knowledgeDocumentsTable.title,
      sourceType: knowledgeDocumentsTable.sourceType,
      sourceUri: knowledgeDocumentsTable.sourceUri,
      byteCount: knowledgeDocumentsTable.byteCount,
      chunkCount: knowledgeDocumentsTable.chunkCount,
      createdAt: knowledgeDocumentsTable.createdAt,
    })
    .from(knowledgeDocumentsTable)
    .where(eq(knowledgeDocumentsTable.userId, userId))
    .orderBy(desc(knowledgeDocumentsTable.createdAt));
  res.json({ documents: docs });
});

router.delete("/documents/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as number;
  const id = String(req.params.id);
  const result = await db
    .delete(knowledgeDocumentsTable)
    .where(and(eq(knowledgeDocumentsTable.id, id), eq(knowledgeDocumentsTable.userId, userId)))
    .returning({ id: knowledgeDocumentsTable.id });
  if (result.length === 0) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json({ ok: true });
});

// ── External database connections ────────────────────────────────────────────

router.get("/database-connections", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as number;
  const rows = await db
    .select({
      id: externalDbConnectionsTable.id,
      label: externalDbConnectionsTable.label,
      kind: externalDbConnectionsTable.kind,
      schemaHint: externalDbConnectionsTable.schemaHint,
      createdAt: externalDbConnectionsTable.createdAt,
    })
    .from(externalDbConnectionsTable)
    .where(eq(externalDbConnectionsTable.userId, userId));
  res.json({ connections: rows });
});

router.post("/database-connections", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as number;
  const { label = "default", connectionString, schemaHint } = req.body ?? {};
  if (!connectionString || typeof connectionString !== "string") {
    res.status(400).json({ error: "connectionString is required" });
    return;
  }
  if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
    res.status(400).json({ error: "Only postgres:// connection strings are supported." });
    return;
  }

  // Upsert by (userId, label)
  const existing = await db
    .select()
    .from(externalDbConnectionsTable)
    .where(and(eq(externalDbConnectionsTable.userId, userId), eq(externalDbConnectionsTable.label, label)));

  if (existing.length > 0) {
    await db
      .update(externalDbConnectionsTable)
      .set({ connectionString, schemaHint: schemaHint ?? null, updatedAt: new Date() })
      .where(eq(externalDbConnectionsTable.id, existing[0].id));
    res.json({ id: existing[0].id, label, updated: true });
    return;
  }

  const [row] = await db
    .insert(externalDbConnectionsTable)
    .values({ userId, label, connectionString, schemaHint: schemaHint ?? null })
    .returning();
  res.status(201).json({ id: row.id, label: row.label });
});

router.delete("/database-connections/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as number;
  const id = String(req.params.id);
  const result = await db
    .delete(externalDbConnectionsTable)
    .where(and(eq(externalDbConnectionsTable.id, id), eq(externalDbConnectionsTable.userId, userId)))
    .returning({ id: externalDbConnectionsTable.id });
  if (result.length === 0) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }
  res.json({ ok: true });
});

// ── Email credentials ────────────────────────────────────────────────────────

router.get("/email", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as number;
  const [row] = await db
    .select({
      id: emailCredentialsTable.id,
      provider: emailCredentialsTable.provider,
      fromAddress: emailCredentialsTable.fromAddress,
      fromName: emailCredentialsTable.fromName,
      createdAt: emailCredentialsTable.createdAt,
    })
    .from(emailCredentialsTable)
    .where(eq(emailCredentialsTable.userId, userId))
    .limit(1);
  res.json({ email: row ?? null });
});

router.put("/email", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as number;
  const { provider = "resend", apiKey, fromAddress, fromName } = req.body ?? {};
  if (!fromAddress || typeof fromAddress !== "string") {
    res.status(400).json({ error: "fromAddress is required" });
    return;
  }
  if (provider === "resend" && !apiKey) {
    res.status(400).json({ error: "apiKey is required for the Resend provider" });
    return;
  }

  const existing = await db
    .select()
    .from(emailCredentialsTable)
    .where(eq(emailCredentialsTable.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(emailCredentialsTable)
      .set({
        provider,
        apiKey: apiKey ?? existing[0].apiKey,
        fromAddress,
        fromName: fromName ?? null,
        updatedAt: new Date(),
      })
      .where(eq(emailCredentialsTable.id, existing[0].id));
    res.json({ id: existing[0].id, updated: true });
    return;
  }

  const [row] = await db
    .insert(emailCredentialsTable)
    .values({ userId, provider, apiKey, fromAddress, fromName: fromName ?? null })
    .returning();
  res.status(201).json({ id: row.id });
});

router.delete("/email", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as number;
  await db.delete(emailCredentialsTable).where(eq(emailCredentialsTable.userId, userId));
  res.json({ ok: true });
});

export default router;
