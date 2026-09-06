const RESPONSES_URL = "https://api.openai.com/v1/responses";

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is required for the autonomous control plane");
  return key;
}

function defaultModel(): string {
  return process.env.AUTONOMY_MODEL?.trim() || "gpt-5.6-terra";
}

function fastModel(): string {
  return process.env.AUTONOMY_FAST_MODEL?.trim() || "gpt-5.6-luna";
}

/** Remove obvious credential-shaped strings before telemetry is sent to a model. */
export function scrubModelContext(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
      .replace(/\b(?:sk|sk-proj|ya29|ghp|github_pat)_[A-Za-z0-9._-]{12,}\b/gi, "[redacted]")
      .replace(/\b[A-Fa-f0-9]{64}\b/g, "[redacted]");
  }
  if (Array.isArray(value)) return value.map(scrubModelContext);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/token|secret|password|credential|api.?key/i.test(key)) out[key] = "[redacted]";
      else out[key] = scrubModelContext(item);
    }
    return out;
  }
  return value;
}

function outputText(response: any): string {
  if (typeof response?.output_text === "string" && response.output_text) return response.output_text;
  const chunks: string[] = [];
  for (const item of response?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const content of item?.content ?? []) {
      if ((content?.type === "output_text" || content?.type === "text") && typeof content?.text === "string") {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n");
}

export interface StructuredModelOptions {
  schemaName: string;
  schema: Record<string, unknown>;
  model?: string;
  useWebSearch?: boolean;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  maxOutputTokens?: number;
}

function modelFor(options: StructuredModelOptions): string {
  if (options.model?.trim()) return options.model.trim();
  const effort = options.reasoningEffort ?? "low";
  return effort === "none" || effort === "minimal" || effort === "low" ? fastModel() : defaultModel();
}

export async function structuredModel<T>(
  instructions: string,
  input: unknown,
  options: StructuredModelOptions,
): Promise<T> {
  const body: Record<string, unknown> = {
    model: modelFor(options),
    instructions,
    input: JSON.stringify(scrubModelContext(input)),
    store: false,
    reasoning: { effort: options.reasoningEffort ?? "low" },
    text: {
      format: {
        type: "json_schema",
        name: options.schemaName,
        schema: options.schema,
        strict: true,
      },
    },
  };
  if (options.maxOutputTokens) body.max_output_tokens = options.maxOutputTokens;
  if (options.useWebSearch) body.tools = [{ type: "web_search" }];

  const res = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 600);
    throw new Error(`Autonomy model request failed (${res.status}): ${detail}`);
  }
  const data = await res.json();
  const text = outputText(data);
  if (!text) throw new Error("Autonomy model returned no structured output");
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Autonomy model returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
