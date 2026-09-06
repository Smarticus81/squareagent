import { pool } from "@workspace/db";
import { structuredModel } from "./openai";
import { recordAutonomousAction, markActionExecuted, markActionFailed, recordBusinessEvent } from "./ledger";
import { executors as emailExecutors } from "../tools/general/email";
import { autonomyEnabled } from "./constitution";

const EMAIL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
  },
} as const;

function customerSuccessEnabled(): boolean {
  return autonomyEnabled() && process.env.AUTONOMY_ENABLE_CUSTOMER_SUCCESS !== "false" && process.env.AUTONOMY_ENABLE_CUSTOMER_SUCCESS !== "0";
}

export async function runActivationInterventions(runId?: string, maxBatch = 15): Promise<{ sent: number; considered: number }> {
  if (!pool || !customerSuccessEnabled()) return { sent: 0, considered: 0 };

  const operatorUserId = Number(process.env.AUTONOMY_OPERATOR_USER_ID);
  const operatorOrgId = process.env.AUTONOMY_OPERATOR_ORG_ID?.trim() || null;
  if (!Number.isInteger(operatorUserId) || operatorUserId <= 0) return { sent: 0, considered: 0 };

  const candidates = await pool.query(
    `SELECT
       s.user_id,
       s.organization_id,
       s.trial_ends_at,
       s.created_at AS subscription_created_at,
       u.email,
       u.name,
       EXISTS (
         SELECT 1 FROM venues v
         WHERE (s.organization_id IS NOT NULL AND v.organization_id=s.organization_id)
            OR (s.organization_id IS NULL AND v.user_id=s.user_id)
           AND v.connected_at IS NOT NULL
       ) AS square_connected,
       CASE WHEN s.organization_id IS NULL THEN 0 ELSE (
         SELECT COUNT(*)::int FROM agent_profiles ap WHERE ap.organization_id=s.organization_id
       ) END AS assistants,
       (
         SELECT COUNT(*)::int FROM voice_sessions vs
         WHERE (s.organization_id IS NOT NULL AND vs.organization_id=s.organization_id)
            OR (s.organization_id IS NULL AND vs.user_id=s.user_id)
       ) AS voice_sessions,
       (
         SELECT COUNT(*)::int FROM tool_calls tc
         WHERE ((s.organization_id IS NOT NULL AND tc.organization_id=s.organization_id)
            OR (s.organization_id IS NULL AND tc.user_id=s.user_id))
           AND tc.status NOT IN ('error','failed')
           AND tc.error_message IS NULL
       ) AS successful_tools
     FROM subscriptions s
     JOIN users u ON u.id=s.user_id
     WHERE (s.plan='trial' OR s.status='trialing')
       AND s.created_at <= now() - interval '6 hours'
     ORDER BY s.trial_ends_at ASC NULLS LAST, s.created_at ASC
     LIMIT $1`,
    [Math.max(1, Math.min(50, maxBatch * 3))],
  );

  let sent = 0;
  let considered = 0;
  for (const row of candidates.rows) {
    if (sent >= maxBatch) break;
    considered += 1;

    const recent = await pool.query(
      `SELECT 1 FROM business_events
       WHERE event_type='lifecycle_email_sent'
         AND properties->>'userId'=$1
         AND occurred_at >= now()-interval '72 hours'
       LIMIT 1`,
      [String(row.user_id)],
    );
    if (recent.rowCount) continue;

    const trialEndsAt = row.trial_ends_at ? new Date(row.trial_ends_at) : null;
    const hoursToTrialEnd = trialEndsAt ? (trialEndsAt.getTime() - Date.now()) / 3_600_000 : null;
    let intervention: "connect_square" | "create_assistant" | "first_value" | "convert" | null = null;
    if (!row.square_connected) intervention = "connect_square";
    else if (Number(row.assistants ?? 0) < 1) intervention = "create_assistant";
    else if (Number(row.successful_tools ?? 0) < 3) intervention = "first_value";
    else if (hoursToTrialEnd !== null && hoursToTrialEnd <= 72) intervention = "convert";
    if (!intervention) continue;

    const copy = await structuredModel<{ subject: string; body: string }>(
      [
        "You are VoyceLab customer success. Write a concise, helpful lifecycle email based only on the supplied account state.",
        "Do not invent usage, savings, customer results, urgency, or capabilities. Never shame the user. The goal is to help them reach value in the product.",
        "For connect_square: explain that connecting Square unlocks real venue actions and invite them back to continue setup.",
        "For create_assistant: explain that the next step is creating their venue assistant and choosing allowed actions/voice settings.",
        "For first_value: suggest one or two simple real commands such as checking sales/reporting or inventory based on available skills, and invite them to try the assistant.",
        "For convert: acknowledge actual successful use and explain that a paid plan keeps the assistant active; do not fabricate a discount.",
        "Plain text, under 130 words, one CTA.",
      ].join("\n"),
      {
        name: row.name,
        intervention,
        squareConnected: Boolean(row.square_connected),
        assistants: Number(row.assistants ?? 0),
        voiceSessions: Number(row.voice_sessions ?? 0),
        successfulTools: Number(row.successful_tools ?? 0),
        hoursToTrialEnd: hoursToTrialEnd === null ? null : Math.round(hoursToTrialEnd),
      },
      { schemaName: "voycelab_activation_email", schema: EMAIL_SCHEMA as unknown as Record<string, unknown>, reasoningEffort: "low", maxOutputTokens: 700 },
    );

    const action = await recordAutonomousAction({
      runId,
      agent: "customer-success",
      actionType: "activation.lifecycle_email",
      riskLevel: "low",
      input: { userId: row.user_id, intervention, subject: copy.subject },
      expectedImpact: { metric: intervention === "convert" ? "activation_to_paid" : "activation_rate" },
    });
    try {
      const executor = emailExecutors.send_email;
      if (!executor) throw new Error("send_email executor is unavailable");
      const result = await executor(
        { to: String(row.email), subject: copy.subject, body: copy.body },
        { userId: operatorUserId, organizationId: operatorOrgId } as any,
      );
      if (/failed|error|missing|limit|rejected/i.test(result.result)) throw new Error(result.result);
      await recordBusinessEvent({
        organizationId: row.organization_id,
        userId: row.user_id,
        eventType: "lifecycle_email_sent",
        actorType: "agent",
        actorId: "customer-success",
        properties: { userId: row.user_id, intervention },
      });
      await markActionExecuted(action.id, { providerResult: result.result });
      sent += 1;
    } catch (error) {
      await markActionFailed(action.id, { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { sent, considered };
}
