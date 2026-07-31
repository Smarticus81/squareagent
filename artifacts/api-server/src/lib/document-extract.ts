/**
 * Extract plain text from uploaded documents (PDF / DOCX / TXT / MD / HTML).
 * Used by POST /api/v1/knowledge/documents/upload.
 *
 * pdf-parse and mammoth are loaded dynamically so the server still boots if
 * an environment is missing them — the tool just refuses that file type.
 */

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function extractTextFromUpload(
  buffer: Buffer,
  filename: string,
  mimetype: string,
): Promise<string> {
  const lower = filename.toLowerCase();
  const isPdf = mimetype === "application/pdf" || lower.endsWith(".pdf");
  const isDocx =
    mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx");
  const isHtml = mimetype === "text/html" || lower.endsWith(".html") || lower.endsWith(".htm");
  const isText =
    mimetype.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".json");

  if (isPdf) {
    try {
      // pdf-parse has no shipped types
      const mod: any = await import("pdf-parse" as any);
      const fn = mod.default ?? mod;
      const out = await fn(buffer);
      return String(out?.text ?? "").trim();
    } catch (e: any) {
      throw new Error(`PDF parsing not available: ${e.message}`);
    }
  }

  if (isDocx) {
    try {
      const mammoth: any = await import("mammoth");
      const out = await mammoth.extractRawText({ buffer });
      return String(out?.value ?? "").trim();
    } catch (e: any) {
      throw new Error(`DOCX parsing not available: ${e.message}`);
    }
  }

  if (isHtml) {
    return htmlToText(buffer.toString("utf8"));
  }

  if (isText) {
    return buffer.toString("utf8").trim();
  }

  throw new Error(`Unsupported file type: ${mimetype || filename}`);
}
