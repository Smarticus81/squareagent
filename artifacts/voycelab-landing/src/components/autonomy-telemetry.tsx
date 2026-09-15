import { useEffect } from "react";
import { useLocation } from "wouter";

const VISITOR_KEY = "voycelab_visitor_id";
const SESSION_KEY = "voycelab_session_id";

function id(storage: Storage, key: string): string {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const created = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  storage.setItem(key, created);
  return created;
}

function attribution(): { source: string | null; campaign: string | null } {
  const params = new URLSearchParams(window.location.search);
  return {
    source: params.get("utm_source") || document.referrer || null,
    campaign: params.get("utm_campaign") || null,
  };
}

export function trackBusinessEvent(eventType: string, properties: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const visitorId = id(localStorage, VISITOR_KEY);
  const sessionId = id(sessionStorage, SESSION_KEY);
  const { source, campaign } = attribution();
  const payload = JSON.stringify({ visitorId, sessionId, eventType, source, campaign, properties });
  void fetch("/api/v1/autonomy/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * Lightweight first-party telemetry for the autonomous business evaluator.
 * It records one visit per route and observes CTA links globally, so the
 * marketing site does not need vendor analytics to understand acquisition.
 */
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
      if (/\/signup|\/book-demo|\/pricing/.test(href) || /start free|book.*demo|pricing|pick pro|pick business/i.test(text)) {
        trackBusinessEvent("cta_clicked", { path: window.location.pathname, href, label: text });
      }
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
  }, []);

  return null;
}
