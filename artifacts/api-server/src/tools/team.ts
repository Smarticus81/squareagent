/**
 * Team & Labor tools — list team members, shifts, clock in/out.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import { SQUARE_BASE, squareHeaders } from "../lib/square-helpers";

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

async function listTeam(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.squareToken) return { result: "Square not connected." };
  try {
    const res = await fetch(`${SQUARE_BASE}/team-members/search`, {
      method: "POST",
      headers: squareHeaders(ctx.squareToken),
      body: JSON.stringify({
        query: {
          filter: {
            status: { members: ["ACTIVE"] },
            ...(ctx.squareLocationId ? { location_ids: { any_of: [ctx.squareLocationId] } } : {}),
          },
        },
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    const members = data.team_members ?? [];
    if (members.length === 0) return { result: "No active team members found." };
    const lines = members.map((m: any) => {
      const name = `${m.given_name ?? ""} ${m.family_name ?? ""}`.trim() || "Unnamed";
      return `${name} (${m.id})`;
    });
    return { result: `Team members:\n${lines.join("\n")}` };
  } catch (e: any) {
    return { result: `Failed to list team: ${e.message}` };
  }
}

async function currentShifts(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.squareToken) return { result: "Square not connected." };
  try {
    const res = await fetch(`${SQUARE_BASE}/labor/shifts/search`, {
      method: "POST",
      headers: squareHeaders(ctx.squareToken),
      body: JSON.stringify({
        query: {
          filter: {
            status: "OPEN",
            ...(ctx.squareLocationId ? { location_ids: [ctx.squareLocationId] } : {}),
          },
        },
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    const shifts = data.shifts ?? [];
    if (shifts.length === 0) return { result: "Nobody is currently clocked in." };
    const lines = shifts.map((s: any) => {
      const start = s.start_at ? new Date(s.start_at).toLocaleTimeString() : "?";
      return `${s.team_member_id} — clocked in at ${start} (shift: ${s.id})`;
    });
    return { result: `Currently working:\n${lines.join("\n")}` };
  } catch (e: any) {
    return { result: `Failed to get shifts: ${e.message}` };
  }
}

async function clockIn(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const teamMemberId = String(args.team_member_id ?? "");
  if (!teamMemberId) return { result: "Team member ID is required." };
  if (!ctx.squareToken) return { result: "Square not connected." };
  try {
    const res = await fetch(`${SQUARE_BASE}/labor/shifts`, {
      method: "POST",
      headers: squareHeaders(ctx.squareToken),
      body: JSON.stringify({
        idempotency_key: `clock-in-${teamMemberId}-${Date.now()}`,
        shift: {
          team_member_id: teamMemberId,
          location_id: ctx.squareLocationId,
          start_at: new Date().toISOString(),
        },
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    return { result: `Clocked in ${teamMemberId}. Shift ID: ${data.shift?.id ?? "unknown"}.` };
  } catch (e: any) {
    return { result: `Failed to clock in: ${e.message}` };
  }
}

async function clockOut(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const shiftId = String(args.shift_id ?? "");
  if (!shiftId) return { result: "Shift ID is required." };
  if (!ctx.squareToken) return { result: "Square not connected." };
  try {
    // Get current shift to get version
    const getRes = await fetch(`${SQUARE_BASE}/labor/shifts/${shiftId}`, {
      headers: squareHeaders(ctx.squareToken),
    });
    const getData = (await getRes.json()) as any;
    if (!getRes.ok) return { result: `Shift not found: ${getData.errors?.[0]?.detail ?? "Unknown"}` };

    const shift = getData.shift;
    const res = await fetch(`${SQUARE_BASE}/labor/shifts/${shiftId}`, {
      method: "PUT",
      headers: squareHeaders(ctx.squareToken),
      body: JSON.stringify({
        shift: {
          ...shift,
          end_at: new Date().toISOString(),
          status: "CLOSED",
        },
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    return { result: `Clocked out. Shift ${shiftId} closed.` };
  } catch (e: any) {
    return { result: `Failed to clock out: ${e.message}` };
  }
}

// ── Export executor map ───────────────────────────────────────────────────────

export const executors: Record<string, ToolExecutor> = {
  list_team: listTeam,
  current_shifts: currentShifts,
  clock_in: clockIn,
  clock_out: clockOut,
};
