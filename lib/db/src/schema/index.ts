import { pgTable, text, serial, timestamp, integer, index, jsonb, boolean, uuid, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vector = customType<{ data: number[]; driverParam: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value.replace("(", "[").replace(")", "]"));
  },
});

// ── Users ─────────────────────────────────────────────────────────────────────

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

// ── Organizations ─────────────────────────────────────────────────────────────
// New: tenants that own venues, agents, and connections. Existing users
// remain valid; per-user organizations are created on demand by the API.

export const organizationsTable = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("organizations_owner_idx").on(table.ownerUserId),
]);

export type Organization = typeof organizationsTable.$inferSelect;

/** @deprecated Not used for team sharing yet. Single-user orgs only. */
export const organizationMembershipsTable = pgTable("organization_memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("owner"), // owner | admin | manager | operator
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("org_memberships_user_idx").on(table.userId),
  index("org_memberships_org_idx").on(table.organizationId),
]);

export type OrganizationMembership = typeof organizationMembershipsTable.$inferSelect;

// ── Venues ────────────────────────────────────────────────────────────────────
// Square credential columns kept for back-compat with the legacy /dashboard
// flow. New code reads connections from service_connections.

export const venuesTable = pgTable("venues", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => organizationsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  /** @deprecated Use service_connections table for new code. */
  squareAccessToken: text("square_access_token"),
  /** @deprecated Use service_connections table for new code. */
  squareMerchantId: text("square_merchant_id"),
  /** @deprecated Use service_connections table for new code. */
  squareLocationId: text("square_location_id"),
  /** @deprecated Use service_connections table for new code. */
  squareLocationName: text("square_location_name"),
  connectedAt: timestamp("connected_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("venues_user_id_idx").on(table.userId),
  index("venues_organization_idx").on(table.organizationId),
]);

export const insertVenueSchema = createInsertSchema(venuesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVenue = z.infer<typeof insertVenueSchema>;
export type Venue = typeof venuesTable.$inferSelect;

// ── Service Connections ───────────────────────────────────────────────────────
// Provider-agnostic credential store. Supersedes the per-venue Square
// columns; those rows still work via the SquareAdapter.squareConnectionFromVenue
// shim until the migration completes.

export const serviceConnectionsTable = pgTable("service_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  venueId: integer("venue_id").references(() => venuesTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // ConnectedServiceProvider
  /** Encrypted at rest by the API layer; stores tokens, refresh tokens, etc. */
  credentials: jsonb("credentials").notNull().default({}),
  /** Provider-specific config: locationId, environment, action mappings. */
  config: jsonb("config").notNull().default({}),
  status: text("status").notNull().default("needs_configuration"),
  lastHealthCheck: jsonb("last_health_check"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("service_connections_org_idx").on(table.organizationId),
  index("service_connections_venue_idx").on(table.venueId),
  index("service_connections_provider_idx").on(table.provider),
]);

export type ServiceConnectionRow = typeof serviceConnectionsTable.$inferSelect;

// ── Agent Profiles ────────────────────────────────────────────────────────────

export const agentProfilesTable = pgTable("agent_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  venueId: integer("venue_id").references(() => venuesTable.id, { onDelete: "set null" }),
  connectedServiceId: uuid("connected_service_id").references(() => serviceConnectionsTable.id, { onDelete: "set null" }),
  displayName: text("display_name").notNull(),
  wakePhrase: text("wake_phrase").notNull(),
  voicePipelineProvider: text("voice_pipeline_provider").notNull(),
  voicePipelineConfig: jsonb("voice_pipeline_config").notNull().default({}),
  noiseMode: text("noise_mode").notNull().default("standard"),
  allowedTools: jsonb("allowed_tools").notNull().default([]), // string[]
  confirmationPolicy: jsonb("confirmation_policy").notNull().default({}),
  personality: text("personality").notNull().default(""),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("agent_profiles_org_idx").on(table.organizationId),
  index("agent_profiles_venue_idx").on(table.venueId),
]);

export type AgentProfileRow = typeof agentProfilesTable.$inferSelect;

// ── Subscriptions ─────────────────────────────────────────────────────────────

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan: text("plan").notNull().default("trial"),
  status: text("status").notNull().default("trialing"),
  trialEndsAt: timestamp("trial_ends_at"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAt: timestamp("cancel_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("subscriptions_user_id_idx").on(table.userId),
  index("subscriptions_org_id_idx").on(table.organizationId),
]);

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;

// ── Sessions ──────────────────────────────────────────────────────────────────

export const sessionsTable = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("sessions_user_id_idx").on(table.userId),
]);

export type Session = typeof sessionsTable.$inferSelect;

// ── Exchange Codes ────────────────────────────────────────────────────────────

