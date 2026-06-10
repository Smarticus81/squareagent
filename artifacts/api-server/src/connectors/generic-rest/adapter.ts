import {
  type ConnectedServiceAdapter,
  type ServiceConnection,
  type ServiceContext,
  type CatalogItem as NormalizedCatalogItem,
  type CreateOrderInput,
  type CreateOrderResult,
  type ServiceLocation,
  type ConnectionHealth,
  ConnectedServiceError,
} from "@workspace/voicelab-core/connected-service";
import { lookup } from "dns/promises";
import { isIP } from "net";

/**
 * Generic REST adapter — drives a configured external HTTP service. The
 * connection.config blob describes:
 *   - baseUrl: required
 *   - auth: { type: "bearer" | "header"; name?: string; valueFromCredentials: string }
 *   - actions: map of capability → { method, path, requestTemplate?, responseMap? }
 *
 * Only the actions explicitly configured are callable; missing actions throw
 * CapabilityNotSupportedError-style errors via the registry.
 */

interface GenericRestConfig {
  baseUrl: string;
  auth?: {
    type: "bearer" | "header";
    name?: string;
    valueFromCredentials: string;
  };
  actions: Partial<{
    listLocations: GenericRestAction;
    getCatalog: GenericRestAction;
    searchCatalog: GenericRestAction;
    createOrder: GenericRestAction;
    healthCheck: GenericRestAction;
  }>;
}

interface GenericRestAction {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  /** Mustache-style placeholder substitutions ({{query}}, {{locationId}}, etc.). */
  requestTemplate?: string;
  responseMap?: {
    /** Path within the JSON response that contains the array of items. */
    itemsPath?: string;
    /** Field aliases — e.g. { id: "uuid", name: "title" }. */
    fields?: Record<string, string>;
  };
}

const ALLOW_PRIVATE_REST_TARGETS =
  process.env.VOYCELAB_ALLOW_PRIVATE_REST_CONNECTOR === "true" ||
  process.env.NODE_ENV === "development" ||
  process.env.NODE_ENV === "test";

function isPrivateIp(ip: string): boolean {
  if (ip === "::1") return true;
  const normalized = ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
  const version = isIP(normalized);
  if (version === 4) {
    const parts = normalized.split(".").map((part) => Number(part));
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = normalized.toLowerCase();
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80:")
    );
  }
  return false;
}

async function assertPublicHttpTarget(url: URL): Promise<void> {
  if (url.protocol !== "https:" && !(ALLOW_PRIVATE_REST_TARGETS && url.protocol === "http:")) {
    throw new ConnectedServiceError(
      "generic_rest",
      "Generic REST targets must use https://. Local http:// targets are allowed only in development or when explicitly enabled.",
    );
  }

  if (ALLOW_PRIVATE_REST_TARGETS) return;

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new ConnectedServiceError("generic_rest", "Generic REST targets cannot point to localhost.");
  }

  const directIpVersion = isIP(hostname);
  if (directIpVersion && isPrivateIp(hostname)) {
    throw new ConnectedServiceError("generic_rest", "Generic REST targets cannot point to private network addresses.");
  }

  const addresses = await lookup(hostname, { all: true, verbatim: false });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new ConnectedServiceError("generic_rest", "Generic REST target DNS resolves to a private network address.");
  }
}

async function buildActionUrl(cfg: GenericRestConfig, action: GenericRestAction, vars: Record<string, string> = {}): Promise<string> {
  const baseUrl = new URL(cfg.baseUrl);
  if (!action.path.startsWith("/")) {
    throw new ConnectedServiceError("generic_rest", "Generic REST action paths must start with '/'.");
  }
  const path = substitute(action.path, vars);
  const url = new URL(path, baseUrl);
  if (url.origin !== baseUrl.origin) {
    throw new ConnectedServiceError("generic_rest", "Generic REST action paths cannot change host.");
  }
  await assertPublicHttpTarget(url);
  return url.toString();
}

function readConfig(connection: ServiceConnection): GenericRestConfig {
  const raw = connection.config as unknown as GenericRestConfig | undefined;
  if (!raw || typeof raw.baseUrl !== "string" || !raw.actions) {
    throw new ConnectedServiceError(
      "generic_rest",
      "Generic REST adapter requires baseUrl and actions in connection.config.",
    );
  }
  try {
    const url = new URL(raw.baseUrl);
    if (!url.hostname) throw new Error("missing hostname");
  } catch {
    throw new ConnectedServiceError(
      "generic_rest",
      "Generic REST adapter requires a valid absolute baseUrl in connection.config.",
    );
  }
  return raw;
}

