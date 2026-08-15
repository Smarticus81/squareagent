import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { rememberIntendedPath } from "@/lib/post-login-redirect";
import {
  useVenues,
  useSaveVenue,
  useSquareLocations,
  type SquareLocation,
} from "@/hooks/use-venues";
import { withClerkBillingHeader } from "@/lib/clerk-session";
import { OnboardingChrome } from "@/components/onboarding/chrome";
import { VoiceCard, type VoiceChoice } from "@/components/onboarding/voice-card";
import {
  TeachSequence,
  type CatalogSummary,
} from "@/components/onboarding/teach-sequence";
import {
  riseVariants,
  riseVariantsReduced,
  screenVariants,
  screenVariantsReduced,
} from "@/components/onboarding/motion";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Coffee,
  Loader2,
  MapPin,
  Martini,
  Mic,
  PartyPopper,
  ShoppingBag,
  UtensilsCrossed,
} from "lucide-react";

/* ── Flow definition ─────────────────────────────────────────────────── */

type StepId = "welcome" | "name" | "connect" | "teach" | "voice" | "ready";

const STEP_ORDER: StepId[] = ["welcome", "name", "connect", "teach", "voice", "ready"];

/** teach shares connect's slot — it's an interstitial, not a numbered step. */
const STEP_LABELS: Record<StepId, string> = {
  welcome: "Step 1 of 5",
  name: "Step 2 of 5",
  connect: "Step 3 of 5",
  teach: "Learning your menu",
  voice: "Step 4 of 5",
  ready: "Step 5 of 5",
};

const STEP_PROGRESS: Record<StepId, number> = {
  welcome: 0.08,
  name: 0.26,
  connect: 0.46,
  teach: 0.62,
  voice: 0.78,
  ready: 0.94,
};

interface VenueType {
  id: string;
  label: string;
  tagline: string;
  icon: typeof Martini;
  names: string[];
  sampleLine: string;
}

const VENUE_TYPES: VenueType[] = [
  {
    id: "bar",
    label: "Bar & lounge",
    tagline: "Tabs, pours, last call",
    icon: Martini,
    names: ["Bev", "Rio", "Cash"],
    sampleLine: "Two ranch waters and a Bud heavy — starting a tab or closing out?",
  },
  {
    id: "restaurant",
    label: "Restaurant",
    tagline: "Tickets, tables, turns",
    icon: UtensilsCrossed,
    names: ["Piper", "Remy", "Sam"],
    sampleLine: "Table twelve wants the burrata to start — it's on the ticket.",
  },
  {
    id: "cafe",
    label: "Café & counter",
    tagline: "Lines, lattes, rushes",
    icon: Coffee,
    names: ["June", "Milo", "Wren"],
    sampleLine: "One oat-milk cortado and a blueberry scone, coming right up.",
  },
  {
    id: "events",
    label: "Events & venues",
    tagline: "Bars, booths, big nights",
    icon: PartyPopper,
    names: ["Nova", "Sky", "Ace"],
    sampleLine: "Bar three is running low on limes — flagging a restock now.",
  },
];

const DEFAULT_SAMPLE_LINE = "Hey, ready when you are. Two ranch waters and a Bud heavy?";

const VOICES: VoiceChoice[] = [
  { id: "verse", label: "Verse", tone: "Bright and quick", gender: "male" },
  { id: "ballad", label: "Ballad", tone: "Smooth and unhurried", gender: "male" },
  { id: "ash", label: "Ash", tone: "Grounded, no nonsense", gender: "male" },
  { id: "coral", label: "Coral", tone: "Warm and welcoming", gender: "female" },
];

/* ── Persistence ─────────────────────────────────────────────────────── */

const STATE_KEY = "voycelab.onboarding.v2";
const LEGACY_NAME_KEY = "voycelab.onboarding_name";

interface PersistedState {
  step?: StepId;
  name?: string;
  venueTypeId?: string;
  voice?: string;
}

