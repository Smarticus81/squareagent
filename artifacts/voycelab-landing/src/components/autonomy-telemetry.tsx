import { useEffect } from "react";
import { useLocation } from "wouter";

const VISITOR_KEY = "voycelab_visitor_id";
const SESSION_KEY = "voycelab_session_id";
const ATTRIBUTION_KEY = "voycelab_campaign_attribution";

type Attribution = { source: string | null; campaign: string | null; variant: string | null };

function id(storage: Storage, key: string): string {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const created = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  storage.setItem(key, created);
  return created;
}

function attribution(): Attribution {
  const params = new URLSearchParams(window.location.search);
  const direct: Attribution = {
    source: params.get("utm_source") || null,
    campaign: params.get("utm_campaign") || null,
    variant: params.get("utm_content") || null,
  };
  if (direct.source || direct.campaign || direct.variant) {
    sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(direct));
    return direct;
  }
  try {
    const persisted = JSON.parse(sessionStorage.getItem(ATTRIBUTION_KEY) || "null") as Attribution | null;
    if (persisted) return persisted;
  } catch { /* ignore malformed session attribution */ }
  return { source: document.referrer || null, campaign: null, variant: null };
}

export function trackBusinessEvent(eventType: string, properties: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const visitorId = id(localStorage, VISITOR_KEY);
  const sessionId = id(sessionStorage, SESSION_KEY);
  const { source, campaign, variant } = attribution();
  const payload = JSON.stringify({ visitorId, sessionId, eventType, source, campaign, variant, properties });
  void fetch("/api/v1/autonomy/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}

export function AutonomyTelemetry() {
  const [location] = useLocation();

  useEffect(() => {
    trackBusinessEvent("visitor_seen", { path: location });
  }, [location]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest("a,button") : null;
      if (!element) return;
      const anchor = element instanceof HTMLAnchorElement ? element : null;
      const href = anchor?.getAttribute("href") ?? "";
      const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
      if (/\/signup|\/pricing/.test(href) || /start free|pricing|pick pro|pick business/i.test(text)) {
        trackBusinessEvent("cta_clicked", { path: window.location.pathname, href, label: text });
      }
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
  }, []);

  return null;
}
