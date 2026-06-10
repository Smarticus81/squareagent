import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { SignedIn, SignedOut, SignInButton, OrganizationSwitcher } from "@clerk/clerk-react";
import { ArrowLeft, ArrowRight, ArrowUpRight, BarChart3, Building2, CheckCircle2, CreditCard, KeyRound, Loader2, Lock, UserRound } from "lucide-react";
import { getClerkSessionToken } from "@/lib/clerk-session";
import { getPlan } from "@workspace/voicelab-core/pricing";

type BillingSubscription = {
  plan: string | null;
  status: string | null;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
  clerkSubscriptionId?: string | null;
  organizationId?: string | null;
  billingSource?: "local_db" | "clerk_claims" | null;
};

type PlatformConfigStatus = {
  status: "ok";
  nodeEnv: string;
  publicBaseUrlConfigured: boolean;
  databaseConfigured: boolean;
  jwtSecretConfigured: boolean;
  secretsEncryption: {
    configured: boolean;
    source: string;
    productionReady: boolean;
    message?: string;
  };
  providers: {
    openai: ProviderKeyStatus;
    gemini: ProviderKeyStatus;
  };
  billing: {
    clerkPublishableKeyConfigured: boolean;
    clerkSecretKeyConfigured: boolean;
    clerkWebhookSecretConfigured: boolean;
  };
  square: {
    applicationIdConfigured: boolean;
    applicationSecretConfigured: boolean;
  };
};

type ProviderKeyStatus = {
  configured: boolean;
  canonicalEnv?: string;
  sourceEnv?: string | null;
  usingAlias?: boolean;
};

const isClerkLinkedSubscription = (subscription: BillingSubscription | null | undefined) =>
  Boolean(subscription?.clerkSubscriptionId) || subscription?.billingSource === "clerk_claims";

const rememberPendingPlan = (plan: string | null | undefined) => {
  if (plan && plan !== "trial") sessionStorage.setItem("voycelab.pending_plan", plan);
};

function providerReadinessText(label: string, status: ProviderKeyStatus | undefined): string {
  if (!status?.configured) return `${label} key needed`;
  if (status.usingAlias && status.sourceEnv) return `${label} ready via ${status.sourceEnv}`;
  return `${label} ready`;
}

/**
 * Settings — account only.
 *
 * Three things live here: who you are, your password, your plan.
 * Assistant config lives on /assistants. Integrations live on /services.
 * Nothing else belongs on this page.
 */
