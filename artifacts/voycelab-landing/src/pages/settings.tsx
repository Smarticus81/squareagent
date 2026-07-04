import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { rememberIntendedPath } from "@/lib/post-login-redirect";
import { SignedIn, SignedOut, OrganizationSwitcher } from "@clerk/clerk-react";
import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Building2,
  Check,
  CheckCircle2,
  CreditCard,
  KeyRound,
  Loader2,
  Lock,
  Mic,
  ShieldCheck,
  Sparkles,
  Store,
  Terminal,
  UserRound,
  UsersRound,
  Activity,
  AlertCircle,
  AlertTriangle,
  Search,
  HelpCircle,
  X
} from "lucide-react";
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

type AdminOverview = {
  windowDays: number;
  roles: { role: string; label: string; permissions: string[] }[];
  totals: {
    users: number;
    organizations: number;
    venues: number;
    assistants: number;
    voiceMinutes: number;
    toolCalls: number;
    failedToolCalls: number;
  };
  pipelines: { provider: string; displayName: string; status: string; reason?: string | null; missing?: string[] }[];
  topTools: { toolName: string; count: number }[];
  recentErrors: { userId: number | null; email: string | null; toolName: string; errorMessage: string | null; createdAt: string }[];
  users: AdminUserAccess[];
};

type AdminUserAccess = {
  id: number;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  organization: { id: string; name: string | null; role: string } | null;
  subscription: { plan: string; status: string; trialEndsAt?: string | null; currentPeriodEnd?: string | null } | null;
  usage: {
    voiceMinutes: number;
    toolCalls: number;
    failedToolCalls: number;
    lastActivityAt: string | null;
    includedMinutes: number;
    hardCapMinutes: number;
    includedPercent: number;
    hardCapPercent: number;
    overIncluded: boolean;
    overIncludedMinutes: number;
    remainingIncludedMinutes: number;
    remainingToHardCapMinutes: number;
    risk: "ok" | "watch" | "over_included" | "near_cap" | "blocked";
  };
};

type AdminAccessPatch = Partial<{ plan: string; status: string; role: string }>;

