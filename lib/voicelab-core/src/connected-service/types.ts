/**
 * Connected service metadata. VoyceLab is a bolt-on layer; connected
 * services (Square, Toast, Clover, etc.) remain the source of truth for
 * catalog, orders, inventory, payments, team, and reports.
 */

export type ConnectedServiceProvider =
  | "square"
  | "toast"
  | "clover"
  | "lightspeed"
  | "shopify_pos"
  | "gopayments_poynt"
  | "revel"
  | "generic_rest"
  | "webhook"
  | "mock";

export type ConnectedServiceCapability =
  | "locations:read"
  | "catalog:read"
  | "catalog:manage"
  | "orders:create"
  | "orders:update"
  | "orders:submit"
  | "terminal:checkout"
  | "inventory:read"
  | "inventory:adjust"
  | "reports:read"
  | "customers:read"
  | "payments:refund"
  | "team:read"
  | "team:clock";

export type ConnectedServiceAvailabilityStatus =
  | "available"
  | "needs_configuration"
  | "request_access"
  | "unavailable";

export interface ConnectedServiceProviderMetadata {
  provider: ConnectedServiceProvider;
  displayName: string;
  description: string;
  status: ConnectedServiceAvailabilityStatus;
  capabilities: ConnectedServiceCapability[];
  /** When status === "request_access" or "needs_configuration", what's missing. */
  notes?: string;
  /** Visible in admin UI as a contact link. */
  requestAccessUrl?: string;
}