export default function Settings() {
  const [, setLocation] = useLocation();
  const { data: auth, isLoading, refetch } = useAuth();
  const clerkBillingEnabled = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileMsg, setProfileMsg] = useState<null | { tone: "ok" | "error"; text: string }>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg] = useState<null | { tone: "ok" | "error"; text: string }>(null);

  const [billingLoading, setBillingLoading] = useState(false);
  const [billingMsg, setBillingMsg] = useState<null | { tone: "ok" | "error"; text: string }>(null);
  const [billingStatus, setBillingStatus] = useState<null | {
    provider: "clerk";
    configured: boolean;
    operational?: boolean;
    embeddedCheckoutReady: boolean;
    serverCheckoutReady: boolean;
    portalReady: boolean;
    portalMode?: "external" | "embedded" | "none";
    webhooksReady: boolean;
    secretKeyConfigured: boolean;
    publishableKeyConfigured: boolean;
    subscription?: BillingSubscription | null;
  }>(null);
  const [platformStatus, setPlatformStatus] = useState<PlatformConfigStatus | null>(null);

  useEffect(() => {
    if (!isLoading && !auth?.user) setLocation("/login");
  }, [auth, isLoading, setLocation]);

  useEffect(() => {
    if (auth?.user && !name && !email) {
      setName(auth.user.name ?? "");
      setEmail(auth.user.email ?? "");
    }
  }, [auth?.user, name, email]);

  useEffect(() => {
    if (!auth?.user) return;
    const token = localStorage.getItem("voycelab_token");
    if (!token) return;
    (async () => {
      const clerkToken = await getClerkSessionToken();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (clerkToken) headers["x-clerk-session-token"] = clerkToken;
      const res = await fetch("/api/subscriptions/status", { headers });
      if (!res.ok) return;
      const data = await res.json();
      if (data) setBillingStatus(data);
    })().catch(() => {});
  }, [auth?.user]);

  useEffect(() => {
    if (!auth?.user?.isAdmin) return;
    const token = localStorage.getItem("voycelab_token");
    if (!token) return;
    (async () => {
      const clerkToken = await getClerkSessionToken();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (clerkToken) headers["x-clerk-session-token"] = clerkToken;
      const res = await fetch("/api/healthz/config", {
        headers,
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.status === "ok") setPlatformStatus(data as PlatformConfigStatus);
    })().catch(() => {});
  }, [auth?.user?.isAdmin]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
      </div>
    );
  }
  if (!auth?.user) return null;

  const getHeaders = () => {
    const token = localStorage.getItem("voycelab_token");
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const profileDirty = (name || "") !== (auth.user.name || "") || (email || "") !== (auth.user.email || "");

  const handleProfileUpdate = async (e: FormEvent) => {
    e.preventDefault();
    if (!profileDirty) return;
    setProfileLoading(true);
    setProfileMsg(null);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save your profile.");
      setProfileMsg({ tone: "ok", text: "Saved." });
      refetch();
    } catch (err) {
      setProfileMsg({ tone: "error", text: err instanceof Error ? err.message : "Could not save your profile." });
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordChange = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) return;
    setPwLoading(true);
    setPwMsg(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not change your password.");
      setPwMsg({ tone: "ok", text: "Password updated." });
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setPwMsg({ tone: "error", text: err instanceof Error ? err.message : "Could not change your password." });
    } finally {
      setPwLoading(false);
    }
  };

  const handleManageBilling = async () => {
    setBillingMsg(null);
    const subscription = (billingStatus?.subscription ?? auth?.subscription ?? null) as BillingSubscription | null;
    const status = subscription?.status;

    if (status !== "active") {
      rememberPendingPlan(subscription?.plan ?? auth?.subscription?.plan);
      setLocation("/pricing");
      return;
    }

    if (billingStatus && !isClerkLinkedSubscription(subscription)) {
      rememberPendingPlan(subscription?.plan);
      setBillingMsg({
        tone: "error",
        text: "This plan is active locally, but it is not linked to Clerk Billing yet.",
      });
      setLocation("/pricing");
      return;
    }

    if (billingStatus && !billingStatus.portalReady) {
      setBillingMsg({
        tone: "error",
        text: "Billing portal is not configured on this deployment.",
      });
      return;
    }

    setBillingLoading(true);
    try {
      const clerkToken = await getClerkSessionToken();
      const headers: Record<string, string> = getHeaders();
      if (clerkToken) headers["x-clerk-session-token"] = clerkToken;
      const res = await fetch("/api/subscriptions/portal", {
        method: "POST",
        headers,
      });
      let data: { url?: unknown; error?: unknown } = {};
      try {
        data = await res.json();
      } catch {
        /* ignore */
      }
      if (!res.ok) {
        const msg =
          typeof data.error === "string" && data.error.trim()
            ? data.error.trim()
            : res.status === 503
              ? "Clerk Billing is not configured on this server."
              : "Could not open billing.";
        throw new Error(msg);
      }
      const url = typeof data.url === "string" ? data.url : null;
      if (!url) throw new Error("No billing URL returned.");
      window.location.assign(url);
    } catch (err) {
      setBillingMsg({
        tone: "error",
        text: err instanceof Error ? err.message : "Could not open billing.",
      });
    } finally {
      setBillingLoading(false);
    }
  };

  const effectiveSubscription = (billingStatus?.subscription ?? auth.subscription ?? null) as BillingSubscription | null;
  const status = effectiveSubscription?.status ?? "trialing";
  const plan = effectiveSubscription?.plan ?? auth.subscription?.plan ?? "trial";
  const trialEndsAt = effectiveSubscription?.trialEndsAt ? new Date(effectiveSubscription.trialEndsAt) : null;
  const currentPeriodEnd = effectiveSubscription?.currentPeriodEnd ? new Date(effectiveSubscription.currentPeriodEnd) : null;
  const trialActive = status === "trialing" && (!trialEndsAt || trialEndsAt > new Date());
  const trialExpired = status === "trialing" && trialEndsAt && trialEndsAt < new Date();
  const planActive = status === "active";
  const billingVerifiedByClerk = effectiveSubscription?.billingSource === "clerk_claims";
  const billingLinked = planActive && isClerkLinkedSubscription(effectiveSubscription);
  const billingOperational =
    billingStatus?.operational ??
    Boolean(
      billingStatus?.configured &&
      billingStatus.portalReady &&
      billingStatus.webhooksReady &&
      billingStatus.secretKeyConfigured,
    );
  const daysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return (
    <div className="relative flex-1 overflow-hidden bg-vl-cream px-4 pb-24 pt-16 sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-230">
        {/* Back to assistants */}
        <Link
          href="/assistants"
          className="inline-flex items-center gap-1.5 text-[12px] mb-5 transition-colors"
          style={{ color: "var(--color-vl-ink-muted)" }}
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Assistants
        </Link>

        <p className="vl-eyebrow">Account</p>
        <h1 className="vl-display mt-3 text-[44px] md:text-[58px]" style={{ color: "var(--color-vl-ink)" }}>
          Your account
        </h1>
        <p className="mt-4 max-w-140 text-[15px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
          Sign-in, usage, and billing for your organization.
        </p>

        <div className="mt-10 space-y-4">
          {/* Usage */}
          <UsageCard token={localStorage.getItem("voycelab_token")} plan={plan} />

          {/* Profile */}
          <Section icon={<UserRound className="h-5 w-5" />} title="Profile" description="Your name and email.">
            <form onSubmit={handleProfileUpdate} className="grid sm:grid-cols-2 gap-4">
              <Field label="Name">
                <input value={name} onChange={(e) => setName(e.target.value)} className="vl-compact-input" />
              </Field>
              <Field label="Email">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="vl-compact-input" />
              </Field>
              <div className="sm:col-span-2 flex items-center gap-4 mt-1">
                <button
                  type="submit"
                  disabled={profileLoading || !profileDirty}
                  className="vl-btn-primary inline-flex items-center gap-2 text-[13px] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {profileLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save changes
                </button>
                {profileMsg && (
                  <InlineStatus tone={profileMsg.tone} text={profileMsg.text} />
                )}
              </div>
            </form>
          </Section>

          {/* Password */}
          <Section icon={<Lock className="h-5 w-5" />} title="Password" description="At least 8 characters.">
            <form onSubmit={handlePasswordChange} className="grid sm:grid-cols-2 gap-4">
              <Field label="Current password">
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="vl-compact-input"
                  autoComplete="current-password"
                />
              </Field>
              <Field label="New password">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  className="vl-compact-input"
                  autoComplete="new-password"
                />
              </Field>
              <div className="sm:col-span-2 flex items-center gap-4 mt-1">
                <button
                  type="submit"
                  disabled={pwLoading || !currentPassword || !newPassword}
                  className="vl-btn-ghost inline-flex items-center gap-2 text-[13px] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {pwLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Update password
                </button>
                {pwMsg && <InlineStatus tone={pwMsg.tone} text={pwMsg.text} />}
              </div>
            </form>
          </Section>

          {/* Billing — the one place where intent to upgrade lives */}
          <Section icon={<CreditCard className="h-5 w-5" />} title="Billing" description="Your organization's plan and trial.">
            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div>
                <p className="text-[15px] font-medium" style={{ color: "var(--color-vl-ink)" }}>
                  {planActive
                    ? `${capitalize(plan)} · Active`
                    : trialActive
                    ? `Free trial · ${capitalize(plan)}`
                    : trialExpired
                    ? "Trial ended"
                    : capitalize(status)}
                </p>
                <p className="text-[12.5px] mt-1" style={{ color: "var(--color-vl-ink-muted)" }}>
                  {planActive
                    ? currentPeriodEnd
                      ? `Your organization's plan renews ${currentPeriodEnd.toLocaleDateString()} via Clerk Billing.`
                      : "Your organization's plan renews automatically via Clerk Billing."
                    : trialActive && trialEndsAt
                    ? `${daysLeft} days left · Ends ${trialEndsAt.toLocaleDateString()}`
                    : trialExpired
                    ? "Upgrade your organization to keep using your assistant."
                    : "Pick a plan to get started."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <BillingBadge
                    tone={billingStatus?.configured ? "ok" : "warn"}
                    text={billingStatus?.configured ? "Checkout linked" : "Checkout setup needed"}
                  />
                  <BillingBadge
                    tone={billingStatus?.portalReady ? "ok" : "warn"}
                    text={
                      billingStatus?.portalReady
                        ? billingStatus.portalMode === "external"
                          ? "External portal ready"
                          : "Embedded billing ready"
                        : "Billing management needed"
                    }
                  />
                  <BillingBadge
                    tone={billingStatus?.webhooksReady ? "ok" : "warn"}
                    text={billingStatus?.webhooksReady ? "Webhook active" : "Webhook setup needed"}
                  />
                  <BillingBadge
                    tone={billingStatus?.secretKeyConfigured ? "ok" : "warn"}
                    text={billingStatus?.secretKeyConfigured ? "Server sync ready" : "Server sync needed"}
                  />
                  {planActive && (
                    <BillingBadge
                      tone={billingLinked ? "ok" : "warn"}
                      text={billingVerifiedByClerk ? "Clerk plan verified" : billingLinked ? "Subscription synced" : "Plan active locally"}
                    />
                  )}
                </div>
                {billingStatus && !billingOperational && (
                  <p className="mt-2 max-w-xl text-[12px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
                    Finish Clerk Billing configuration before launch so checkout, the billing portal, webhook sync, and server-side organization matching all work from one account page.
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <button
                  type="button"
                  onClick={handleManageBilling}
                  disabled={billingLoading}
                  className={
                    trialExpired
                      ? "vl-btn-primary inline-flex items-center gap-2 text-[13px]"
                      : "vl-btn-ghost inline-flex items-center gap-2 text-[13px]"
                  }
                >
                  {billingLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {trialExpired ? "Choose a plan" : planActive && !billingLinked ? "Link billing" : planActive ? "Manage billing" : "Upgrade"}
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
                {billingMsg && <InlineStatus tone={billingMsg.tone} text={billingMsg.text} />}
              </div>
            </div>
          </Section>

          {/* Admin-only launch readiness */}
          {auth.user.isAdmin && (
            <Section icon={<KeyRound className="h-5 w-5" />} title="Platform readiness" description="Server-side provider keys and launch checks.">
              <div className="flex flex-wrap gap-2">
                <BillingBadge
                  tone={platformStatus?.providers.openai.configured ? "ok" : "warn"}
                  text={providerReadinessText("OpenAI", platformStatus?.providers.openai)}
                />
                <BillingBadge
                  tone={platformStatus?.providers.gemini.configured ? "ok" : "warn"}
                  text={providerReadinessText("Gemini", platformStatus?.providers.gemini)}
                />
                <BillingBadge
                  tone={platformStatus?.secretsEncryption.productionReady ? "ok" : "warn"}
                  text={platformStatus?.secretsEncryption.productionReady ? "Encryption ready" : "Encryption key needed"}
                />
                <BillingBadge
                  tone={platformStatus?.square.applicationIdConfigured && platformStatus?.square.applicationSecretConfigured ? "ok" : "warn"}
                  text={platformStatus?.square.applicationIdConfigured && platformStatus?.square.applicationSecretConfigured ? "Square OAuth ready" : "Square OAuth needed"}
                />
                <BillingBadge
                  tone={platformStatus?.databaseConfigured && platformStatus?.jwtSecretConfigured ? "ok" : "warn"}
                  text={platformStatus?.databaseConfigured && platformStatus?.jwtSecretConfigured ? "Core server ready" : "Server config needed"}
                />
              </div>
              <p className="mt-3 max-w-xl text-[12px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
                Secret values stay on the server. This page only shows whether each required key is present.
              </p>
            </Section>
          )}

          {clerkBillingEnabled && (
            <Section icon={<Building2 className="h-5 w-5" />} title="Organization" description="Billing is managed at the organization level.">
              <SignedIn>
                <div className="flex items-center gap-4">
                  <OrganizationSwitcher hidePersonal />
                  <Link
                    href="/billing"
                    className="vl-btn-ghost inline-flex items-center gap-2 text-[13px]"
                  >
                    Manage organization billing
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </SignedIn>
              <SignedOut>
                <div className="flex items-center gap-3">
                  <p className="text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                    Sign in with Clerk to manage your organization's billing.
                  </p>
                  <SignInButton mode="modal">
                    <button className="vl-btn-ghost text-[13px]">Sign in</button>
                  </SignInButton>
                </div>
              </SignedOut>
            </Section>
          )}
        </div>

        {/* Post-settings nudge back to the work */}
        <div className="mt-12">
          <p className="vl-eyebrow mb-3">Keep going</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <NextLink
              href="/services"
              title="Connected services"
              hint="Square and other integrations."
            />
            <NextLink
              href="/assistants"
              title="Assistants"
              hint="Open your assistant."
            />
          </div>
        </div>
      </div>

      <style>{`
        .vl-compact-input {
          width: 100%;
          height: 42px;
          padding: 0 14px;
          border-radius: 12px;
          background: rgba(255,255,255,0.72);
          border: 1px solid rgba(10, 10, 11,0.12);
          color: var(--color-vl-ink);
          font-size: 13.5px;
          outline: none;
          transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;
        }
        .vl-compact-input::placeholder { color: rgba(10, 10, 11,0.36); }
        .vl-compact-input:focus {
          border-color: var(--color-vl-coral);
          box-shadow: 0 0 0 3px rgba(99, 102, 241,0.12);
        }
      `}</style>
    </div>
  );
}

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="vl-panel grid gap-6 p-5 md:grid-cols-[220px_1fr] md:gap-8">
      <div className="flex gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--color-vl-coral-tint)", color: "var(--color-vl-coral-deep)" }}>
          {icon}
        </div>
        <div>
        <h2 className="text-[15px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
            {title}
          </h2>
        {description && (
            <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
            {description}
          </p>
        )}
        </div>
      </div>
      <div>{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.14em] mb-1.5" style={{ color: "var(--color-vl-ink-faint)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function InlineStatus({ tone, text }: { tone: "ok" | "error"; text: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[12px]"
      style={{
        color: tone === "ok" ? "var(--color-vl-success)" : "var(--color-vl-danger)",
      }}
    >
      {tone === "ok" && <CheckCircle2 className="w-3.5 h-3.5" />}
      {text}
    </span>
  );
}

function BillingBadge({ tone, text }: { tone: "ok" | "warn"; text: string }) {
  const ok = tone === "ok";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
      style={{
        color: ok ? "var(--color-vl-success)" : "var(--color-vl-ink-muted)",
        borderColor: ok ? "rgba(20, 133, 85, 0.24)" : "rgba(10, 10, 11, 0.12)",
        background: ok ? "rgba(20, 133, 85, 0.08)" : "rgba(255, 255, 255, 0.46)",
      }}
    >
      {ok && <CheckCircle2 className="h-3 w-3" />}
      {text}
    </span>
  );
}

