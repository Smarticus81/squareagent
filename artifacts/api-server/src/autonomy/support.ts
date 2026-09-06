import { readFile } from "fs/promises";
import path from "path";
import { pool } from "@workspace/db";
import { autonomyEnabled } from "./constitution";
import { structuredModel } from "./openai";
import { recordAutonomousAction, markActionExecuted, markActionFailed, recordBusinessEvent } from "./ledger";
import { optOutLead } from "./growth";
import { executors as inboxExecutors } from "../tools/general/email-read";
import { executors as emailExecutors } from "../tools/general/email";

const TRIAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "severity", "canAutoRespond", "summary", "response"],
  properties: {
    intent: { type: "string", enum: ["support", "sales", "opt_out", "billing", "security", "legal", "data_loss", "other"] },
    severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
    canAutoRespond: { type: "boolean" },
    summary: { type: "string" },
    response: { type: "string" },
  },
} as const;

function supportEnabled(): boolean {
  return autonomyEnabled() && process.env.AUTONOMY_ENABLE_SUPPORT !== "false" && process.env.AUTONOMY_ENABLE_SUPPORT !== "0";
}

function senderEmail(from: string): string | null {
  const angled = from.match(/<([^>]+@[^>]+)>/);
  const plain = from.match(/\b[^\s<>]+@[^\s<>]+\.[^\s<>]+\b/);
  return (angled?.[1] ?? plain?.[0] ?? "").trim().toLowerCase() || null;
}

async function productContext(): Promise<string> {
  try {
    const file = await readFile(path.resolve(process.cwd(), "CAPABILITIES.md"), "utf8");
    return file.slice(0, 28_000);
  } catch {
    return "VoyceLab is a voice-powered hospitality operations platform with connected POS, reporting, inventory, catalog, customers/payments, team/labor, email, knowledge and workflow capabilities according to the customer's plan and configured services.";
  }
}

