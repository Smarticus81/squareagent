type ApiKeyProvider = "openai" | "gemini";

interface ApiKeySpec {
  canonicalEnv: string;
  aliases: string[];
}

const API_KEY_SPECS: Record<ApiKeyProvider, ApiKeySpec> = {
  openai: {
    canonicalEnv: "OPENAI_API_KEY",
    aliases: ["AI_INTEGRATIONS_OPENAI_API_KEY"],
  },
  gemini: {
    canonicalEnv: "GOOGLE_GEMINI_API_KEY",
    aliases: ["GOOGLE_API_KEY"],
  },
};

const PLACEHOLDER_KEY_PATTERN = /\b(?:change-?me|replace-?me|your[_-]?(?:openai|gemini|google)?[_-]?(?:api[_-]?)?key|example|placeholder|todo)\b/i;

export interface ServerApiKey {
  provider: ApiKeyProvider;
  value: string;
  sourceEnv: string;
  canonicalEnv: string;
}

export function isUsableApiKeyValue(value: string | undefined): value is string {
  const trimmed = value?.trim();
  return Boolean(trimmed && !PLACEHOLDER_KEY_PATTERN.test(trimmed));
}

export function readServerApiKey(provider: ApiKeyProvider): ServerApiKey | null {
  const spec = API_KEY_SPECS[provider];
  for (const envName of [spec.canonicalEnv, ...spec.aliases]) {
    const value = process.env[envName]?.trim();
    if (isUsableApiKeyValue(value)) {
      return { provider, value, sourceEnv: envName, canonicalEnv: spec.canonicalEnv };
    }
  }
  return null;
}

export function requireServerApiKey(provider: ApiKeyProvider): ServerApiKey {
  const key = readServerApiKey(provider);
  if (key) return key;
  throw new Error(`${API_KEY_SPECS[provider].canonicalEnv} missing`);
}

export function readServerApiKeyPresence(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const spec of Object.values(API_KEY_SPECS)) {
    const present = [spec.canonicalEnv, ...spec.aliases].some((envName) => {
      const value = isUsableApiKeyValue(process.env[envName]);
      out[envName] = Boolean(value);
      return Boolean(value);
    });
    out[spec.canonicalEnv] = present;
  }
  return out;
}

export interface ServerApiKeyReadiness {
  provider: ApiKeyProvider;
  configured: boolean;
  canonicalEnv: string;
  sourceEnv: string | null;
  usingAlias: boolean;
  aliases: string[];
}

export function readServerApiKeyReadiness(): Record<ApiKeyProvider, ServerApiKeyReadiness> {
  return Object.fromEntries(
    (Object.keys(API_KEY_SPECS) as ApiKeyProvider[]).map((provider) => {
      const spec = API_KEY_SPECS[provider];
      const key = readServerApiKey(provider);
      return [
        provider,
        {
          provider,
          configured: Boolean(key),
          canonicalEnv: spec.canonicalEnv,
          sourceEnv: key?.sourceEnv ?? null,
          usingAlias: Boolean(key && key.sourceEnv !== spec.canonicalEnv),
          aliases: spec.aliases,
        },
      ];
    }),
  ) as Record<ApiKeyProvider, ServerApiKeyReadiness>;
}

export function requiredApiKeyEnv(provider: ApiKeyProvider): string {
  return API_KEY_SPECS[provider].canonicalEnv;
}