function NextLink({ href, title, hint }: { href: string; title: string; hint: string }) {
  return (
    <Link
      href={href}
      className="group vl-card flex items-center justify-between gap-4 px-5 py-4 transition-colors"
    >
      <div>
        <p className="text-[14px] font-medium" style={{ color: "var(--color-vl-ink)" }}>
          {title}
        </p>
        <p className="text-[12px] mt-0.5" style={{ color: "var(--color-vl-ink-muted)" }}>
          {hint}
        </p>
      </div>
      <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" style={{ color: "var(--color-vl-ink-muted)" }} />
    </Link>
  );
}

function capitalize(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}


function UsageCard({ token, plan }: { token: string | null; plan?: string }) {
  const [data, setData] = useState<{
    voiceMinutes: { used: number };
    topTools: { toolName: string; count: number }[];
    recentErrors: { toolName: string; errorMessage: string | null; createdAt: string }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError("Sign in again to load usage.");
      return;
    }
    setLoading(true);
    setError(null);
    fetch("/api/v1/usage/current", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        const payload = await r.json().catch(() => null);
        if (!r.ok) throw new Error(payload?.error ?? "Usage is unavailable right now.");
        setData(payload);
      })
      .catch((err) => {
        setData(null);
        setError(err instanceof Error ? err.message : "Usage is unavailable right now.");
      })
      .finally(() => setLoading(false));
  }, [token]);

  const limit = getPlan(plan ?? "trial")?.includedVoiceMinutes ?? getPlan("trial")?.includedVoiceMinutes ?? 60;
  const used = data?.voiceMinutes?.used ?? 0;
  const hasFiniteLimit = limit !== -1;
  const pct = hasFiniteLimit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const limitLabel = hasFiniteLimit ? limit.toLocaleString() : "Unlimited";

  return (
    <Section icon={<BarChart3 className="h-5 w-5" />} title="Usage" description="Voice minutes and command activity this period.">
      {loading ? (
        <div className="flex items-center gap-2 py-4">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
          <span className="text-sm" style={{ color: "var(--color-vl-ink-muted)" }}>Loading usage...</span>
        </div>
      ) : error ? (
        <p className="text-sm py-4" style={{ color: "var(--color-vl-coral-deep, #e04323)" }}>
          {error}
        </p>
      ) : (
        <div className="space-y-5">
          <div>
            <div className="flex justify-between text-sm mb-1.5">
              <span style={{ color: "var(--color-vl-ink)" }}>Voice minutes</span>
              <span className="tabular-nums" style={{ color: "var(--color-vl-ink-muted)" }}>
                {used.toLocaleString()} / {limitLabel}
              </span>
            </div>
            {hasFiniteLimit && (
              <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "var(--color-vl-ink-faint, #e5e5e5)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${pct}%`,
                    background: pct > 80 ? "var(--color-vl-coral-deep, #e04323)" : "var(--color-vl-accent, #ff6b47)",
                  }}
                />
              </div>
            )}
            {hasFiniteLimit && pct >= 80 && (
              <p className="text-xs mt-1" style={{ color: "var(--color-vl-coral-deep, #e04323)" }}>
                {pct >= 100 ? "Overage: charges apply beyond your plan limit" : "Approaching plan limit"}
              </p>
            )}
          </div>

          {data?.topTools && data.topTools.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--color-vl-ink-faint)" }}>Top commands</p>
              <div className="space-y-1">
                {data.topTools.map((t) => (
                  <div key={t.toolName} className="flex justify-between text-sm">
                    <span style={{ color: "var(--color-vl-ink)" }}>{t.toolName.replace(/_/g, " ")}</span>
                    <span className="tabular-nums" style={{ color: "var(--color-vl-ink-muted)" }}>{t.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data?.recentErrors && data.recentErrors.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--color-vl-ink-faint)" }}>Recent errors</p>
              <div className="space-y-1 text-xs" style={{ color: "var(--color-vl-ink-muted)" }}>
                {data.recentErrors.slice(0, 5).map((e, i) => (
                  <div key={i}>{e.toolName}: {e.errorMessage ?? "unknown"}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