type AdminActionModalState =
  | {
      kind: "quick";
      title: string;
      description: string;
      confirmLabel: string;
      user: AdminUserAccess;
      patch: AdminAccessPatch;
      tone?: "default" | "danger";
    }
  | {
      kind: "custom";
      title: string;
      description: string;
      confirmLabel: string;
      user: AdminUserAccess;
      draft: { plan: string; status: string; role: string };
      fields: Array<"plan" | "status" | "role">;
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
  const [settingsTab, setSettingsTab] = useState<"account" | "admin">("account");

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
    if (!isLoading && !auth?.user) { rememberIntendedPath(); setLocation("/login"); }
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

  useEffect(() => {
    if (!auth?.user?.isAdmin && settingsTab === "admin") setSettingsTab("account");
  }, [auth?.user?.isAdmin, settingsTab]);

  if (isLoading) {
    return (
      <div className="vl-page-shell flex min-h-screen flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--color-vl-coral)" }} />
          <span className="text-sm font-medium text-slate-500">Loading settings...</span>
        </div>
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
      setProfileMsg({ tone: "ok", text: "Saved successfully." });
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
      setPwMsg({ tone: "ok", text: "Password updated successfully." });
      setCurrentPassword("");
      newPassword && setNewPassword("");
    } catch (err) {
      setPwMsg({ tone: "error", text: err instanceof Error ? err.message : "Could not change your password." });
    } finally {
      setPwLoading(false);
    }
  };

  const handleManageBilling = async () => {
    setBillingMsg(null);
    if (auth?.user?.isAdmin) {
      setBillingMsg({ tone: "ok", text: "Platform admin access is already unlimited." });
      return;
    }
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
  const launchReadiness = [
    {
      isCompleted: Boolean(platformStatus?.providers.openai.configured || platformStatus?.providers.gemini.configured),
      label: "Realtime voice is online",
      subtext: platformStatus?.providers.openai.configured
        ? providerReadinessText("OpenAI", platformStatus?.providers.openai)
        : providerReadinessText("Gemini", platformStatus?.providers.gemini),
    },
    {
      isCompleted: Boolean(platformStatus?.square.applicationIdConfigured && platformStatus?.square.applicationSecretConfigured),
      label: "Square actions are available",
      subtext: platformStatus?.square.applicationIdConfigured && platformStatus?.square.applicationSecretConfigured
        ? "Assistants can connect to venue POS data"
        : "Square connection needs production credentials",
    },
    {
      isCompleted: Boolean(platformStatus?.databaseConfigured && platformStatus?.jwtSecretConfigured && platformStatus?.secretsEncryption.productionReady),
      label: "Secure sessions are protected",
      subtext: platformStatus?.databaseConfigured && platformStatus?.jwtSecretConfigured && platformStatus?.secretsEncryption.productionReady
        ? "Accounts, tokens, and sessions are secured"
        : "Account security needs production configuration",
    },
    {
      isCompleted: Boolean(billingOperational),
      label: "Billing sync is live",
      subtext: billingOperational ? "Plans and renewals can sync automatically" : "Billing portal or webhook setup is incomplete",
    },
  ];
  const launchReadyCount = launchReadiness.filter((item) => item.isCompleted).length;

  return (
    <div className="vl-page-shell relative flex-1 overflow-hidden px-4 pb-24 pt-16 sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-[1540px]">
        {/* Back link */}
        <Link
          href="/assistants"
          className="inline-flex items-center gap-1.5 text-[13px] mb-5 font-semibold transition-colors hover:text-[#FF6B47]"
          style={{ color: "var(--color-vl-ink-muted)" }}
        >
          <ArrowLeft className="w-4 h-4" /> Back to Assistants
        </Link>

        <p className="vl-eyebrow uppercase tracking-widest text-[11px] font-bold">Account Settings</p>
        <h1 className="vl-display mt-3 text-[44px] md:text-[58px] leading-none" style={{ color: "var(--color-vl-ink)" }}>
          Your account
        </h1>
        <p className="mt-3 max-w-140 text-[15px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
          Manage your personal profile, credentials, organization details, and access our administrative panel.
        </p>

        {auth.user.isAdmin && (
          <div className="mt-8 flex justify-start">
            <div className="inline-flex rounded-2xl border bg-white/70 p-1.5 shadow-sm" role="tablist" aria-label="Account sections" style={{ borderColor: "rgba(10,10,11,0.08)" }}>
              <button
                type="button"
                role="tab"
                aria-selected={settingsTab === "account"}
                onClick={() => setSettingsTab("account")}
                className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13.5px] font-bold transition-all duration-200"
                style={{
                  color: settingsTab === "account" ? "var(--color-vl-ink)" : "var(--color-vl-ink-muted)",
                  background: settingsTab === "account" ? "#fff" : "transparent",
                  boxShadow: settingsTab === "account" ? "0 4px 12px rgba(10,10,11,0.05)" : "none",
                }}
              >
                <UserRound className="h-4 w-4" />
                Account Details
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={settingsTab === "admin"}
                onClick={() => setSettingsTab("admin")}
                className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13.5px] font-bold transition-all duration-200"
                style={{
                  color: settingsTab === "admin" ? "var(--color-vl-ink)" : "var(--color-vl-ink-muted)",
                  background: settingsTab === "admin" ? "#fff" : "transparent",
                  boxShadow: settingsTab === "admin" ? "0 4px 12px rgba(10,10,11,0.05)" : "none",
                }}
              >
                <ShieldCheck className="h-4 w-4" />
                Admin Console
              </button>
            </div>
          </div>
        )}

        {settingsTab === "admin" && auth.user.isAdmin ? (
          <AdminConsole token={localStorage.getItem("voycelab_token")} />
        ) : (
          <div className="mt-10 grid items-stretch gap-5 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
              <Section icon={<CreditCard className="h-5 w-5" />} title="Subscription & Billing" description="Manage plans, renewals and subscriptions.">
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div>
                    <p className="text-[18px] font-bold leading-tight" style={{ color: "var(--color-vl-ink)" }}>
                      {auth.user.isAdmin
                        ? "Platform Admin — Unlimited Scale"
                        : planActive
                        ? `${capitalize(plan)} Tier · Active Subscription`
                        : trialActive
                        ? `Free Trial · ${capitalize(plan)} Tier`
                        : trialExpired
                        ? "Free Trial Expired"
                        : `${capitalize(status)} Subscription`}
                    </p>
                    <p className="mt-2 max-w-130 text-[13px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
                      {auth.user.isAdmin
                        ? "All voice assistants, commands, and low-latency pipelines are fully unlocked for testing."
                        : planActive
                        ? currentPeriodEnd
                          ? `Your plan renews on ${currentPeriodEnd.toLocaleDateString()} through our secure billing partner.`
                          : "Your plan renews automatically through our secure billing partner."
                        : trialActive && trialEndsAt
                        ? `${daysLeft} days remaining in trial (ends ${trialEndsAt.toLocaleDateString()}).`
                        : trialExpired
                        ? "Upgrade to a professional plan to restore your voice assistants and resume services."
                        : "Pick a plan to activate services."}
                    </p>
                    {planActive && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <BillingBadge
                          tone={billingLinked ? "ok" : "warn"}
                          text={billingLinked ? "Subscription active & synced" : "Finalizing cloud sync…"}
                        />
                      </div>
                    )}

                    {auth.user.isAdmin && billingStatus && (
                      <div className="mt-5 border-t pt-4" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
                        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Launch Diagnostics</p>
                        <div className="flex flex-wrap gap-2.5">
                          <BillingBadge tone={billingStatus.configured ? "ok" : "warn"} text={billingStatus.configured ? "Stripe Connected" : "Stripe Integration Needed"} />
                          <BillingBadge
                            tone={billingStatus.portalReady ? "ok" : "warn"}
                            text={
                              billingStatus.portalReady
                                ? billingStatus.portalMode === "external"
                                  ? "Portal Online (External)"
                                  : "Portal Online (Embedded)"
                                : "Portal Offline"
                            }
                          />
                          <BillingBadge tone={billingStatus.webhooksReady ? "ok" : "warn"} text={billingStatus.webhooksReady ? "Sync Webhook Online" : "Webhook Pending Setup"} />
                          <BillingBadge tone={billingStatus.secretKeyConfigured ? "ok" : "warn"} text={billingStatus.secretKeyConfigured ? "Sync Key Configured" : "Sync Key Needed"} />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-start gap-2.5 lg:items-end">
                    <button
                      type="button"
                      onClick={handleManageBilling}
                      disabled={billingLoading}
                      className={
                        trialExpired
                          ? "vl-btn-primary inline-flex items-center gap-2 text-[13.5px] shadow-sm transition-all duration-200 hover:shadow"
                          : "vl-btn-ghost inline-flex items-center gap-2 text-[13.5px] transition-all duration-200 hover:bg-slate-50"
                      }
                    >
                      {billingLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {auth.user.isAdmin ? "Admin access" : trialExpired ? "Choose plan" : planActive && !billingLinked ? "Complete sync" : planActive ? "Manage subscription" : "Upgrade"}
                      {!auth.user.isAdmin && <ArrowUpRight className="w-3.5 h-3.5" />}
                    </button>
                    {billingMsg && <InlineStatus tone={billingMsg.tone} text={billingMsg.text} />}
                  </div>
                </div>
              </Section>

              {auth.user.isAdmin && (
                <Section icon={<KeyRound className="h-5 w-5" />} title="Launch Readiness" description="Confirm the live product is ready for customers.">
                  <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
                    <div className="rounded-[24px] border p-5" style={{ borderColor: "rgba(10,10,11,0.08)", background: "linear-gradient(135deg, rgba(124,110,245,0.12), rgba(255,107,71,0.10), rgba(79,184,255,0.10))" }}>
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
                        Production score
                      </p>
                      <p className="mt-4 text-[54px] font-black leading-none tabular-nums" style={{ color: "var(--color-vl-ink)" }}>
                        {launchReadyCount}/{launchReadiness.length}
                      </p>
                      <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
                        This checks what customers actually experience: voice, POS actions, secure sessions, and billing sync.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {launchReadiness.map((item) => (
                        <ChecklistItem key={item.label} isCompleted={item.isCompleted} label={item.label} subtext={item.subtext} />
                      ))}
                    </div>
                  </div>
                </Section>
              )}
              <UsageCard token={localStorage.getItem("voycelab_token")} plan={plan} isAdmin={auth.user.isAdmin} />

              <Section icon={<UserRound className="h-5 w-5" />} title="Profile Details" description="Your basic identity information.">
                <form onSubmit={handleProfileUpdate} className="grid gap-4">
                  <Field label="Full Name">
                    <input value={name} onChange={(e) => setName(e.target.value)} className="vl-compact-input shadow-sm" placeholder="Your name" />
                  </Field>
                  <Field label="Email Address">
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="vl-compact-input shadow-sm" placeholder="Your email address" />
                  </Field>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: "rgba(10,10,11,0.05)" }}>
                    <button
                      type="submit"
                      disabled={profileLoading || !profileDirty}
                      className="vl-btn-primary inline-flex items-center gap-2 text-[13px] shadow-sm transition-all duration-200 hover:shadow disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {profileLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Save profile
                    </button>
                    {profileMsg && <InlineStatus tone={profileMsg.tone} text={profileMsg.text} />}
                  </div>
                </form>
              </Section>

              <Section icon={<Lock className="h-5 w-5" />} title="Security Credentials" description="Update your access password.">
                <form onSubmit={handlePasswordChange} className="grid gap-4">
                  <Field label="Current Password">
                    <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="vl-compact-input shadow-sm" autoComplete="current-password" placeholder="••••••••" />
                  </Field>
                  <Field label="New Password">
                    <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} className="vl-compact-input shadow-sm" autoComplete="new-password" placeholder="Min 8 characters" />
                  </Field>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: "rgba(10,10,11,0.05)" }}>
                    <button
                      type="submit"
                      disabled={pwLoading || !currentPassword || !newPassword}
                      className="vl-btn-ghost inline-flex items-center gap-2 text-[13px] transition-all duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {pwLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Update password
                    </button>
                    {pwMsg && <InlineStatus tone={pwMsg.tone} text={pwMsg.text} />}
                  </div>
                </form>
              </Section>

            {clerkBillingEnabled && (
              <Section icon={<Building2 className="h-5 w-5" />} title="Workspaces & Organizations" description="Manage sharing and collaborative workspaces.">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                  <SignedIn>
                    <div className="flex flex-wrap items-center gap-4">
                      <OrganizationSwitcher hidePersonal />
                      <Link
                        href="/billing"
                        className="vl-btn-ghost inline-flex items-center gap-2 text-[13px] hover:bg-slate-50 transition-all duration-200"
                      >
                        Organization billing
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </SignedIn>
                  <SignedOut>
                    <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                      <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                      Preparing your secure workspace...
                    </div>
                  </SignedOut>
                </div>
              </Section>
            )}
          </div>
        )}

      </div>

      <style>{`
        .vl-compact-input {
          width: 100%;
          height: 44px;
          padding: 0 16px;
          border-radius: 14px;
          background: rgba(255,255,255,0.78);
          border: 1px solid rgba(14,27,44,0.12);
          color: var(--color-vl-ink);
          font-size: 14px;
          outline: none;
          transition: all .2s ease;
        }
        .vl-compact-input::placeholder { color: rgba(14,27,44,0.3); }
        .vl-compact-input:focus {
          border-color: #FF6B47;
          background: #fff;
          box-shadow: 0 0 0 4px rgba(255, 107, 71, 0.08);
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
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="vl-panel group flex aspect-square min-h-[210px] flex-col justify-between overflow-hidden rounded-[28px] border p-4 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
        style={{ borderColor: "rgba(14,27,44,0.05)" }}
      >
        <PremiumSettingsArt title={title} />

        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
            Settings
          </p>
          <h2 className="mt-2 text-[19px] font-bold leading-tight" style={{ color: "var(--color-vl-ink)" }}>
            {title}
          </h2>
          {description && (
            <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
              {description}
            </p>
          )}
        </div>

        <span className="text-[11.5px] font-bold" style={{ color: "var(--color-vl-coral-deep)" }}>
          Open
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
            className="relative flex max-h-[88vh] w-full max-w-[960px] flex-col overflow-hidden rounded-[28px] border bg-white shadow-2xl"
            style={{ borderColor: "rgba(10,10,11,0.10)" }}
          >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b p-6" style={{ borderColor: "rgba(10,10,11,0.08)" }}>
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-orange-100 shadow-sm" style={{ background: "var(--color-vl-coral-tint)", color: "var(--color-vl-coral-deep)" }}>
                  {icon}
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
                    Account settings
                  </p>
                  <h2 className="mt-1 text-[28px] font-bold leading-tight" style={{ color: "var(--color-vl-ink)" }}>
                    {title}
                  </h2>
                  {description && (
                    <p className="mt-1 max-w-140 text-[13px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
                      {description}
                    </p>
                  )}
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

function PremiumSettingsArt({ title }: { title: string }) {
  const palette = getSettingsArtPalette(title);
  const bars = title.includes("Usage")
    ? [34, 54, 42, 76, 62, 88]
    : title.includes("Launch")
      ? [76, 76, 76, 52, 76, 52]
      : title.includes("Security")
        ? [44, 68, 84, 68, 44, 28]
        : [52, 68, 46, 82, 58, 72];

  return (
    <div
      className="relative h-[96px] w-full overflow-hidden rounded-[22px] border shadow-inner"
      style={{
        borderColor: palette.border,
        background: `linear-gradient(135deg, ${palette.start}, ${palette.mid} 48%, ${palette.end})`,
      }}
    >
      <div
        className="absolute -right-8 -top-12 h-32 w-32 rounded-[36%] blur-2xl"
        style={{ background: palette.glow }}
      />
      <div
        className="absolute -bottom-12 -left-10 h-32 w-32 rounded-[40%] blur-2xl"
        style={{ background: palette.soft }}
      />
      <div className="absolute inset-x-4 bottom-4 flex h-14 items-end gap-1.5">
        {bars.map((height, index) => (
          <span
            key={`${title}-${index}`}
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
        style={{ borderColor: "rgba(255,255,255,0.55)", background: "rgba(255,255,255,0.42)" }}
      >
        {title.includes("Billing") && <BillingGlyph color={palette.ink} />}
        {title.includes("Launch") && <LaunchGlyph color={palette.ink} />}
        {title.includes("Usage") && <UsageGlyph color={palette.ink} />}
        {title.includes("Profile") && <ProfileGlyph color={palette.ink} />}
        {title.includes("Security") && <SecurityGlyph color={palette.ink} />}
        {title.includes("Workspaces") && <WorkspaceGlyph color={palette.ink} />}
      </div>
      <div
        className="absolute right-4 top-4 h-3 w-12 rounded-md"
        style={{ background: palette.line, opacity: 0.75 }}
      />
      <div
        className="absolute right-4 top-9 h-3 w-8 rounded-md"
        style={{ background: palette.lineAlt, opacity: 0.65 }}
      />
    </div>
  );
}

function getSettingsArtPalette(title: string) {
  if (title.includes("Billing")) {
    return {
      start: "rgba(255,107,71,0.20)",
      mid: "rgba(255,185,90,0.22)",
      end: "rgba(255,255,255,0.88)",
      glow: "rgba(255,107,71,0.45)",
      soft: "rgba(255,185,90,0.32)",
      line: "rgba(255,107,71,0.72)",
      lineAlt: "rgba(14,27,44,0.72)",
      border: "rgba(255,107,71,0.18)",
      ink: "#8F2F1D",
    };
  }
  if (title.includes("Launch")) {
    return {
      start: "rgba(124,110,245,0.22)",
      mid: "rgba(79,184,255,0.20)",
      end: "rgba(255,255,255,0.88)",
      glow: "rgba(124,110,245,0.42)",
      soft: "rgba(79,184,255,0.34)",
      line: "rgba(124,110,245,0.74)",
      lineAlt: "rgba(79,184,255,0.78)",
      border: "rgba(124,110,245,0.18)",
      ink: "#332B93",
    };
  }
  if (title.includes("Usage")) {
    return {
      start: "rgba(47,158,100,0.20)",
      mid: "rgba(79,184,255,0.18)",
      end: "rgba(255,255,255,0.88)",
      glow: "rgba(47,158,100,0.40)",
      soft: "rgba(79,184,255,0.32)",
      line: "rgba(47,158,100,0.78)",
      lineAlt: "rgba(14,27,44,0.68)",
      border: "rgba(47,158,100,0.18)",
      ink: "#17633B",
    };
  }
  if (title.includes("Security")) {
    return {
      start: "rgba(14,27,44,0.16)",
      mid: "rgba(124,110,245,0.18)",
      end: "rgba(255,255,255,0.88)",
      glow: "rgba(14,27,44,0.28)",
      soft: "rgba(124,110,245,0.32)",
      line: "rgba(14,27,44,0.76)",
      lineAlt: "rgba(124,110,245,0.74)",
      border: "rgba(14,27,44,0.12)",
      ink: "#0E1B2C",
    };
  }
  if (title.includes("Workspaces")) {
    return {
      start: "rgba(255,107,71,0.16)",
      mid: "rgba(124,110,245,0.18)",
      end: "rgba(255,255,255,0.88)",
      glow: "rgba(124,110,245,0.34)",
      soft: "rgba(255,107,71,0.30)",
      line: "rgba(124,110,245,0.74)",
      lineAlt: "rgba(255,107,71,0.70)",
      border: "rgba(124,110,245,0.16)",
      ink: "#3C2FA6",
    };
  }
  return {
    start: "rgba(79,184,255,0.18)",
    mid: "rgba(255,107,71,0.16)",
    end: "rgba(255,255,255,0.88)",
    glow: "rgba(79,184,255,0.34)",
    soft: "rgba(255,107,71,0.30)",
    line: "rgba(79,184,255,0.74)",
    lineAlt: "rgba(255,107,71,0.70)",
    border: "rgba(79,184,255,0.16)",
    ink: "#135D82",
  };
}

function BillingGlyph({ color }: { color: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <rect x="5" y="7" width="20" height="16" rx="5" fill="none" stroke={color} strokeWidth="2.2" />
      <path d="M8 12h14M10 18h5" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M19 18h3" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function LaunchGlyph({ color }: { color: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <path d="M15 4l8 4v7c0 5.2-3.4 8.7-8 11-4.6-2.3-8-5.8-8-11V8l8-4z" fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M11 15l2.7 2.7L20 11.5" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UsageGlyph({ color }: { color: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <path d="M6 21V9M12 21V5M18 21v-8M24 21V7" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M5 24h20" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function ProfileGlyph({ color }: { color: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <path d="M15 15.5a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" fill="none" stroke={color} strokeWidth="2.2" />
      <path d="M6.5 25c1.4-4.5 4.4-6.8 8.5-6.8s7.1 2.3 8.5 6.8" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function SecurityGlyph({ color }: { color: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <rect x="7" y="13" width="16" height="11" rx="4" fill="none" stroke={color} strokeWidth="2.2" />
      <path d="M10.5 13V10a4.5 4.5 0 0 1 9 0v3" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M15 17.5v3" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function WorkspaceGlyph({ color }: { color: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <path d="M6 24V9l8-4 8 4v15" fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M11 24v-7h8v7M10 12h2M18 12h2" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AdminPanel({
  icon,
  title,
  description,
  children,
  right,
  className,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`vl-panel rounded-3xl border p-5 shadow-sm ${className ?? ""}`} style={{ borderColor: "rgba(14,27,44,0.06)" }}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b pb-4" style={{ borderColor: "rgba(14,27,44,0.06)" }}>
        <div className="flex min-w-0 items-start gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-orange-100 shadow-sm" style={{ background: "var(--color-vl-coral-tint)", color: "var(--color-vl-coral-deep)" }}>
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold leading-snug" style={{ color: "var(--color-vl-ink)" }}>
              {title}
            </h2>
            {description && (
              <p className="mt-1 max-w-160 text-[12.5px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
                {description}
              </p>
            )}
          </div>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.16em] mb-2 font-bold" style={{ color: "var(--color-vl-ink-faint)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function InlineStatus({ tone, text }: { tone: "ok" | "error"; text: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[12.5px] font-bold"
      style={{
        color: tone === "ok" ? "var(--color-vl-success)" : "var(--color-vl-danger)",
      }}
    >
      {tone === "ok" ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" /> : <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />}
      {text}
    </span>
  );
}

function BillingBadge({ tone, text }: { tone: "ok" | "warn"; text: string }) {
  const ok = tone === "ok";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1 text-[11.5px] font-bold shadow-sm"
      style={{
        color: ok ? "var(--color-vl-success)" : "#D97706",
        borderColor: ok ? "rgba(20, 133, 85, 0.2)" : "rgba(217, 119, 6, 0.2)",
        background: ok ? "rgba(20, 133, 85, 0.05)" : "rgba(217, 119, 6, 0.05)",
      }}
    >
      <span className={`h-1.5 w-1.5 rounded-[3px] ${ok ? 'bg-emerald-500' : 'bg-amber-500'} ${ok ? 'animate-pulse' : ''}`} />
      {text}
    </span>
  );
}

function ChecklistItem({ isCompleted, label, subtext }: { isCompleted: boolean; label: string; subtext: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border bg-white/50 p-4 shadow-sm" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
      <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${isCompleted ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-amber-50 border-amber-200 text-amber-600'}`}>
        {isCompleted ? <Check className="h-3.5 w-3.5 font-bold" /> : <HelpCircle className="h-3.5 w-3.5" />}
      </div>
      <div>
        <p className="text-[13px] font-bold" style={{ color: "var(--color-vl-ink)" }}>{label}</p>
        <p className="text-[11.5px] mt-0.5 leading-snug" style={{ color: "var(--color-vl-ink-muted)" }}>{subtext}</p>
      </div>
    </div>
  );
}

