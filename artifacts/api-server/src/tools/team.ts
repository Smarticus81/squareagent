/**
 * Team & Labor tools — list team members, shifts, clock in/out.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import { idempotencyKey, squareErrorMessage } from "../lib/square-helpers";
import { squareFromCtx, idempotencySeed, venueTimeZone, NOT_CONNECTED } from "./_square";
import { formatLocalTime } from "../lib/venue-time";

// ── Definitions ───────────────────────────────────────────────────────────────

export const definitions: ToolDefinition[] = [
  {
    type: "function",
    name: "list_team",
    description: "List all active team members at this location",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "current_shifts",
    description: "See who is currently clocked in and working",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "clock_in",
    description: "Clock in a team member to start their shift",
    parameters: {
      type: "object",
      properties: {
        team_member_id: { type: "string", description: "Square team member ID" },
      },
      required: ["team_member_id"],
    },
  },
  {
    type: "function",
    name: "clock_out",
    description: "Clock out a team member to end their shift",
    parameters: {
      type: "object",
      properties: {
        shift_id: { type: "string", description: "Square shift ID to end" },
      },
      required: ["shift_id"],
    },
  },
];

// ── Executors ─────────────────────────────────────────────────────────────────

function memberName(m: any): string {
  return `${m?.given_name ?? ""} ${m?.family_name ?? ""}`.trim() || "Unnamed";
}

const ACTIVE_MEMBERS_QUERY = (locationId: string) => ({
  query: { filter: { status: "ACTIVE", location_ids: [locationId] } },
  limit: 200,
});

async function listTeam(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const res = await client.postAllPages(
    "/team-members/search",
    ACTIVE_MEMBERS_QUERY(client.locationId),
    (page: { team_members?: any[] }) => page.team_members ?? [],
    500,
  );
  if (!res.ok) return { result: `Failed: ${squareErrorMessage(res.error)}` };
  if (res.items.length === 0) return { result: "No active team members found." };
  const lines = res.items.map((m: any) => `${memberName(m)} (${m.id})`);
  return { result: `Team members:\n${lines.join("\n")}` };
}

async function currentShifts(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const [shiftsRes, membersRes, tz] = await Promise.all([
    client.post("/labor/shifts/search", { query: { filter: { status: "OPEN", location_ids: [client.locationId] } }, limit: 200 }),
    client.post("/team-members/search", ACTIVE_MEMBERS_QUERY(client.locationId)),
    venueTimeZone(client),
  ]);
  if (!shiftsRes.ok) return { result: `Failed: ${squareErrorMessage(shiftsRes.error)}` };
  const shifts: any[] = shiftsRes.data?.shifts ?? [];
  if (shifts.length === 0) return { result: "Nobody is currently clocked in." };
  const names = new Map<string, string>();
  for (const m of membersRes.ok ? membersRes.data?.team_members ?? [] : []) names.set(m.id, memberName(m));
  const lines = shifts.map((s) => {
    const who = names.get(s.team_member_id) ?? s.team_member_id;
    return `${who} - clocked in at ${formatLocalTime(s.start_at, tz)} (shift: ${s.id})`;
  });
  return { result: `Currently working:\n${lines.join("\n")}` };
}

async function clockIn(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const teamMemberId = String(args.team_member_id ?? "").trim();
  if (!teamMemberId) return { result: "Team member ID is required." };
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const res = await client.post("/labor/shifts", {
    idempotency_key: idempotencyKey("cin", idempotencySeed(ctx, "cin") ?? `${teamMemberId}-${Date.now()}`),
    shift: { team_member_id: teamMemberId, location_id: client.locationId, start_at: new Date().toISOString() },
  });
  if (!res.ok) return { result: `Failed: ${squareErrorMessage(res.error)}` };
  return { result: `Clocked in ${teamMemberId}. Shift ID: ${res.data.shift?.id ?? "unknown"}.` };
}

async function clockOut(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const shiftId = String(args.shift_id ?? "").trim();
  if (!shiftId) return { result: "Shift ID is required." };
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  // Square requires the current version for an update.
  const current = await client.get(`/labor/shifts/${encodeURIComponent(shiftId)}`);
  if (!current.ok) return { result: `Shift not found: ${squareErrorMessage(current.error)}` };
  const shift = current.data.shift;
  if (shift?.status === "CLOSED") return { result: `Shift ${shiftId} is already closed.` };
  const res = await client.put(`/labor/shifts/${encodeURIComponent(shiftId)}`, {
    shift: { ...shift, end_at: new Date().toISOString(), status: "CLOSED" },
  });
  if (!res.ok) return { result: `Failed: ${squareErrorMessage(res.error)}` };
  return { result: `Clocked out. Shift ${shiftId} closed.` };
}

export const executors: Record<string, ToolExecutor> = {
  list_team: listTeam,
  current_shifts: currentShifts,
  clock_in: clockIn,
  clock_out: clockOut,
};