function buildHeaders(connection: ServiceConnection): Record<string, string> {
  const cfg = readConfig(connection);
  const creds = connection.credentials as Record<string, unknown>;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.auth) {
    const value = creds[cfg.auth.valueFromCredentials];
    if (typeof value === "string") {
      if (cfg.auth.type === "bearer") {
        headers["Authorization"] = `Bearer ${value}`;
      } else if (cfg.auth.type === "header" && cfg.auth.name) {
        headers[cfg.auth.name] = value;
      }
    }
  }
  return headers;
}

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function getByPath(obj: unknown, path?: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function mapItem(raw: Record<string, unknown>, fields?: Record<string, string>): Record<string, unknown> {
  if (!fields) return raw;
  const out: Record<string, unknown> = {};
  for (const [target, source] of Object.entries(fields)) {
    out[target] = raw[source];
  }
  return out;
}

export class GenericRestAdapter implements ConnectedServiceAdapter {
  readonly provider = "generic_rest" as const;
  readonly capabilities: ConnectedServiceAdapter["capabilities"] = [
    "catalog:read",
    "orders:create",
    "locations:read",
  ];

  async validateConnection(connection: ServiceConnection): Promise<ConnectionHealth> {
    const cfg = readConfig(connection);
    const action = cfg.actions.healthCheck;
    if (!action) {
      return {
        ok: true,
        status: "healthy",
        message: "No healthCheck action configured; assumed healthy.",
        checkedAt: new Date().toISOString(),
      };
    }
    try {
      const res = await fetch(await buildActionUrl(cfg, action), {
        method: action.method,
        headers: buildHeaders(connection),
      });
      const checkedAt = new Date().toISOString();
      if (!res.ok) return { ok: false, status: "down", message: `HTTP ${res.status}`, checkedAt };
      return { ok: true, status: "healthy", checkedAt };
    } catch (e) {
      return {
        ok: false,
        status: "down",
        message: e instanceof Error ? e.message : "unknown",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async listLocations(connection: ServiceConnection): Promise<ServiceLocation[]> {
    const cfg = readConfig(connection);
    const action = cfg.actions.listLocations;
    if (!action) return [];
    const res = await fetch(await buildActionUrl(cfg, action), {
      method: action.method,
      headers: buildHeaders(connection),
    });
    if (!res.ok) {
      throw new ConnectedServiceError("generic_rest", `listLocations failed: HTTP ${res.status}`, {
        capability: "locations:read",
      });
    }
    const json = (await res.json()) as unknown;
    const items = (getByPath(json, action.responseMap?.itemsPath) as Record<string, unknown>[]) ?? [];
    return items.map((raw) => {
      const m = mapItem(raw, action.responseMap?.fields) as { id?: string; name?: string };
      return { id: String(m.id ?? ""), name: String(m.name ?? "Unnamed") };
    });
  }

  async getCatalog(ctx: ServiceContext): Promise<NormalizedCatalogItem[]> {
    const cfg = readConfig(ctx.connection);
    const action = cfg.actions.getCatalog;
    if (!action) return [];
    const res = await fetch(await buildActionUrl(cfg, action), {
      method: action.method,
      headers: buildHeaders(ctx.connection),
    });
    if (!res.ok) {
      throw new ConnectedServiceError("generic_rest", `getCatalog failed: HTTP ${res.status}`, {
        capability: "catalog:read",
      });
    }
    const json = (await res.json()) as unknown;
    const items = (getByPath(json, action.responseMap?.itemsPath) as Record<string, unknown>[]) ?? [];
    return items.map((raw) => {
      const m = mapItem(raw, action.responseMap?.fields) as {
        id?: string;
        name?: string;
        priceCents?: number;
        category?: string;
      };
      return {
        id: String(m.id ?? ""),
        name: String(m.name ?? "Unnamed"),
        priceCents: typeof m.priceCents === "number" ? m.priceCents : undefined,
        category: m.category,
      };
    });
  }

  async searchCatalog(ctx: ServiceContext, query: string): Promise<NormalizedCatalogItem[]> {
    const cfg = readConfig(ctx.connection);
    const action = cfg.actions.searchCatalog;
    if (!action) {
      const all = await this.getCatalog(ctx);
      const q = query.toLowerCase();
      return all.filter((i) => i.name.toLowerCase().includes(q));
    }
    const res = await fetch(await buildActionUrl(cfg, action, { query: encodeURIComponent(query) }), {
      method: action.method,
      headers: buildHeaders(ctx.connection),
      body: action.requestTemplate
        ? substitute(action.requestTemplate, { query })
        : undefined,
    });
    if (!res.ok) {
      throw new ConnectedServiceError("generic_rest", `searchCatalog failed: HTTP ${res.status}`, {
        capability: "catalog:read",
      });
    }
    const json = (await res.json()) as unknown;
    const items = (getByPath(json, action.responseMap?.itemsPath) as Record<string, unknown>[]) ?? [];
    return items.map((raw) => {
      const m = mapItem(raw, action.responseMap?.fields) as { id?: string; name?: string; priceCents?: number };
      return {
        id: String(m.id ?? ""),
        name: String(m.name ?? "Unnamed"),
        priceCents: typeof m.priceCents === "number" ? m.priceCents : undefined,
      };
    });
  }

  async createOrder(ctx: ServiceContext, input: CreateOrderInput): Promise<CreateOrderResult> {
    const cfg = readConfig(ctx.connection);
    const action = cfg.actions.createOrder;
    if (!action) {
      throw new ConnectedServiceError("generic_rest", "createOrder action not configured", {
        capability: "orders:create",
      });
    }
    const body = action.requestTemplate
      ? substitute(action.requestTemplate, {
          locationId: input.locationId,
          lineItemsJson: JSON.stringify(input.lineItems),
        })
      : JSON.stringify({ locationId: input.locationId, lineItems: input.lineItems });
    const res = await fetch(await buildActionUrl(cfg, action), {
      method: action.method,
      headers: buildHeaders(ctx.connection),
      body,
    });
    if (!res.ok) {
      throw new ConnectedServiceError("generic_rest", `createOrder failed: HTTP ${res.status}`, {
        capability: "orders:create",
      });
    }
    const json = (await res.json()) as { id?: string; orderId?: string };
    const orderId = json.orderId ?? json.id ?? `generic-${Date.now()}`;
    return { orderId, state: "open" };
  }
}