function capitalize(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function AdminConsole({ token }: { token: string | null }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [usageFilter, setUsageFilter] = useState<"all" | "watch" | "over_included" | "near_cap" | "blocked">("all");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [actionMsg, setActionMsg] = useState<null | { tone: "ok" | "error"; text: string }>(null);
  const [actionModal, setActionModal] = useState<AdminActionModalState | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [controlCenterOpen, setControlCenterOpen] = useState(false);
  const [enginesOpen, setEnginesOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);

  const load = async () => {
    if (!token) {
      setError("Sign in again to load admin controls.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/overview", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error?.message ?? "Admin overview is unavailable.");
      setData(payload as AdminOverview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin overview is unavailable.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  useEffect(() => {
    if (!data?.users.length) return;
    if (!selectedUserId || !data.users.some((user) => user.id === selectedUserId)) {
      setSelectedUserId(data.users[0].id);
    }
  }, [data, selectedUserId]);

  const patchAccess = async (
    user: AdminUserAccess,
    patch: AdminAccessPatch,
    successText: string,
  ) => {
    if (!token) return;
    setSavingId(user.id);
    setError(null);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/v1/admin/users/${user.id}/access`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...patch,
          organizationId: user.organization?.id ?? undefined,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error?.message ?? "Could not update access.");
      await load();
      setSelectedUserId(user.id);
      setActionMsg({ tone: "ok", text: successText });
      setActionModal(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update access.";
      setError(message);
      setActionMsg({ tone: "error", text: message });
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="mt-10 flex items-center gap-3 py-6 justify-center rounded-2xl bg-white/40 border" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
        <Loader2 className="h-5 w-5 animate-spin text-[#FF6B47]" />
        <span className="text-[13.5px] font-bold" style={{ color: "var(--color-vl-ink-muted)" }}>Loading secure admin workspace...</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mt-10">
        <Section icon={<ShieldCheck className="h-5 w-5" />} title="Admin Operations" description="Control panel details.">
          <div className="flex items-center justify-between gap-4">
            <p className="text-[13px] font-bold" style={{ color: "var(--color-vl-danger)" }}>{error}</p>
            <button type="button" className="vl-btn-ghost text-[13px] py-1.5 px-4 rounded-xl border border-red-200" onClick={() => void load()}>Retry Connection</button>
          </div>
        </Section>
      </div>
    );
  }

  if (!data) return null;

  const usageRiskRank: Record<AdminUserAccess["usage"]["risk"], number> = {
    blocked: 5,
    near_cap: 4,
    over_included: 3,
    watch: 2,
    ok: 1,
  };
  const filteredUsers = data.users.filter((user) => {
    const q = searchQuery.toLowerCase();
    const matchesQuery = (
      user.name?.toLowerCase().includes(q) ||
      user.email?.toLowerCase().includes(q) ||
      user.subscription?.plan?.toLowerCase().includes(q) ||
      user.organization?.name?.toLowerCase().includes(q)
    );
    const matchesUsage =
      usageFilter === "all" ||
      (usageFilter === "watch" && user.usage.risk !== "ok") ||
      user.usage.risk === usageFilter;
    return matchesQuery && matchesUsage;
  }).sort((a, b) => {
    const riskDelta = usageRiskRank[b.usage.risk] - usageRiskRank[a.usage.risk];
    if (riskDelta !== 0) return riskDelta;
    return b.usage.hardCapPercent - a.usage.hardCapPercent;
  });
  const selectedUser =
    (selectedUserId ? filteredUsers.find((user) => user.id === selectedUserId) : null) ??
    filteredUsers[0] ??
    data.users[0] ??
    null;
  const selectedDraft = selectedUser
    ? {
        plan: selectedUser.subscription?.plan ?? "trial",
        status: selectedUser.subscription?.status ?? "trialing",
        role: selectedUser.organization?.role ?? "owner",
      }
    : null;
  const inactiveUsers = data.users.filter((user) => ["inactive", "canceled", "past_due"].includes(user.subscription?.status ?? ""));
  const blockedUsers = data.users.filter((user) => user.usage.risk === "blocked");
  const nearCapUsers = data.users.filter((user) => user.usage.risk === "near_cap");
  const overIncludedUsers = data.users.filter((user) => user.usage.risk === "over_included");
  const watchUsers = data.users.filter((user) => user.usage.risk !== "ok");

  return (
    <div className="mt-10 grid items-stretch gap-5 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-4">
      {/* 1. Platform Control Center Card */}
      <button
        type="button"
        onClick={() => setControlCenterOpen(true)}
        className="vl-panel group flex aspect-square min-h-[210px] flex-col justify-between overflow-hidden rounded-[28px] border p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg bg-white"
        style={{ borderColor: "rgba(14,27,44,0.05)" }}
      >
        <PremiumSettingsArt title="Platform Control Center" />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
            Admin console
          </p>
          <h2 className="mt-2 text-[19px] font-bold leading-tight" style={{ color: "var(--color-vl-ink)" }}>
            Platform Control Center
          </h2>
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
            Search active accounts, adjust voice minute balances, change subscription tiers, or suspend/resume users.
          </p>
        </div>
        <span className="text-[11.5px] font-bold flex items-center gap-1" style={{ color: "var(--color-vl-coral-deep)" }}>
          Manage Accounts &rarr;
        </span>
      </button>

      {/* 2. System Diagnostics Card */}
      <button
        type="button"
        onClick={() => setDiagnosticsOpen(true)}
        className="vl-panel group flex aspect-square min-h-[210px] flex-col justify-between overflow-hidden rounded-[28px] border p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg bg-white"
        style={{ borderColor: "rgba(14,27,44,0.05)" }}
      >
        <PremiumSettingsArt title="System Diagnostics" />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
            System health
          </p>
          <h2 className="mt-2 text-[19px] font-bold leading-tight" style={{ color: "var(--color-vl-ink)" }}>
            System Diagnostics
          </h2>
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
            Execute dynamic health checks. Monitor database latency, environment keys, and OpenAI/Gemini connectivity.
          </p>
        </div>
        <span className="text-[11.5px] font-bold flex items-center gap-1" style={{ color: "var(--color-vl-coral-deep)" }}>
          Run Health Check &rarr;
        </span>
      </button>

      {/* 3. Voice Engines Card */}
      <button
        type="button"
        onClick={() => setEnginesOpen(true)}
        className="vl-panel group flex aspect-square min-h-[210px] flex-col justify-between overflow-hidden rounded-[28px] border p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg bg-white"
        style={{ borderColor: "rgba(14,27,44,0.05)" }}
      >
        <PremiumSettingsArt title="Voice Pipelines" />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
            Pipelines
          </p>
          <h2 className="mt-2 text-[19px] font-bold leading-tight" style={{ color: "var(--color-vl-ink)" }}>
            Voice Engines & Pipelines
          </h2>
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
            Trace availability, capabilities, and configurations for real-time speech platforms and engines.
          </p>
        </div>
        <span className="text-[11.5px] font-bold flex items-center gap-1" style={{ color: "var(--color-vl-coral-deep)" }}>
          Check Engines &rarr;
        </span>
      </button>

      {/* 4. Roles Card */}
      <button
        type="button"
        onClick={() => setRolesOpen(true)}
        className="vl-panel group flex aspect-square min-h-[210px] flex-col justify-between overflow-hidden rounded-[28px] border p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg bg-white"
        style={{ borderColor: "rgba(14,27,44,0.05)" }}
      >
        <PremiumSettingsArt title="Workspace Roles" />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
            Access policy
          </p>
          <h2 className="mt-2 text-[19px] font-bold leading-tight" style={{ color: "var(--color-vl-ink)" }}>
            Workspace Roles & Policy
          </h2>
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
            Configure and verify role-based permissions, administrative rules, and collaborative settings.
          </p>
        </div>
        <span className="text-[11.5px] font-bold flex items-center gap-1" style={{ color: "var(--color-vl-coral-deep)" }}>
          Review Policies &rarr;
        </span>
      </button>

      {/* Modal overlays rendered conditionally */}
      {controlCenterOpen && (
        <AdminControlCenterModal
          data={data}
          loading={loading}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          usageFilter={usageFilter}
          setUsageFilter={setUsageFilter}
          filteredUsers={filteredUsers}
          selectedUser={selectedUser}
          selectedUserId={selectedUserId}
          setSelectedUserId={setSelectedUserId}
          selectedDraft={selectedDraft}
          savingId={savingId}
          setSavingId={setSavingId}
          actionMsg={actionMsg}
          setActionMsg={setActionMsg}
          actionModal={actionModal}
          setActionModal={setActionModal}
          patchAccess={patchAccess}
          onClose={() => setControlCenterOpen(false)}
        />
      )}

      {diagnosticsOpen && (
        <AdminDiagnosticsModal token={token} onClose={() => setDiagnosticsOpen(false)} />
      )}

      {enginesOpen && (
        <AdminVoiceEnginesModal data={data} onClose={() => setEnginesOpen(false)} />
      )}

      {rolesOpen && (
        <AdminRolesModal data={data} onClose={() => setRolesOpen(false)} />
      )}
    </div>
  );
}

function AdminStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-white/65 px-4 py-3 shadow-sm" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
      <p className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: "var(--color-vl-ink-faint)" }}>
        {label}
      </p>
      <p className="mt-1 truncate text-[15px] font-bold capitalize" style={{ color: "var(--color-vl-ink)" }}>
        {value.replace(/_/g, " ")}
      </p>
    </div>
  );
}

function usageRiskLabel(risk: AdminUserAccess["usage"]["risk"]): string {
  switch (risk) {
    case "blocked":
      return "Blocked at cap";
    case "near_cap":
      return "Near hard cap";
    case "over_included":
      return "Over included";
    case "watch":
      return "Watch usage";
    default:
      return "Healthy";
  }
}

function usageRiskColor(risk: AdminUserAccess["usage"]["risk"]) {
  switch (risk) {
    case "blocked":
      return { text: "#B91C1C", bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.24)", bar: "rgba(239,68,68,0.72)" };
    case "near_cap":
      return { text: "#B45309", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.24)", bar: "rgba(245,158,11,0.72)" };
    case "over_included":
      return { text: "#C2410C", bg: "rgba(255,107,71,0.12)", border: "rgba(255,107,71,0.26)", bar: "rgba(255,107,71,0.72)" };
    case "watch":
      return { text: "#5B21B6", bg: "rgba(124,110,245,0.12)", border: "rgba(124,110,245,0.24)", bar: "rgba(124,110,245,0.72)" };
    default:
      return { text: "#047857", bg: "rgba(16,185,129,0.10)", border: "rgba(16,185,129,0.22)", bar: "rgba(16,185,129,0.72)" };
  }
}

function formatMinutesLimit(value: number): string {
  return value === -1 ? "Unlimited" : `${value.toLocaleString()} min`;
}

function UsageRiskBadge({ user }: { user: AdminUserAccess }) {
  const colors = usageRiskColor(user.usage.risk);
  const limitLabel = user.usage.includedMinutes === -1
    ? "Unlimited"
    : `${Math.min(user.usage.includedPercent, 999)}% included`;

  return (
    <span
      className="inline-flex items-center gap-2 rounded-xl border px-2.5 py-1 text-[10.5px] font-black uppercase tracking-[0.12em]"
      style={{ color: colors.text, background: colors.bg, borderColor: colors.border }}
    >
      {usageRiskLabel(user.usage.risk)}
      <span className="opacity-65">{limitLabel}</span>
    </span>
  );
}

function UsageMeter({ usage, compact = false }: { usage: AdminUserAccess["usage"]; compact?: boolean }) {
  const colors = usageRiskColor(usage.risk);
  const includedWidth = usage.includedMinutes === -1 ? 100 : Math.min(100, usage.includedPercent);
  const capWidth = usage.hardCapMinutes === -1 ? 100 : Math.min(100, usage.hardCapPercent);

  return (
    <div className={compact ? "mt-2" : "mt-4"}>
      <div className="h-2.5 overflow-hidden rounded-lg bg-slate-100">
        <div className="h-full rounded-lg" style={{ width: `${capWidth}%`, background: colors.bar }} />
      </div>
      {!compact && (
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-[11.5px] font-semibold" style={{ color: "var(--color-vl-ink-muted)" }}>
          <span>{usage.voiceMinutes.toLocaleString()} used</span>
          <span>{usage.includedMinutes === -1 ? "Unlimited plan" : `${includedWidth}% of included · ${capWidth}% of cap`}</span>
        </div>
      )}
    </div>
  );
}

function UsageRiskTile({ label, value, tone, onClick }: { label: string; value: number; tone: "danger" | "warn" | "orange" | "violet"; onClick: () => void }) {
  const colors =
    tone === "danger"
      ? { bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.22)", text: "#B91C1C" }
      : tone === "warn"
      ? { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.22)", text: "#B45309" }
      : tone === "orange"
      ? { bg: "rgba(255,107,71,0.12)", border: "rgba(255,107,71,0.24)", text: "#C2410C" }
      : { bg: "rgba(124,110,245,0.12)", border: "rgba(124,110,245,0.22)", text: "#5B21B6" };

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[24px] border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      style={{ background: colors.bg, borderColor: colors.border }}
    >
      <p className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: colors.text }}>
        {label}
      </p>
      <p className="mt-2 text-[32px] font-black leading-none tabular-nums" style={{ color: "var(--color-vl-ink)" }}>
        {value.toLocaleString()}
      </p>
    </button>
  );
}

function AdminDiagnosticsModal({
  token,
  onClose,
}: {
  token: string | null;
  onClose: () => void;
}) {
  const [diagData, setDiagData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runChecks = () => {
    if (!token) {
      setLoading(false);
      setError("Sign in again to run diagnostics.");
      return;
    }
    setLoading(true);
    setError(null);
    fetch("/api/v1/admin/diagnostics", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (r) => {
        const payload = await r.json().catch(() => null);
        if (!r.ok) throw new Error(payload?.error ?? "Diagnostics check failed.");
        setDiagData(payload);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Error executing diagnostics.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    runChecks();
  }, [token]);

  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center px-4 py-8">
      <button
        type="button"
        aria-label="Close diagnostics"
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[88vh] w-full max-w-[960px] flex-col overflow-hidden rounded-[28px] border bg-[#FBF7F1] shadow-2xl"
        style={{ borderColor: "rgba(10,10,11,0.10)" }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b p-6 bg-white" style={{ borderColor: "rgba(10,10,11,0.08)" }}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
              Admin diagnostics
            </p>
            <h2 className="mt-2 text-[28px] font-bold leading-tight" style={{ color: "var(--color-vl-ink)" }}>
              System Health & Connectivity
            </h2>
            <p className="mt-2 max-w-155 text-[13px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
              Live verification of cloud services, database channels, encryption structures, and internal caches.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="vl-btn-outline px-4 py-2 text-[12.5px] inline-flex items-center gap-2 font-bold bg-white"
              onClick={runChecks}
              disabled={loading}
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Re-test Services
            </button>
            <button
              type="button"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border bg-white/80 text-slate-500 transition hover:bg-white hover:text-slate-900"
              style={{ borderColor: "rgba(10,10,11,0.10)" }}
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="vl-scroll overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-[#FF6B47]" />
              <p className="text-[14px] font-bold" style={{ color: "var(--color-vl-ink-muted)" }}>Running system connectivity checks...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-2 text-red-600 text-[13px] font-medium">
              <AlertCircle className="h-4.5 w-4.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {/* Service Latencies */}
              <div className="rounded-[24px] border bg-white p-5 shadow-xs" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
                <h3 className="text-[15px] font-black mb-4 flex items-center gap-2" style={{ color: "var(--color-vl-ink)" }}>
                  <Activity className="h-4.5 w-4.5 text-[#FF6B47]" />
                  Live API Latency
                </h3>
                <div className="space-y-3.5">
                  {/* Database */}
                  <div className="flex items-center justify-between rounded-xl p-3" style={{ background: diagData.database?.status === "healthy" ? "rgba(16,185,129,0.05)" : "rgba(239,68,68,0.05)" }}>
                    <div>
                      <p className="text-[13px] font-bold">PostgreSQL Channel</p>
                      <p className="text-[11px] font-semibold text-slate-400">Database select latency</p>
                    </div>
                    <div className="text-right">
                      <span className={`text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-md ${diagData.database?.status === "healthy" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                        {diagData.database?.status}
                      </span>
                      <p className="text-[13px] font-black mt-1 tabular-nums">{diagData.database?.latencyMs} ms</p>
                    </div>
                  </div>

                  {/* Square API */}
                  <div className="flex items-center justify-between rounded-xl p-3" style={{ background: diagData.squareApi?.status === "healthy" ? "rgba(16,185,129,0.05)" : "rgba(239,68,68,0.05)" }}>
                    <div>
                      <p className="text-[13px] font-bold">Square POS API</p>
                      <p className="text-[11px] font-semibold text-slate-400">Locations lookup latency</p>
                    </div>
                    <div className="text-right">
                      <span className={`text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-md ${diagData.squareApi?.status === "healthy" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                        {diagData.squareApi?.status}
                      </span>
                      <p className="text-[13px] font-black mt-1 tabular-nums">{diagData.squareApi?.latencyMs} ms</p>
                    </div>
                  </div>

                  {/* OpenAI API */}
                  <div className="flex items-center justify-between rounded-xl p-3" style={{ background: diagData.openaiApi?.status === "healthy" ? "rgba(16,185,129,0.05)" : "rgba(239,68,68,0.05)" }}>
                    <div>
                      <p className="text-[13px] font-bold">OpenAI API Endpoint</p>
                      <p className="text-[11px] font-semibold text-slate-400">Models metadata latency</p>
                    </div>
                    <div className="text-right">
                      <span className={`text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-md ${diagData.openaiApi?.status === "healthy" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                        {diagData.openaiApi?.status}
                      </span>
                      <p className="text-[13px] font-black mt-1 tabular-nums">{diagData.openaiApi?.latencyMs} ms</p>
                    </div>
                  </div>

                  {/* Gemini API */}
                  <div className="flex items-center justify-between rounded-xl p-3" style={{ background: diagData.geminiApi?.status === "healthy" ? "rgba(16,185,129,0.05)" : "rgba(239,68,68,0.05)" }}>
                    <div>
                      <p className="text-[13px] font-bold">Google Gemini API</p>
                      <p className="text-[11px] font-semibold text-slate-400">BidiLive models latency</p>
                    </div>
                    <div className="text-right">
                      <span className={`text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-md ${diagData.geminiApi?.status === "healthy" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                        {diagData.geminiApi?.status}
                      </span>
                      <p className="text-[13px] font-black mt-1 tabular-nums">{diagData.geminiApi?.latencyMs} ms</p>
                    </div>
                  </div>

                  {/* Clerk API */}
                  {diagData.clerkApi && (
                    <div className="flex items-center justify-between rounded-xl p-3" style={{ background: diagData.clerkApi.status === "healthy" ? "rgba(16,185,129,0.05)" : diagData.clerkApi.status === "unconfigured" ? "rgba(100,116,139,0.05)" : "rgba(239,68,68,0.05)" }}>
                      <div>
                        <p className="text-[13px] font-bold">Clerk Billing API</p>
                        <p className="text-[11px] font-semibold text-slate-400">
                          {diagData.clerkApi.status === "unconfigured" ? "Not Configured" : "Identity lookup latency"}
                        </p>
                        {diagData.clerkApi.status === "unhealthy" && (
                          <p className="text-[10px] text-red-500 mt-0.5 max-w-70 truncate" title={diagData.clerkApi.error}>{diagData.clerkApi.error}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <span className={`text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-md ${diagData.clerkApi.status === "healthy" ? "bg-emerald-100 text-emerald-800" : diagData.clerkApi.status === "unconfigured" ? "bg-slate-100 text-slate-800" : "bg-red-100 text-red-800"}`}>
                          {diagData.clerkApi.status}
                        </span>
                        {diagData.clerkApi.status === "healthy" && (
                          <p className="text-[13px] font-black mt-1 tabular-nums">{diagData.clerkApi.latencyMs} ms</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Environment Checklist */}
              <div className="rounded-[24px] border bg-white p-5 shadow-xs flex flex-col justify-between" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
                <div>
                  <h3 className="text-[15px] font-black mb-4 flex items-center gap-2" style={{ color: "var(--color-vl-ink)" }}>
                    <ShieldCheck className="h-4.5 w-4.5 text-emerald-600" />
                    Environment Credentials
                  </h3>
                  <div className="grid grid-cols-2 gap-2 text-[12.5px] font-semibold text-slate-700">
                    <div className="flex items-center gap-2 rounded-xl border p-3 bg-slate-50" style={{ borderColor: "rgba(10,10,11,0.04)" }}>
                      <span className={`h-2.5 w-2.5 rounded-full ${diagData.env?.databaseUrlSet ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span>DATABASE_URL</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border p-3 bg-slate-50" style={{ borderColor: "rgba(10,10,11,0.04)" }}>
                      <span className={`h-2.5 w-2.5 rounded-full ${diagData.env?.secretsEncryptionKeySet ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span>ENCRYPTION_KEY</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border p-3 bg-slate-50" style={{ borderColor: "rgba(10,10,11,0.04)" }}>
                      <span className={`h-2.5 w-2.5 rounded-full ${diagData.env?.openaiApiKeySet ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span>OPENAI_API_KEY</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border p-3 bg-slate-50" style={{ borderColor: "rgba(10,10,11,0.04)" }}>
                      <span className={`h-2.5 w-2.5 rounded-full ${diagData.env?.googleGeminiApiKeySet ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span>GEMINI_API_KEY</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border p-3 bg-slate-50" style={{ borderColor: "rgba(10,10,11,0.04)" }}>
                      <span className={`h-2.5 w-2.5 rounded-full ${diagData.env?.squareAppIdSet ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span>SQUARE_APP_ID</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border p-3 bg-slate-50" style={{ borderColor: "rgba(10,10,11,0.04)" }}>
                      <span className={`h-2.5 w-2.5 rounded-full ${diagData.env?.squareAppSecretSet ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span>SQUARE_SECRET</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border p-3 bg-slate-50" style={{ borderColor: "rgba(10,10,11,0.04)" }}>
                      <span className={`h-2.5 w-2.5 rounded-full ${diagData.env?.clerkSecretKeySet ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span>CLERK_SECRET_KEY</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border p-3 bg-slate-50" style={{ borderColor: "rgba(10,10,11,0.04)" }}>
                      <span className={`h-2.5 w-2.5 rounded-full ${diagData.env?.clerkPublishableKeySet ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span>CLERK_PUB_KEY</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t" style={{ borderColor: "rgba(10,10,11,0.04)" }}>
                  <div className="flex justify-between text-[13px] font-bold">
                    <span style={{ color: "var(--color-vl-ink-muted)" }}>Active cached venues:</span>
                    <span className="tabular-nums" style={{ color: "var(--color-vl-coral-deep)" }}>{diagData.caches?.credentialsSize} credentials</span>
                  </div>
                  <div className="flex justify-between text-[13px] font-bold mt-1.5">
                    <span style={{ color: "var(--color-vl-ink-muted)" }}>Active cached menus:</span>
                    <span className="tabular-nums" style={{ color: "var(--color-vl-coral-deep)" }}>{diagData.caches?.catalogSize} catalogs</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function AdminVoiceEnginesModal({
  data,
  onClose,
}: {
  data: AdminOverview;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center px-4 py-8">
      <button
        type="button"
        aria-label="Close voice engines"
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[85vh] w-full max-w-[800px] flex-col overflow-hidden rounded-[28px] border bg-[#FBF7F1] shadow-2xl"
        style={{ borderColor: "rgba(10,10,11,0.10)" }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b p-6 bg-white" style={{ borderColor: "rgba(10,10,11,0.08)" }}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
              Voice pipelines
            </p>
            <h2 className="mt-2 text-[28px] font-bold leading-tight" style={{ color: "var(--color-vl-ink)" }}>
              Voice Engines & Status
            </h2>
            <p className="mt-2 max-w-150 text-[13px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
              Verify connectivity, availability, and active deployment parameters for the real-time pipeline adapters.
            </p>
          </div>
          <button
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border bg-white/80 text-slate-500 transition hover:bg-white hover:text-slate-900"
            style={{ borderColor: "rgba(10,10,11,0.10)" }}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="vl-scroll overflow-y-auto p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {data.pipelines.map((pipeline) => {
              const isLive = pipeline.status === "available" || pipeline.status === "experimental";
              return (
                <div key={pipeline.provider} className="rounded-2xl border bg-white p-4 flex flex-col justify-between" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-black" style={{ color: "var(--color-vl-ink)" }}>{pipeline.displayName}</p>
                      <p className="mt-0.5 truncate text-[10.5px] font-mono font-semibold uppercase tracking-wider" style={{ color: "var(--color-vl-ink-muted)" }}>{pipeline.provider}</p>
                    </div>
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${isLive ? "bg-emerald-500" : "bg-slate-300"}`} />
                  </div>
                  {pipeline.reason && (
                    <p className="mt-3.5 border-t pt-3 text-[11.5px] leading-relaxed font-semibold" style={{ borderColor: "rgba(10,10,11,0.04)", color: "var(--color-vl-ink-muted)" }}>{pipeline.reason}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function AdminRolesModal({
  data,
  onClose,
}: {
  data: AdminOverview;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center px-4 py-8">
      <button
        type="button"
        aria-label="Close security roles"
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[85vh] w-full max-w-[800px] flex-col overflow-hidden rounded-[28px] border bg-[#FBF7F1] shadow-2xl"
        style={{ borderColor: "rgba(10,10,11,0.10)" }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b p-6 bg-white" style={{ borderColor: "rgba(10,10,11,0.08)" }}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
              Access policy
            </p>
            <h2 className="mt-2 text-[28px] font-bold leading-tight" style={{ color: "var(--color-vl-ink)" }}>
              Workspace Roles & Policy
            </h2>
            <p className="mt-2 max-w-150 text-[13px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
              System roles and granular policy sets mapped across collaboration, reporting, POS ordering, and inventory adjustments.
            </p>
          </div>
          <button
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border bg-white/80 text-slate-500 transition hover:bg-white hover:text-slate-900"
            style={{ borderColor: "rgba(10,10,11,0.10)" }}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="vl-scroll overflow-y-auto p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {data.roles.map((role) => (
              <div key={role.role} className="rounded-2xl border bg-white p-4" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
                <div className="flex items-center gap-2.5 mb-2">
                  <Lock className="h-4 w-4 text-slate-400" />
                  <p className="text-[14px] font-black" style={{ color: "var(--color-vl-ink)" }}>{role.label}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t" style={{ borderColor: "rgba(10,10,11,0.04)" }}>
                  {role.permissions.map((p) => (
                    <span key={p} className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-50 border capitalize text-slate-500" style={{ borderColor: "rgba(10,10,11,0.04)" }}>
                      {p.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function AdminControlCenterModal({
  data,
  loading,
  searchQuery,
  setSearchQuery,
  usageFilter,
  setUsageFilter,
  filteredUsers,
  selectedUser,
  selectedUserId,
  setSelectedUserId,
  selectedDraft,
  savingId,
  setSavingId,
  actionMsg,
  setActionMsg,
  actionModal,
  setActionModal,
  patchAccess,
  onClose,
}: {
  data: AdminOverview;
  loading: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  usageFilter: string;
  setUsageFilter: (f: any) => void;
  filteredUsers: AdminUserAccess[];
  selectedUser: AdminUserAccess | null;
  selectedUserId: number | null;
  setSelectedUserId: (id: number | null) => void;
  selectedDraft: any;
  savingId: number | null;
  setSavingId: (id: number | null) => void;
  actionMsg: { tone: "ok" | "error"; text: string } | null;
  setActionMsg: (msg: any) => void;
  actionModal: AdminActionModalState | null;
  setActionModal: (state: any) => void;
  patchAccess: any;
  onClose: () => void;
}) {
  const inactiveUsers = data.users.filter((user) => ["inactive", "canceled", "past_due"].includes(user.subscription?.status ?? ""));
  const blockedUsers = data.users.filter((user) => user.usage.risk === "blocked");
  const nearCapUsers = data.users.filter((user) => user.usage.risk === "near_cap");
  const overIncludedUsers = data.users.filter((user) => user.usage.risk === "over_included");
  const watchUsers = data.users.filter((user) => user.usage.risk !== "ok");

  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center px-4 py-8">
      <button
        type="button"
        aria-label="Close platform control"
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[90vh] w-full max-w-[1240px] flex-col overflow-hidden rounded-[28px] border bg-[#FBF7F1] shadow-2xl"
        style={{ borderColor: "rgba(10,10,11,0.10)" }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b p-6 bg-white" style={{ borderColor: "rgba(10,10,11,0.08)" }}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
              Admin console
            </p>
            <h2 className="mt-2 text-[28px] font-bold leading-tight" style={{ color: "var(--color-vl-ink)" }}>
              Platform Control Center
            </h2>
            <p className="mt-2 max-w-180 text-[13px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
              Review workspace plans, change sub-limits, toggle suspensions, and manage platform-wide customer success.
            </p>
          </div>
          <button
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border bg-white/80 text-slate-500 transition hover:bg-white hover:text-slate-900"
            style={{ borderColor: "rgba(10,10,11,0.10)" }}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="vl-scroll overflow-y-auto p-6 space-y-5">
          {/* Quick Filter Tiles (Uncrowded) */}
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            <UsageRiskTile label="Blocked at cap" value={blockedUsers.length} tone="danger" onClick={() => setUsageFilter("blocked")} />
            <UsageRiskTile label="Near hard cap" value={nearCapUsers.length} tone="warn" onClick={() => setUsageFilter("near_cap")} />
            <UsageRiskTile label="Over included" value={overIncludedUsers.length} tone="orange" onClick={() => setUsageFilter("over_included")} />
            <UsageRiskTile label="Needs review" value={watchUsers.length} tone="violet" onClick={() => setUsageFilter("watch")} />
          </div>

          {/* Accounts & Form */}
          <div className="grid gap-5 lg:grid-cols-[440px_minmax(0,1fr)] 2xl:grid-cols-[460px_minmax(0,1fr)] pb-2">
            {/* Accounts Panel */}
            <div className="rounded-3xl border bg-white p-4 shadow-xs" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
                    Account Registry
                  </p>
                  <p className="mt-1 text-[11.5px] font-semibold" style={{ color: "var(--color-vl-ink-muted)" }}>
                    {filteredUsers.length} visible of {data.users.length} total
                  </p>
                </div>
                {inactiveUsers.length > 0 && (
                  <span className="rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-700">
                    {inactiveUsers.length} need review
                  </span>
                )}
              </div>

              <div className="relative">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search name, email, plan, org..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-12 w-full rounded-2xl border bg-slate-50 pl-11 pr-4 text-[13px] outline-none transition-all duration-200 focus:border-[#FF6B47] focus:bg-white font-semibold"
                  style={{ borderColor: "rgba(10,10,11,0.08)", color: "var(--color-vl-ink)" }}
                />
              </div>

              <div className="mt-3 grid grid-cols-5 gap-1.5">
                {([
                  ["all", "All"],
                  ["watch", "Review"],
                  ["over", "Over"],
                  ["near_cap", "Near"],
                  ["blocked", "Block"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setUsageFilter(value === "over" ? "over_included" : value)}
                    className="rounded-xl border py-2 text-[10px] font-black uppercase tracking-[0.12em] transition hover:bg-white"
                    style={{
                      borderColor: (value === "over" ? usageFilter === "over_included" : usageFilter === value) ? "rgba(255,107,71,0.34)" : "rgba(10,10,11,0.06)",
                      background: (value === "over" ? usageFilter === "over_included" : usageFilter === value) ? "rgba(255,107,71,0.08)" : "rgba(255,255,255,0.58)",
                      color: (value === "over" ? usageFilter === "over_included" : usageFilter === value) ? "var(--color-vl-coral-deep)" : "var(--color-vl-ink-muted)",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="vl-scroll mt-3.5 max-h-[460px] space-y-2 overflow-y-auto pr-1">
                {filteredUsers.length === 0 ? (
                  <p className="text-center text-[12.5px] py-10 font-bold" style={{ color: "var(--color-vl-ink-muted)" }}>
                    No accounts match filters.
                  </p>
                ) : (
                  filteredUsers.map((user) => {
                    const isSelected = selectedUser?.id === user.id;
                    const status = user.subscription?.status ?? "none";
                    const statusTone =
                      status === "active" ? "text-emerald-700 bg-emerald-50" :
                      status === "past_due" || status === "inactive" || status === "canceled" ? "text-red-700 bg-red-50" :
                      "text-amber-700 bg-amber-50";
                    return (
                      <button
                        key={user.id}
                        type="button"
                        className="w-full rounded-2xl border p-3.5 text-left transition hover:bg-white hover:shadow-xs"
                        style={{
                          borderColor: isSelected ? "rgba(255,107,71,0.34)" : "rgba(10,10,11,0.06)",
                          background: isSelected ? "rgba(255,107,71,0.08)" : "rgba(255,255,255,0.66)",
                        }}
                        onClick={() => setSelectedUserId(user.id)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-[13.5px] font-bold" style={{ color: "var(--color-vl-ink)" }}>
                              {user.name || "Unnamed user"}
                            </p>
                            <p className="mt-0.5 truncate text-[11.5px] font-semibold" style={{ color: "var(--color-vl-ink-muted)" }}>
                              {user.email}
                            </p>
                          </div>
                          <span className={`rounded-lg px-2 py-0.5 text-[9.5px] font-black uppercase tracking-[0.10em] ${statusTone}`}>
                            {status}
                          </span>
                        </div>
                        <div className="mt-3.5 border-t pt-3 flex items-center justify-between text-[11px] font-bold" style={{ borderColor: "rgba(10,10,11,0.04)" }}>
                          <span style={{ color: "var(--color-vl-ink-muted)" }}>
                            {user.organization?.name || "Personal Workspace"}
                          </span>
                          <span className="tabular-nums" style={{ color: user.usage.risk === "blocked" ? "var(--color-vl-danger)" : user.usage.risk !== "ok" ? "var(--color-vl-coral-deep)" : "var(--color-vl-ink-muted)" }}>
                            {user.usage.voiceMinutes} / {user.usage.includedMinutes} min
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Account Details Form */}
            <div className="rounded-3xl border bg-white p-5 shadow-xs flex flex-col justify-between" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
              {selectedUser ? (
                <div className="space-y-5">
                  <div className="border-b pb-4 flex justify-between items-start gap-4" style={{ borderColor: "rgba(10,10,11,0.04)" }}>
                    <div>
                      <h3 className="text-[17px] font-black" style={{ color: "var(--color-vl-ink)" }}>
                        {selectedUser.name || "User Details"}
                      </h3>
                      <p className="text-[12px] font-semibold mt-0.5" style={{ color: "var(--color-vl-ink-muted)" }}>
                        Member active on secure endpoints
                      </p>
                    </div>
                    {selectedUser.usage.risk !== "ok" && (
                      <span className="rounded-lg bg-red-50 text-red-700 px-2 py-1 text-[10px] font-black uppercase tracking-wider">
                        {selectedUser.usage.risk} Risk
                      </span>
                    )}
                  </div>

                  {actionMsg && (
                    <div className={`p-4 rounded-2xl border text-[13px] font-bold leading-relaxed flex items-center gap-2 ${actionMsg.tone === "ok" ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-red-50 border-red-100 text-red-800"}`}>
                      {actionMsg.tone === "ok" ? <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-emerald-600" /> : <AlertCircle className="h-4.5 w-4.5 shrink-0 text-red-600" />}
                      <span>{actionMsg.text}</span>
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <AdminStat label="Email ID" value={selectedUser.email} />
                    <AdminStat label="Workspace Organization" value={selectedUser.organization?.name || "Personal Account"} />
                    <AdminStat label="Square POS Channels" value={selectedUser.organization ? "Workspace active connection" : "Personal Workspace channel"} />
                    <AdminStat label="Total Voice Minutes" value={`${selectedUser.usage.voiceMinutes} mins utilized`} />
                  </div>

                  <div className="border-t pt-4 space-y-4" style={{ borderColor: "rgba(10,10,11,0.04)" }}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <AdminSelect
                        label="Subscription Tier"
                        value={selectedDraft?.plan || "trial"}
                        options={["trial", "starter", "professional", "premium", "enterprise", "admin"]}
                        onChange={(val) =>
                          setActionModal({
                            kind: "quick",
                            user: selectedUser,
                            title: "Change subscription",
                            description: `Convert this account's core tier to ${val.toUpperCase()}? This instantly recalculates voice minute boundaries, allowed tools, and server integrations.`,
                            confirmLabel: "Change Plan",
                            patch: { plan: val },
                          })
                        }
                      />
                      <AdminSelect
                        label="Subscription Status"
                        value={selectedDraft?.status || "trialing"}
                        options={["trialing", "active", "past_due", "canceled", "inactive"]}
                        onChange={(val) =>
                          setActionModal({
                            kind: "quick",
                            user: selectedUser,
                            title: "Change billing status",
                            description: `Convert billing state to ${val.toUpperCase()}? Marking as past_due, canceled, or inactive blocks assistant initialization until settled.`,
                            confirmLabel: "Change Status",
                            patch: { status: val },
                          })
                        }
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <AdminSelect
                        label="Organization Role"
                        value={selectedDraft?.role || "owner"}
                        options={["owner", "admin", "member"]}
                        onChange={(val) =>
                          setActionModal({
                            kind: "quick",
                            user: selectedUser,
                            title: "Change workspace role",
                            description: `Convert organization role to ${val.toUpperCase()}? This will update workspace permissions and access parameters for collaborative systems.`,
                            confirmLabel: "Change Role",
                            patch: { role: val },
                          })
                        }
                      />

                      {/* Manual reset / override controls */}
                      <div className="flex flex-col justify-end">
                        <span className="text-[10px] font-black uppercase tracking-[0.14em] mb-1.5" style={{ color: "var(--color-vl-ink-faint)" }}>Quick overrides</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="vl-btn-outline w-full py-2.5 rounded-xl font-bold text-[12px] inline-flex items-center justify-center gap-1 bg-slate-50 hover:bg-white text-slate-700"
                            style={{ borderColor: "rgba(10,10,11,0.06)" }}
                            onClick={() =>
                              setActionModal({
                                kind: "quick",
                                user: selectedUser,
                                title: "Reset voice minutes",
                                description: `Instantly clear voice minute accumulator for ${selectedUser.name}? This will zero out database voice event logs for the active monthly cycle.`,
                                confirmLabel: "Reset Minutes",
                                patch: { resetMinutes: true } as any,
                              })
                            }
                          >
                            Reset Minutes
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <UserRound className="w-12 h-12 text-[#FF6B47] opacity-24 mb-3" />
                  <p className="text-[14px] font-bold" style={{ color: "var(--color-vl-ink-muted)" }}>
                    Select an account from the registry to inspect.
                  </p>
                </div>
              )}

              {selectedUser && (
                <div className="mt-6 pt-4 border-t flex justify-end gap-2" style={{ borderColor: "rgba(10,10,11,0.04)" }}>
                  {selectedDraft?.status !== "active" ? (
                    <button
                      type="button"
                      className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-extrabold text-[12.5px] hover:bg-emerald-700 transition"
                      onClick={() =>
                        setActionModal({
                          kind: "quick",
                          user: selectedUser,
                          title: "Force activate account",
                          description: `Instantly force activation of ${selectedUser.name}'s workspace billing state?`,
                          confirmLabel: "Force Activate",
                          patch: { status: "active" },
                        })
                      }
                    >
                      Force Activate Account
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="px-4 py-2.5 rounded-xl bg-red-600 text-white font-extrabold text-[12.5px] hover:bg-red-700 transition"
                      onClick={() =>
                        setActionModal({
                          kind: "quick",
                          user: selectedUser,
                          title: "Deactivate workspace",
                          description: `Suspend ${selectedUser.name}'s workspace access immediately?`,
                          confirmLabel: "Deactivate Workspace",
                          patch: { status: "inactive" },
                          tone: "danger",
                        })
                      }
                    >
                      Suspend Workspace
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Confirmation Sub-Modal */}
      {actionModal && (
        <AdminAccessModal
          modal={actionModal}
          saving={savingId === actionModal.user.id}
          onClose={() => setActionModal(null)}
          onConfirm={(patch) =>
            void patchAccess(
              actionModal.user,
              patch,
              `${actionModal.user.email} updated successfully.`
            )
          }
        />
      )}
    </div>
  );
}


function AdminActionTile({
  label,
  eyebrow,
  description,
  onClick,
  disabled,
  tone = "default",
}: {
  label: string;
  eyebrow: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  const danger = tone === "danger";
  return (
    <button
      type="button"
      className="group flex min-h-28 flex-col rounded-3xl border bg-white/72 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        borderColor: danger ? "rgba(215,64,46,0.20)" : "rgba(10,10,11,0.08)",
        color: danger ? "var(--color-vl-danger)" : "var(--color-vl-ink)",
      }}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: danger ? "rgba(215,64,46,0.72)" : "var(--color-vl-ink-faint)" }}>
        {eyebrow}
      </span>
      <span className="mt-5 block">
        <span className="block text-[15px] font-bold">{label}</span>
        <span className="mt-1 block text-[11.5px] leading-relaxed" style={{ color: danger ? "rgba(215,64,46,0.74)" : "var(--color-vl-ink-muted)" }}>
          {description}
        </span>
      </span>
    </button>
  );
}

function AdminAccessModal({
  modal,
  saving,
  onClose,
  onConfirm,
}: {
  modal: AdminActionModalState;
  saving: boolean;
  onClose: () => void;
  onConfirm: (patch: AdminAccessPatch) => void;
}) {
  const [draft, setDraft] = useState(
    modal.kind === "custom"
      ? modal.draft
      : {
          plan: modal.user.subscription?.plan ?? "trial",
          status: modal.user.subscription?.status ?? "trialing",
          role: modal.user.organization?.role ?? "owner",
        },
  );

  useEffect(() => {
    setDraft(
      modal.kind === "custom"
        ? modal.draft
        : {
            plan: modal.user.subscription?.plan ?? "trial",
            status: modal.user.subscription?.status ?? "trialing",
            role: modal.user.organization?.role ?? "owner",
          },
    );
  }, [modal]);

  const danger = modal.kind === "quick" && modal.tone === "danger";
  const patch =
    modal.kind === "quick"
      ? modal.patch
      : modal.fields.reduce<AdminAccessPatch>((next, field) => ({ ...next, [field]: draft[field] }), {});

  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center px-4 py-8">
      <button
        type="button"
        aria-label="Close admin action"
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-150 overflow-hidden rounded-[28px] border bg-white shadow-2xl"
        style={{ borderColor: "rgba(10,10,11,0.10)" }}
      >
        <div className="relative border-b p-6" style={{ borderColor: "rgba(10,10,11,0.08)" }}>
          <div className="pointer-events-none absolute inset-0 opacity-80" style={{
            background:
              "radial-gradient(circle at 14% 18%, rgba(236,72,153,0.12), transparent 28%), radial-gradient(circle at 85% 5%, rgba(99,102,241,0.12), transparent 30%), radial-gradient(circle at 92% 88%, rgba(16,185,129,0.10), transparent 30%)",
          }} />
          <div className="relative flex items-start justify-between gap-5">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: danger ? "var(--color-vl-danger)" : "var(--color-vl-ink-faint)" }}>
                Live admin action
              </p>
              <h2 className="mt-2 text-[28px] font-bold leading-tight" style={{ color: "var(--color-vl-ink)" }}>
                {modal.title}
              </h2>
              <p className="mt-2 max-w-115 text-[13px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
                {modal.description}
              </p>
            </div>
            <button
              type="button"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border bg-white/80 text-slate-500 transition hover:bg-white hover:text-slate-900"
              style={{ borderColor: "rgba(10,10,11,0.10)" }}
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid gap-5 p-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <AdminStat label="Account" value={modal.user.name || modal.user.email} />
            <AdminStat label="Current plan" value={modal.user.subscription?.plan ?? "trial"} />
            <AdminStat label="Current status" value={modal.user.subscription?.status ?? "none"} />
          </div>

          {modal.kind === "custom" ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {modal.fields.includes("plan") && (
                <AdminSelect label="Plan" value={draft.plan} options={["trial", "pro", "business", "admin"]} onChange={(value) => setDraft((current) => ({ ...current, plan: value }))} />
              )}
              {modal.fields.includes("status") && (
                <AdminSelect label="Status" value={draft.status} options={["trialing", "active", "past_due", "canceled", "inactive"]} onChange={(value) => setDraft((current) => ({ ...current, status: value }))} />
              )}
              {modal.fields.includes("role") && (
                <AdminSelect label="Role" value={draft.role} options={["owner", "admin", "manager", "operator"]} onChange={(value) => setDraft((current) => ({ ...current, role: value }))} />
              )}
            </div>
          ) : (
            <div className="rounded-3xl border bg-slate-50/70 p-5" style={{ borderColor: "rgba(10,10,11,0.08)" }}>
              <p className="text-[11px] font-bold uppercase tracking-[0.15em]" style={{ color: "var(--color-vl-ink-faint)" }}>
                This will apply
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {Object.entries(patch).map(([key, value]) => (
                  <AdminStat key={key} label={key} value={String(value)} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t bg-slate-50/60 p-5" style={{ borderColor: "rgba(10,10,11,0.08)" }}>
          <button type="button" className="vl-btn-ghost text-[13px]" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="vl-btn-primary inline-flex items-center gap-2 text-[13px]"
            style={danger ? { background: "var(--color-vl-danger)" } : undefined}
            onClick={() => onConfirm(patch)}
            disabled={saving}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {modal.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function AdminMetricCard({ label, value, icon, bgColor, textColor, isFailure = false }: { label: string; value: number; icon: ReactNode; bgColor: string; textColor: string; isFailure?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border bg-white/70 p-3 shadow-sm transition duration-200 hover:bg-white hover:shadow" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-inner ${bgColor} ${textColor}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[9.5px] font-bold uppercase tracking-[0.13em]" style={{ color: "var(--color-vl-ink-faint)" }}>{label}</p>
        <p className="mt-0.5 text-[20px] font-bold leading-none tabular-nums" style={{ color: isFailure ? "var(--color-vl-danger)" : "var(--color-vl-ink)" }}>
          {value.toLocaleString()}
        </p>
      </div>
    </div>
  );
}

function AdminSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="vl-compact-input shadow-inner font-semibold text-slate-700 bg-white">
        {options.map((option) => (
          <option key={option} value={option}>{capitalize(option.replace(/_/g, " "))}</option>
        ))}
      </select>
    </Field>
  );
}


function UsageCard({ token, plan, isAdmin = false }: { token: string | null; plan?: string; isAdmin?: boolean }) {
  const [data, setData] = useState<{
    voiceMinutes: { used: number };
    usageLimits?: {
      includedMinutes: number;
      hardCapMinutes: number;
      includedPercent: number;
      hardCapPercent: number;
      overIncluded: boolean;
      overIncludedMinutes: number;
      remainingIncludedMinutes: number;
      remainingToHardCapMinutes: number;
      risk: "ok" | "watch" | "over_included" | "near_cap" | "blocked";
    };
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

  const used = data?.voiceMinutes?.used ?? 0;
  const limits = data?.usageLimits;
  const limit = limits ? limits.includedMinutes : (isAdmin || plan === "admin"
    ? -1
    : getPlan(plan ?? "trial")?.includedVoiceMinutes ?? getPlan("trial")?.includedVoiceMinutes ?? 60);

  const hasFiniteLimit = limit !== -1;
  const hardCap = limits ? limits.hardCapMinutes : (hasFiniteLimit ? Math.floor(limit * 1.5) : -1);
  const risk = limits?.risk ?? (hasFiniteLimit ? (used >= hardCap ? "blocked" : used >= hardCap * 0.9 ? "near_cap" : used > limit ? "over_included" : used >= limit * 0.8 ? "watch" : "ok") : "ok");

  const includedPercent = limits ? limits.includedPercent : (hasFiniteLimit ? Math.round((used / limit) * 100) : 0);
  const hardCapPercent = limits ? limits.hardCapPercent : (hasFiniteLimit ? Math.round((used / hardCap) * 100) : 0);

  // Status Badge colors and labels
  const statusConfig: Record<string, { label: string; text: string; bg: string; border: string; bar: string }> = {
    blocked: { label: "Suspended (At Cap)", text: "#B91C1C", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.20)", bar: "bg-red-600" },
    near_cap: { label: "Critical (Near Cap)", text: "#B45309", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.20)", bar: "bg-amber-500" },
    over_included: { label: "Overage Active", text: "#C2410C", bg: "rgba(255,107,71,0.08)", border: "rgba(255,107,71,0.20)", bar: "bg-[#FF6B47]" },
    watch: { label: "Approaching Limit", text: "#5B21B6", bg: "rgba(124,110,245,0.08)", border: "rgba(124,110,245,0.20)", bar: "bg-[#7C6EF5]" },
    ok: { label: "Optimal", text: "#047857", bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.18)", bar: "bg-[#10B981]" }
  };
  const activeStatus = statusConfig[risk] || statusConfig.ok;

  return (
    <Section icon={<BarChart3 className="h-5 w-5" />} title="Resource Usage" description="Voice minutes consumption and triggered operations.">
      {loading ? (
        <div className="flex items-center gap-2.5 py-4">
          <Loader2 className="w-4 h-4 animate-spin text-[#FF6B47]" />
          <span className="text-[13.5px] font-bold" style={{ color: "var(--color-vl-ink-muted)" }}>Loading usage data...</span>
        </div>
      ) : error ? (
        <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-2 text-red-600 text-[13px] font-medium">
          <AlertCircle className="h-4.5 w-4.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            {/* Upper labels & Badge */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <span className="text-[14.5px] font-black" style={{ color: "var(--color-vl-ink)" }}>Voice minutes</span>
                <p className="text-[11.5px] font-semibold mt-0.5" style={{ color: "var(--color-vl-ink-muted)" }}>
                  Tracked over active billing period
                </p>
              </div>
              {hasFiniteLimit && (
                <span
                  className="rounded-xl border px-3 py-1 text-[10.5px] font-black uppercase tracking-wider"
                  style={{
                    color: activeStatus.text,
                    background: activeStatus.bg,
                    borderColor: activeStatus.border
                  }}
                >
                  {activeStatus.label}
                </span>
              )}
            </div>

            {/* Blocked or near-cap explicit banners */}
            {hasFiniteLimit && risk === "blocked" && (
              <div className="mb-4 p-4 bg-red-50/50 border border-red-200/80 rounded-2xl text-[12.5px] leading-relaxed font-semibold text-red-800">
                <p className="flex items-center gap-2 font-bold mb-1">
                  <AlertCircle className="h-4.5 w-4.5 text-red-600" />
                  Monthly Limit Blocked
                </p>
                Your voice assistants are currently suspended because you have reached your plan's absolute overage cap ({hardCap} minutes). Please upgrade your subscription on the Billing page or contact support to resume immediate access.
              </div>
            )}

            {hasFiniteLimit && risk === "near_cap" && (
              <div className="mb-4 p-4 bg-amber-50/50 border border-amber-200/80 rounded-2xl text-[12.5px] leading-relaxed font-semibold text-amber-800">
                <p className="flex items-center gap-2 font-bold mb-1">
                  <AlertTriangle className="h-4.5 w-4.5 text-amber-600" />
                  Approaching Hard Suspension Cap
                </p>
                You are currently utilizing overage minutes and are within 10% of your plan's hard suspension cap ({hardCap} minutes). Upgrade your subscription soon to avoid service interruptions.
              </div>
            )}

            {/* Visual Progress Bar (Overage-aware) */}
            {hasFiniteLimit ? (
              <div className="space-y-2">
                <div className="relative">
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100 shadow-inner" style={{ border: "1px solid rgba(14,27,44,0.04)" }}>
                    <div
                      className={`h-full rounded-full ${activeStatus.bar} transition-all duration-500`}
                      style={{
                        width: `${Math.min(100, hardCapPercent)}%`,
                      }}
                    />
                  </div>
                  {/* Subtle marker at the included minutes mark (which is 1 / 1.5 = 66.6% of the hard cap bar) */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-slate-300 border-l border-dashed border-slate-400"
                    style={{ left: "66.67%" }}
                    title="Included Minutes limit"
                  />
                </div>

                <div className="flex justify-between items-center text-[12px] font-bold">
                  <span className="tabular-nums" style={{ color: "var(--color-vl-ink)" }}>
                    {used.toLocaleString()} min <span className="text-slate-400 font-medium">used</span>
                  </span>
                  <div className="flex gap-4 text-slate-500 font-semibold">
                    <span title="Billed as standard monthly flat fee">
                      Included: <strong className="text-slate-700">{limit} min</strong>
                    </span>
                    <span title="Overage cap: service suspends beyond this limit">
                      Hard Cap: <strong className="text-slate-700">{hardCap} min</strong>
                    </span>
                  </div>
                </div>

                {/* Progress details */}
                <div className="rounded-2xl border bg-slate-50/50 p-3 mt-3 flex justify-between items-center text-[12px] font-semibold" style={{ borderColor: "rgba(10,10,11,0.05)" }}>
                  <span style={{ color: "var(--color-vl-ink-muted)" }}>
                    {used > limit ? (
                      <>
                        Using overage: <strong className="text-orange-700">+{Math.max(0, used - limit)} min</strong> billed at ${getPlan(plan ?? "trial")?.overagePerMinuteUsd.toFixed(2) ?? "0.18"}/min.
                      </>
                    ) : (
                      <>
                        Plan allocation: <strong>{limit - used} min</strong> remaining.
                      </>
                    )}
                  </span>
                  <span className="tabular-nums" style={{ color: "var(--color-vl-ink-muted)" }}>
                    {hardCapPercent}% of absolute cap
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border bg-emerald-50/30 border-emerald-100 p-4 text-[13px] font-semibold text-emerald-800 flex justify-between items-center">
                <span>All voice minutes are completely unlimited on your current administrative role.</span>
                <span className="text-emerald-600 font-bold uppercase tracking-wider text-[11px]">Unlimited</span>
              </div>
            )}
          </div>

          {data?.topTools && data.topTools.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider mb-2.5 font-bold" style={{ color: "var(--color-vl-ink-faint)" }}>Top commands</p>
              <div className="space-y-2">
                {data.topTools.map((t) => {
                  const maxCount = Math.max(...(data?.topTools?.map((tool) => tool.count) ?? [1]));
                  const relativePct = Math.max(12, Math.round((t.count / maxCount) * 100));
                  return (
                    <div key={t.toolName} className="relative overflow-hidden rounded-xl bg-slate-50 border px-4 py-2 flex justify-between items-center text-[13px]" style={{ borderColor: "rgba(14,27,44,0.04)" }}>
                      {/* background count bar */}
                      <div className="absolute left-0 top-0 bottom-0 bg-[#FF6B47]/5 transition-all duration-300" style={{ width: `${relativePct}%` }} />
                      <span className="font-bold capitalize z-10" style={{ color: "var(--color-vl-ink)" }}>{t.toolName.replace(/_/g, " ")}</span>
                      <span className="tabular-nums font-bold text-slate-500 z-10">{t.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {data?.recentErrors && data.recentErrors.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider mb-2.5 font-bold" style={{ color: "var(--color-vl-ink-faint)" }}>Recent execution errors</p>
              <div className="space-y-1.5 text-[12.5px] font-semibold" style={{ color: "var(--color-vl-ink-muted)" }}>
                {data.recentErrors.slice(0, 5).map((e, i) => (
                  <div key={i} className="flex gap-2.5 items-start p-2.5 bg-red-50/40 rounded-xl border border-red-100/60">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />
                    <span><strong className="text-red-700 capitalize font-bold">{e.toolName.replace(/_/g, " ")}</strong>: {e.errorMessage ?? "Unknown error details"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