export const exchangeCodesTable = pgTable("exchange_codes", {
  code: text("code").primaryKey(),
  token: text("token").notNull(),
  venueId: text("venue_id").notNull(),
  agentProfileId: uuid("agent_profile_id").references(() => agentProfilesTable.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ExchangeCode = typeof exchangeCodesTable.$inferSelect;

// ── Voice Sessions ────────────────────────────────────────────────────────────

/** @deprecated In-memory session store is authoritative. DB write-through retained for future analytics only. */
export const voiceSessionsTable = pgTable("voice_sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  venueId: integer("venue_id").notNull().references(() => venuesTable.id, { onDelete: "cascade" }),
  agentProfileId: uuid("agent_profile_id").references(() => agentProfilesTable.id, { onDelete: "set null" }),
  pipelineProvider: text("pipeline_provider"),
  state: jsonb("state").notNull().default({}),
  squareOrderId: text("square_order_id"),
  externalOrderId: text("external_order_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => [
  index("voice_sessions_user_id_idx").on(table.userId),
  index("voice_sessions_venue_id_idx").on(table.venueId),
  index("voice_sessions_agent_profile_idx").on(table.agentProfileId),
]);

export type VoiceSession = typeof voiceSessionsTable.$inferSelect;

// ── Tool Calls ────────────────────────────────────────────────────────────────

export const toolCallsTable = pgTable("tool_calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  venueId: integer("venue_id").references(() => venuesTable.id, { onDelete: "set null" }),
  sessionId: text("session_id"),
  agentProfileId: uuid("agent_profile_id").references(() => agentProfilesTable.id, { onDelete: "set null" }),
  connectedServiceId: uuid("connected_service_id").references(() => serviceConnectionsTable.id, { onDelete: "set null" }),
  toolName: text("tool_name").notNull(),
  args: jsonb("args").notNull().default({}),
  result: jsonb("result"),
  riskLevel: text("risk_level").notNull().default("medium"),
  confirmedByUser: boolean("confirmed_by_user").notNull().default(false),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("tool_calls_session_idx").on(table.sessionId),
  index("tool_calls_agent_idx").on(table.agentProfileId),
  index("tool_calls_org_idx").on(table.organizationId),
  index("tool_calls_status_idx").on(table.status),
  index("tool_calls_user_created_idx").on(table.userId, table.createdAt),
]);

// ── Usage Events ──────────────────────────────────────────────────────────────

export const usageEventsTable = pgTable("usage_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  agentProfileId: uuid("agent_profile_id").references(() => agentProfilesTable.id, { onDelete: "set null" }),
  kind: text("kind").notNull(), // voice_minutes | tool_call | session_start
  quantity: integer("quantity").notNull().default(1),
  metadata: jsonb("metadata").notNull().default({}),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
}, (table) => [
  index("usage_events_org_idx").on(table.organizationId),
  index("usage_events_kind_idx").on(table.kind),
  index("usage_events_user_kind_idx").on(table.userId, table.kind, table.occurredAt),
]);


// -- Knowledge Base ------------------------------------------------------------
// User-uploaded text documents that the general assistant can search via the
// search_knowledge tool. Embeddings are stored as pgvector vector(1536) columns
// with an HNSW index for fast cosine similarity search.

export const knowledgeDocumentsTable = pgTable("knowledge_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  venueId: integer("venue_id").references(() => venuesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sourceType: text("source_type").notNull().default("text"), // text | url | pdf
  sourceUri: text("source_uri"),
  byteCount: integer("byte_count").notNull().default(0),
  chunkCount: integer("chunk_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("knowledge_documents_user_idx").on(table.userId),
  index("knowledge_documents_venue_idx").on(table.venueId),
]);

export type KnowledgeDocument = typeof knowledgeDocumentsTable.$inferSelect;

export const knowledgeChunksTable = pgTable("knowledge_chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").notNull().references(() => knowledgeDocumentsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  venueId: integer("venue_id").references(() => venuesTable.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  text: text("text").notNull(),
  embedding: vector("embedding").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("knowledge_chunks_document_idx").on(table.documentId),
  index("knowledge_chunks_user_idx").on(table.userId),
]);

export type KnowledgeChunk = typeof knowledgeChunksTable.$inferSelect;

// -- External Postgres Connections ---------------------------------------------
// Per-user read-only Postgres connection strings exposed to the
// query_database tool. Stored in plaintext for now � TODO: encrypt at rest.

export const externalDbConnectionsTable = pgTable("external_db_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  venueId: integer("venue_id").references(() => venuesTable.id, { onDelete: "cascade" }),
  label: text("label").notNull().default("default"),
  kind: text("kind").notNull().default("postgres"), // postgres only for now
  connectionString: text("connection_string").notNull(),
  /** Optional schema hint shown to the model so it knows what to query. */
  schemaHint: text("schema_hint"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("external_db_connections_user_idx").on(table.userId),
]);

export type ExternalDbConnection = typeof externalDbConnectionsTable.$inferSelect;

// -- Email Credentials ---------------------------------------------------------
// Per-user outbound email config. Supports Resend (api_key), Gmail via SMTP
// app password (smtp_*), and Gmail via OAuth2 (oauth_refresh_token).

export const emailCredentialsTable = pgTable("email_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  venueId: integer("venue_id").references(() => venuesTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("resend"), // resend | gmail | gmail_oauth | smtp
  apiKey: text("api_key"),
  fromAddress: text("from_address").notNull(),
  fromName: text("from_name"),
  /** Optional SMTP fields for provider=smtp / gmail. */
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpUser: text("smtp_user"),
  smtpPass: text("smtp_pass"),
  /** OAuth2 refresh token (encrypted) for provider=gmail_oauth. */
  oauthRefreshToken: text("oauth_refresh_token"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("email_credentials_user_idx").on(table.userId),
]);

export type EmailCredential = typeof emailCredentialsTable.$inferSelect;
