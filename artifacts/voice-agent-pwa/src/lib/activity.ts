import type { OrderCommand } from "@/contexts/VoiceAgentContext";

/** One line in the surface's quiet ledger of what the assistant just did. */
export interface ActivityEntry {
  id: string;
  text: string;
  at: number;
  tone: "neutral" | "good" | "bad";
}

const MAX_ENTRIES = 4;

let counter = 0;

export function activityFromCommand(cmd: OrderCommand): ActivityEntry | null {
  const qty = cmd.quantity ?? 1;
  const name = cmd.item_name?.trim();
  switch (cmd.action) {
    case "add":
      return entry(name ? `Added ${qty} × ${name}` : `Added ${qty} item${qty === 1 ? "" : "s"}`, "neutral");
    case "remove":
      return entry(name ? `Removed ${qty > 1 ? `${qty} × ` : ""}${name}` : "Removed an item", "neutral");
    case "clear":
      return entry("Cleared the ticket", "neutral");
    case "submit":
      return entry("Sent the ticket to Square", "good");
    default:
      return null;
  }
}

export function entry(text: string, tone: ActivityEntry["tone"] = "neutral"): ActivityEntry {
  counter += 1;
  return { id: `${Date.now()}-${counter}`, text, at: Date.now(), tone };
}

export function pushActivity(list: ActivityEntry[], next: ActivityEntry): ActivityEntry[] {
  return [...list, next].slice(-MAX_ENTRIES);
}

export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 8) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return `${h}h`;
}
