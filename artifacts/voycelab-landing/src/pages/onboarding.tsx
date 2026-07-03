import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { rememberIntendedPath } from "@/lib/post-login-redirect";
import {
  useVenues,
  useSaveVenue,
  useSquareLocations,
  type SquareLocation,
} from "@/hooks/use-venues";
import { withClerkBillingHeader } from "@/lib/clerk-session";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Loader2,
  MapPin,
  Pause,
  Play,
  Volume2,
} from "lucide-react";

/* ── Voice constants (same as create-assistant) ──────────────────────── */

const VOICES = [
  { id: "verse", label: "Verse", gender: "male" },
  { id: "ballad", label: "Ballad", gender: "male" },
  { id: "ash", label: "Ash", gender: "male" },
  { id: "coral", label: "Coral", gender: "female" },
] as const;

const SAMPLE_LINE = "Hey, ready when you are. Two ranch waters and a Bud heavy?";

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem("voycelab_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* ── Main component ──────────────────────────────────────────────────── */

export default function Onboarding() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);

  const { data: auth, isLoading: authLoading } = useAuth();
  const { data: venues, refetch: refetchVenues } = useVenues();
  const saveVenue = useSaveVenue();
  const fetchLocations = useSquareLocations();

  /* Wizard state */
  const [step, setStep] = useState(() => {
    const s = searchParams.get("step");
    return s === "2" ? 2 : s === "3" ? 3 : 1;
  });
  const [name, setName] = useState("");
  const [voice, setVoice] = useState("verse");

  /* Square OAuth state */
  const [squareOAuthClaim, setSquareOAuthClaim] = useState<string | null>(null);
  const [oauthMerchantId, setOauthMerchantId] = useState<string | null>(null);
  const [locations, setLocations] = useState<SquareLocation[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [selectedVenueId, setSelectedVenueId] = useState<number | null>(null);
  const [squareConnected, setSquareConnected] = useState(false);
  const [connectedLocationName, setConnectedLocationName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* Final submit state */
  const [saving, setSaving] = useState(false);

  /* Auth guard */
  useEffect(() => {
    if (!authLoading && !auth?.user) { rememberIntendedPath(); navigate("/login"); }
  }, [auth, authLoading, navigate]);

  /* Restore name from sessionStorage if user went through OAuth redirect */
  useEffect(() => {
    const saved = sessionStorage.getItem("voycelab.onboarding_name");
    if (saved) setName(saved);
  }, []);

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

    if (oauthError) {
      setError(`Square authorization failed: ${oauthError}`);
      setStep(2);
      return;
    }
    if (oauthTs) {
      setStep(2);
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
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to connect Square");
        } finally {
          setConnecting(false);
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Check if already connected via existing venues */
  useEffect(() => {
    if (venues && venues.length > 0 && !squareConnected) {
      const v = venues[0];
      setSquareConnected(true);
      setSelectedVenueId(v.id);
      setConnectedLocationName(v.squareLocationName ?? v.name ?? null);
    }
  }, [venues, squareConnected]);

  async function handleConnectSquare() {
    // Save name so it persists across OAuth redirect
    sessionStorage.setItem("voycelab.onboarding_name", name);
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/square/oauth/authorize?mode=redirect&handoff=json&return_url=/onboarding?step=2", {
        headers: getAuthHeader(),
      });
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save location");
    }
  }

  async function handleLaunch() {
    if (!name.trim()) return;
    if (!auth?.organizationId) {
      // Silently returning here makes the primary button look dead.
      setError("Your workspace is still being set up. Wait a moment, then try again — or reload the page.");
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
        allowedTools: [],
        confirmationPolicy: { approvals: {} },
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
        throw new Error(
          errBody.error?.message ?? `Could not create assistant. (HTTP ${res.status})`,
        );
      }
      const data = await res.json();
      const profileId = data.profile?.id ?? data.id;

      sessionStorage.removeItem("voycelab.onboarding_name");

      // Exchange code and open PWA
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
            (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
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
        // Non-fatal -- still redirect to the assistants page.
      }

      navigate("/assistants");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create assistant.");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) {
    return (
      <div className="vl-page-shell flex flex-1 items-center justify-center">
        <Loader2
          className="w-5 h-5 animate-spin"
          style={{ color: "var(--color-vl-brass2)" }}
        />
      </div>
    );
  }

  return (
    <div className="vl-page-shell relative flex-1 overflow-hidden px-4 pb-20 pt-16 sm:px-6 lg:px-10">
      {/* Background blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute left-[-12%] top-[-18%] h-95 w-140 rounded-[42%] blur-3xl"
          style={{ background: "rgba(251, 207, 232, 0.42)" }}
        />
        <div
          className="absolute right-[-14%] top-[5%] h-120 w-150 rounded-[42%] blur-3xl"
          style={{ background: "rgba(199, 210, 254, 0.30)" }}
        />
        <div
          className="absolute bottom-[-18%] right-[12%] h-105 w-170 rounded-[42%] blur-3xl"
          style={{ background: "rgba(167, 243, 208, 0.23)" }}
        />
      </div>

      <div className="mx-auto w-full max-w-xl">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-10">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (n < step) setStep(n);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-xl text-[12px] font-semibold transition-all"
                style={{
                  background:
                    n < step
                      ? "var(--color-vl-coral)"
                      : n === step
                        ? "var(--color-vl-ink)"
                        : "transparent",
                  color:
                    n <= step ? "#fff" : "rgba(10,10,11,0.35)",
                  border:
                    n > step
                      ? "1.5px solid rgba(10,10,11,0.18)"
                      : "1.5px solid transparent",
                  cursor: n < step ? "pointer" : "default",
                }}
              >
                {n < step ? <Check className="w-3.5 h-3.5" /> : n}
              </button>
              {n < 3 && (
                <div
                  className="w-10 h-px"
                  style={{
                    background:
                      n < step ? "var(--color-vl-coral)" : "rgba(10,10,11,0.12)",
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* ── Step 1: Name ───────────────────────────────────────────── */}
        {step === 1 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <p className="vl-eyebrow">Step 1</p>
            <h1
              className="vl-display mt-3 text-[34px]"
              style={{ color: "var(--color-vl-ink)" }}
            >
              Name your assistant
            </h1>
            <p
              className="mt-2 text-[14px] leading-relaxed"
              style={{ color: "var(--color-vl-ink-muted)" }}
            >
              You can change this later.
            </p>

            <div className="mt-8">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Bev"
                className="vl-input"
                maxLength={32}
              />
            </div>

            <button
              type="button"
              disabled={!name.trim()}
              onClick={() => setStep(2)}
              className="vl-btn-primary w-full mt-6 inline-flex items-center justify-center gap-2 text-[14px] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Step 2: Connect Square ─────────────────────────────────── */}
        {step === 2 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <p className="vl-eyebrow">Step 2</p>
            <h1
              className="vl-display mt-3 text-[34px]"
              style={{ color: "var(--color-vl-ink)" }}
            >
              Connect Square POS
            </h1>
            <p
              className="mt-2 text-[14px] leading-relaxed"
              style={{ color: "var(--color-vl-ink-muted)" }}
            >
              Unlock voice ordering, inventory, and reports.
            </p>

            <div className="mt-8">
              {connecting && (
                <div className="vl-card p-6 flex items-center justify-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
                  <span className="text-[14px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                    Connecting to Square...
                  </span>
                </div>
              )}

              {!connecting && squareConnected && (
                <div
                  className="vl-card p-5 flex items-center gap-3"
                  style={{ borderColor: "rgba(34,197,94,0.4)", background: "rgba(34,197,94,0.04)" }}
                >
                  <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: "rgb(34,197,94)" }} />
                  <div>
                    <p className="text-[14px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                      {connectedLocationName ?? "Square connected"}
                    </p>
                    <p className="text-[12px] mt-0.5" style={{ color: "rgba(10,10,11,0.55)" }}>
                      Square POS connected successfully
                    </p>
                  </div>
                </div>
              )}

              {!connecting && !squareConnected && locations.length === 0 && (
                <button
                  type="button"
                  onClick={handleConnectSquare}
                  className="vl-btn-primary w-full inline-flex items-center justify-center gap-2 text-[14px]"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <rect width="24" height="24" rx="4" fill="currentColor" />
                    <rect x="5" y="5" width="14" height="14" rx="2" fill="white" />
                  </svg>
                  Connect Square
                </button>
              )}

              {/* Location picker */}
              {!connecting && !squareConnected && locations.length > 0 && (
                <div className="space-y-2">
                  <p
                    className="vl-eyebrow block mb-3"
                  >
                    Select a location
                  </p>
                  {locations.map((loc) => (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => handleSelectLocation(loc)}
                      disabled={saveVenue.isPending}
                      className="vl-card w-full flex items-center gap-3 p-4 text-left transition-colors hover:border-[rgba(124,110,245,0.4)]"
                    >
                      <MapPin className="w-4 h-4 shrink-0" style={{ color: "var(--color-vl-accent)" }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium truncate" style={{ color: "var(--color-vl-ink)" }}>
                          {loc.name}
                        </p>
                        {loc.address && (
                          <p className="text-[12px] truncate mt-0.5" style={{ color: "rgba(10,10,11,0.50)" }}>
                            {loc.address}
                          </p>
                        )}
                      </div>
                      {saveVenue.isPending && (
                        <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
                      )}
                    </button>
                  ))}
                </div>
              )}

              {error && (
                <p className="mt-4 text-[13px]" style={{ color: "var(--color-vl-danger)" }}>
                  {error}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => setStep(3)}
              className={
                squareConnected
                  ? "vl-btn-primary w-full mt-6 inline-flex items-center justify-center gap-2 text-[14px]"
                  : "w-full mt-6 inline-flex items-center justify-center gap-2 text-[14px] py-3 transition-colors"
              }
              style={
                squareConnected
                  ? undefined
                  : { color: "var(--color-vl-ink-muted)" }
              }
            >
              {squareConnected ? (
                <>Next <ChevronRight className="w-4 h-4" /></>
              ) : (
                "Skip for now"
              )}
            </button>
          </div>
        )}

        {/* ── Step 3: Voice ──────────────────────────────────────────── */}
        {step === 3 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <p className="vl-eyebrow">Step 3</p>
            <h1
              className="vl-display mt-3 text-[34px]"
              style={{ color: "var(--color-vl-ink)" }}
            >
              Choose a voice
            </h1>
            <p
              className="mt-2 text-[14px] leading-relaxed"
              style={{ color: "var(--color-vl-ink-muted)" }}
            >
              How your assistant sounds.
            </p>

            <fieldset className="mt-8">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {VOICES.map((v) => (
                  <VoiceOption
                    key={v.id}
                    voiceId={v.id}
                    label={v.label}
                    gender={v.gender}
                    selected={voice === v.id}
                    onSelect={() => setVoice(v.id)}
                  />
                ))}
              </div>
            </fieldset>

            {error && (
              <p className="mt-4 text-[13px]" style={{ color: "var(--color-vl-danger)" }}>
                {error}
              </p>
            )}

            <button
              type="button"
              disabled={saving}
              onClick={handleLaunch}
              className="vl-btn-primary w-full mt-6 inline-flex items-center justify-center gap-2 text-[14px] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Creating...
                </>
              ) : (
                <>
                  Launch assistant <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        )}
      </div>

      <style>{`
        .vl-input {
          width: 100%;
          height: 48px;
          padding: 0 16px;
          border-radius: 14px;
          background: #FFFFFF;
          border: 1px solid rgba(10, 10, 11,0.12);
          color: var(--color-vl-ink);
          font-size: 15px;
          outline: none;
          transition: border-color .2s ease, background .2s ease, box-shadow .2s ease;
        }
        .vl-input::placeholder { color: rgba(10, 10, 11,0.36); }
        .vl-input:focus {
          border-color: var(--color-vl-coral);
          box-shadow: 0 0 0 3px rgba(99, 102, 241,0.14);
        }
      `}</style>
    </div>
  );
}

