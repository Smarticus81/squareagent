/**
 * Knowledge-base tools.
 *  - search_knowledge: semantic search over the user's uploaded documents
 *    (chunks + embeddings stored in Postgres, scored client-side via cosine).
 *  - list_knowledge:   show what documents are available.
 */

import { db, pool, knowledgeDocumentsTable, knowledgeChunksTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "../types";
import { embed } from "../../lib/embeddings";

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

  const vecStr = `[${queryVec.join(",")}]`;

  const { rows } = await pool.query(
    `SELECT c.id, c.document_id, c.text, d.title,
            c.embedding <=> $1::vector AS distance
     FROM knowledge_chunks c
     JOIN knowledge_documents d ON d.id = c.document_id
     WHERE c.user_id = $2
     ORDER BY distance
     LIMIT $3`,
    [vecStr, ctx.userId, topK],
  );

  if (rows.length === 0) {
    return { result: "Your knowledge base is empty. Upload documents in the dashboard first." };
  }

  const out = rows.map((r: { title: string; text: string; distance: number }, i: number) => {
    const score = 1 - r.distance;
    if (score <= 0) return null;
    const snippet = r.text.slice(0, 600);
    return `[${i + 1}] ${r.title} (score=${score.toFixed(2)})\n${snippet}`;
  }).filter(Boolean);

  if (out.length === 0) {
    return { result: "No relevant passages found in the knowledge base." };
  }

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
