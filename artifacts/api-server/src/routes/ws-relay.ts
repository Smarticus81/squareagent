/**
 * WebSocket Relay for Native (iOS/Android) Voice Agent
 *
 * Accepts WebSocket upgrades on /api/realtime path.
 * Authenticates via WebSocket subprotocol `jwt.<JWT>`.
 * Tokens in query strings are rejected so credentials never land in URL logs.
 * Opens a relay WebSocket to OpenAI Realtime API.
 * Handles tool calls server-side using the shared tool registry.
 */

import { IncomingMessage } from "http";
import { Server } from "http";
import WebSocket, { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import {
  db,
  venuesTable,
  sessionsTable,
  usersTable,
  subscriptionsTable,
  organizationMembershipsTable,
  agentProfilesTable,
  serviceConnectionsTable,
  emailCredentialsTable,
  knowledgeDocumentsTable,
  externalDbConnectionsTable,
  usageEventsTable,
} from "@workspace/db";
import { eq, and, isNull, or, gte, sql } from "drizzle-orm";
import { buildUsageLimitSnapshot } from "@workspace/voicelab-core/pricing";
import {
  cancelLiveOrder,
  type CatalogItem,
  type OrderItem,
  type LiveSession,
} from "../lib/square-helpers";
import { executeToolCall, toolCount, type ToolDefinition } from "../tools";
import { buildInstructionsFromSkills, buildToolsFromSkills, getSkillsForSession } from "../skills";
import {
  buildGeminiLiveSetupMessage,
  buildGeminiLiveUrl,
} from "../voice-pipelines/google/gemini-live";
import { getCachedCredentials } from "../lib/credential-cache";
import { readServerApiKey, requiredApiKeyEnv } from "../lib/api-keys";
import { createComponentLogger } from "../lib/logger";
import type { NoiseMode } from "@workspace/voicelab-core/noise";
import { planAllowsPipeline } from "@workspace/voicelab-core/pricing";
import type { VoicePipelineProvider } from "@workspace/voicelab-core/voice-pipeline";
import { isAdminEmail, JWT_SECRET } from "./auth";
import {
  OPENAI_REALTIME_MODEL,
  buildRealtimeSessionPayload,
  sanitizeRealtimeVoice,
  sanitizeRealtimeSpeed,
} from "../lib/openai-realtime";

const SENSITIVE_LOG_KEY_RE = /(token|secret|password|pass|credential|authorization|email|recipient|subject|body|message|text|query|sql|connection|string|address|phone|name)/i;
const relayLog = createComponentLogger("ws-relay");

type RelayKind = "openai" | "gemini";

type RelayScope =
  | {
      ok: true;
      venueId: number | null;
      agentProfileId: string | null;
      connectedServiceId: string | null;
      usesSquareService: boolean;
      geminiModelId: string | null;
      allowedToolNames: string[] | null;
      noiseMode: NoiseMode;
      voicePipelineProvider: VoicePipelineProvider | null;
      profileDisplayName: string;
      profilePersonality: string;
    }
  | { ok: false; status: 400 | 403 | 404 };

export interface RelayCtx {
  userId: number;
  organizationId: string | null;
  userRole: string | null;
  venueId: number | null;
  agentProfileId: string | null;
  plan: string;
  allowedToolNames: string[] | null;
  includeGeneralTools: boolean;
  squareToken: string;
  squareLocationId: string;
  kind: RelayKind;
  voicePipelineProvider: VoicePipelineProvider | null;
  profileDisplayName: string;
  profilePersonality: string;
  geminiModelId: string | null;
  noiseMode: NoiseMode;
  query: Record<string, string>;
}

function summarizeToolArgs(args: Record<string, unknown>): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_LOG_KEY_RE.test(key)) {
      summary[key] = "[redacted]";
      continue;
    }
    if (Array.isArray(value)) {
      summary[key] = `array(${value.length})`;
      continue;
    }
    if (value && typeof value === "object") {
      summary[key] = "object";
      continue;
    }
    summary[key] = typeof value;
  }
  return summary;
}

function logToolCall(scope: RelayKind, ctx: RelayCtx, toolName: string, args: Record<string, unknown>): void {
  relayLog.info(
    {
      scope,
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      venueId: ctx.venueId,
      agentProfileId: ctx.agentProfileId,
      toolName,
      args: summarizeToolArgs(args),
    },
    "relay tool call",
  );
}

function resamplePcm16Base64(base64Pcm: string, fromRate: number, toRate: number): string {
  if (fromRate === toRate) return base64Pcm;
  const input = Buffer.from(base64Pcm, "base64");
  const sampleCount = Math.floor(input.length / 2);
  if (sampleCount === 0) return base64Pcm;

  const outputCount = Math.max(1, Math.floor(sampleCount * toRate / fromRate));
  const output = Buffer.alloc(outputCount * 2);
  for (let outIndex = 0; outIndex < outputCount; outIndex++) {
    const sourceIndex = outIndex * (fromRate / toRate);
    const leftIndex = Math.min(sampleCount - 1, Math.floor(sourceIndex));
    const rightIndex = Math.min(sampleCount - 1, leftIndex + 1);
    const weight = sourceIndex - leftIndex;
    const left = input.readInt16LE(leftIndex * 2);
    const right = input.readInt16LE(rightIndex * 2);
    const sample = Math.round(left + (right - left) * weight);
    output.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), outIndex * 2);
  }
  return output.toString("base64");
}

