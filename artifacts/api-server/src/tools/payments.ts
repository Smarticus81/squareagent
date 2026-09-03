/**
 * Payment tools — list payments, refund, void.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import { idempotencyKey, squareErrorMessage } from "../lib/square-helpers";
import { squareFromCtx, idempotencySeed, venueTimeZone, NOT_CONNECTED, money } from "./_square";
import { formatLocalDateTime } from "../lib/venue-time";

// ── Definitions ───────────────────────────────────────────────────────────────

export const definitions: ToolDefinition[] = [
  {
    type: "function",
    name: "list_payments",
    description: "List recent payments with amounts and status",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Number of payments to show (default 10)", default: 10 },
      },
    },
  },
  {
    type: "function",
    name: "refund_payment",
    description: "Refund a payment — full or partial amount",
    parameters: {
      type: "object",
      properties: {
        payment_id: { type: "string", description: "Square payment ID to refund" },
        amount: { type: "number", description: "Amount to refund in USD. Omit for full refund." },
        reason: { type: "string", description: "Reason for the refund", default: "Requested by staff" },
      },
      required: ["payment_id"],
    },
  },
  {
    type: "function",
    name: "cancel_payment",
    description: "Cancel a payment that hasn't been completed yet",
    parameters: {
      type: "object",
      properties: {
        payment_id: { type: "string", description: "Square payment ID to cancel" },
      },
      required: ["payment_id"],
    },
  },
];

// ── Executors ─────────────────────────────────────────────────────────────────

async function listPayments(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const limit = Math.min(Math.max(1, Number(args.limit ?? 10) || 10), 100);
  const [res, tz] = await Promise.all([
    client.get(`/payments?location_id=${encodeURIComponent(client.locationId)}&sort_order=DESC&limit=${limit}`),
    venueTimeZone(client),
  ]);
  if (!res.ok) return { result: `Failed: ${squareErrorMessage(res.error)}` };
  const payments: any[] = res.data?.payments ?? [];
  if (payments.length === 0) return { result: "No recent payments found." };
  const lines = payments.map((p) => {
    const status = p.status ?? "UNKNOWN";
    const source = p.source_type ?? "UNKNOWN";
    return `${formatLocalDateTime(p.created_at, tz)} - ${money(p.amount_money?.amount)} (${status}, ${source}) [${String(p.id).slice(0, 12)}...]`;
  });
  return { result: `Recent payments:\n${lines.join("\n")}` };
}

async function refundPayment(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const paymentId = String(args.payment_id ?? "").trim();
  if (!paymentId) return { result: "Payment ID is required." };
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const reason = String(args.reason ?? "Requested by staff");

  // Always read the payment: it gives the full amount for a full refund and
  // the currency for a partial one, and blocks over-refunds up front.
  const payRes = await client.get(`/payments/${encodeURIComponent(paymentId)}`);
  if (!payRes.ok) return { result: `Payment not found: ${squareErrorMessage(payRes.error)}` };
  const payment = payRes.data.payment;
  const paidCents: number = payment?.amount_money?.amount ?? 0;
  const currency: string = payment?.amount_money?.currency ?? "USD";
  const amountCents = args.amount !== undefined ? Math.round(Number(args.amount) * 100) : paidCents;
  if (!(amountCents > 0)) return { result: "Refund amount must be positive." };
  if (amountCents > paidCents) return { result: `Refund can't exceed the ${money(paidCents)} paid.` };

  const res = await client.post("/refunds", {
    idempotency_key: idempotencyKey("ref", idempotencySeed(ctx, "ref") ?? `${paymentId}-${amountCents}`),
    payment_id: paymentId,
    amount_money: { amount: amountCents, currency },
    reason,
  });
  if (!res.ok) return { result: `Refund failed: ${squareErrorMessage(res.error)}` };
  return { result: `Refunded ${money(amountCents)} for payment ${paymentId.slice(0, 12)}. Refund ID: ${res.data.refund?.id ?? "unknown"}.` };
}

async function cancelPayment(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const paymentId = String(args.payment_id ?? "").trim();
  if (!paymentId) return { result: "Payment ID is required." };
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const res = await client.post(`/payments/${encodeURIComponent(paymentId)}/cancel`);
  if (!res.ok) return { result: `Cancel failed: ${squareErrorMessage(res.error)}` };
  return { result: `Payment ${paymentId.slice(0, 12)} canceled.` };
}

export const executors: Record<string, ToolExecutor> = {
  list_payments: listPayments,
  refund_payment: refundPayment,
  cancel_payment: cancelPayment,
};
