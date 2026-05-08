/**
 * OpenAI embedding helper used by the knowledge base tool + ingestion route.
 * Default model: text-embedding-3-small (1536 dims, cheap, plenty of quality).
 */

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
const OPENAI_BASE = process.env.OPENAI_API_BASE ?? "https://api.openai.com/v1";

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "";
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  return key;
}

export async function embed(text: string): Promise<number[]> {
  const [vec] = await embedBatch([text]);
  return vec;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch(`${OPENAI_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Embedding request failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return data.data.map((d) => d.embedding);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Split a long string into ~chunkSize-character chunks, breaking on paragraph
 * or sentence boundaries when possible. Cheap and fully sync; good enough for
 * the kinds of docs (notes, SOPs, FAQs) the assistant will index.
 */
export function chunkText(input: string, chunkSize = 1200, overlap = 150): string[] {
  const text = input.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + chunkSize, text.length);
    if (end < text.length) {
      // Prefer to break on a paragraph or sentence boundary.
      const slice = text.slice(i, end);
      const lastPara = slice.lastIndexOf("\n\n");
      const lastSentence = slice.lastIndexOf(". ");
      const breakAt = lastPara > chunkSize * 0.5 ? lastPara
        : lastSentence > chunkSize * 0.5 ? lastSentence + 1
        : -1;
      if (breakAt > 0) end = i + breakAt;
    }
    chunks.push(text.slice(i, end).trim());
    if (end >= text.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return chunks.filter((c) => c.length > 0);
}