function geminiClientMessageFromRealtimeEvent(event: Record<string, unknown>): string | null {
  if (event.type === "input_audio_buffer.append" && typeof event.audio === "string") {
    const inputRate = Number(event.sample_rate ?? event.sampleRate ?? 24000);
    return JSON.stringify({
      realtimeInput: {
        audio: {
          data: resamplePcm16Base64(event.audio, Number.isFinite(inputRate) ? inputRate : 24000, 16000),
          mimeType: "audio/pcm;rate=16000",
        },
      },
    });
  }

  if (event.type === "response.cancel") {
    return null;
  }

  if (event.realtimeInput || event.clientContent || event.toolResponse) {
    return JSON.stringify(event);
  }

  return null;
}

function getOpenAiFunctionOutputCallId(event: Record<string, unknown>): string | null {
  if (event.type !== "conversation.item.create") return null;
  const item = event.item as Record<string, unknown> | undefined;
  if (item?.type !== "function_call_output") return null;
  return typeof item.call_id === "string" && item.call_id ? item.call_id : null;
}

function isOpenAiFunctionOutputEvent(event: Record<string, unknown>): boolean {
  if (event.type !== "conversation.item.create") return false;
  const item = event.item as Record<string, unknown> | undefined;
  return item?.type === "function_call_output";
}

function getGeminiToolResponseIds(event: Record<string, unknown>): string[] | null {
  const toolResponse = event.toolResponse as Record<string, unknown> | undefined;
  if (!toolResponse) return null;
  const functionResponses = toolResponse.functionResponses;
  if (!Array.isArray(functionResponses) || functionResponses.length === 0) return [];

  const ids: string[] = [];
  for (const response of functionResponses) {
    if (!response || typeof response !== "object") return [];
    const id = (response as Record<string, unknown>).id;
    if (typeof id !== "string" || !id) return [];
    ids.push(id);
  }
  return ids;
}

function canForwardConfirmedToolOutput(
  callIds: string[],
  pendingConfirmationCallIds: Set<string>,
): boolean {
  if (callIds.length === 0) return false;
  return callIds.every((callId) => pendingConfirmationCallIds.has(callId));
}

function geminiServerMessagesForRealtimeClient(
  event: Record<string, unknown>,
  sessionId: string,
): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];

  if (event.setupComplete !== undefined) {
    messages.push({ type: "session.created", session: { id: sessionId } });
  }

  const serverContent = event.serverContent as Record<string, unknown> | undefined;
  if (serverContent) {
    const inputTranscription = serverContent.inputTranscription as Record<string, unknown> | undefined;
    if (typeof inputTranscription?.text === "string" && inputTranscription.text.trim()) {
      messages.push({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: inputTranscription.text,
      });
    }

    const outputTranscription = serverContent.outputTranscription as Record<string, unknown> | undefined;
    if (typeof outputTranscription?.text === "string" && outputTranscription.text.trim()) {
      messages.push({ type: "response.audio_transcript.done", transcript: outputTranscription.text });
    }

    const modelTurn = serverContent.modelTurn as Record<string, unknown> | undefined;
    const parts = Array.isArray(modelTurn?.parts) ? modelTurn.parts : [];
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const inlineData = (part as Record<string, unknown>).inlineData as Record<string, unknown> | undefined;
      if (typeof inlineData?.data === "string") {
        messages.push({ type: "response.audio.delta", delta: inlineData.data });
      }
    }

    if (serverContent.interrupted) {
      messages.push({ type: "input_audio_buffer.speech_started" });
    }
    if (serverContent.generationComplete || serverContent.turnComplete) {
      messages.push({ type: "response.done" });
    }
  }

  if (event.goAway) {
    messages.push({ type: "error", error: { message: "Gemini Live session is closing" } });
  }

  return messages;
}

function parseBooleanQuery(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseLanguageCodes(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const codes = value
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
  return codes.length > 0 ? codes : undefined;
}

function parseThinkingLevel(value: string | undefined): "minimal" | "low" | "medium" | "high" | undefined {
  if (value === "minimal" || value === "low" || value === "medium" || value === "high") return value;
  return undefined;
}

// -- Auth helper ---

function tokenFromWebSocketRequest(req: IncomingMessage): string | null {
  const protocolHeader = req.headers["sec-websocket-protocol"];
  const protocols = typeof protocolHeader === "string"
    ? protocolHeader.split(",").map((value) => value.trim()).filter(Boolean)
    : [];
  const jwtProtocol = protocols.find((value) => value.startsWith("jwt."));
  if (jwtProtocol) return jwtProtocol.slice("jwt.".length);
  return null;
}

async function authenticateToken(
  token: string,
): Promise<{ userId: number; organizationId: string | null; userRole: string | null; subscription: any; isAdmin: boolean } | null> {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as unknown as { sub: number; sid: string };
    if (!payload?.sub || !payload?.sid) return null;

    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, payload.sid), eq(sessionsTable.userId, payload.sub)));
    if (!session || session.expiresAt < new Date()) return null;

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.sub));
    if (!user) return null;

    const [[subscription], [membership]] = await Promise.all([
      db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, user.id)),
      db
        .select({
          organizationId: organizationMembershipsTable.organizationId,
          role: organizationMembershipsTable.role,
        })
        .from(organizationMembershipsTable)
        .where(eq(organizationMembershipsTable.userId, user.id))
        .limit(1),
    ]);
    return {
      userId: user.id,
      organizationId: membership?.organizationId ?? null,
      userRole: membership?.role ?? null,
      subscription: subscription ?? null,
      isAdmin: isAdminEmail(user.email),
    };
  } catch {
    return null;
  }
}

