import { useEffect, useState, useCallback, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { rememberIntendedPath } from "@/lib/post-login-redirect";
import {
  useVenues,
  useSaveVenue,
  useDeleteVenue,
  useSquareLocations,
  type SquareLocation,
} from "@/hooks/use-venues";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Database,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Plus,
  Store,
  Trash2,
  Upload,
  X,
} from "lucide-react";

// ── Types from data-sources ──────────────────────────────────────────────────

type Doc = {
  id: string;
  title: string;
  sourceType: string;
  sourceUri: string | null;
  byteCount: number;
  chunkCount: number;
  createdAt: string;
};

type DbConn = {
  id: string;
  label: string;
  kind: string;
  schemaHint: string | null;
  createdAt: string;
};

type EmailConfig = {
  id: string;
  provider: string;
  fromAddress: string;
  fromName: string | null;
  createdAt: string;
} | null;

type ConnectedServiceProviderStatus =
  | "available"
  | "needs_configuration"
  | "request_access"
  | "unavailable";

type ConnectedServiceProviderInfo = {
  provider: string;
  displayName: string;
  description: string;
  status: ConnectedServiceProviderStatus;
  capabilities: string[];
  notes?: string;
  isImplemented?: boolean;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function getHeaders(extra: Record<string, string> = {}) {
  const token = localStorage.getItem("voycelab_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem("voycelab_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function providerStatusText(provider?: ConnectedServiceProviderInfo | null): string {
  if (!provider) return "Checking";
  if (!provider.isImplemented) return "Unavailable";
  switch (provider.status) {
    case "available": return "Ready";
    case "needs_configuration": return "Setup needed";
    case "request_access": return "Request access";
    default: return "Unavailable";
  }
}

function providerStatusTone(provider?: ConnectedServiceProviderInfo | null): "ok" | "warn" {
  return provider?.isImplemented && provider.status === "available" ? "ok" : "warn";
}

// ── Integration card + modal wrapper ─────────────────────────────────────────

function IntegrationSection({
  icon,
  iconBg,
  iconColor,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex aspect-square min-h-[218px] flex-col justify-between overflow-hidden rounded-[28px] border bg-white/72 p-4 text-left shadow-sm transition hover:-translate-y-1 hover:bg-white hover:shadow-lg"
        style={{ borderColor: "rgba(10,10,11,0.07)" }}
      >
        <IntegrationArt title={title} icon={icon} iconBg={iconBg} iconColor={iconColor} />

        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
            Integration
          </p>
          <h2 className="mt-2 text-[19px] font-bold leading-tight" style={{ color: "var(--color-vl-ink)" }}>
            {title}
          </h2>
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed" style={{ color: "rgba(10,10,11,0.58)" }}>
            {subtitle}
          </p>
        </div>

        <span className="inline-flex items-center gap-2 text-[11.5px] font-bold" style={{ color: "var(--color-vl-coral-deep)" }}>
          Configure
          <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-80 flex items-center justify-center px-4 py-8">
          <button
            type="button"
            aria-label={`Close ${title}`}
            className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            className="relative flex max-h-[88vh] w-full max-w-[1060px] flex-col overflow-hidden rounded-[28px] border bg-white shadow-2xl"
            style={{ borderColor: "rgba(10,10,11,0.10)" }}
          >
            <div className="grid gap-5 border-b p-6 lg:grid-cols-[220px_minmax(0,1fr)_auto]" style={{ borderColor: "rgba(10,10,11,0.08)" }}>
              <IntegrationArt title={title} icon={icon} iconBg={iconBg} iconColor={iconColor} compact />
              <div className="flex min-w-0 items-start gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
                    Configure integration
                  </p>
                  <h2 className="mt-1 text-[28px] font-bold leading-tight" style={{ color: "var(--color-vl-ink)" }}>
                    {title}
                  </h2>
                  <p className="mt-1 max-w-140 text-[13px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
                    {subtitle}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border bg-white/80 text-slate-500 transition hover:bg-white hover:text-slate-900"
                style={{ borderColor: "rgba(10,10,11,0.10)" }}
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="vl-scroll overflow-y-auto p-6">
              {children}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function IntegrationArt({
  title,
  icon,
  iconBg,
  iconColor,
  compact = false,
}: {
  title: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  compact?: boolean;
}) {
  const palette = getIntegrationPalette(title);
  const blocks = title.includes("Square")
    ? [80, 54, 68, 42, 86]
    : title.includes("Knowledge")
      ? [48, 78, 58, 88, 62]
      : title.includes("Email")
        ? [54, 46, 88, 64, 74]
        : [78, 64, 42, 86, 58];

  return (
    <div
      className={`relative w-full overflow-hidden rounded-[22px] border shadow-inner ${compact ? "h-[120px]" : "h-[96px]"}`}
      style={{
        borderColor: palette.border,
        background: `linear-gradient(135deg, ${palette.start}, ${palette.mid} 52%, ${palette.end})`,
      }}
    >
      <div className="absolute -right-8 -top-12 h-32 w-32 rounded-[36%] blur-2xl" style={{ background: palette.glow }} />
      <div className="absolute -bottom-12 -left-10 h-32 w-32 rounded-[40%] blur-2xl" style={{ background: palette.soft }} />
      <div className="absolute inset-x-4 bottom-4 flex h-14 items-end gap-1.5">
        {blocks.map((height, index) => (
          <span
            key={`${title}-${height}-${index}`}
            className="w-full rounded-md shadow-sm"
            style={{
              height: `${height}%`,
              background: index % 2 === 0 ? palette.line : palette.lineAlt,
              opacity: 0.88,
            }}
          />
        ))}
      </div>
      <div
        className="absolute left-4 top-4 grid h-12 w-12 place-items-center rounded-[18px] border shadow-lg backdrop-blur"
        style={{ borderColor: "rgba(255,255,255,0.55)", background: iconBg, color: iconColor }}
      >
        {icon}
      </div>
      <div className="absolute right-4 top-4 h-3 w-12 rounded-md" style={{ background: palette.line, opacity: 0.75 }} />
      <div className="absolute right-4 top-9 h-3 w-8 rounded-md" style={{ background: palette.lineAlt, opacity: 0.65 }} />
    </div>
  );
}

function getIntegrationPalette(title: string) {
  if (title.includes("Square")) {
    return {
      start: "rgba(47,158,100,0.22)",
      mid: "rgba(79,184,255,0.18)",
      end: "rgba(255,255,255,0.88)",
      glow: "rgba(47,158,100,0.42)",
      soft: "rgba(79,184,255,0.30)",
      line: "rgba(47,158,100,0.78)",
      lineAlt: "rgba(14,27,44,0.70)",
      border: "rgba(47,158,100,0.18)",
    };
  }
  if (title.includes("Knowledge")) {
    return {
      start: "rgba(124,110,245,0.22)",
      mid: "rgba(255,107,71,0.16)",
      end: "rgba(255,255,255,0.88)",
      glow: "rgba(124,110,245,0.40)",
      soft: "rgba(255,107,71,0.28)",
      line: "rgba(124,110,245,0.78)",
      lineAlt: "rgba(255,107,71,0.68)",
      border: "rgba(124,110,245,0.18)",
    };
  }
  if (title.includes("Email")) {
    return {
      start: "rgba(255,107,71,0.20)",
      mid: "rgba(255,185,90,0.18)",
      end: "rgba(255,255,255,0.88)",
      glow: "rgba(255,107,71,0.40)",
      soft: "rgba(255,185,90,0.30)",
      line: "rgba(255,107,71,0.74)",
      lineAlt: "rgba(14,27,44,0.68)",
      border: "rgba(255,107,71,0.18)",
    };
  }
  return {
    start: "rgba(79,184,255,0.20)",
    mid: "rgba(124,110,245,0.18)",
    end: "rgba(255,255,255,0.88)",
    glow: "rgba(79,184,255,0.38)",
    soft: "rgba(124,110,245,0.30)",
    line: "rgba(79,184,255,0.76)",
    lineAlt: "rgba(124,110,245,0.72)",
    border: "rgba(79,184,255,0.18)",
  };
}
// ── Main page ────────────────────────────────────────────────────────────────

export default function ConnectedServices() {
  const [, setLocation] = useLocation();
  const { data: auth, isLoading } = useAuth();
  const { data: venues, isLoading: venuesLoading, error: venuesError } = useVenues();
  const saveVenue = useSaveVenue();
  const deleteVenue = useDeleteVenue();
  const fetchLocations = useSquareLocations();

  const [squareOAuthClaim, setSquareOAuthClaim] = useState<string | null>(null);
  const [oauthMerchantId, setOauthMerchantId] = useState<string | null>(null);
  const [locations, setLocations] = useState<SquareLocation[]>([]);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [serviceProviders, setServiceProviders] = useState<ConnectedServiceProviderInfo[]>([]);

  useEffect(() => {
    if (!isLoading && !auth?.user) { rememberIntendedPath(); setLocation("/login"); }
  }, [auth, isLoading, setLocation]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthTs = params.get("oauth_ts");
    const oauthError = params.get("oauth_error");
    if (!oauthTs && !oauthError) return;

    const url = new URL(window.location.href);
    url.searchParams.delete("oauth_ts");
    url.searchParams.delete("oauth_error");
    window.history.replaceState({}, "", url.pathname + url.search);

    if (oauthError) {
      setErrorMsg(`Square authorization failed: ${oauthError}`);
      return;
    }
    if (oauthTs) {
      (async () => {
        setConnecting(true);
        try {
          const tokenRes = await fetch(`/api/square/oauth/token?ts=${encodeURIComponent(oauthTs)}`, {
            headers: getAuthHeader(),
          });
          const tokenData = await tokenRes.json();
          if (!tokenRes.ok) throw new Error(tokenData.error || "Failed to verify Square connection");
          setSquareOAuthClaim(tokenData.tokenState);
          setOauthMerchantId(tokenData.merchantId || null);
          const locs = await fetchLocations.mutateAsync(tokenData.tokenState);
          setLocations(locs);
          setShowLocationPicker(true);
        } catch (e) {
          setErrorMsg(e instanceof Error ? e.message : "Failed to connect Square");
        } finally {
          setConnecting(false);
        }
      })();
    }
  }, [fetchLocations]);

  useEffect(() => {
    if (!auth?.user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/connected-service-providers", {
          headers: getAuthHeader(),
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setServiceProviders(Array.isArray(data.providers) ? data.providers : []);
        }
      } catch {
        if (!cancelled) setServiceProviders([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth?.user]);

  const handleConnectSquare = useCallback(async () => {
    setConnecting(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/square/oauth/authorize?mode=redirect&handoff=json&return_url=/services", {
        headers: getAuthHeader(),
      });
      const data = await res.json().catch(() => ({}));
      const url = typeof data.url === "string" ? data.url : null;
      if (!res.ok || !url) throw new Error(data.error || "Could not start Square authorization");
      window.location.href = url;
    } catch (e) {
      setConnecting(false);
      setErrorMsg(e instanceof Error ? e.message : "Could not start Square authorization");
    }
  }, []);

  const handleSelectLocation = useCallback(
    async (loc: SquareLocation) => {
      if (!squareOAuthClaim) return;
      try {
        await saveVenue.mutateAsync({
          squareOAuthClaim,
          merchantId: oauthMerchantId || undefined,
          locationId: loc.id,
          locationName: loc.name,
          name: loc.name,
        });
        setSquareOAuthClaim(null);
        setOauthMerchantId(null);
        setLocations([]);
        setShowLocationPicker(false);
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Failed to save location");
      }
    },
    [squareOAuthClaim, oauthMerchantId, saveVenue],
  );

  if (isLoading || (venuesLoading && !venuesError)) {
    return (
      <div className="vl-page-shell flex flex-1 items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
      </div>
    );
  }

  if (!auth?.user) return null;

  const hasVenues = (venues ?? []).length > 0;
  const squareProvider = serviceProviders.find((p) => p.provider === "square") ?? null;
  const squareReady = !squareProvider || (squareProvider.isImplemented && squareProvider.status === "available");

  return (
    <div className="vl-page-shell flex-1 pb-16 pt-20 sm:pt-24">
      <div className="mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:px-10">
        <Link
          href="/assistants"
          className="inline-flex items-center gap-1.5 text-[12px] mb-5 transition-colors"
          style={{ color: "var(--color-vl-ink-muted)" }}
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Assistants
        </Link>

        <div className="vl-panel mb-8 overflow-hidden p-6 md:p-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
            <div>
              <p className="vl-eyebrow">Integrations</p>
              <h1
                className="vl-display mt-3 text-[38px] md:text-[54px]"
                style={{ color: "var(--color-vl-ink)" }}
              >
                Connected systems
              </h1>
              <p className="mt-4 max-w-2xl text-[15px] leading-relaxed" style={{ color: "rgba(10,10,11,0.62)" }}>
                Connect the live systems your assistants can act on. Square powers POS actions; knowledge, email, and databases expand what the assistant can answer and coordinate.
              </p>
            </div>
            <div className="rounded-3xl border bg-white/70 p-4 shadow-sm" style={{ borderColor: "rgba(10,10,11,0.07)" }}>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
                Current status
              </p>
              <div className="mt-3 flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <Store className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-bold" style={{ color: "var(--color-vl-ink)" }}>
                    Square adapter
                  </p>
                  <p className="mt-0.5 text-[12px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                    {providerStatusText(squareProvider)}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1 text-[11px] font-semibold"
              style={{
                color: providerStatusTone(squareProvider) === "ok" ? "var(--color-vl-success)" : "rgba(138,99,24,0.95)",
                borderColor: providerStatusTone(squareProvider) === "ok" ? "rgba(47,158,100,0.22)" : "rgba(138,99,24,0.22)",
                background: providerStatusTone(squareProvider) === "ok" ? "rgba(47,158,100,0.08)" : "rgba(253,224,71,0.16)",
              }}
            >
              <CheckCircle2 className="h-3 w-3" />
              Square adapter: {providerStatusText(squareProvider)}
            </span>
          </div>
        </div>

        {errorMsg && (
          <div
            className="mb-6 rounded-2xl border px-4 py-3 text-[13px]"
            style={{
              color: "var(--color-vl-danger)",
              background: "rgba(215, 64, 46, 0.08)",
              borderColor: "rgba(215, 64, 46, 0.18)",
            }}
          >
            {errorMsg}
            <button
              onClick={() => setErrorMsg(null)}
              className="ml-3 underline text-[12px]"
            >
              Dismiss
            </button>
          </div>
        )}

        {venuesError && (
          <div
            className="mb-6 rounded-2xl border px-4 py-3 text-[13px]"
            style={{
              color: "var(--color-vl-danger)",
              background: "rgba(215, 64, 46, 0.08)",
              borderColor: "rgba(215, 64, 46, 0.18)",
            }}
          >
            Could not reach the venue service: {venuesError.message}
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {/* ── 1. Square POS ──────────────────────────────────────── */}
          <IntegrationSection
            icon={<Store className="h-4.5 w-4.5" />}
            iconBg="linear-gradient(135deg, #FFFFFF, var(--color-vl-coral-tint))"
            iconColor="var(--color-vl-coral-deep)"
            title="Square POS"
            subtitle="Menu, orders, inventory, reporting, terminals"
          >
          <div className="flex justify-end mb-3">
            {hasVenues && (
              <button
                onClick={handleConnectSquare}
                disabled={connecting || !squareReady}
                className="vl-btn-outline hidden items-center gap-2 px-4 py-2 text-[13px] sm:inline-flex"
                title={squareReady ? "Add Square location" : squareProvider?.notes ?? "Square is not available on this server"}
              >
                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Add location
              </button>
            )}
          </div>

          <div
            className="overflow-hidden rounded-3xl border bg-white/82"
            style={{ borderColor: "rgba(10,10,11,0.08)", boxShadow: "0 1px 2px rgba(10,10,11,0.04), 0 8px 24px -12px rgba(10,10,11,0.08)" }}
          >
            {!hasVenues ? (
              <div className="flex flex-col gap-6 p-7 sm:flex-row sm:items-center sm:justify-between md:p-8">
                <div>
                  <p className="text-[16px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                    Connect your Square account
                  </p>
                  <p className="mt-2 max-w-md text-[13px] leading-relaxed" style={{ color: "rgba(10,10,11,0.55)" }}>
                    Choose a Square location so your assistant can search the menu, build orders, check inventory, and send to your terminal.
                  </p>
                </div>
                <button
                  onClick={handleConnectSquare}
                  disabled={connecting || !squareReady}
                  className="vl-btn-primary inline-flex shrink-0 items-center gap-2"
                  title={squareReady ? "Connect Square" : squareProvider?.notes ?? "Square is not available on this server"}
                >
                  {connecting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {squareReady ? "Connect Square" : providerStatusText(squareProvider)}
                  {!connecting && <ArrowRight className="h-4 w-4" />}
                </button>
              </div>
            ) : (
              (venues ?? []).map((v) => (
                <div key={v.id} className="flex items-center gap-4 border-b border-[rgba(10,10,11,0.06)] p-5 last:border-b-0 md:p-6">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold truncate" style={{ color: "var(--color-vl-ink)" }}>
                        {v.squareLocationName ?? v.name ?? `Venue ${v.id}`}
                      </span>
                      <span
                        className="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10.5px] font-semibold tracking-wide uppercase"
                        style={{
                          color: "var(--color-vl-success)",
                          borderColor: "rgba(47,158,100,0.20)",
                          background: "rgba(47,158,100,0.08)",
                        }}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Live
                      </span>
                    </div>
                    {v.connectedAt && (
                      <p className="mt-1 text-[12px]" style={{ color: "rgba(10,10,11,0.42)" }}>
                        Connected {new Date(v.connectedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      // Destructive: severs the Square connection and any assistants pointed at it.
                      if (window.confirm(`Disconnect ${v.squareLocationName ?? v.name ?? "this venue"} from Square? Assistants using it will stop working until you reconnect.`)) {
                        deleteVenue.mutate(v.id);
                      }
                    }}
                    disabled={deleteVenue.isPending}
                    className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-60"
                    style={{
                      color: "var(--color-vl-danger)",
                      background: "rgba(215, 64, 46, 0.06)",
                      borderColor: "rgba(215, 64, 46, 0.16)",
                    }}
                  >
                    {deleteVenue.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    Disconnect
                  </button>
                </div>
              ))
            )}
          </div>
          {hasVenues && (
            <div className="mt-3 sm:hidden">
              <button
                onClick={handleConnectSquare}
                disabled={connecting || !squareReady}
                className="vl-btn-outline inline-flex items-center gap-2 px-4 py-2 text-[13px]"
                title={squareReady ? "Add another Square location" : squareProvider?.notes ?? "Square is not available on this server"}
              >
                {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Add another location
              </button>
            </div>
          )}
          </IntegrationSection>

          {/* ── 2. Knowledge Base ───────────────────────────────────── */}
          <IntegrationSection
            icon={<FileText className="h-4.5 w-4.5" />}
            iconBg="linear-gradient(135deg, #FFFFFF, rgba(199,210,254,0.4))"
            iconColor="var(--color-vl-accent)"
            title="Knowledge Base"
            subtitle="Upload documents the assistant can search and quote from"
          >
            <KnowledgeSection />
          </IntegrationSection>

          {/* ── 3. Email ────────────────────────────────────────────── */}
          <IntegrationSection
            icon={<Mail className="h-4.5 w-4.5" />}
            iconBg="linear-gradient(135deg, #FFFFFF, rgba(253,224,71,0.2))"
            iconColor="var(--color-vl-accent)"
            title="Email"
            subtitle="Gmail sign-in or Resend for outbound mail"
          >
            <EmailSection />
          </IntegrationSection>

          {/* ── 4. Database ─────────────────────────────────────────── */}
          <IntegrationSection
            icon={<Database className="h-4.5 w-4.5" />}
            iconBg="linear-gradient(135deg, #FFFFFF, rgba(167,243,208,0.3))"
            iconColor="var(--color-vl-accent)"
            title="Database"
            subtitle="Read-only Postgres connection for database commands"
          >
            <DatabaseSection />
          </IntegrationSection>
        </div>

      </div>

      {/* Location picker modal */}
      {showLocationPicker && locations.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(10,10,11,0.36)] p-4 backdrop-blur-sm">
          <div
            className="w-full max-w-md rounded-3xl border bg-white/94 p-6 md:p-7"
            style={{ borderColor: "rgba(10,10,11,0.10)", boxShadow: "0 24px 48px -12px rgba(10,10,11,0.25)" }}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="vl-eyebrow">Square</p>
                <h2 className="text-[22px] font-semibold tracking-tight mt-1" style={{ color: "var(--color-vl-ink)" }}>
                  Choose a location
                </h2>
                <p className="mt-1 text-[13px]" style={{ color: "rgba(10,10,11,0.55)" }}>
                  Pick the venue this assistant will control.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowLocationPicker(false);
                  setSquareOAuthClaim(null);
                  setLocations([]);
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors"
                style={{
                  color: "rgba(10,10,11,0.45)",
                  background: "rgba(10, 10, 11,0.04)",
                  border: "1px solid rgba(10, 10, 11,0.08)",
                }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="vl-scroll max-h-80 space-y-2 overflow-y-auto pr-2">
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => handleSelectLocation(loc)}
                  disabled={saveVenue.isPending}
                  className="flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-[rgba(124,110,245,0.4)] disabled:opacity-50"
                  style={{ borderColor: "rgba(10,10,11,0.08)" }}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: "var(--color-vl-coral-tint)", color: "var(--color-vl-coral-deep)" }}
                  >
                    <MapPin className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold truncate" style={{ color: "var(--color-vl-ink)" }}>{loc.name}</p>
                    {loc.address && (
                      <p className="mt-0.5 text-[11.5px] truncate" style={{ color: "rgba(10,10,11,0.45)" }}>
                        {loc.address}
                      </p>
                    )}
                  </div>
                  {saveVenue.isPending && <Loader2 className="ml-auto h-4 w-4 animate-spin" style={{ color: "var(--color-vl-coral)" }} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Knowledge Base section ───────────────────────────────────────────────────

function KnowledgeSection() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/knowledge/documents", { headers: getAuthHeader() });
      const data = await res.json();
      setDocs(data.documents ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submitText = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !text.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/knowledge/documents", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ title: title.trim(), text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setMsg({ tone: "ok", text: `Indexed "${data.title}" (${data.chunkCount} chunks).` });
      setTitle("");
      setText("");
      await load();
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setBusy(false);
    }
  };

  const submitFile = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", file.name);
      const res = await fetch("/api/v1/knowledge/documents/upload", {
        method: "POST",
        headers: getAuthHeader(),
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setMsg({ tone: "ok", text: `Indexed "${data.title}" (${data.chunkCount} chunks).` });
      await load();
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this document and all its chunks?")) return;
    await fetch(`/api/v1/knowledge/documents/${id}`, {
      method: "DELETE",
      headers: getAuthHeader(),
    });
    await load();
  };

  return (
    <div
      className="rounded-3xl border bg-white/82 p-6"
      style={{ borderColor: "rgba(10,10,11,0.08)", boxShadow: "0 1px 2px rgba(10,10,11,0.04), 0 8px 24px -12px rgba(10,10,11,0.08)" }}
    >
      <p className="text-[14px] mb-6" style={{ color: "rgba(10,10,11,0.62)" }}>
        Upload PDFs, Word docs, or paste text. The assistant will use <code className="rounded px-1" style={{ color: "var(--color-vl-ink)", background: "rgba(10,10,11,0.06)" }}>search_knowledge</code> to
        quote from these when relevant.
      </p>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <form onSubmit={submitText} className="space-y-3">
          <input
            type="text"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-2xl border border-black/12 bg-white/72 px-3 py-2 text-sm text-(--color-vl-ink) placeholder:text-black/35"
          />
          <textarea
            placeholder="Paste text here..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="w-full resize-y rounded-2xl border border-black/12 bg-white/72 px-3 py-2 text-sm text-(--color-vl-ink) placeholder:text-black/35"
          />
          <button
            type="submit"
            disabled={busy || !title.trim() || !text.trim()}
            className="vl-btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add text
          </button>
        </form>

        <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-black/12 bg-white/56 p-6 transition hover:border-black/25 hover:bg-white/76">
          <Upload className="w-6 h-6 mb-2" style={{ color: "var(--color-vl-accent)" }} />
          <div className="text-sm" style={{ color: "var(--color-vl-ink)" }}>Upload a file</div>
          <div className="text-xs mt-1" style={{ color: "rgba(10,10,11,0.52)" }}>PDF, DOCX, TXT, MD, HTML - up to 10 MB</div>
          <input
            type="file"
            accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,.csv,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/html,text/markdown"
            disabled={busy}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) submitFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {msg && (
        <div
          className={`text-sm mb-4 ${msg.tone === "ok" ? "text-emerald-400" : "text-rose-400"}`}
          role={msg.tone === "error" ? "alert" : undefined}
        >
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: "rgba(10,10,11,0.52)" }}>Loading...</div>
      ) : docs.length === 0 ? (
        <div className="text-sm" style={{ color: "rgba(10,10,11,0.52)" }}>No documents yet.</div>
      ) : (
        <ul className="divide-y divide-black/6">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm" style={{ color: "var(--color-vl-ink)" }}>{d.title}</div>
                <div className="text-xs" style={{ color: "rgba(10,10,11,0.52)" }}>
                  {d.chunkCount} chunks · {fmtBytes(d.byteCount)} · {new Date(d.createdAt).toLocaleString()}
                </div>
              </div>
              <button
                onClick={() => remove(d.id)}
                className="p-2 rounded-md text-black/45 hover:text-rose-600 hover:bg-black/4"
                aria-label="Delete document"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Email section ────────────────────────────────────────────────────────────

function EmailSection() {
  const [config, setConfig] = useState<EmailConfig>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [provider, setProvider] = useState<"resend" | "gmail_oauth">("gmail_oauth");
  const [apiKey, setApiKey] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [fromName, setFromName] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/knowledge/email", { headers: getAuthHeader() });
      const data = await res.json();
      setConfig(data.email ?? null);
      if (data.email) {
        setFromAddress(data.email.fromAddress ?? "");
        setFromName(data.email.fromName ?? "");
        if (data.email.provider === "gmail_oauth" || data.email.provider === "resend") {
          setProvider(data.email.provider);
        }
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const saveResend = async (e: FormEvent) => {
    e.preventDefault();
    if (!fromAddress.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/knowledge/email", {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({
          provider: "resend",
          apiKey: apiKey.trim() || undefined,
          fromAddress: fromAddress.trim(),
          fromName: fromName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ? `${data.error}: ${data.detail}` : data.error || "Save failed");
      setMsg({ tone: "ok", text: "Email config saved." });
      setApiKey("");
      await load();
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("gmail_oauth_result");
    if (!raw) return;

    const url = new URL(window.location.href);
    url.searchParams.delete("gmail_oauth_result");
    window.history.replaceState({}, "", url.pathname + url.search);

    try {
      const payload = JSON.parse(raw);
      if (payload.ok) {
        setMsg({ tone: "ok", text: `Gmail connected as ${payload.email ?? "your account"}.` });
        setProvider("gmail_oauth");
        load();
      } else {
        setMsg({ tone: "error", text: payload.error || "Gmail authorization failed." });
      }
    } catch {
      setMsg({ tone: "error", text: "Could not parse Gmail OAuth result." });
    }
  }, []);

  const connectGmail = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const params = new URLSearchParams();
      if (fromName.trim()) params.set("fromName", fromName.trim());
      const res = await fetch(`/api/oauth/google/start?${params}`, { headers: getAuthHeader() });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Failed to start Gmail OAuth");

      window.location.href = data.url;
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Connection failed" });
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Disconnect email?")) return;
    await fetch("/api/v1/knowledge/email", { method: "DELETE", headers: getAuthHeader() });
    setConfig(null);
    setApiKey("");
    setFromAddress("");
    setFromName("");
  };

  const isGmailConnected = config?.provider === "gmail_oauth";
  const isResendConnected = config?.provider === "resend";

  return (
    <div
      className="rounded-3xl border bg-white/82 p-6"
      style={{ borderColor: "rgba(10,10,11,0.08)", boxShadow: "0 1px 2px rgba(10,10,11,0.04), 0 8px 24px -12px rgba(10,10,11,0.08)" }}
    >
      <p className="text-[14px] mb-4" style={{ color: "rgba(10,10,11,0.62)" }}>
        Choose how outbound mail is sent. The email command delivers from this address - the assistant always reads the recipient and subject back to you before sending.
      </p>

      {loading ? (
        <div className="text-sm" style={{ color: "rgba(10,10,11,0.52)" }}>Loading...</div>
      ) : (
        <>
          <div className="flex gap-2 mb-4" role="tablist" aria-label="Email provider">
            <button
              type="button"
              role="tab"
              aria-selected={provider === "gmail_oauth"}
              onClick={() => setProvider("gmail_oauth")}
              className={`rounded-xl border px-3 py-1.5 text-sm transition ${provider === "gmail_oauth" ? "bg-(--color-vl-ink) text-white border-transparent" : "border-black/12 text-(--color-vl-ink)"}`}
            >
              Gmail
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={provider === "resend"}
              onClick={() => setProvider("resend")}
              className={`rounded-xl border px-3 py-1.5 text-sm transition ${provider === "resend" ? "bg-(--color-vl-ink) text-white border-transparent" : "border-black/12 text-(--color-vl-ink)"}`}
            >
              Resend
            </button>
          </div>

          {provider === "gmail_oauth" ? (
            <div className="space-y-3">
              <p className="text-[13px]" style={{ color: "rgba(10,10,11,0.55)" }}>
                Sign in with Google to let VoyceLab read, search, and send mail for assistant commands. Mail is sent from your Gmail address - no app password or SMTP setup. You can revoke access any time at <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--color-vl-accent)" }}>your Google Account</a>.
              </p>

              {isGmailConnected ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm flex items-center justify-between">
                  <span style={{ color: "var(--color-vl-ink)" }}>Connected as <strong>{config?.fromAddress}</strong></span>
                </div>
              ) : null}

              <input
                type="text"
                placeholder="From name (optional, e.g. Acme Bar)"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                className="w-full rounded-2xl border border-black/12 bg-white/72 px-3 py-2 text-sm text-(--color-vl-ink) placeholder:text-black/35"
              />

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={connectGmail}
                  disabled={busy}
                  className="vl-btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {isGmailConnected ? "Reconnect Gmail" : "Connect Gmail"}
                </button>
                {config && (
                  <button
                    type="button"
                    onClick={remove}
                    className="vl-btn-outline inline-flex items-center gap-2 px-4 py-2 text-sm"
                  >
                    <Trash2 className="w-4 h-4" /> Disconnect
                  </button>
                )}
              </div>
            </div>
          ) : (
            <form onSubmit={saveResend} className="space-y-3">
              <p className="text-[13px]" style={{ color: "rgba(10,10,11,0.55)" }}>
                Plug in a <a href="https://resend.com" target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--color-vl-accent)" }}>Resend</a> key. Best for sending from a verified custom domain.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                <input
                  type="email"
                  placeholder="From address (e.g. ops@yourdomain.com)"
                  value={fromAddress}
                  onChange={(e) => setFromAddress(e.target.value)}
                  className="rounded-2xl border border-black/12 bg-white/72 px-3 py-2 text-sm text-(--color-vl-ink) placeholder:text-black/35"
                  required
                />
                <input
                  type="text"
                  placeholder="From name (optional)"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  className="rounded-2xl border border-black/12 bg-white/72 px-3 py-2 text-sm text-(--color-vl-ink) placeholder:text-black/35"
                />
              </div>
              <input
                type="password"
                placeholder={isResendConnected ? "Resend key (leave blank to keep current)" : "Resend key (re_...)"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full rounded-2xl border border-black/12 bg-white/72 px-3 py-2 text-sm font-mono text-(--color-vl-ink) placeholder:text-black/35"
                autoComplete="new-password"
              />
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={busy || !fromAddress.trim() || (!isResendConnected && !apiKey.trim())}
                  className="vl-btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {isResendConnected ? "Update" : "Save"}
                </button>
                {config && (
                  <button
                    type="button"
                    onClick={remove}
                    className="vl-btn-outline inline-flex items-center gap-2 px-4 py-2 text-sm"
                  >
                    <Trash2 className="w-4 h-4" /> Disconnect
                  </button>
                )}
              </div>
            </form>
          )}
        </>
      )}

      {msg && (
        <div className={`text-sm mt-4 ${msg.tone === "ok" ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</div>
      )}
    </div>
  );
}

// ── Database section ─────────────────────────────────────────────────────────

function DatabaseSection() {
  const [conns, setConns] = useState<DbConn[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [label, setLabel] = useState("default");
  const [connectionString, setConnectionString] = useState("");
  const [schemaHint, setSchemaHint] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/knowledge/database-connections", { headers: getAuthHeader() });
      const data = await res.json();
      setConns(data.connections ?? []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!connectionString.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/knowledge/database-connections", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          label: label.trim() || "default",
          connectionString: connectionString.trim(),
          schemaHint: schemaHint.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ? `${data.error}: ${data.detail}` : data.error || "Save failed");
      setMsg({ tone: "ok", text: data.validated ? "Connection tested and saved." : "Connection saved." });
      setConnectionString("");
      await load();
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this database connection?")) return;
    await fetch(`/api/v1/knowledge/database-connections/${id}`, {
      method: "DELETE",
      headers: getAuthHeader(),
    });
    await load();
  };

  return (
    <div
      className="rounded-3xl border bg-white/82 p-6"
      style={{ borderColor: "rgba(10,10,11,0.08)", boxShadow: "0 1px 2px rgba(10,10,11,0.04), 0 8px 24px -12px rgba(10,10,11,0.08)" }}
    >
      <p className="text-[14px] mb-2" style={{ color: "rgba(10,10,11,0.62)" }}>
        Read-only Postgres. The assistant gets a database command that runs SELECT
        statements (capped at 100 rows, 8 second timeout). The connection string is encrypted at rest.
      </p>
      <p className="text-xs mb-6" style={{ color: "#8A6318" }}>
        <strong>Recommended:</strong> create a dedicated read-only role on your database and use its credentials here.
        Example: <code style={{ color: "#76520B" }}>CREATE ROLE voycelab_ro LOGIN PASSWORD '...'; GRANT CONNECT ON DATABASE
        mydb TO voycelab_ro; GRANT USAGE ON SCHEMA public TO voycelab_ro; GRANT SELECT ON ALL TABLES IN SCHEMA public TO
        voycelab_ro;</code>
      </p>

      <form onSubmit={save} className="space-y-3 mb-6">
        <div className="grid md:grid-cols-3 gap-3">
          <input
            type="text"
            placeholder="Label (e.g. analytics)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="rounded-2xl border border-black/12 bg-white/72 px-3 py-2 text-sm text-(--color-vl-ink) placeholder:text-black/35"
          />
          <input
            type="text"
            placeholder="postgres://user:pass@host:5432/db"
            value={connectionString}
            onChange={(e) => setConnectionString(e.target.value)}
            className="rounded-2xl border border-black/12 bg-white/72 px-3 py-2 text-sm font-mono text-(--color-vl-ink) placeholder:text-black/35 md:col-span-2"
          />
        </div>
        <textarea
          placeholder="Optional schema hint shown to the assistant (table names, columns, joins)..."
          value={schemaHint}
          onChange={(e) => setSchemaHint(e.target.value)}
          rows={3}
          className="w-full resize-y rounded-2xl border border-black/12 bg-white/72 px-3 py-2 text-sm text-(--color-vl-ink) placeholder:text-black/35"
        />
        <button
          type="submit"
          disabled={busy || !connectionString.trim()}
          className="vl-btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Save connection
        </button>
      </form>

      {msg && (
        <div className={`text-sm mb-4 ${msg.tone === "ok" ? "text-emerald-400" : "text-rose-400"}`}>{msg.text}</div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: "rgba(10,10,11,0.52)" }}>Loading...</div>
      ) : conns.length === 0 ? (
        <div className="text-sm" style={{ color: "rgba(10,10,11,0.52)" }}>No connections configured.</div>
      ) : (
        <ul className="divide-y divide-black/6">
          {conns.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm font-mono" style={{ color: "var(--color-vl-ink)" }}>{c.label}</div>
                <div className="text-xs" style={{ color: "rgba(10,10,11,0.52)" }}>
                  {c.kind}
                  {c.schemaHint ? ` · ${c.schemaHint.slice(0, 80)}${c.schemaHint.length > 80 ? "..." : ""}` : ""}
                </div>
              </div>
              <button
                onClick={() => remove(c.id)}
                className="p-2 rounded-md text-black/45 hover:text-rose-600 hover:bg-black/4"
                aria-label="Delete connection"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
