/**
 * Payment tools — list payments, refund, void.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import { SQUARE_BASE, squareHeaders } from "../lib/square-helpers";

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
  if (!ctx.squareToken || !ctx.squareLocationId) return { result: "Square not connected." };
  const limit = Number(args.limit ?? 10);
  try {
    const res = await fetch(
      `${SQUARE_BASE}/payments?location_id=${ctx.squareLocationId}&sort_order=DESC&limit=${limit}`,
      { headers: squareHeaders(ctx.squareToken) },
    );
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    const payments = data.payments ?? [];
    if (payments.length === 0) return { result: "No recent payments found." };
    const lines = payments.map((p: any) => {
      const amount = ((p.amount_money?.amount ?? 0) / 100).toFixed(2);
      const status = p.status ?? "UNKNOWN";
      const date = p.created_at ? new Date(p.created_at).toLocaleString() : "?";
      const source = p.source_type ?? "UNKNOWN";
      return `${date} — $${amount} (${status}, ${source}) [${p.id.slice(0, 12)}...]`;
    });
    return { result: `Recent payments:\n${lines.join("\n")}` };
  } catch (e: any) {
    return { result: `Failed to list payments: ${e.message}` };
  }
}

async function refundPayment(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const paymentId = String(args.payment_id ?? "");
  if (!paymentId) return { result: "Payment ID is required." };
  if (!ctx.squareToken) return { result: "Square not connected." };
  const reason = String(args.reason ?? "Requested by staff");

  try {
    // If no amount specified, get payment details for full refund
    let amountCents: number;
    if (args.amount !== undefined) {
      amountCents = Math.round(Number(args.amount) * 100);
    } else {
      const payRes = await fetch(`${SQUARE_BASE}/payments/${paymentId}`, {
        headers: squareHeaders(ctx.squareToken),
      });
      const payData = (await payRes.json()) as any;
      if (!payRes.ok) return { result: `Payment not found: ${payData.errors?.[0]?.detail ?? "Unknown"}` };
      amountCents = payData.payment?.amount_money?.amount ?? 0;
    }

    const res = await fetch(`${SQUARE_BASE}/refunds`, {
      method: "POST",
      headers: squareHeaders(ctx.squareToken),
      body: JSON.stringify({
        idempotency_key: `refund-${paymentId}-${Date.now()}`,
        payment_id: paymentId,
        amount_money: { amount: amountCents, currency: "USD" },
        reason,
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Refund failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    const refundAmount = (amountCents / 100).toFixed(2);
    return { result: `Refunded $${refundAmount} for payment ${paymentId.slice(0, 12)}. Refund ID: ${data.refund?.id ?? "unknown"}.` };
  } catch (e: any) {
    return { result: `Failed to refund: ${e.message}` };
  }
}

async function cancelPayment(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const paymentId = String(args.payment_id ?? "");
  if (!paymentId) return { result: "Payment ID is required." };
  if (!ctx.squareToken) return { result: "Square not connected." };
  try {
    const res = await fetch(`${SQUARE_BASE}/payments/${paymentId}/cancel`, {
      method: "POST",
      headers: squareHeaders(ctx.squareToken),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Cancel failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    return { result: `Payment ${paymentId.slice(0, 12)} canceled.` };
  } catch (e: any) {
    return { result: `Failed to cancel payment: ${e.message}` };
  }
}

// ── Export executor map ───────────────────────────────────────────────────────

export const executors: Record<string, ToolExecutor> = {
  list_payments: listPayments,
  refund_payment: refundPayment,
  cancel_payment: cancelPayment,
};
