/**
 * Web tools for the general assistant.
 *  - web_search: live web search via Tavily (https://tavily.com).
 *  - fetch_url:  fetch a URL and return readable text.
 *
 * Tavily is used because it returns clean, model-ready snippets in a single
 * REST call — no scraping, no OAuth. If TAVILY_API_KEY is missing we fall back
 * to DuckDuckGo's HTML endpoint (best-effort, may rate-limit).
 */

import type { ToolDefinition, ToolExecutor, ToolResult } from "../types";

export const definitions: ToolDefinition[] = [
  {
    type: "function",
    name: "web_search",
    description:
      "Search the live web for up-to-date information. Use for news, current facts, prices, or anything the assistant might not know. Returns a list of result snippets with URLs.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query" },
        max_results: { type: "integer", description: "Max results to return (default 5, max 10)", default: 5 },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "fetch_url",
    description:
      "Fetch a single web page and return its readable text content (HTML stripped). Use after web_search to read a specific result, or when the user provides a URL.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL to fetch" },
      },
      required: ["url"],
    },
  },
];

const TAVILY_KEY = () => process.env.TAVILY_API_KEY ?? "";

async function webSearch(args: Record<string, unknown>): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) return { result: "web_search: query is required." };
  const max = Math.min(Math.max(Number(args.max_results ?? 5), 1), 10);

  if (TAVILY_KEY()) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: TAVILY_KEY(),
          query,
          max_results: max,
          include_answer: true,
          search_depth: "basic",
        }),
      });
      if (!res.ok) {
        return { result: `web_search failed (Tavily ${res.status}): ${(await res.text()).slice(0, 200)}` };
      }
      const data = (await res.json()) as {
        answer?: string;
        results?: Array<{ title: string; url: string; content: string }>;
      };
      const lines: string[] = [];
      if (data.answer) lines.push(`Summary: ${data.answer}`);
      for (const r of data.results ?? []) {
        lines.push(`- ${r.title} — ${r.url}\n  ${r.content?.slice(0, 280) ?? ""}`);
      }
      return { result: lines.join("\n") || "No results." };
    } catch (e: any) {
      return { result: `web_search error: ${e.message}` };
    }
  }

  // Fallback: DuckDuckGo HTML (rough but free; just for dev without TAVILY_API_KEY).
  try {
    const res = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 VoyceLab" },
    });
    const html = await res.text();
    const matches = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].slice(0, max);
    if (matches.length === 0) {
      return { result: "web_search: no results (and TAVILY_API_KEY not configured for higher quality search)." };
    }
    const lines = matches.map((m, i) => `${i + 1}. ${decodeEntities(m[2])} — ${m[1]}`);
    return {
      result:
        "(Set TAVILY_API_KEY for richer results.)\n" + lines.join("\n"),
    };
  } catch (e: any) {
    return { result: `web_search error: ${e.message}` };
  }
}

async function fetchUrlExec(args: Record<string, unknown>): Promise<ToolResult> {
  const url = String(args.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return { result: "fetch_url: a valid http(s) URL is required." };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 VoyceLab" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { result: `fetch_url: HTTP ${res.status} from ${url}` };
    }
    const ct = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    const text = ct.includes("html") ? htmlToText(raw) : raw;
    const trimmed = text.trim().slice(0, 8000);
    return { result: `Fetched ${url} (${ct || "unknown"}):\n\n${trimmed}` };
  } catch (e: any) {
    return { result: `fetch_url error: ${e.message}` };
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export const executors: Record<string, ToolExecutor> = {
  web_search: (args) => webSearch(args),
  fetch_url: (args) => fetchUrlExec(args),
};