function checkPlan(subscription: any, isAdmin: boolean): string | null {
  if (isAdmin) return null;
  if (!subscription) return "No active subscription";

  if (subscription.status === "trialing") {
    if (subscription.trialEndsAt && new Date(subscription.trialEndsAt) < new Date()) {
      return "Trial expired. Please subscribe to continue.";
    }
    return null;
  }

  if (subscription.status !== "active") return "Subscription inactive";

  return null;
}

function effectiveRelayPlan(subscription: any, isAdmin: boolean): string {
  if (isAdmin) return "admin";
  return typeof subscription?.plan === "string" && subscription.plan ? subscription.plan : "trial";
}

function tenantWhere(table: { organizationId: any; userId: any }, userId: number, organizationId: string) {
  return or(
    eq(table.organizationId, organizationId),
    and(eq(table.userId, userId), isNull(table.organizationId)),
  );
}

async function hasGeneralConnectedSystems(userId: number, organizationId: string | null): Promise<boolean> {
  if (!organizationId) return false;
  try {
    const [[email], [document], [database]] = await Promise.all([
      db
        .select({ id: emailCredentialsTable.id })
        .from(emailCredentialsTable)
        .where(tenantWhere(emailCredentialsTable, userId, organizationId))
        .limit(1),
      db
        .select({ id: knowledgeDocumentsTable.id })
        .from(knowledgeDocumentsTable)
        .where(tenantWhere(knowledgeDocumentsTable, userId, organizationId))
        .limit(1),
      db
        .select({ id: externalDbConnectionsTable.id })
        .from(externalDbConnectionsTable)
        .where(tenantWhere(externalDbConnectionsTable, userId, organizationId))
        .limit(1),
    ]);
    return Boolean(email || document || database);
  } catch {
    return false;
  }
}

