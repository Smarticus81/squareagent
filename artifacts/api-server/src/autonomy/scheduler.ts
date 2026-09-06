import { autonomyEnabled } from "./constitution";
import { runAutonomyCycleLocked } from "./orchestrator";
import { runSupportInbox } from "./support";
import { runActivationInterventions } from "./activation";
import { evaluateMergedProductRepairs, promoteReadyProductRepairs } from "./promotion";
import { evaluateExperiments } from "./experiments";

const timers: NodeJS.Timeout[] = [];
let supportRunning = false;
let activationRunning = false;
let promotionRunning = false;

function intervalMs(env: string, fallbackMinutes: number): number {
  const minutes = Number(process.env[env] ?? fallbackMinutes);
  return Math.max(1, Number.isFinite(minutes) ? minutes : fallbackMinutes) * 60_000;
}

function schedule(fn: () => Promise<void>, ms: number): void {
  const timer = setInterval(() => { void fn(); }, ms);
  timer.unref?.();
  timers.push(timer);
}

export function startAutonomyScheduler(): void {
  if (!autonomyEnabled() || timers.length) return;

  const strategy = async () => {
    try { await runAutonomyCycleLocked("scheduler"); }
    catch (error) { console.error("[autonomy] strategy cycle failed", error instanceof Error ? error.message : error); }
  };
  const support = async () => {
    if (supportRunning) return;
    supportRunning = true;
    try { await runSupportInbox(undefined, 6); }
    catch (error) { console.error("[autonomy] support loop failed", error instanceof Error ? error.message : error); }
    finally { supportRunning = false; }
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
      await evaluateExperiments();
    } catch (error) { console.error("[autonomy] evaluator/promotion loop failed", error instanceof Error ? error.message : error); }
    finally { promotionRunning = false; }
  };

  schedule(strategy, intervalMs("AUTONOMY_STRATEGY_INTERVAL_MINUTES", 360));
  schedule(support, intervalMs("AUTONOMY_SUPPORT_INTERVAL_MINUTES", 15));
  schedule(activation, intervalMs("AUTONOMY_ACTIVATION_INTERVAL_MINUTES", 60));
  schedule(promotion, intervalMs("AUTONOMY_PROMOTION_INTERVAL_MINUTES", 10));

  // Warm-start the evaluator shortly after boot; defer the expensive strategy
  // pass so deploy startup/readiness remains fast.
  const warm = setTimeout(() => { void promotion(); }, 20_000);
  warm.unref?.();
  timers.push(warm as unknown as NodeJS.Timeout);
  console.log("[autonomy] scheduler started");
}

export function stopAutonomyScheduler(): void {
  while (timers.length) clearInterval(timers.pop());
}
