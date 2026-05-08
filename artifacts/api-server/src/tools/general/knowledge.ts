/**
 * Knowledge-base tools.
 *  - search_knowledge: semantic search over the user's uploaded documents
 *    (chunks + embeddings stored in Postgres, scored client-side via cosine).
 *  - list_knowledge:   show what documents are available.
 */

import { db, knowledgeDocumentsTable, knowledgeChunksTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "../types";
import { embed, cosineSimilarity } from "../../lib/embeddings";

export const definitions: ToolDefinition[] = [
  {
    type: "function",
    name: "search_knowledge",
    description:
      "Search the user's private knowledge base (uploaded notes, SOPs, FAQs, attachments). Returns the most relevant passages with citations. Use whenever the user asks about something specific to their business that the model would not know.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language question or keywords" },
        top_k: { type: "integer", description: "Max passages to return (default 4, max 8)", default: 4 },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "list_knowledge",
    description: "List all documents currently stored in the user's knowledge base.",
    parameters: { type: "object", properties: {} },
  },
];

async function searchKnowledge(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.userId) return { result: "search_knowledge: missing user context." };
  if (!db) return { result: "search_knowledge: database is not configured." };

  const query = String(args.query ?? "").trim();
  if (!query) return { result: "search_knowledge: query is required." };
  const topK = Math.min(Math.max(Number(args.top_k ?? 4), 1), 8);

  let queryVec: number[];
  try {
    queryVec = await embed(query);
  } catch (e: any) {
    return { result: `search_knowledge: embedding failed — ${e.message}` };
  }

  const rows = await db
    .select({
      id: knowledgeChunksTable.id,
      documentId: knowledgeChunksTable.documentId,
      text: knowledgeChunksTable.text,
      embedding: knowledgeChunksTable.embedding,
    })
    .from(knowledgeChunksTable)
    .where(eq(knowledgeChunksTable.userId, ctx.userId));

  if (rows.length === 0) {
    return { result: "Your knowledge base is empty. Upload documents in the dashboard first." };
  }

  const titles = await db
    .select({ id: knowledgeDocumentsTable.id, title: knowledgeDocumentsTable.title })
    .from(knowledgeDocumentsTable)
    .where(eq(knowledgeDocumentsTable.userId, ctx.userId));
  const titleById = new Map(titles.map((t: { id: string; title: string }) => [t.id, t.title] as const));

  const scored = rows
    .map((r: typeof rows[number]) => {
      const emb = Array.isArray(r.embedding) ? (r.embedding as number[]) : [];
      return { ...r, score: cosineSimilarity(queryVec, emb) };
    })
    .filter((r: { score: number }) => r.score > 0)
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
    .slice(0, topK);

  if (scored.length === 0) {
    return { result: "No relevant passages found in the knowledge base." };
  }

  const out = scored.map((s: { documentId: string; text: string; score: number }, i: number) => {
    const title = titleById.get(s.documentId) ?? "Untitled";
    const snippet = s.text.slice(0, 600);
    return `[${i + 1}] ${title} (score=${s.score.toFixed(2)})\n${snippet}`;
  });
  return { result: out.join("\n\n") };
}

async function listKnowledge(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.userId) return { result: "list_knowledge: missing user context." };
  if (!db) return { result: "list_knowledge: database is not configured." };
  const docs = await db
    .select()
    .from(knowledgeDocumentsTable)
    .where(eq(knowledgeDocumentsTable.userId, ctx.userId))
    .orderBy(desc(knowledgeDocumentsTable.createdAt));
  if (docs.length === 0) return { result: "No documents in the knowledge base yet." };
  return {
    result: docs
      .map((d: typeof docs[number]) => `- ${d.title} (${d.chunkCount} chunks, ${d.byteCount} bytes, ${d.createdAt.toISOString()})`)
      .join("\n"),
  };
}

export const executors: Record<string, ToolExecutor> = {
  search_knowledge: searchKnowledge,
  list_knowledge: listKnowledge,
};