async function validateRelayScope(
  userId: number,
  organizationId: string | null,
  venueIdStr: string | null,
  agentProfileId: string | null,
  kind: RelayKind,
): Promise<RelayScope> {
  let venueId = venueIdStr ? Number(venueIdStr) : null;
  let profileVenueId: number | null = null;
  let connectedServiceId: string | null = null;
  let usesSquareService = true;
  let geminiModelId: string | null = null;
  let allowedToolNames: string[] | null = null;
  let noiseMode: NoiseMode = "standard";
  let voicePipelineProvider: VoicePipelineProvider | null = null;
  let profileDisplayName = "";
  let profilePersonality = "";

  if (venueIdStr && (!Number.isInteger(venueId) || venueId === null || venueId <= 0)) {
    return { ok: false, status: 400 };
  }

  if (agentProfileId) {
    if (!organizationId) return { ok: false, status: 403 };
    const [profile] = await db
      .select({
        id: agentProfilesTable.id,
        venueId: agentProfilesTable.venueId,
        noiseMode: agentProfilesTable.noiseMode,
        voicePipelineProvider: agentProfilesTable.voicePipelineProvider,
        allowedTools: agentProfilesTable.allowedTools,
        connectedServiceId: agentProfilesTable.connectedServiceId,
        displayName: agentProfilesTable.displayName,
        personality: agentProfilesTable.personality,
      })
      .from(agentProfilesTable)
      .where(and(eq(agentProfilesTable.id, agentProfileId), eq(agentProfilesTable.organizationId, organizationId)))
      .limit(1);
    if (!profile) return { ok: false, status: 404 };
    profileVenueId = profile.venueId ?? null;
    connectedServiceId = profile.connectedServiceId ?? null;
    voicePipelineProvider = profile.voicePipelineProvider as VoicePipelineProvider;
    profileDisplayName = profile.displayName ?? "";
    profilePersonality = profile.personality ?? "";
    if (profile.noiseMode === "standard" || profile.noiseMode === "loud" || profile.noiseMode === "push_to_talk") {
      noiseMode = profile.noiseMode;
    }
    allowedToolNames =
      Array.isArray(profile.allowedTools) && profile.allowedTools.every((name: unknown): name is string => typeof name === "string")
        ? profile.allowedTools
        : null;
    if (kind === "gemini") {
      switch (profile.voicePipelineProvider) {
        case "google_gemini_3_1_flash_live":
          geminiModelId = "gemini-3.1-flash-live-preview";
          break;
        case "google_gemini_2_5_flash_native_audio":
          geminiModelId = "gemini-2.5-flash-native-audio-preview-12-2025";
          break;
        default:
          return { ok: false, status: 400 };
      }
    } else if (
      profile.voicePipelineProvider !== "openai_realtime_server_ws" &&
      profile.voicePipelineProvider !== "openai_realtime_webrtc"
    ) {
      return { ok: false, status: 400 };
    }
    if (connectedServiceId) {
      const [connection] = await db
        .select({ provider: serviceConnectionsTable.provider })
        .from(serviceConnectionsTable)
        .where(
          and(
            eq(serviceConnectionsTable.id, connectedServiceId),
            eq(serviceConnectionsTable.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!connection) return { ok: false, status: 403 };
      if (connection.provider !== "square") usesSquareService = false;
    }
  } else if (kind === "gemini") {
    return { ok: false, status: 400 };
  }

  if (venueId !== null) {
    const [venue] = await db
      .select({ id: venuesTable.id })
      .from(venuesTable)
      .where(
        and(
          eq(venuesTable.id, venueId),
          organizationId
            ? or(
                eq(venuesTable.organizationId, organizationId),
                and(eq(venuesTable.userId, userId), isNull(venuesTable.organizationId)),
              )
            : eq(venuesTable.userId, userId),
        ),
      )
      .limit(1);
    if (!venue) return { ok: false, status: 404 };
    if (profileVenueId !== null && profileVenueId !== venueId) return { ok: false, status: 400 };
  } else if (profileVenueId !== null) {
    venueId = profileVenueId;
  }

  return {
    ok: true,
    venueId,
    agentProfileId,
    connectedServiceId,
    usesSquareService,
    geminiModelId,
    allowedToolNames,
    noiseMode,
    voicePipelineProvider,
    profileDisplayName,
    profilePersonality,
  };
}

function buildRelayTools(
  plan: string,
  assistantKind: "venue" | "general",
  allowedToolNames: string[] | null,
  includeGeneralTools: boolean,
): ToolDefinition[] {
  const tools = buildToolsFromSkills(getSkillsForSession(plan, { kind: assistantKind, includeGeneralTools }));
  if (!allowedToolNames || allowedToolNames.length === 0) return tools;
  const allowed = new Set(allowedToolNames);
  return tools.filter((tool) => tool.name === "wait_for_user" || allowed.has(tool.name));
}

function isRelayToolAllowed(toolName: string, tools: ToolDefinition[]): boolean {
  return tools.some((tool) => tool.name === toolName);
}

function parsePendingConfirmation(result: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const confirmation = parsed.confirmation;
    if (parsed.status === "REQUIRES_CONFIRMATION" && confirmation && typeof confirmation === "object") {
      return confirmation as Record<string, unknown>;
    }
  } catch {
    // Result is not a JSON confirmation envelope.
  }
  return null;
}

// -- System prompt ---

function buildInstructions(
  ctx: RelayCtx,
  catalog: CatalogItem[],
  order: OrderItem[],
  assistantKind: "venue" | "general",
): string {
  const skills = getSkillsForSession(ctx.plan, {
    kind: assistantKind,
    includeGeneralTools: ctx.includeGeneralTools,
  });
  let instructions = buildInstructionsFromSkills(skills, catalog, order, assistantKind);
  if (ctx.profileDisplayName || ctx.profilePersonality) {
    const identity = ctx.profileDisplayName ? `You are ${ctx.profileDisplayName}. ` : "";
    const personality = ctx.profilePersonality ? `${ctx.profilePersonality}\n\n` : "";
    instructions = `${identity}${personality}${instructions}`;
  }
  return instructions;
}

// -- Attach WebSocket server to HTTP server ---

export function attachWebSocketRelay(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    let kind: RelayKind;
    switch (url.pathname) {
      case "/api/realtime": kind = "openai"; break;
      case "/api/realtime/gemini": kind = "gemini"; break;
      default:
        socket.destroy();
        return;
    }

    if (url.searchParams.has("token")) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    const token = tokenFromWebSocketRequest(req);
    const venueIdStr = url.searchParams.get("venueId");
    const agentProfileId = url.searchParams.get("agentProfileId");
    const requestedGeminiModelId = url.searchParams.get("modelId");

    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // Authenticate
    const auth = await authenticateToken(token);
    if (!auth) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // Check subscription plan (admins bypass)
    const planError = checkPlan(auth.subscription, auth.isAdmin);
    if (planError) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    const effectivePlan = effectiveRelayPlan(auth.subscription, auth.isAdmin);

    // Check usage limits and overage cap (admins bypass)
    if (!auth.isAdmin) {
      try {
        const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const [usage] = await db
          .select({ total: sql<number>`coalesce(sum(${usageEventsTable.quantity}), 0)` })
          .from(usageEventsTable)
          .where(and(
            auth.organizationId
              ? or(
                  eq(usageEventsTable.organizationId, auth.organizationId),
                  and(eq(usageEventsTable.userId, auth.userId), isNull(usageEventsTable.organizationId)),
                )
              : eq(usageEventsTable.userId, auth.userId),
            eq(usageEventsTable.kind, "voice_minutes"),
            gte(usageEventsTable.occurredAt, periodStart),
          ));
        
        const used = Number(usage?.total ?? 0);
        const limits = buildUsageLimitSnapshot(effectivePlan, used);
        if (limits.risk === "blocked") {
          socket.write("HTTP/1.1 402 Payment Required\r\n\r\n");
          socket.destroy();
          return;
        }
      } catch {
        // non-critical — allow connection if usage check fails
      }
    }

    const scope = await validateRelayScope(auth.userId, auth.organizationId, venueIdStr, agentProfileId, kind);
    if (!scope.ok) {
      socket.write(`HTTP/1.1 ${scope.status} ${scope.status === 400 ? "Bad Request" : scope.status === 403 ? "Forbidden" : "Not Found"}\r\n\r\n`);
      socket.destroy();
      return;
    }
    if (
      scope.voicePipelineProvider &&
      !auth.isAdmin &&
      !planAllowsPipeline(effectivePlan, scope.voicePipelineProvider)
    ) {
      socket.write("HTTP/1.1 402 Payment Required\r\n\r\n");
      socket.destroy();
      return;
    }

    // Lookup venue credentials. Explicit assistant service bindings are
    // authoritative; non-Square assistants stay general and do not fall back
    // to legacy venue Square tokens.
    let squareToken = "";
    let squareLocationId = "";
    if (scope.venueId !== null && scope.usesSquareService) {
      const creds = await getCachedCredentials(
        auth.userId,
        scope.venueId,
        auth.organizationId,
        scope.connectedServiceId,
      );
      if (creds) {
        squareToken = creds.squareToken;
        squareLocationId = creds.squareLocationId;
      }
    }

    const queryParams: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      if (key === "token") return;
      queryParams[key] = value;
    });
    const includeGeneralTools =
      scope.venueId !== null && (await hasGeneralConnectedSystems(auth.userId, auth.organizationId));

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      const ctx: RelayCtx = {
        userId: auth.userId,
        organizationId: auth.organizationId,
        userRole: auth.userRole,
        venueId: scope.venueId,
        agentProfileId: scope.agentProfileId,
        plan: effectivePlan,
        allowedToolNames: scope.allowedToolNames,
        includeGeneralTools,
        squareToken,
        squareLocationId,
        kind,
        voicePipelineProvider: scope.voicePipelineProvider,
        profileDisplayName: scope.profileDisplayName,
        profilePersonality: scope.profilePersonality,
        geminiModelId: kind === "gemini" ? scope.geminiModelId : requestedGeminiModelId,
        noiseMode: scope.noiseMode,
        query: queryParams,
      };
      wss.emit("connection", clientWs, req, ctx);
    });
  });

  wss.on("connection", (clientWs: WebSocket, _req: IncomingMessage, ctx: RelayCtx) => {
    if (ctx.kind === "gemini") {
      handleGeminiRelay(clientWs, ctx);
      return;
    }
    const apiKey = readServerApiKey("openai")?.value ?? "";
    if (!apiKey) {
      clientWs.send(JSON.stringify({ type: "error", error: { message: `${requiredApiKeyEnv("openai")} not configured` } }));
      clientWs.close();
      return;
    }

    // Session state
    const connectionStartMs = Date.now();
    let catalog: CatalogItem[] = [];
    let order: OrderItem[] = [];
    const session: LiveSession = { items: [] };
    let sessionSquareToken = ctx.squareToken;
    let sessionLocationId = ctx.squareLocationId;
    const assistantKind: "venue" | "general" = sessionSquareToken ? "venue" : "general";
    const relayTools = buildRelayTools(ctx.plan, assistantKind, ctx.allowedToolNames, ctx.includeGeneralTools);

    relayLog.info(
      {
        scope: "openai",
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        venueId: ctx.venueId,
        agentProfileId: ctx.agentProfileId,
        provider: ctx.voicePipelineProvider ?? "openai_realtime_server_ws",
        activeTools: relayTools.length,
        totalTools: toolCount(),
      },
      "relay connected",
    );

    // Connect to OpenAI Realtime API
    const openaiUrl = `wss://api.openai.com/v1/realtime?model=${OPENAI_REALTIME_MODEL}`;
    const openaiWs = new WebSocket(openaiUrl, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
    });

    let openaiReady = false;
    let pendingFromClient: string[] = [];
    const pendingConfirmationCallIds = new Set<string>();

    openaiWs.on("open", () => {
      relayLog.info({ scope: "openai", userId: ctx.userId }, "upstream connected");
      openaiReady = true;

      // Configure session. The model is fixed by the connection URL, so strip
      // it from the session.update payload; voice/speed arrive as raw query
      // params and are sanitized inside the builder.
      const { model: _model, ...session } = buildRealtimeSessionPayload({
        instructions: buildInstructions(ctx, catalog, order, assistantKind),
        tools: relayTools,
        voice: ctx.query.voice || "ash",
        speed: ctx.query.speed,
        turnDetection: {
          type: "semantic_vad",
          eagerness: "auto",
          create_response: true,
          interrupt_response: true,
        },
        noiseMode: ctx.noiseMode,
      });
      openaiWs.send(JSON.stringify({ type: "session.update", session }));

      // Flush any messages that arrived before OpenAI was ready
      for (const msg of pendingFromClient) {
        openaiWs.send(msg);
      }
      pendingFromClient = [];
    });

    // Handle messages FROM OpenAI -> relay to client (intercept tool calls)
    openaiWs.on("message", async (data) => {
      const raw = data.toString();
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw); } catch { clientWs.send(raw); return; }

      // Intercept tool call completion -> execute server-side
      if (event.type === "response.function_call_arguments.done") {
        const toolName = String(event.name ?? "");
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(String(event.arguments ?? "{}")); } catch {}
        const callId = String(event.call_id ?? "");

        logToolCall("openai", ctx, toolName, args);

        try {
          if (!isRelayToolAllowed(toolName, relayTools)) {
            throw new Error(`Command not allowed in this assistant: ${toolName}`);
          }
          const { result, command } = await executeToolCall(
            toolName, args,
            {
              catalog,
              order,
              squareToken: sessionSquareToken,
              squareLocationId: sessionLocationId,
              session,
              requestId: callId || undefined,
              userId: ctx.userId,
              userRole: ctx.userRole,
              organizationId: ctx.organizationId,
              venueId: ctx.venueId ?? undefined,
              assistantKind,
              noiseMode: ctx.noiseMode,
            },
          );
          const pendingConfirmation = parsePendingConfirmation(result);
          if (pendingConfirmation && clientWs.readyState === WebSocket.OPEN) {
            if (callId) pendingConfirmationCallIds.add(callId);
            clientWs.send(JSON.stringify({
              type: "x.pending_confirmation",
              confirmation: pendingConfirmation,
              call_id: callId,
            }));
            return;
          }

          // Send tool output back to OpenAI
          openaiWs.send(JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: result,
            },
          }));
          openaiWs.send(JSON.stringify({ type: "response.create" }));

          // Send order command to client
          if (command) {
            clientWs.send(JSON.stringify({ type: "x.order_command", command }));
          }
        } catch (e: any) {
          relayLog.error({ scope: "openai", userId: ctx.userId, toolName, err: e.message }, "relay tool error");
          openaiWs.send(JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: `Error: ${e.message}`,
            },
          }));
          openaiWs.send(JSON.stringify({ type: "response.create" }));
        }

        // The relay has already executed this command and returned the result
        // upstream. Do not forward the raw function-call event to the PWA, or
        // the client will execute the same command a second time.
        return;
      }

      // Forward all other events to client
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(raw);
      }
    });

    openaiWs.on("error", (err) => {
      relayLog.error({ scope: "openai", userId: ctx.userId, err: err.message }, "upstream websocket error");
      clientWs.send(JSON.stringify({ type: "error", error: { message: "Voice service connection failed" } }));
      clientWs.close();
    });

    openaiWs.on("close", () => {
      relayLog.info({ scope: "openai", userId: ctx.userId }, "upstream websocket closed");
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    });

    // Handle messages FROM client -> relay to OpenAI (intercept context updates)
    clientWs.on("message", (data) => {
      const raw = data.toString();
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw); } catch {
        return;
      }

      // Intercept custom context update -- update local state, send session.update to OpenAI
      if (event.type === "x.context_update") {
        if (Array.isArray(event.catalog)) catalog = event.catalog as CatalogItem[];
        if (Array.isArray(event.order)) order = event.order as OrderItem[];

        const voice = event.voice ? sanitizeRealtimeVoice(event.voice) : undefined;
        const speed = typeof event.speed === "number" && Number.isFinite(event.speed)
          ? sanitizeRealtimeSpeed(event.speed)
          : undefined;

        // Send updated instructions to OpenAI
        if (openaiReady) {
          openaiWs.send(JSON.stringify({
            type: "session.update",
            session: {
              // GA session objects are discriminated on `type`; updates
              // without it are rejected as invalid.
              type: "realtime",
              instructions: buildInstructions(ctx, catalog, order, assistantKind),
              ...(voice || speed
                ? {
                    audio: {
                      output: {
                        ...(voice ? { voice } : {}),
                        ...(speed ? { speed } : {}),
                      },
                    },
                  }
                : {}),
            },
          }));
        }
        return;
      }

      if (isOpenAiFunctionOutputEvent(event)) {
        const functionOutputCallId = getOpenAiFunctionOutputCallId(event);
        if (
          !functionOutputCallId ||
          !canForwardConfirmedToolOutput([functionOutputCallId], pendingConfirmationCallIds)
        ) {
          relayLog.warn(
            { scope: "openai", userId: ctx.userId, callId: functionOutputCallId ?? null },
            "blocked untrusted client tool output",
          );
          return;
        }
        pendingConfirmationCallIds.delete(functionOutputCallId);
      }

      // Client audio frames carry a non-standard `sample_rate` hint because a
      // browser AudioContext may not honor the requested 24kHz rate. The GA
      // API rejects unknown parameters ("Unknown parameter: 'sample_rate'"),
      // so resample to the session's 24kHz PCM here and forward a clean event.
      if (event.type === "input_audio_buffer.append" && typeof event.audio === "string") {
        const rawRate = Number(event.sample_rate ?? event.sampleRate ?? 24000);
        const inputRate = Number.isFinite(rawRate) && rawRate > 0 ? rawRate : 24000;
        const payload = JSON.stringify({
          type: "input_audio_buffer.append",
          audio: resamplePcm16Base64(event.audio, inputRate, 24000),
        });
        if (openaiReady) {
          openaiWs.send(payload);
        } else {
          pendingFromClient.push(payload);
        }
        return;
      }

      // Forward standard Realtime API messages to OpenAI
      if (openaiReady) {
        openaiWs.send(raw);
      } else {
        pendingFromClient.push(raw);
      }
    });

    clientWs.on("close", () => {
      relayLog.info({ scope: "openai", userId: ctx.userId }, "client disconnected");
      if (session.squareOrderId) {
        cancelLiveOrder(session, sessionSquareToken, sessionLocationId).catch(() => {});
      }
      if (openaiWs.readyState === WebSocket.OPEN || openaiWs.readyState === WebSocket.CONNECTING) {
        openaiWs.close();
      }

      // Record voice session minutes in database
      const durationMs = Date.now() - connectionStartMs;
      if (durationMs >= 1000) {
        db.insert(usageEventsTable).values({
          kind: "voice_minutes",
          userId: ctx.userId,
          organizationId: ctx.organizationId,
          agentProfileId: ctx.agentProfileId,
          quantity: Math.ceil(durationMs / 60000),
          occurredAt: new Date(),
          metadata: {
            durationMs,
            provider: ctx.voicePipelineProvider ?? "openai_realtime_server_ws",
            venueId: ctx.venueId || null,
          },
        }).catch((err: any) => {
          relayLog.error({ err: err.message }, "failed to write usage event for closed openai relay session");
        });
      }
    });

    clientWs.on("error", (err) => {
      relayLog.error({ scope: "openai", userId: ctx.userId, err: err.message }, "client websocket error");
      if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
    });
  });

  relayLog.info({ paths: ["/api/realtime", "/api/realtime/gemini"] }, "websocket relay attached");
}

