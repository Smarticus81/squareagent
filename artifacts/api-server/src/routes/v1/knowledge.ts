/**
 * REST surface for the general assistant's data sources.
 *  - Knowledge documents: upload text, list, delete (chunks + embeddings).
 *  - External Postgres connection for the query_database tool.
 *  - Outbound email credentials for the send_email tool.
 *
 * Routes are scoped to the authenticated user's active organization. Legacy
 * rows without organization_id remain visible to their original owner.
 */

import { Router, type Request, type Response } from "express";
import { and, eq, desc, isNull, or } from "drizzle-orm";
import {
  db,
  knowledgeDocumentsTable,
  knowledgeChunksTable,
  externalDbConnectionsTable,
  emailCredentialsTable,
} from "@workspace/db";
import { requireAuth } from "../auth";
import { ensureUserOrganization, requireMinRole } from "./_helpers";
import { embedBatch, chunkText } from "../../lib/embeddings";
import { encrypt } from "../../lib/secrets";
import { extractTextFromUpload } from "../../lib/document-extract";
import multer from "multer";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import pg from "pg";

const { Client } = pg;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/** Per-user write limiter: protects upload + DB-config + email-config write paths. */
const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    const uid = (req as any).user?.id;
    return uid ? `u:${uid}` : ipKeyGenerator(req.ip ?? "");
  },
  message: { error: "Too many requests. Slow down and try again in a minute." },
});

/** Tighter limiter for the embedding-heavy upload paths. */
const uploadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    const uid = (req as any).user?.id;
    return uid ? `u:${uid}` : ipKeyGenerator(req.ip ?? "");
  },
  message: { error: "Upload limit reached (10/min). Please wait before uploading more." },
});

const router = Router();

router.use(requireAuth as any);

async function currentOrganizationId(req: Request): Promise<string | null> {
  const existing = (req as Request & { organization?: { id: string } | null }).organization?.id;
  if (existing) return existing;
  const user = (req as any).user;
  if (!user) return null;
  return (await ensureUserOrganization(user)).id;
}

function tenantWhere(table: { userId: any; organizationId: any }, userId: number, organizationId: string | null) {
  return organizationId
    ? or(
        eq(table.organizationId, organizationId),
        and(eq(table.userId, userId), isNull(table.organizationId)),
      )
    : eq(table.userId, userId);
}

function safeIntegrationError(error: unknown, fallback = "The connection check failed. Verify the settings and try again."): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!raw) return fallback;
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[database-url]")
    .replace(/(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(?:re|sk|sq0[a-z]?)[A-Za-z0-9_-]{16,}\b/g, "[redacted]")
    .replace(/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, "[redacted]")
    .slice(0, 240);
}

async function validatePostgresConnection(connectionString: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    query_timeout: 5_000,
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT 1 AS voycelab_connection_check");
    await client.query("ROLLBACK");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: safeIntegrationError(e, "Could not connect to database"),
    };
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
}

// ── Knowledge documents ───────────────────────────────────────────────────────

router.post("/documents", requireMinRole("manager"), uploadLimiter, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as number;
  const organizationId = await currentOrganizationId(req);
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
      res.status(502).json({ error: "Embedding service failed", detail: safeIntegrationError(e, "Embedding service failed") });
      return;
    }

    const [doc] = await db
      .insert(knowledgeDocumentsTable)
      .values({
        userId,
        organizationId,
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
        organizationId,
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
    console.error("[Knowledge] upload error:", safeIntegrationError(e, "upload failed"));
    res.status(500).json({ error: safeIntegrationError(e, "Upload failed") });
  }
});

router.get("/documents", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as number;
  const organizationId = await currentOrganizationId(req);
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
    .where(tenantWhere(knowledgeDocumentsTable, userId, organizationId))
    .orderBy(desc(knowledgeDocumentsTable.createdAt));
  res.json({ documents: docs });
});

router.delete("/documents/:id", requireMinRole("manager"), async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as number;
  const organizationId = await currentOrganizationId(req);
  const id = String(req.params.id);
  const result = await db
    .delete(knowledgeDocumentsTable)
    .where(and(eq(knowledgeDocumentsTable.id, id), tenantWhere(knowledgeDocumentsTable, userId, organizationId)))
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
  const organizationId = await currentOrganizationId(req);
  const rows = await db
    .select({
      id: externalDbConnectionsTable.id,
      label: externalDbConnectionsTable.label,
      kind: externalDbConnectionsTable.kind,
      schemaHint: externalDbConnectionsTable.schemaHint,
      createdAt: externalDbConnectionsTable.createdAt,
    })
    .from(externalDbConnectionsTable)
    .where(tenantWhere(externalDbConnectionsTable, userId, organizationId));
  res.json({ connections: rows });
});