async function accountContext(email: string): Promise<Record<string, unknown>> {
  if (!pool) return {};
  const userResult = await pool.query(`SELECT id, name FROM users WHERE lower(email)=lower($1) LIMIT 1`, [email]);
  const user = userResult.rows[0];
  if (!user) return { knownCustomer: false };
  const sub = await pool.query(
    `SELECT plan,status,trial_ends_at,current_period_end,organization_id FROM subscriptions WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1`,
    [user.id],
  );
  const subscription = sub.rows[0] ?? null;
  const orgId = subscription?.organization_id ?? null;
  const [venues, failures] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS count, COUNT(*) FILTER (WHERE connected_at IS NOT NULL)::int AS connected
       FROM venues WHERE user_id=$1 OR ($2::uuid IS NOT NULL AND organization_id=$2::uuid)`,
      [user.id, orgId],
    ),
    pool.query(
      `SELECT tool_name, COUNT(*)::int AS failures
       FROM tool_calls
       WHERE ((user_id=$1) OR ($2::uuid IS NOT NULL AND organization_id=$2::uuid))
         AND created_at >= now()-interval '7 days'
         AND (status IN ('error','failed') OR error_message IS NOT NULL)
       GROUP BY tool_name ORDER BY failures DESC LIMIT 5`,
      [user.id, orgId],
    ),
  ]);
  return {
    knownCustomer: true,
    userId: user.id,
    name: user.name,
    subscription: subscription ? { plan: subscription.plan, status: subscription.status, trialEndsAt: subscription.trial_ends_at, currentPeriodEnd: subscription.current_period_end } : null,
    venues: venues.rows[0] ?? {},
    recentFailingTools: failures.rows,
  };
}

export async function runSupportInbox(runId?: string, maxMessages = 6): Promise<{ inspected: number; responded: number; escalated: number }> {
  if (!supportEnabled()) return { inspected: 0, responded: 0, escalated: 0 };
  const operatorUserId = Number(process.env.AUTONOMY_OPERATOR_USER_ID);
  const operatorOrgId = process.env.AUTONOMY_OPERATOR_ORG_ID?.trim() || null;
  if (!Number.isInteger(operatorUserId) || operatorUserId <= 0) return { inspected: 0, responded: 0, escalated: 0 };

  const ctx = { userId: operatorUserId, organizationId: operatorOrgId } as any;
  const list = inboxExecutors.list_inbox;
  const read = inboxExecutors.read_email;
  const markRead = inboxExecutors.mark_email_read;
  const send = emailExecutors.send_email;
  if (!list || !read || !markRead || !send) throw new Error("Email support executors are unavailable");

  const query = process.env.AUTONOMY_SUPPORT_GMAIL_QUERY?.trim() || "in:inbox is:unread newer_than:7d";
  const listed = await list({ query, max_results: Math.max(1, Math.min(20, maxMessages)) }, ctx);
  let parsed: any;
  try { parsed = JSON.parse(listed.result); } catch { return { inspected: 0, responded: 0, escalated: 0 }; }
  const messages = Array.isArray(parsed?.messages) ? parsed.messages.slice(0, maxMessages) : [];
  let inspected = 0;
  let responded = 0;
  let escalated = 0;
  const capabilities = await productContext();

  for (const metadata of messages) {
    const id = String(metadata.id ?? "");
    if (!id) continue;
    const full = await read({ id }, ctx);
    let message: any;
    try { message = JSON.parse(full.result); } catch { continue; }
    inspected += 1;
    const email = senderEmail(String(message.from ?? ""));
    if (!email) continue;

    const acct = await accountContext(email);
    await recordBusinessEvent({
      userId: typeof acct.userId === "number" ? acct.userId : null,
      eventType: "support_opened",
      actorType: "customer",
      properties: { gmailMessageId: id, fromDomain: email.split("@")[1], knownCustomer: acct.knownCustomer === true },
      dedupeKey: `support-opened:${id}`,
    });

    const triage = await structuredModel<{
      intent: "support" | "sales" | "opt_out" | "billing" | "security" | "legal" | "data_loss" | "other";
      severity: "low" | "medium" | "high" | "critical";
      canAutoRespond: boolean;
      summary: string;
      response: string;
    }>(
      [
        "You are VoyceLab customer support. Triage the incoming email and, only when safe, write the reply.",
        "Use only the supplied product and account context. Never invent account actions, refunds, credits, incident causes, timelines, customer data, or capabilities.",
        "Set canAutoRespond=false for security issues, legal threats, suspected data loss, billing disputes/refund requests, account ownership disputes, or anything requiring an irreversible/account-changing action.",
        "Routine how-to, setup, known product behavior, basic troubleshooting, and sales questions may be auto-responded when the context is sufficient.",
        "For opt_out, response should simply acknowledge no further outreach. For escalated cases, response should acknowledge receipt without promising a resolution time.",
        "Keep the response concise and professional.",
      ].join("\n"),
      { message: { from: message.from, subject: message.subject, body: message.body }, account: acct, productContext: capabilities },
      { schemaName: "voycelab_support_triage", schema: TRIAGE_SCHEMA as unknown as Record<string, unknown>, reasoningEffort: "medium", maxOutputTokens: 1500 },
    );

    if (triage.intent === "opt_out") {
      if (pool) {
        const lead = await pool.query<{ id: string }>(`SELECT id FROM prospect_leads WHERE lower(contact_email)=lower($1) LIMIT 1`, [email]);
        if (lead.rows[0]?.id) await optOutLead(lead.rows[0].id, "email_reply_opt_out");
      }
    }

    const risk = triage.severity === "critical" ? "critical" : triage.severity === "high" ? "high" : triage.severity === "medium" ? "medium" : "low";
    const action = await recordAutonomousAction({
      runId,
      agent: "support",
      actionType: triage.canAutoRespond ? "support.respond" : "support.escalate",
      riskLevel: risk,
      input: { gmailMessageId: id, intent: triage.intent, summary: triage.summary },
      expectedImpact: { metric: "support_resolution_and_customer_trust" },
    });

    if (triage.canAutoRespond && action.authority !== "founder" && action.authority !== "forbidden") {
      try {
        const result = await send({ to: email, subject: `Re: ${String(message.subject ?? "VoyceLab support")}`, body: triage.response }, ctx);
        if (/failed|error|missing|limit|rejected/i.test(result.result)) throw new Error(result.result);
        await markRead({ id }, ctx);
        await recordBusinessEvent({
          userId: typeof acct.userId === "number" ? acct.userId : null,
          eventType: "support_resolved",
          actorType: "agent",
          actorId: "support",
          properties: { gmailMessageId: id, intent: triage.intent },
          dedupeKey: `support-resolved:${id}`,
        });
        await markActionExecuted(action.id, { providerResult: result.result });
        responded += 1;
      } catch (error) {
        await markActionFailed(action.id, { error: error instanceof Error ? error.message : String(error) });
        escalated += 1;
      }
    } else {
      await recordBusinessEvent({
        userId: typeof acct.userId === "number" ? acct.userId : null,
        eventType: "support_escalated",
        actorType: "agent",
        actorId: "support",
        properties: { gmailMessageId: id, intent: triage.intent, severity: triage.severity, summary: triage.summary },
        dedupeKey: `support-escalated:${id}`,
      });
      escalated += 1;
    }
  }
  return { inspected, responded, escalated };
}