// -- Gemini Live relay (BidiGenerateContent over WebSocket) ---

export function handleGeminiRelay(clientWs: WebSocket, ctx: RelayCtx): void {
  const connectionStartMs = Date.now();
  const apiKey = readServerApiKey("gemini")?.value ?? "";
  if (!apiKey) {
    clientWs.send(JSON.stringify({ type: "error", error: { message: `${requiredApiKeyEnv("gemini")} not configured` } }));
    clientWs.close();
    return;
  }

  const modelId = ctx.geminiModelId ?? "gemini-2.5-flash-native-audio-preview-12-2025";
  const capabilityProfile: "preview_3_1" | "ga_2_5" =
    modelId.includes("3.1-flash-live") ? "preview_3_1" : "ga_2_5";

  let catalog: CatalogItem[] = [];
  let order: OrderItem[] = [];
  const session: LiveSession = { items: [] };
  let sessionSquareToken = ctx.squareToken;
  let sessionLocationId = ctx.squareLocationId;
  const assistantKind: "venue" | "general" = sessionSquareToken ? "venue" : "general";
  const relayTools = buildRelayTools(ctx.plan, assistantKind, ctx.allowedToolNames, ctx.includeGeneralTools);
  let inputLanguageCodes = parseLanguageCodes(ctx.query.languageCodes);
  let proactiveAudio = parseBooleanQuery(ctx.query.proactiveAudio) ?? capabilityProfile === "ga_2_5";
  let affectiveDialog = parseBooleanQuery(ctx.query.affectiveDialog) ?? false;
  let thinkingLevel: "minimal" | "low" | "medium" | "high" =
    parseThinkingLevel(ctx.query.thinkingLevel) ?? "minimal";
  let voiceName = ctx.query.voice || undefined;

  relayLog.info(
    {
      scope: "gemini",
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      venueId: ctx.venueId,
      agentProfileId: ctx.agentProfileId,
      modelId,
      activeTools: relayTools.length,
      totalTools: toolCount(),
    },
    "relay connected",
  );
  const sessionId = ctx.query.sessionId || `gemini-${ctx.userId}-${Date.now()}`;

  const upstreamUrl = (() => {
    try {
      const apiVersion =
        capabilityProfile === "ga_2_5" && (proactiveAudio || affectiveDialog) ? "v1alpha" : "v1beta";
      return buildGeminiLiveUrl(apiVersion);
    } catch (e) {
      relayLog.error(
        { scope: "gemini", userId: ctx.userId, modelId, err: e instanceof Error ? e.message : "url build failed" },
        "upstream URL build failed",
      );
      clientWs.send(JSON.stringify({ type: "error", error: { message: "Voice service is not configured." } }));
      clientWs.close();
      return null;
    }
  })();
  if (!upstreamUrl) return;

  const upstream = new WebSocket(upstreamUrl);
  let upstreamReady = false;
  let setupSent = false;
  // Gemini Live requires the client to wait for the setupComplete ack before
  // sending any other message. Forwarding mic audio in the window between
  // sending setup and receiving the ack can abort the session, so everything
  // from the client is queued until the ack arrives.
  let setupAcked = false;
  let pendingFromClient: string[] = [];
  const pendingConfirmationCallIds = new Set<string>();

  function sendSetup(): void {
    const setup = buildGeminiLiveSetupMessage({
      modelId,
      instructions: buildInstructions(ctx, catalog, order, assistantKind),
      tools: relayTools,
      capabilityProfile,
      inputLanguageCodes,
      proactiveAudio,
      affectiveDialog,
      thinkingLevel,
      voiceName,
      noiseMode: ctx.noiseMode,
    });
    upstream.send(JSON.stringify(setup));
    setupSent = true;
  }

  upstream.on("open", () => {
    relayLog.info({ scope: "gemini", userId: ctx.userId, modelId }, "upstream connected");
    upstreamReady = true;
    sendSetup();
  });

  upstream.on("message", async (data, isBinary) => {
    const raw = isBinary ? data.toString() : data.toString();
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(raw);
      return;
    }

    // Setup ack -- flush any queued client messages.
    if (event.setupComplete !== undefined) {
      relayLog.info(
        { scope: "gemini", userId: ctx.userId, modelId, activeTools: relayTools.length },
        "upstream setup complete",
      );
      setupAcked = true;
      for (const msg of pendingFromClient) upstream.send(msg);
      pendingFromClient = [];
      if (clientWs.readyState === WebSocket.OPEN) {
        for (const message of geminiServerMessagesForRealtimeClient(event, sessionId)) {
          clientWs.send(JSON.stringify(message));
        }
      }
      return;
    }

    // Tool calls -- execute server-side, post results back.
    const toolCall = event.toolCall as
      | { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> }
      | undefined;
    if (toolCall && Array.isArray(toolCall.functionCalls)) {
      const responses: Array<{ id: string; name: string; response: { result?: string; error?: string } }> = [];
      for (const fc of toolCall.functionCalls) {
        const name = String(fc.name ?? "");
        const id = String(fc.id ?? "");
        const args = (fc.args ?? {}) as Record<string, unknown>;
        logToolCall("gemini", ctx, name, args);
        try {
          if (!isRelayToolAllowed(name, relayTools)) {
            throw new Error(`Command not allowed in this assistant: ${name}`);
          }
          const { result, command } = await executeToolCall(
            name,
            args,
            {
              catalog,
              order,
              squareToken: sessionSquareToken,
              squareLocationId: sessionLocationId,
              session,
              requestId: id || undefined,
              userId: ctx.userId,
              userRole: ctx.userRole,
              organizationId: ctx.organizationId,
              venueId: ctx.venueId ?? undefined,
              assistantKind,
              noiseMode: ctx.noiseMode,
            },
          );
          const pendingConfirmation = parsePendingConfirmation(result);
          if (pendingConfirmation && clientWs.readyState === WebSocket.OPEN) {
            if (id) pendingConfirmationCallIds.add(id);
            clientWs.send(JSON.stringify({
              type: "x.pending_confirmation",
              confirmation: pendingConfirmation,
              call_id: id,
            }));
            continue;
          }
          responses.push({ id, name, response: { result } });
          if (command && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "x.order_command", command }));
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "tool call failed";
          relayLog.error({ scope: "gemini", userId: ctx.userId, toolName: name, err: msg }, "relay tool error");
          responses.push({ id, name, response: { error: msg } });
        }
      }
      if (responses.length > 0) {
        upstream.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
      }
      return;
    }

    if (clientWs.readyState === WebSocket.OPEN) {
      for (const message of geminiServerMessagesForRealtimeClient(event, sessionId)) {
        clientWs.send(JSON.stringify(message));
      }
    }
  });

  upstream.on("error", (err) => {
    relayLog.error({ scope: "gemini", userId: ctx.userId, modelId, err: err.message }, "upstream websocket error");
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: "error", error: { message: "Voice service connection failed" } }));
      clientWs.close();
    }
  });

  upstream.on("close", (code, reason) => {
    const providerReason = reason.toString();
    const clientMessage = "Voice service session ended. Please reconnect.";
    const clientCloseCode = code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1011;
    relayLog.info(
      { scope: "gemini", userId: ctx.userId, modelId, code, reasonLength: providerReason.length },
      "upstream websocket closed",
    );
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: "error", error: { message: clientMessage } }));
      clientWs.close(clientCloseCode, clientMessage);
    }
  });

  clientWs.on("message", (data) => {
    const raw = data.toString();
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    // Custom context update from the PWA -- refresh local state and re-send setup.
    if (event.type === "x.context_update") {
      if (Array.isArray(event.catalog)) catalog = event.catalog as CatalogItem[];
      if (Array.isArray(event.order)) order = event.order as OrderItem[];
      if (Array.isArray(event.languageCodes)) inputLanguageCodes = event.languageCodes as string[];
      if (typeof event.proactiveAudio === "boolean") proactiveAudio = event.proactiveAudio;
      if (typeof event.affectiveDialog === "boolean") affectiveDialog = event.affectiveDialog;
      if (
        typeof event.thinkingLevel === "string" &&
        ["minimal", "low", "medium", "high"].includes(event.thinkingLevel)
      ) {
        thinkingLevel = event.thinkingLevel as typeof thinkingLevel;
      }
      if (typeof event.voice === "string") voiceName = event.voice;

      // Before setup is sent the refreshed catalog/order are picked up by
      // sendSetup() itself; afterwards the model needs an explicit context
      // turn. Queue it if the setup ack hasn't arrived yet.
      if (setupSent) {
        const contextMessage = JSON.stringify({
          clientContent: {
            turns: [
              {
                role: "user",
                parts: [
                  {
                    text: `[Updated context]\n${buildInstructions(ctx, catalog, order, assistantKind)}`,
                  },
                ],
              },
            ],
            turnComplete: false,
          },
        });
        if (upstreamReady && setupAcked) upstream.send(contextMessage);
        else pendingFromClient.push(contextMessage);
      }
      return;
    }

    const toolResponseIds = getGeminiToolResponseIds(event);
    if (toolResponseIds) {
      if (!canForwardConfirmedToolOutput(toolResponseIds, pendingConfirmationCallIds)) {
        relayLog.warn(
          { scope: "gemini", userId: ctx.userId, callIds: toolResponseIds },
          "blocked untrusted client tool response",
        );
        return;
      }
      for (const callId of toolResponseIds) pendingConfirmationCallIds.delete(callId);
    }

    const geminiMessage = geminiClientMessageFromRealtimeEvent(event);
    if (!geminiMessage) return;

    if (upstreamReady && setupSent && setupAcked) upstream.send(geminiMessage);
    else pendingFromClient.push(geminiMessage);
  });

  clientWs.on("close", () => {
    relayLog.info({ scope: "gemini", userId: ctx.userId, modelId }, "client disconnected");
    if (session.squareOrderId) {
      cancelLiveOrder(session, sessionSquareToken, sessionLocationId).catch(() => {});
    }
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
    }

    // Record voice session minutes in database
    const durationMs = Date.now() - connectionStartMs;
    if (durationMs >= 1000) {
      db.insert(usageEventsTable).values({
        kind: "voice_minutes",
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        agentProfileId: ctx.agentProfileId,
        quantity: Math.ceil(durationMs / 60000),
        occurredAt: new Date(),
        metadata: {
          durationMs,
          provider: ctx.voicePipelineProvider ?? "google_gemini_live",
          venueId: ctx.venueId || null,
        },
      }).catch((err: any) => {
        relayLog.error({ err: err.message }, "failed to write usage event for closed gemini relay session");
      });
    }
  });

  clientWs.on("error", (err) => {
    relayLog.error({ scope: "gemini", userId: ctx.userId, modelId, err: err.message }, "client websocket error");
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  });
}