router.post("/database-connections", requireMinRole("manager"), writeLimiter, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as number;
  const organizationId = await currentOrganizationId(req);
  const { label = "default", connectionString, schemaHint } = req.body ?? {};
  if (!connectionString || typeof connectionString !== "string") {
    res.status(400).json({ error: "connectionString is required" });
    return;
  }
  if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
    res.status(400).json({ error: "Only postgres:// connection strings are supported." });
    return;
  }
  const validation = await validatePostgresConnection(connectionString);
  if (!validation.ok) {
    res.status(400).json({
      error: "Could not connect to this database with a read-only test query.",
      detail: validation.error,
    });
    return;
  }

  // Upsert by (userId, label)
  const existing = await db
    .select()
    .from(externalDbConnectionsTable)
    .where(and(tenantWhere(externalDbConnectionsTable, userId, organizationId), eq(externalDbConnectionsTable.label, label)));

  if (existing.length > 0) {
    await db
      .update(externalDbConnectionsTable)
      .set({ organizationId: existing[0].organizationId ?? organizationId, connectionString: encrypt(connectionString), schemaHint: schemaHint ?? null, updatedAt: new Date() })
      .where(eq(externalDbConnectionsTable.id, existing[0].id));
    res.json({ id: existing[0].id, label, updated: true, validated: true });
    return;
  }

  const [row] = await db
    .insert(externalDbConnectionsTable)
    .values({ userId, organizationId, label, connectionString: encrypt(connectionString), schemaHint: schemaHint ?? null })
    .returning();
  res.status(201).json({ id: row.id, label: row.label, validated: true });
});

router.delete("/database-connections/:id", requireMinRole("manager"), async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as number;
  const organizationId = await currentOrganizationId(req);
  const id = String(req.params.id);
  const result = await db
    .delete(externalDbConnectionsTable)
    .where(and(eq(externalDbConnectionsTable.id, id), tenantWhere(externalDbConnectionsTable, userId, organizationId)))
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
  const organizationId = await currentOrganizationId(req);
  const [row] = await db
    .select({
      id: emailCredentialsTable.id,
      provider: emailCredentialsTable.provider,
      fromAddress: emailCredentialsTable.fromAddress,
      fromName: emailCredentialsTable.fromName,
      createdAt: emailCredentialsTable.createdAt,
    })
    .from(emailCredentialsTable)
    .where(tenantWhere(emailCredentialsTable, userId, organizationId))
    .limit(1);
  res.json({ email: row ?? null });
});

