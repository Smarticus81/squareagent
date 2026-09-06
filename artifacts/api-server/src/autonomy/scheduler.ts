import { autonomyEnabled } from "./constitution";
import { runAutonomyCycleLocked } from "./orchestrator";
import { runSalesInbox } from "./sales";
import { runSupportInbox } from "./support";
import { runActivationInterventions } from "./activation";
import { reconcileOutboundSubscriptionAttribution } from "./marketing";
import { evaluateMergedProductRepairs, promoteReadyProductRepairs } from "./promotion";
import { evaluateExperiments } from "./experiments";

const intervalTimers: NodeJS.Timeout[] = [];
const timeoutTimers: NodeJS.Timeout[] = [];
let inboxRunning = false;
let activationRunning = false;
let promotionRunning = false;
let strategyRunning = false;

function intervalMs(env: string, fallbackMinutes: number): number {
  const minutes = Number(process.env[env] ?? fallbackMinutes);
  return Math.max(1, Number.isFinite(minutes) ? minutes : fallbackMinutes) * 60_000;
}

function schedule(fn: () => Promise<void>, ms: number): void {
  const timer = setInterval(() => { void fn(); }, ms);
  timer.unref?.();
  intervalTimers.push(timer);
}

function scheduleOnce(fn: () => Promise<void>, ms: number): void {
  const timer = setTimeout(() => { void fn(); }, ms);
  timer.unref?.();
  timeoutTimers.push(timer);
}

export function startAutonomyScheduler(): void {
  if (!autonomyEnabled() || intervalTimers.length || timeoutTimers.length) return;

  const strategyInterval = intervalMs("AUTONOMY_STRATEGY_INTERVAL_MINUTES", 360);
  const inboxInterval = intervalMs("AUTONOMY_INBOX_INTERVAL_MINUTES", 10);
  const activationInterval = intervalMs("AUTONOMY_ACTIVATION_INTERVAL_MINUTES", 60);
  const promotionInterval = intervalMs("AUTONOMY_PROMOTION_INTERVAL_MINUTES", 10);

  const strategy = async () => {
    if (strategyRunning) {
      console.warn("[autonomy] strategy cycle skipped: previous cycle still running");
      return;
    }
    strategyRunning = true;
    const startedAt = Date.now();
    console.log("[autonomy] strategy cycle started", { trigger: "scheduler", startedAt: new Date(startedAt).toISOString() });
    try {
      const result = await runAutonomyCycleLocked("scheduler");
      console.log("[autonomy] strategy cycle completed", {
        trigger: "scheduler",
        durationMs: Date.now() - startedAt,
        completedAt: new Date().toISOString(),
        result: result ?? null,
      });
    } catch (error) {
      console.error("[autonomy] strategy cycle failed", {
        trigger: "scheduler",
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : error,
      });
    } finally {
      strategyRunning = false;
    }
  };
  const inbox = async () => {
    if (inboxRunning) return;
    inboxRunning = true;
    try {
      await runSalesInbox(undefined, 8);
      await runSupportInbox(undefined, 6);
    } catch (error) { console.error("[autonomy] sales/support inbox loop failed", error instanceof Error ? error.message : error); }
    finally { inboxRunning = false; }
  };
  const activation = async () => {
    if (activationRunning) return;
    activationRunning = true;
    try { await runActivationInterventions(undefined, 15); }
    catch (error) { console.error("[autonomy] activation loop failed", error instanceof Error ? error.message : error); }
    finally { activationRunning = false; }
  };
  const promotion = async () => {
    if (promotionRunning) return;
    promotionRunning = true;
    try {
      await promoteReadyProductRepairs();
      await evaluateMergedProductRepairs();
      await reconcileOutboundSubscriptionAttribution();
      await evaluateExperiments();
    } catch (error) { console.error("[autonomy] evaluator/promotion loop failed", error instanceof Error ? error.message : error); }
    finally { promotionRunning = false; }
  };

  schedule(strategy, strategyInterval);
  schedule(inbox, inboxInterval);
  schedule(activation, activationInterval);
  schedule(promotion, promotionInterval);

  scheduleOnce(promotion, 20_000);
  scheduleOnce(inbox, 35_000);
  scheduleOnce(strategy, 60_000);
  console.log("[autonomy] scheduler started", {
    firstStrategyAt: new Date(Date.now() + 60_000).toISOString(),
    strategyIntervalMinutes: strategyInterval / 60_000,
    inboxIntervalMinutes: inboxInterval / 60_000,
    activationIntervalMinutes: activationInterval / 60_000,
    promotionIntervalMinutes: promotionInterval / 60_000,
  });
}

export function stopAutonomyScheduler(): void {
  while (intervalTimers.length) clearInterval(intervalTimers.pop());
  while (timeoutTimers.length) clearTimeout(timeoutTimers.pop());
}