/* ── Voice option card (same as create-assistant) ────────────────────── */

function VoiceOption({
  voiceId,
  label,
  gender,
  selected,
  onSelect,
}: {
  voiceId: string;
  label: string;
  gender: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playState, setPlayState] = useState<
    "idle" | "loading" | "playing" | "error"
  >("idle");

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.src = "";
    };
  }, []);

  async function toggleSample(e: React.MouseEvent) {
    e.stopPropagation();
    if (playState === "playing") {
      audioRef.current?.pause();
      setPlayState("idle");
      return;
    }
    setPlayState("loading");
    try {
      const url = `/api/v1/voice-pipelines/openai_realtime_webrtc/sample?voice=${encodeURIComponent(voiceId)}`;
      const token = localStorage.getItem("voycelab_token") || "";
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      audio.onended = () => {
        URL.revokeObjectURL(objectUrl);
        setPlayState("idle");
      };
      audio.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        setPlayState("error");
      };
      audioRef.current = audio;
      await audio.play();
      setPlayState("playing");
    } catch {
      fallbackBrowserVoice();
    }
  }

  function fallbackBrowserVoice() {
    if (!window.speechSynthesis) {
      setPlayState("error");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(SAMPLE_LINE);
    utterance.rate = 1.05;
    utterance.onend = () => setPlayState("idle");
    utterance.onerror = () => setPlayState("error");
    const voices = window.speechSynthesis.getVoices();
    const en = voices.filter((v) =>
      v.lang.toLowerCase().startsWith("en"),
    );
    if (en.length > 0) utterance.voice = en[0];
    window.speechSynthesis.speak(utterance);
    setPlayState("playing");
  }

  const isPlaying = playState === "playing";

  return (
    <button
      type="button"
      onClick={onSelect}
      className="vl-card relative flex flex-col items-center gap-2 p-4 transition-colors"
      style={{
        borderColor: selected
          ? "rgba(124,110,245,0.6)"
          : "rgba(10, 10, 11,0.10)",
        background: selected ? "rgba(124,110,245,0.06)" : undefined,
      }}
    >
      {selected && (
        <span
          className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-lg"
          style={{ background: "var(--color-vl-coral)" }}
        >
          <Check className="w-3 h-3 text-white" />
        </span>
      )}
      <span
        className="text-[14px] font-semibold"
        style={{ color: "var(--color-vl-ink)" }}
      >
        {label}
      </span>
      <span
        className="text-[11px]"
        style={{ color: "var(--color-vl-ink-faint)" }}
      >
        {gender}
      </span>
      <button
        type="button"
        onClick={toggleSample}
        disabled={playState === "loading"}
        className="mt-1 inline-flex items-center gap-1.5 rounded-xl border px-3 py-1 text-[11px] transition-colors"
        style={{
          borderColor: isPlaying
            ? "rgba(124,110,245,0.6)"
            : "rgba(10, 10, 11,0.12)",
          background: isPlaying
            ? "var(--color-vl-coral-tint)"
            : "rgba(255,255,255,0.55)",
          color: "var(--color-vl-ink)",
        }}
      >
        {playState === "loading" ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : isPlaying ? (
          <Pause className="w-3 h-3" />
        ) : playState === "error" ? (
          <Volume2
            className="w-3 h-3"
            style={{ color: "var(--color-vl-danger)" }}
          />
        ) : (
          <Play className="w-3 h-3" />
        )}
        {isPlaying ? "Stop" : "Play"}
      </button>
    </button>
  );
}