router.put("/email", requireMinRole("manager"), writeLimiter, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as number;
  const organizationId = await currentOrganizationId(req);
  const {
    provider = "resend",
    apiKey,
    fromAddress,
    fromName,
    appPassword,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
  } = req.body ?? {};
  if (!fromAddress || typeof fromAddress !== "string") {
    res.status(400).json({ error: "fromAddress is required" });
    return;
  }
  if (provider === "resend" && !apiKey) {
    res.status(400).json({ error: "apiKey is required for the Resend provider" });
    return;
  }
  if (provider === "gmail") {
    // Initial setup must include the app password; updates may omit it to keep current.
    // The handler below will preserve the existing password when appPassword is blank.
  } else if (provider === "smtp") {
    if (!smtpHost || !smtpUser) {
      res.status(400).json({ error: "smtpHost and smtpUser are required for the SMTP provider" });
      return;
    }
  }

  const existing = await db
    .select()
    .from(emailCredentialsTable)
    .where(tenantWhere(emailCredentialsTable, userId, organizationId))
    .limit(1);

  // Resolve which encrypted password column to write. For gmail/smtp we reuse smtpPass.
  const incomingSmtpPass: string | undefined =
    provider === "gmail" ? (appPassword ? String(appPassword).replace(/\s+/g, "") : undefined)
    : provider === "smtp" ? (smtpPass ? String(smtpPass) : undefined)
    : undefined;

  if (existing.length > 0) {
    if (provider === "gmail" && !existing[0].smtpPass && !incomingSmtpPass) {
      res.status(400).json({ error: "appPassword is required when first connecting Gmail" });
      return;
    }
    await db
      .update(emailCredentialsTable)
      .set({
        provider,
        organizationId: existing[0].organizationId ?? organizationId,
        apiKey: provider === "resend" ? (apiKey ? encrypt(apiKey) : existing[0].apiKey) : null,
        fromAddress,
        fromName: fromName ?? null,
        smtpHost: provider === "gmail" ? "smtp.gmail.com" : (provider === "smtp" ? (smtpHost ?? null) : null),
        smtpPort: provider === "gmail" ? 465 : (provider === "smtp" ? (typeof smtpPort === "number" ? smtpPort : 587) : null),
        smtpUser: provider === "gmail" ? (smtpUser ?? fromAddress) : (provider === "smtp" ? (smtpUser ?? null) : null),
        smtpPass: incomingSmtpPass ? encrypt(incomingSmtpPass) : (provider === existing[0].provider ? existing[0].smtpPass : null),
        updatedAt: new Date(),
      })
      .where(eq(emailCredentialsTable.id, existing[0].id));
    res.json({ id: existing[0].id, updated: true });
    return;
  }

  if (provider === "gmail" && !incomingSmtpPass) {
    res.status(400).json({ error: "appPassword is required for the Gmail provider" });
    return;
  }
  if (provider === "smtp" && !incomingSmtpPass) {
    res.status(400).json({ error: "smtpPass is required for the SMTP provider" });
    return;
  }

  const [row] = await db
    .insert(emailCredentialsTable)
    .values({
      userId,
      organizationId,
      provider,
      apiKey: provider === "resend" && apiKey ? encrypt(apiKey) : null,
      fromAddress,
      fromName: fromName ?? null,
      smtpHost: provider === "gmail" ? "smtp.gmail.com" : (provider === "smtp" ? (smtpHost ?? null) : null),
      smtpPort: provider === "gmail" ? 465 : (provider === "smtp" ? (typeof smtpPort === "number" ? smtpPort : 587) : null),
      smtpUser: provider === "gmail" ? (smtpUser ?? fromAddress) : (provider === "smtp" ? (smtpUser ?? null) : null),
      smtpPass: incomingSmtpPass ? encrypt(incomingSmtpPass) : null,
    })
    .returning();
  res.status(201).json({ id: row.id });
});

// ── File upload (PDF / DOCX / TXT) ───────────────────────────────────────────

router.post(
  "/documents/upload",
  requireMinRole("manager"),
  uploadLimiter,
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user.id as number;
    const organizationId = await currentOrganizationId(req);
    const file = (req as any).file as { originalname: string; mimetype: string; buffer: Buffer } | undefined;
    if (!file) {
      res.status(400).json({ error: "file is required (multipart field 'file')" });
      return;
    }
    const title = String(req.body?.title || file.originalname || "Untitled").slice(0, 200);
    try {
      const text = await extractTextFromUpload(file.buffer, file.originalname, file.mimetype);
      if (!text || text.trim().length === 0) {
        res.status(400).json({ error: "Could not extract any text from the uploaded file." });
        return;
      }
      const chunks = chunkText(text);
      if (chunks.length === 0) {
        res.status(400).json({ error: "Document produced 0 chunks" });
        return;
      }
      const embeddings = await embedBatch(chunks);

      const [doc] = await db
        .insert(knowledgeDocumentsTable)
        .values({
          userId,
          organizationId,
          title,
          sourceType: file.mimetype || "upload",
          sourceUri: file.originalname,
          byteCount: file.buffer.length,
          chunkCount: chunks.length,
        })
        .returning();

      await db.insert(knowledgeChunksTable).values(
        chunks.map((c, i) => ({
          documentId: doc.id,
          userId,
          organizationId,
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
      console.error("[Knowledge] upload error:", safeIntegrationError(e, "upload failed"));
      res.status(500).json({ error: safeIntegrationError(e, "Upload failed") });
    }
  },
);

router.delete("/email", requireMinRole("manager"), async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as number;
  const organizationId = await currentOrganizationId(req);
  await db.delete(emailCredentialsTable).where(tenantWhere(emailCredentialsTable, userId, organizationId));
  res.json({ ok: true });
});

export default router;