function loadPersisted(): PersistedState {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    const parsed = raw ? (JSON.parse(raw) as PersistedState) : {};
    if (!parsed.name) {
      const legacy = sessionStorage.getItem(LEGACY_NAME_KEY);
      if (legacy) parsed.name = legacy;
    }
    return parsed;
  } catch {
    return {};
  }
}

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem("voycelab_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* ── Page ────────────────────────────────────────────────────────────── */

export default function Onboarding() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const reduced = useReducedMotion();

  const { data: auth, isLoading: authLoading } = useAuth();
  const { data: venues, refetch: refetchVenues } = useVenues();
  const saveVenue = useSaveVenue();
  const fetchLocations = useSquareLocations();

  /* Wizard state — hydrated once from sessionStorage + URL */
  const [persisted] = useState(loadPersisted);
  const [step, setStep] = useState<StepId>(() => {
    const p = new URLSearchParams(searchString).get("step");
    if (p === "2" || p === "connect") return "connect";
    if (p === "3" || p === "voice") return "voice";
    if (persisted.step && STEP_ORDER.includes(persisted.step) && persisted.step !== "teach") {
      return persisted.step;
    }
    return "welcome";
  });
  const [direction, setDirection] = useState(1);
  const [name, setName] = useState(persisted.name ?? "");
  const [venueTypeId, setVenueTypeId] = useState<string | null>(persisted.venueTypeId ?? null);
  const [voice, setVoice] = useState(persisted.voice ?? "verse");

  /* Square OAuth state */
  const [squareOAuthClaim, setSquareOAuthClaim] = useState<string | null>(null);
  const [oauthMerchantId, setOauthMerchantId] = useState<string | null>(null);
  const [locations, setLocations] = useState<SquareLocation[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [selectedVenueId, setSelectedVenueId] = useState<number | null>(null);
  const [squareConnected, setSquareConnected] = useState(false);
  const [connectedLocationName, setConnectedLocationName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* Catalog learning state */
  const [catalog, setCatalog] = useState<CatalogSummary>({
    status: "loading",
    count: 0,
    sampleNames: [],
  });
  const [taughtVenueId, setTaughtVenueId] = useState<number | null>(null);

  /* Final submit state */
  const [saving, setSaving] = useState(false);

  const venueType = VENUE_TYPES.find((t) => t.id === venueTypeId) ?? null;
  const sampleLine = venueType?.sampleLine ?? DEFAULT_SAMPLE_LINE;
  const namePlaceholder = venueType?.names[0] ?? "Bev";
  const selectedVoice = VOICES.find((v) => v.id === voice) ?? VOICES[0];

  const goTo = useCallback(
    (next: StepId) => {
      setDirection(STEP_ORDER.indexOf(next) >= STEP_ORDER.indexOf(step) ? 1 : -1);
      setError(null);
      setStep(next);
    },
    [step],
  );

  /* Persist wizard choices so a refresh (or the OAuth round-trip) resumes */
  useEffect(() => {
    try {
      const state: PersistedState = {
        step: step === "teach" ? "connect" : step,
        name,
        venueTypeId: venueTypeId ?? undefined,
        voice,
      };
      sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
      sessionStorage.setItem(LEGACY_NAME_KEY, name);
    } catch {
      /* storage unavailable — the flow still works, it just won't resume */
    }
  }, [step, name, venueTypeId, voice]);

  /* Auth guard */
  useEffect(() => {
    if (!authLoading && !auth?.user) {
      rememberIntendedPath();
      navigate("/login");
    }
  }, [auth, authLoading, navigate]);

  /* Handle Square OAuth return */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthTs = params.get("oauth_ts");
    const oauthError = params.get("oauth_error");
    if (!oauthTs && !oauthError) return;

    // Clean URL
    const url = new URL(window.location.href);
    url.searchParams.delete("oauth_ts");
    url.searchParams.delete("oauth_error");
    url.searchParams.delete("step");
    window.history.replaceState({}, "", url.pathname + url.search);

    setStep("connect");
    if (oauthError) {
      setError(`Square authorization failed: ${oauthError}`);
      return;
    }
    if (oauthTs) {
      (async () => {
        setConnecting(true);
        try {
          const tokenRes = await fetch(
            `/api/square/oauth/token?ts=${encodeURIComponent(oauthTs)}`,
            { headers: getAuthHeader() },
          );
          const tokenData = await tokenRes.json();
          if (!tokenRes.ok) {
            throw new Error(tokenData.error || "Failed to verify Square connection");
          }
          setSquareOAuthClaim(tokenData.tokenState);
          setOauthMerchantId(tokenData.merchantId || null);
          const locs = await fetchLocations.mutateAsync(tokenData.tokenState);
          setLocations(locs);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to connect Square");
        } finally {
          setConnecting(false);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Already connected via an existing venue */
  useEffect(() => {
    if (venues && venues.length > 0 && !squareConnected) {
      const v = venues[0];
      setSquareConnected(true);
      setSelectedVenueId(v.id);
      setConnectedLocationName(v.squareLocationName ?? v.name ?? null);
    }
  }, [venues, squareConnected]);

  /* Teach step: fetch the real catalog while the sequence plays */
  useEffect(() => {
    if (step !== "teach") return;
    if (!selectedVenueId) {
      // Nothing to learn from — this interstitial only exists for connected venues.
      setStep("voice");
      return;
    }
    if (taughtVenueId === selectedVenueId) return;

    let cancelled = false;
    setCatalog({ status: "loading", count: 0, sampleNames: [] });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("catalog_timeout")), 20_000),
    );
    (async () => {
      try {
        const res = (await Promise.race([
          fetch(`/api/venues/${selectedVenueId}/catalog`, { headers: getAuthHeader() }),
          timeout,
        ])) as Response;
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "catalog_failed");
        if (cancelled) return;
        const items: Array<{ name?: string }> = Array.isArray(data.items) ? data.items : [];
        const names = Array.from(
          new Set(
            items
              .map((it) => (typeof it.name === "string" ? it.name.trim() : ""))
              .filter(Boolean),
          ),
        );
        setCatalog({
          status: "done",
          count: typeof data.count === "number" ? data.count : items.length,
          sampleNames: names.slice(0, 12),
        });
        setTaughtVenueId(selectedVenueId);
      } catch {
        if (!cancelled) {
          setCatalog({ status: "error", count: 0, sampleNames: [] });
          setTaughtVenueId(selectedVenueId);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedVenueId]);

  async function handleConnectSquare() {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch(
        "/api/square/oauth/authorize?mode=redirect&handoff=json&return_url=/onboarding?step=connect",
        { headers: getAuthHeader() },
      );
      const data = await res.json().catch(() => ({}));
      const url = typeof data.url === "string" ? data.url : null;
      if (!res.ok || !url) throw new Error(data.error || "Could not start Square authorization");
      window.location.href = url;
    } catch (e) {
      setConnecting(false);
      setError(e instanceof Error ? e.message : "Could not start Square authorization");
    }
  }

  async function handleSelectLocation(loc: SquareLocation) {
    if (!squareOAuthClaim) return;
    try {
      const venue = await saveVenue.mutateAsync({
        squareOAuthClaim,
        merchantId: oauthMerchantId || undefined,
        locationId: loc.id,
        locationName: loc.name,
        name: loc.name,
      });
      setSquareConnected(true);
      setSelectedVenueId(venue.id);
      setConnectedLocationName(loc.name);
      setSquareOAuthClaim(null);
      setLocations([]);
      await refetchVenues();
      goTo("teach");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save location");
    }
  }

  async function handleLaunch() {
    if (!name.trim()) return;
    if (!auth?.organizationId) {
      setError(
        "Your workspace is still being set up. Wait a moment, then try again — or reload the page.",
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const token = localStorage.getItem("voycelab_token") || "";
      const body: Record<string, unknown> = {
        organizationId: auth.organizationId,
        displayName: name.trim(),
        wakePhrase: "Hey Voyce",
        voicePipelineProvider: "openai_realtime_webrtc",
        voicePipelineConfig: { voice },
        noiseMode: "standard",
        // Confirmation policy and allowed tools omitted so the server
        // applies its defaults rather than persisting empty overrides.
      };
      if (selectedVenueId) body.venueId = selectedVenueId;

      const res = await fetch("/api/v1/agent-profiles", {
        method: "POST",
        headers: await withClerkBillingHeader({
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        }),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(errBody.error?.message ?? `Could not create assistant. (HTTP ${res.status})`);
      }
      const data = await res.json();
      const profileId = data.profile?.id ?? data.id;

      sessionStorage.removeItem(STATE_KEY);
      sessionStorage.removeItem(LEGACY_NAME_KEY);

      // Exchange code and open the live assistant
      try {
        const exchangeBody: Record<string, unknown> = {};
        if (selectedVenueId) exchangeBody.venueId = selectedVenueId;
        if (profileId) exchangeBody.agentProfileId = profileId;
        const codeRes = await fetch("/api/auth/exchange/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(exchangeBody),
        });
        if (codeRes.ok) {
          const { code } = await codeRes.json();
          const isLocalDev =
            !import.meta.env.PROD &&
            (window.location.hostname === "localhost" ||
              window.location.hostname === "127.0.0.1");
          const baseUrl = isLocalDev
            ? `${window.location.protocol}//${window.location.hostname}:8081/`
            : `${window.location.origin}/agent/`;
          const profileParam = profileId
            ? `&agentProfileId=${encodeURIComponent(profileId)}`
            : "";
          window.open(
            `${baseUrl}?code=${encodeURIComponent(code)}${profileParam}`,
            "_blank",
            "noopener,noreferrer",
          );
        }
      } catch {
        // Non-fatal — still land on the assistants page.
      }

      navigate("/assistants");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create assistant.");
    } finally {
      setSaving(false);
    }
  }

  /* Back navigation skips the teach interstitial */
  const backTarget: StepId | null = useMemo(() => {
    switch (step) {
      case "name":
        return "welcome";
      case "connect":
        return "name";
      case "voice":
        return "connect";
      case "ready":
        return "voice";
      default:
        return null;
    }
  }, [step]);

  if (authLoading) {
    return (
      <div className="vl-auth-shell flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--color-vl-coral)" }} />
      </div>
    );
  }

  const sv = reduced ? screenVariantsReduced : screenVariants;
  const rv = reduced ? riseVariantsReduced : riseVariants;

  return (
    <div className="vl-auth-shell relative flex flex-1 flex-col overflow-hidden">
      <OnboardingChrome
        progress={STEP_PROGRESS[step]}
        stepLabel={STEP_LABELS[step]}
        canGoBack={Boolean(backTarget) && !saving}
        onBack={() => backTarget && goTo(backTarget)}
      />

      <div className="flex flex-1 items-center justify-center px-4 pb-16 pt-28 sm:px-6">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.section
            key={step}
            custom={direction}
            variants={sv}
            initial="enter"
            animate="center"
            exit="exit"
            className={`w-full ${step === "welcome" ? "max-w-2xl" : "max-w-lg"}`}
          >
            {/* ── Welcome: what kind of place ─────────────────────── */}
            {step === "welcome" && (
              <>
                <StepHeading
                  rv={rv}
                  eyebrow="Welcome to VoyceLab"
                  sub="We'll shape your assistant around the room it works."
                >
                  What kind of place do you <em>run?</em>
                </StepHeading>
                <motion.div variants={rv} className="mt-9 grid gap-3 sm:grid-cols-2">
                  {VENUE_TYPES.map((t) => {
                    const Icon = t.icon;
                    const active = venueTypeId === t.id;
                    return (
                      <motion.button
                        key={t.id}
                        type="button"
                        whileHover={reduced ? undefined : { y: -3 }}
                        whileTap={reduced ? undefined : { scale: 0.98 }}
                        onClick={() => {
                          setVenueTypeId(t.id);
                          goTo("name");
                        }}
                        className="vl-card flex items-center gap-4 p-5 text-left"
                        style={{
                          borderColor: active ? "rgba(255, 107, 71, 0.5)" : undefined,
                        }}
                      >
                        <span
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                          style={{
                            background: "var(--color-vl-coral-tint)",
                            color: "var(--color-vl-coral-deep)",
                            border: "1px solid rgba(229, 79, 45, 0.16)",
                          }}
                        >
                          <Icon className="h-5 w-5" />
                        </span>
                        <span>
                          <span
                            className="block text-[15.5px] font-semibold"
                            style={{ color: "var(--color-vl-ink)" }}
                          >
                            {t.label}
                          </span>
                          <span
                            className="mt-0.5 block text-[12.5px]"
                            style={{ color: "var(--color-vl-ink-muted)" }}
                          >
                            {t.tagline}
                          </span>
                        </span>
                      </motion.button>
                    );
                  })}
                </motion.div>
                <motion.p
                  variants={rv}
                  className="mt-7 text-center text-[12.5px]"
                  style={{ color: "var(--color-vl-ink-faint)" }}
                >
                  About three minutes, start to first pour.
                </motion.p>
              </>
            )}

            {/* ── Name ─────────────────────────────────────────────── */}
            {step === "name" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) goTo("connect");
                }}
              >
                <StepHeading
                  rv={rv}
                  eyebrow="The introduction"
                  sub="Your team will say it out loud all day — pick something that pours well."
                >
                  Give your assistant a <em>name.</em>
                </StepHeading>

                <motion.div variants={rv} className="mt-9">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={namePlaceholder}
                    maxLength={32}
                    aria-label="Assistant name"
                    className="w-full bg-transparent text-center outline-none"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "clamp(30px, 6vw, 42px)",
                      fontWeight: 600,
                      letterSpacing: "-0.03em",
                      color: "var(--color-vl-ink)",
                      borderBottom: "2px solid rgba(14, 27, 44, 0.14)",
                      paddingBottom: "0.35rem",
                      caretColor: "var(--color-vl-coral)",
                    }}
                  />
                </motion.div>

                <motion.div variants={rv} className="mt-5 flex flex-wrap justify-center gap-2">
                  {(venueType?.names ?? ["Bev", "Piper", "Nova"]).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setName(n)}
                      className="vl-chip-light transition-colors hover:opacity-80"
                      style={
                        name === n
                          ? {
                              borderColor: "rgba(255, 107, 71, 0.5)",
                              color: "var(--color-vl-coral-deep)",
                            }
                          : undefined
                      }
                    >
                      {n}
                    </button>
                  ))}
                </motion.div>

                <AnimatePresence>
                  {name.trim() && (
                    <motion.p
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mx-auto mt-6 max-w-sm text-center text-[13px] italic leading-relaxed"
                      style={{ fontFamily: "var(--font-display)", color: "var(--color-vl-ink-muted)" }}
                    >
                      “{sampleLine}” — {name.trim()}
                    </motion.p>
                  )}
                </AnimatePresence>

                <motion.div variants={rv}>
                  <button
                    type="submit"
                    disabled={!name.trim()}
                    className="vl-btn-primary mt-8 inline-flex w-full items-center justify-center gap-2 text-[14.5px]"
                  >
                    Continue <ArrowRight className="h-4 w-4" />
                  </button>
                </motion.div>
              </form>
            )}

            {/* ── Connect Square ───────────────────────────────────── */}
            {step === "connect" && (
              <>
                <StepHeading
                  rv={rv}
                  eyebrow="The connection"
                  sub={`One tap, and ${name.trim() || "your assistant"} studies your real menu, prices, and locations.`}
                >
                  Connect Square. <em>Watch it learn.</em>
                </StepHeading>

                <motion.div variants={rv} className="mt-8">
                  {connecting && (
                    <div className="vl-card flex items-center justify-center gap-3 p-6">
                      <Loader2
                        className="h-5 w-5 animate-spin"
                        style={{ color: "var(--color-vl-coral)" }}
                      />
                      <span className="text-[14px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                        Talking to Square…
                      </span>
                    </div>
                  )}

                  {!connecting && squareConnected && (
                    <div
                      className="vl-card flex items-center gap-3 p-5"
                      style={{
                        borderColor: "rgba(16, 185, 129, 0.4)",
                        background: "rgba(16, 185, 129, 0.05)",
                      }}
                    >
                      <CheckCircle2
                        className="h-5 w-5 shrink-0"
                        style={{ color: "var(--color-vl-success)" }}
                      />
                      <div>
                        <p className="text-[14px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                          {connectedLocationName ?? "Square connected"}
                        </p>
                        <p className="mt-0.5 text-[12px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                          Square is connected and ready.
                        </p>
                      </div>
                    </div>
                  )}

                  {!connecting && !squareConnected && locations.length === 0 && (
                    <>
                      <ul className="space-y-2">
                        {[
                          { icon: Mic, text: "Take orders by voice, synced straight to your POS" },
                          { icon: ShoppingBag, text: "Count and adjust stock without touching a screen" },
                          { icon: BarChart3, text: "Ask for today's numbers and hear them read back" },
                        ].map(({ icon: Icon, text }) => (
                          <li
                            key={text}
                            className="flex items-center gap-3 rounded-2xl border px-4 py-3"
                            style={{
                              borderColor: "rgba(14, 27, 44, 0.08)",
                              background: "rgba(255, 252, 248, 0.6)",
                            }}
                          >
                            <Icon
                              className="h-4 w-4 shrink-0"
                              style={{ color: "var(--color-vl-accent)" }}
                            />
                            <span className="text-[13.5px]" style={{ color: "var(--color-vl-ink-soft)" }}>
                              {text}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        onClick={handleConnectSquare}
                        className="vl-btn-primary mt-5 inline-flex w-full items-center justify-center gap-2 text-[14.5px]"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <rect width="24" height="24" rx="4" fill="currentColor" />
                          <rect x="5" y="5" width="14" height="14" rx="2" fill="white" />
                        </svg>
                        Connect Square
                      </button>
                    </>
                  )}

                  {/* Location picker */}
                  {!connecting && !squareConnected && locations.length > 0 && (
                    <div className="space-y-2">
                      <p className="vl-eyebrow mb-3 block">Where will {name.trim() || "your assistant"} be working?</p>
                      {locations.map((loc) => (
                        <motion.button
                          key={loc.id}
                          type="button"
                          whileHover={reduced ? undefined : { y: -2 }}
                          onClick={() => handleSelectLocation(loc)}
                          disabled={saveVenue.isPending}
                          className="vl-card flex w-full items-center gap-3 p-4 text-left"
                        >
                          <MapPin
                            className="h-4 w-4 shrink-0"
                            style={{ color: "var(--color-vl-accent)" }}
                          />
                          <span className="min-w-0 flex-1">
                            <span
                              className="block truncate text-[14px] font-medium"
                              style={{ color: "var(--color-vl-ink)" }}
                            >
                              {loc.name}
                            </span>
                            {loc.address && (
                              <span
                                className="mt-0.5 block truncate text-[12px]"
                                style={{ color: "var(--color-vl-ink-muted)" }}
                              >
                                {loc.address}
                              </span>
                            )}
                          </span>
                          {saveVenue.isPending && (
                            <Loader2
                              className="h-4 w-4 animate-spin"
                              style={{ color: "var(--color-vl-coral)" }}
                            />
                          )}
                        </motion.button>
                      ))}
                    </div>
                  )}

                  <ErrorLine error={error} />
                </motion.div>

                <motion.div variants={rv}>
                  {squareConnected ? (
                    <button
                      type="button"
                      onClick={() =>
                        goTo(taughtVenueId === selectedVenueId ? "voice" : "teach")
                      }
                      className="vl-btn-primary mt-6 inline-flex w-full items-center justify-center gap-2 text-[14.5px]"
                    >
                      Continue <ArrowRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => goTo("voice")}
                      className="mt-6 inline-flex w-full items-center justify-center py-3 text-[13.5px] transition-opacity hover:opacity-70"
                      style={{ color: "var(--color-vl-ink-muted)" }}
                    >
                      I'll connect later
                    </button>
                  )}
                </motion.div>
              </>
            )}

            {/* ── Teach: the magic interstitial ────────────────────── */}
            {step === "teach" && (
              <>
                <StepHeading rv={rv} eyebrow="The lesson" sub="A few seconds — this is the real thing, not a loading bar.">
                  Teaching <em>{name.trim() || "your assistant"}</em> your menu.
                </StepHeading>
                <motion.div variants={rv} className="mt-8">
                  <TeachSequence
                    assistantName={name.trim() || "Your assistant"}
                    venueName={connectedLocationName ?? "your venue"}
                    catalog={catalog}
                    onContinue={() => goTo("voice")}
                  />
                </motion.div>
              </>
            )}

            {/* ── Voice ────────────────────────────────────────────── */}
            {step === "voice" && (
              <>
                <StepHeading
                  rv={rv}
                  eyebrow="The audition"
                  sub="Tap play — every voice auditions with a line from your world."
                >
                  How should <em>{name.trim() || "it"}</em> sound?
                </StepHeading>

                <motion.div variants={rv} className="mt-8 grid gap-2.5">
                  {VOICES.map((v) => (
                    <VoiceCard
                      key={v.id}
                      voice={v}
                      sampleLine={sampleLine}
                      selected={voice === v.id}
                      onSelect={() => setVoice(v.id)}
                    />
                  ))}
                </motion.div>

                <ErrorLine error={error} />

                <motion.div variants={rv}>
                  <button
                    type="button"
                    onClick={() => goTo("ready")}
                    className="vl-btn-primary mt-6 inline-flex w-full items-center justify-center gap-2 text-[14.5px]"
                  >
                    Continue <ArrowRight className="h-4 w-4" />
                  </button>
                </motion.div>
              </>
            )}

            {/* ── Ready ────────────────────────────────────────────── */}
            {step === "ready" && (
              <>
                <StepHeading
                  rv={rv}
                  eyebrow="The first shift"
                  sub="Here's the spec card. Say the word and start talking."
                >
                  <em>{name.trim() || "Your assistant"}</em> is ready to work.
                </StepHeading>

                <motion.div variants={rv} className="vl-card mt-8 p-6">
                  <TicketRow label="Assistant" value={name.trim() || "—"} />
                  <TicketRow
                    label="Venue"
                    value={connectedLocationName ?? "Not connected yet"}
                    dim={!connectedLocationName}
                  />
                  <TicketRow
                    label="Menu"
                    value={
                      catalog.status === "done" && catalog.count > 0
                        ? `${catalog.count.toLocaleString()} items learned`
                        : squareConnected
                          ? "Syncing in the background"
                          : "Add Square anytime"
                    }
                    dim={!(catalog.status === "done" && catalog.count > 0)}
                  />
                  <TicketRow label="Voice" value={`${selectedVoice.label} · ${selectedVoice.tone}`} />
                  <TicketRow label="Wake phrase" value="“Hey Voyce”" last />
                </motion.div>

                <ErrorLine error={error} />

                <motion.div variants={rv}>
                  <button
                    type="button"
                    disabled={saving || !name.trim()}
                    onClick={handleLaunch}
                    className="vl-btn-primary mt-6 inline-flex w-full items-center justify-center gap-2 text-[15px]"
                    style={{ padding: "0.9rem 1.4rem" }}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Setting up…
                      </>
                    ) : (
                      <>
                        <Mic className="h-4 w-4" /> Meet {name.trim() || "your assistant"}
                      </>
                    )}
                  </button>
                  <p
                    className="mt-3 text-center text-[12.5px]"
                    style={{ color: "var(--color-vl-ink-faint)" }}
                  >
                    Opens live in a new tab — go ahead, say hello.
                  </p>
                </motion.div>
              </>
            )}
          </motion.section>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── Small shared pieces ─────────────────────────────────────────────── */

