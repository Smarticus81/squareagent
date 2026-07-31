import type {
  ConnectedServiceProvider,
  ConnectedServiceProviderMetadata,
} from "./types";

/**
 * Provider catalog. UI uses this to render an honest list of integrations
 * and their availability state. Adapters that are runtime-implemented set
 * status to "available"; others must say "request_access" or
 * "needs_configuration".
 */
export const CONNECTED_SERVICE_PROVIDERS: Record<
  ConnectedServiceProvider,
  ConnectedServiceProviderMetadata
> = {
  square: {
    provider: "square",
    displayName: "Square",
    description: "Square POS, terminal, catalog, inventory, orders, reports.",
    status: "available",
    capabilities: [
      "locations:read",
      "catalog:read",
      "orders:create",
      "orders:update",
      "orders:submit",
      "terminal:checkout",
      "inventory:read",
      "inventory:adjust",
      "reports:read",
      "customers:read",
      "payments:refund",
      "team:read",
    ],
  },
  toast: {
    provider: "toast",
    displayName: "Toast",
    description: "Restaurant POS used widely in full-service hospitality.",
    status: "request_access",
    capabilities: [],
    notes: "Adapter not yet implemented. Contact us if you need Toast integration.",
  },
  clover: {
    provider: "clover",
    displayName: "Clover",
    description: "Clover POS terminals and small-business hospitality.",
    status: "request_access",
    capabilities: [],
    notes: "Adapter not yet implemented. Contact us if you need Clover integration.",
  },
  lightspeed: {
    provider: "lightspeed",
    displayName: "Lightspeed",
    description: "Lightspeed Restaurant / Retail POS.",
    status: "request_access",
    capabilities: [],
    notes: "Adapter not yet implemented. Contact us if you need Lightspeed integration.",
  },
  shopify_pos: {
    provider: "shopify_pos",
    displayName: "Shopify POS",
    description: "Shopify retail POS with inventory and orders.",
    status: "request_access",
    capabilities: [],
    notes: "Adapter not yet implemented. Contact us if you need Shopify POS integration.",
  },
  gopayments_poynt: {
    provider: "gopayments_poynt",
    displayName: "GoDaddy / Poynt",
    description: "GoDaddy GoPayments / Poynt smart terminals.",
    status: "request_access",
    capabilities: [],
    notes: "Adapter not yet implemented. Contact us if you need GoPayments/Poynt integration.",
  },
  revel: {
    provider: "revel",
    displayName: "Revel",
    description: "Revel Systems iPad-based POS.",
    status: "request_access",
    capabilities: [],
    notes: "Adapter not yet implemented. Contact us if you need Revel integration.",
  },
  generic_rest: {
    provider: "generic_rest",
    displayName: "Generic REST",
    description: "Configurable REST integration for custom systems.",
    status: "needs_configuration",
    capabilities: ["catalog:read", "orders:create"],
    notes: "Configure base URL, auth, and action mappings.",
  },
  webhook: {
    provider: "webhook",
    displayName: "Webhook",
    description: "Outbound webhook delivery for integrations that pull events.",
    status: "needs_configuration",
    capabilities: ["orders:create"],
    notes: "Configure target URL and signing secret.",
  },
  mock: {
    provider: "mock",
    displayName: "Mock (development)",
    description: "In-memory mock for local development and smoke tests.",
    status: "available",
    capabilities: [
      "locations:read",
      "catalog:read",
      "orders:create",
      "orders:update",
      "orders:submit",
      "inventory:read",
      "inventory:adjust",
    ],
  },
};

export function listConnectedServiceProviders(): ConnectedServiceProviderMetadata[] {
  return Object.values(CONNECTED_SERVICE_PROVIDERS);
}