function StepHeading({
  eyebrow,
  sub,
  children,
  rv,
}: {
  eyebrow: string;
  sub?: string;
  children: React.ReactNode;
  rv: Variants;
}) {
  return (
    <header className="text-center">
      <motion.p variants={rv} className="vl-eyebrow" style={{ color: "var(--color-vl-coral-deep)" }}>
        {eyebrow}
      </motion.p>
      <motion.h1
        variants={rv}
        className="vl-display mx-auto mt-3 max-w-xl text-[clamp(30px,5.4vw,40px)]"
        style={{ color: "var(--color-vl-ink)" }}
      >
        {children}
      </motion.h1>
      {sub && (
        <motion.p
          variants={rv}
          className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed"
          style={{ color: "var(--color-vl-ink-muted)" }}
        >
          {sub}
        </motion.p>
      )}
    </header>
  );
}

function TicketRow({
  label,
  value,
  dim,
  last,
}: {
  label: string;
  value: string;
  dim?: boolean;
  last?: boolean;
}) {
  return (
    <div className="lx-ticket-row" style={last ? { borderBottom: "none" } : undefined}>
      <span style={{ color: "var(--color-vl-ink-muted)", letterSpacing: "0.08em", textTransform: "uppercase", fontSize: 11 }}>
        {label}
      </span>
      <span
        className="text-right"
        style={{ color: dim ? "var(--color-vl-ink-faint)" : "var(--color-vl-ink)", fontWeight: 500 }}
      >
        {value}
      </span>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-4 text-center text-[13px]" style={{ color: "var(--color-vl-danger)" }}>
      {error}
    </p>
  );
}
