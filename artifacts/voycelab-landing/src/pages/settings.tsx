import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { SignedIn, SignedOut, OrganizationSwitcher } from "@clerk/clerk-react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  Check,
  CheckCircle2,
  Circle,
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
  Search,
  HelpCircle
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
  };
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

  useEffect(() => {
    if (!auth?.user?.isAdmin && settingsTab === "admin") setSettingsTab("account");
  }, [auth?.user?.isAdmin, settingsTab]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-vl-cream min-h-screen">
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

  return (
    <div className="relative flex-1 overflow-hidden bg-vl-cream px-4 pb-24 pt-16 sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-230">
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
          <div className="mt-10 space-y-6">
            {/* Usage */}
            <UsageCard token={localStorage.getItem("voycelab_token")} plan={plan} isAdmin={auth.user.isAdmin} />

            {/* Profile */}
            <Section icon={<UserRound className="h-5 w-5" />} title="Profile Details" description="Your basic identity information.">
              <form onSubmit={handleProfileUpdate} className="grid sm:grid-cols-2 gap-5">
                <Field label="Full Name">
                  <input value={name} onChange={(e) => setName(e.target.value)} className="vl-compact-input shadow-sm" placeholder="Your name" />
                </Field>
                <Field label="Email Address">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="vl-compact-input shadow-sm" placeholder="Your email address" />
                </Field>
                <div className="sm:col-span-2 flex items-center justify-between border-t pt-4 mt-2" style={{ borderColor: "rgba(10,10,11,0.05)" }}>
                  <button
                    type="submit"
                    disabled={profileLoading || !profileDirty}
                    className="vl-btn-primary inline-flex items-center gap-2 text-[13px] disabled:opacity-40 disabled:cursor-not-allowed shadow-sm hover:shadow transition-all duration-200"
                  >
                    {profileLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Save profile
                  </button>
                  {profileMsg && (
                    <InlineStatus tone={profileMsg.tone} text={profileMsg.text} />
                  )}
                </div>
              </form>
            </Section>

            {/* Password */}
            <Section icon={<Lock className="h-5 w-5" />} title="Security Credentials" description="Update your access password.">
              <form onSubmit={handlePasswordChange} className="grid sm:grid-cols-2 gap-5">
                <Field label="Current Password">
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="vl-compact-input shadow-sm"
                    autoComplete="current-password"
                    placeholder="••••••••"
                  />
                </Field>
                <Field label="New Password">
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={8}
                    className="vl-compact-input shadow-sm"
                    autoComplete="new-password"
                    placeholder="Min 8 characters"
                  />
                </Field>
                <div className="sm:col-span-2 flex items-center justify-between border-t pt-4 mt-2" style={{ borderColor: "rgba(10,10,11,0.05)" }}>
                  <button
                    type="submit"
                    disabled={pwLoading || !currentPassword || !newPassword}
                    className="vl-btn-ghost inline-flex items-center gap-2 text-[13px] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-all duration-200"
                  >
                    {pwLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Update password
                  </button>
                  {pwMsg && <InlineStatus tone={pwMsg.tone} text={pwMsg.text} />}
                </div>
              </form>
            </Section>

            {/* Billing */}
            <Section icon={<CreditCard className="h-5 w-5" />} title="Subscription & Billing" description="Manage plans, renewals and subscriptions.">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex-1">
                  <p className="text-[16px] font-bold" style={{ color: "var(--color-vl-ink)" }}>
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
                  <p className="text-[13px] mt-1.5 leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
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
                    <div className="mt-3 flex flex-wrap gap-2">
                      <BillingBadge
                        tone={billingLinked ? "ok" : "warn"}
                        text={billingLinked ? "Subscription active & synced" : "Finalizing cloud sync…"}
                      />
                    </div>
                  )}

                  {/* Admin Diagnostics (Hidden behind Admin view check, stylized) */}
                  {auth.user.isAdmin && billingStatus && (
                    <div className="mt-4 border-t pt-4">
                      <p className="text-[11px] uppercase tracking-wider font-bold mb-2 text-slate-400">Launch Diagnostics Checklist</p>
                      <div className="flex flex-wrap gap-2.5">
                        <BillingBadge
                          tone={billingStatus.configured ? "ok" : "warn"}
                          text={billingStatus.configured ? "Stripe Connected" : "Stripe Integration Needed"}
                        />
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
                        <BillingBadge
                          tone={billingStatus.webhooksReady ? "ok" : "warn"}
                          text={billingStatus.webhooksReady ? "Sync Webhook Online" : "Webhook Pending Setup"}
                        />
                        <BillingBadge
                          tone={billingStatus.secretKeyConfigured ? "ok" : "warn"}
                          text={billingStatus.secretKeyConfigured ? "Sync Key Configured" : "Sync Key Needed"}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-start md:items-end gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleManageBilling}
                    disabled={billingLoading}
                    className={
                      trialExpired
                        ? "vl-btn-primary inline-flex items-center gap-2 text-[13.5px] shadow-sm hover:shadow transition-all duration-200"
                        : "vl-btn-ghost inline-flex items-center gap-2 text-[13.5px] hover:bg-slate-50 transition-all duration-200"
                    }
                  >
                    {billingLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {auth.user.isAdmin ? "Access admin panel" : trialExpired ? "Choose plan" : planActive && !billingLinked ? "Complete sync" : planActive ? "Manage subscription" : "Upgrade"}
                    {!auth.user.isAdmin && <ArrowUpRight className="w-3.5 h-3.5" />}
                  </button>
                  {billingMsg && <InlineStatus tone={billingMsg.tone} text={billingMsg.text} />}
                </div>
              </div>
            </Section>

            {/* Platform Readiness */}
            {auth.user.isAdmin && (
              <Section icon={<KeyRound className="h-5 w-5" />} title="Infrastructure & Secrets" description="Security credentials and provider APIs.">
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <ChecklistItem
                      isCompleted={Boolean(platformStatus?.providers.openai.configured)}
                      label="OpenAI Realtime Key"
                      subtext={providerReadinessText("OpenAI", platformStatus?.providers.openai)}
                    />
                    <ChecklistItem
                      isCompleted={Boolean(platformStatus?.providers.gemini.configured)}
                      label="Google Gemini Live Key"
                      subtext={providerReadinessText("Gemini", platformStatus?.providers.gemini)}
                    />
                    <ChecklistItem
                      isCompleted={Boolean(platformStatus?.secretsEncryption.productionReady)}
                      label="Secrets AES Key"
                      subtext={platformStatus?.secretsEncryption.productionReady ? "Encrypted and secured" : "Key needs rotation"}
                    />
                    <ChecklistItem
                      isCompleted={Boolean(platformStatus?.square.applicationIdConfigured && platformStatus?.square.applicationSecretConfigured)}
                      label="Square App Client"
                      subtext={platformStatus?.square.applicationIdConfigured && platformStatus?.square.applicationSecretConfigured ? "Connected with OAuth" : "OAuth credentials needed"}
                    />
                    <ChecklistItem
                      isCompleted={Boolean(platformStatus?.databaseConfigured && platformStatus?.jwtSecretConfigured)}
                      label="Postgres & JWT"
                      subtext={platformStatus?.databaseConfigured && platformStatus?.jwtSecretConfigured ? "Database sync ready" : "Check credentials"}
                    />
                  </div>
                  <p className="text-[12px] leading-relaxed border-t pt-3" style={{ color: "var(--color-vl-ink-muted)", borderColor: "rgba(10,10,11,0.05)" }}>
                    Secret values stay strictly encrypted on the server-side. This checklist verifies only key configuration presence.
                  </p>
                </div>
              </Section>
            )}

            {/* Organization */}
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

        {/* Next step nudge */}
        <div className="mt-16 border-t pt-10" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
          <p className="vl-eyebrow mb-4 text-[11px] font-bold uppercase tracking-wider">Quick Navigation</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <NextLink
              href="/services"
              title="Connected Integrations"
              hint="Manage your connected Square POS venues."
            />
            <NextLink
              href="/assistants"
              title="Voice Assistants"
              hint="Configure wake phrases, skills and test tools."
            />
          </div>
        </div>
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
  return (
    <section className="vl-panel grid gap-6 p-6 md:grid-cols-[220px_1fr] md:gap-8 rounded-3xl border shadow-sm transition hover:shadow-md duration-300" style={{ borderColor: "rgba(14,27,44,0.05)" }}>
      <div className="flex gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-sm border border-orange-100" style={{ background: "var(--color-vl-coral-tint)", color: "var(--color-vl-coral-deep)" }}>
          {icon}
        </div>
        <div>
          <h2 className="text-[16px] font-bold leading-snug" style={{ color: "var(--color-vl-ink)" }}>
            {title}
          </h2>
          {description && (
            <p className="text-[12.5px] mt-1.5 leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-col justify-center">{children}</div>
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
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-bold shadow-sm"
      style={{
        color: ok ? "var(--color-vl-success)" : "#D97706",
        borderColor: ok ? "rgba(20, 133, 85, 0.2)" : "rgba(217, 119, 6, 0.2)",
        background: ok ? "rgba(20, 133, 85, 0.05)" : "rgba(217, 119, 6, 0.05)",
      }}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'} ${ok ? 'animate-pulse' : ''}`} />
      {text}
    </span>
  );
}

function ChecklistItem({ isCompleted, label, subtext }: { isCompleted: boolean; label: string; subtext: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border bg-white/50 p-4 shadow-sm" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full mt-0.5 border ${isCompleted ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-amber-50 border-amber-200 text-amber-600'}`}>
        {isCompleted ? <Check className="h-3.5 w-3.5 font-bold" /> : <HelpCircle className="h-3.5 w-3.5" />}
      </div>
      <div>
        <p className="text-[13px] font-bold" style={{ color: "var(--color-vl-ink)" }}>{label}</p>
        <p className="text-[11.5px] mt-0.5 leading-snug" style={{ color: "var(--color-vl-ink-muted)" }}>{subtext}</p>
      </div>
    </div>
  );
}

function NextLink({ href, title, hint }: { href: string; title: string; hint: string }) {
  return (
    <Link
      href={href}
      className="group vl-card flex items-center justify-between gap-4 px-6 py-5 rounded-3xl bg-white/70 border hover:bg-white hover:shadow-md transition-all duration-300"
      style={{ borderColor: "rgba(14,27,44,0.06)" }}
    >
      <div>
        <p className="text-[15px] font-bold" style={{ color: "var(--color-vl-ink)" }}>
          {title}
        </p>
        <p className="text-[12.5px] mt-1" style={{ color: "var(--color-vl-ink-muted)" }}>
          {hint}
        </p>
      </div>
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FF6B47]/10 group-hover:bg-[#FF6B47] transition-all duration-300">
        <ArrowRight className="w-4 h-4 text-[#FF6B47] group-hover:text-white transition-all duration-300 group-hover:translate-x-0.5" />
      </div>
    </Link>
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
  const [drafts, setDrafts] = useState<Record<number, { plan: string; status: string; role: string }>>({});
  const [searchQuery, setSearchQuery] = useState("");

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
      const nextDrafts: Record<number, { plan: string; status: string; role: string }> = {};
      for (const user of (payload as AdminOverview).users) {
        nextDrafts[user.id] = {
          plan: user.subscription?.plan ?? "trial",
          status: user.subscription?.status ?? "trialing",
          role: user.organization?.role ?? "owner",
        };
      }
      setDrafts(nextDrafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin overview is unavailable.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  const updateDraft = (userId: number, key: "plan" | "status" | "role", value: string) => {
    setDrafts((current) => ({
      ...current,
      [userId]: {
        plan: current[userId]?.plan ?? "trial",
        status: current[userId]?.status ?? "trialing",
        role: current[userId]?.role ?? "owner",
        [key]: value,
      },
    }));
  };

  const saveAccess = async (user: AdminUserAccess) => {
    if (!token) return;
    setSavingId(user.id);
    setError(null);
    try {
      const draft = drafts[user.id] ?? {
        plan: user.subscription?.plan ?? "trial",
        status: user.subscription?.status ?? "trialing",
        role: user.organization?.role ?? "owner",
      };
      const res = await fetch(`/api/v1/admin/users/${user.id}/access`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          plan: draft.plan,
          status: draft.status,
          role: draft.role,
          organizationId: user.organization?.id ?? undefined,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error?.message ?? "Could not update access.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update access.");
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

  const filteredUsers = data.users.filter((user) => {
    const q = searchQuery.toLowerCase();
    return (
      user.name?.toLowerCase().includes(q) ||
      user.email?.toLowerCase().includes(q) ||
      user.subscription?.plan?.toLowerCase().includes(q) ||
      user.organization?.name?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="mt-10 space-y-6">
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-2.5 text-[13px] text-red-600 font-medium">
          <AlertCircle className="h-4.5 w-4.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Telemetry Panel */}
      <Section icon={<BarChart3 className="h-5 w-5" />} title="Platform Telemetry" description={`Global platform utilization aggregates over the last ${data.windowDays} days.`}>
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <AdminMetricCard label="Users" value={data.totals.users} icon={<UsersRound className="h-5 w-5" />} bgColor="bg-blue-50" textColor="text-blue-600 animate-pulse" />
          <AdminMetricCard label="Venues" value={data.totals.venues} icon={<Store className="h-5 w-5" />} bgColor="bg-emerald-50" textColor="text-emerald-600" />
          <AdminMetricCard label="Assistants" value={data.totals.assistants} icon={<Sparkles className="h-5 w-5" />} bgColor="bg-orange-50" textColor="text-orange-500" />
          <AdminMetricCard label="Voice Min" value={data.totals.voiceMinutes} icon={<Mic className="h-5 w-5" />} bgColor="bg-purple-50" textColor="text-purple-600" />
          <AdminMetricCard label="Commands" value={data.totals.toolCalls} icon={<Activity className="h-5 w-5" />} bgColor="bg-teal-50" textColor="text-teal-600 animate-pulse" />
          <AdminMetricCard label="Failures" value={data.totals.failedToolCalls} icon={<AlertCircle className="h-5 w-5" />} bgColor={data.totals.failedToolCalls > 0 ? "bg-red-50" : "bg-gray-50"} textColor={data.totals.failedToolCalls > 0 ? "text-red-500 animate-bounce" : "text-gray-500"} isFailure={data.totals.failedToolCalls > 0} />
        </div>

        {data.topTools.length > 0 && (
          <div className="mt-6 border-t pt-5" style={{ borderColor: "rgba(10,10,11,0.05)" }}>
            <p className="text-[11px] uppercase tracking-wider font-bold mb-3.5 text-slate-400">Top Commanded Skills</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.topTools.map((tool) => (
                <div key={tool.toolName} className="flex items-center justify-between rounded-xl border bg-white/60 px-4 py-3 text-[13px] hover:bg-white hover:shadow-sm transition duration-200" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
                  <span className="font-semibold text-slate-700 capitalize">{tool.toolName.replace(/_/g, " ")}</span>
                  <span className="tabular-nums font-bold px-2 py-0.5 bg-slate-100 rounded-md text-[11.5px] text-slate-600">{tool.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* Pipeline Access */}
      <Section icon={<KeyRound className="h-5 w-5" />} title="Voice Pipeline Provisioning" description="Real-time WebRTC and server-relayed pipeline availability checks.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.pipelines.map((pipeline) => {
            const isLive = pipeline.status === "available" || pipeline.status === "experimental";
            const isExperimental = pipeline.status === "experimental";
            return (
              <div key={pipeline.provider} className="relative overflow-hidden rounded-2xl border bg-white/60 p-5 shadow-sm hover:shadow-md transition duration-300" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[14px] font-bold" style={{ color: "var(--color-vl-ink)" }}>{pipeline.displayName}</p>
                    <p className="mt-1 text-[11px] font-mono font-semibold uppercase tracking-wider" style={{ color: "var(--color-vl-ink-muted)" }}>{pipeline.provider}</p>
                  </div>
                  <span className="relative flex h-3 w-3 mt-1 shrink-0">
                    {isLive && (
                      <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${isExperimental ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                    )}
                    <span className={`relative inline-flex h-3 w-3 rounded-full ${isLive ? (isExperimental ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-slate-300'}`} />
                  </span>
                </div>
                {pipeline.reason && (
                  <p className="mt-4 text-[12.5px] leading-relaxed border-t pt-3" style={{ borderColor: "rgba(10,10,11,0.04)", color: "var(--color-vl-ink-muted)" }}>{pipeline.reason}</p>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* Role Definitions */}
      <Section icon={<ShieldCheck className="h-5 w-5" />} title="Security Roles Matrix" description="Standard workspace credential requirements and authorization limits.">
        <div className="grid gap-3.5 md:grid-cols-2">
          {data.roles.map((role) => (
            <div key={role.role} className="flex gap-4 rounded-2xl border bg-white/60 p-4 shadow-sm" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 shadow-inner">
                <Lock className="h-4.5 w-4.5" />
              </div>
              <div>
                <p className="text-[14.5px] font-bold" style={{ color: "var(--color-vl-ink)" }}>{role.label}</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {role.permissions.map((p) => (
                    <span key={p} className="rounded-lg bg-slate-50 border border-slate-100/80 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      {p.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* User Access with Live Search */}
      <Section icon={<UsersRound className="h-5 w-5" />} title="Tenant Management" description="Modify client subscription tiers, organization states and permissions.">
        <div className="space-y-4">
          {/* Live Search */}
          <div className="relative">
            <Search className="absolute left-4.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search active accounts by name, email, plan or workspace..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-12 pl-11 pr-4 rounded-2xl border bg-white/60 text-[13.5px] outline-none transition-all duration-200 focus:border-[#FF6B47]"
              style={{ borderColor: "rgba(10,10,11,0.12)", color: "var(--color-vl-ink)" }}
            />
          </div>

          {filteredUsers.length === 0 ? (
            <div className="text-center py-10 rounded-2xl border border-dashed bg-white/30" style={{ borderColor: "rgba(10,10,11,0.10)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--color-vl-ink-muted)" }}>No accounts match the query.</p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {filteredUsers.map((user) => {
                const draft = drafts[user.id] ?? {
                  plan: user.subscription?.plan ?? "trial",
                  status: user.subscription?.status ?? "trialing",
                  role: user.organization?.role ?? "owner",
                };
                const initials = (user.name || user.email)
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2);

                return (
                  <div key={user.id} className="rounded-2xl border bg-white/80 p-5 shadow-sm hover:shadow-md transition-all duration-300" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4 mb-4" style={{ borderColor: "rgba(10,10,11,0.05)" }}>
                      <div className="flex items-center gap-3.5">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[13.5px] font-bold shadow-sm" style={{ background: "var(--color-vl-coral-tint)", color: "var(--color-vl-coral-deep)" }}>
                          {initials}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[14.5px] font-bold" style={{ color: "var(--color-vl-ink)" }}>{user.name || user.email}</p>
                            {user.isPlatformAdmin && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                                Platform Admin
                              </span>
                            )}
                          </div>
                          <p className="text-[12.5px] mt-0.5" style={{ color: "var(--color-vl-ink-muted)" }}>{user.email}</p>
                          <p className="text-[12px] mt-1" style={{ color: "var(--color-vl-ink-muted)" }}>
                            Workspace: <span className="font-bold text-slate-700">{user.organization?.name ?? "Workspace"}</span>
                            {user.usage.lastActivityAt && (
                              <span className="ml-2.5 px-2 py-0.5 bg-slate-100 rounded text-[11px] font-semibold text-slate-500">
                                Active: {new Date(user.usage.lastActivityAt).toLocaleDateString()}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4.5">
                        <div className="text-right hidden sm:block">
                          <div className="flex gap-4 text-[12px] font-semibold" style={{ color: "var(--color-vl-ink-muted)" }}>
                            <div>
                              <span className="block text-right text-[15px] font-bold" style={{ color: "var(--color-vl-ink)" }}>{user.usage.voiceMinutes.toLocaleString()}</span>
                              minutes
                            </div>
                            <div>
                              <span className="block text-right text-[15px] font-bold" style={{ color: "var(--color-vl-ink)" }}>{user.usage.toolCalls.toLocaleString()}</span>
                              commands
                            </div>
                            <div>
                              <span className="block text-right text-[15px] font-bold" style={{ color: user.usage.failedToolCalls > 0 ? "var(--color-vl-danger)" : "var(--color-vl-ink)" }}>{user.usage.failedToolCalls.toLocaleString()}</span>
                              failures
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="vl-btn-primary inline-flex items-center gap-2 text-[12.5px] py-1.5 px-4 h-9 shadow-sm hover:shadow transition duration-200"
                          disabled={savingId === user.id}
                          onClick={() => void saveAccess(user)}
                        >
                          {savingId === user.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <span>Save Changes</span>
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <AdminSelect label="Plan" value={draft.plan} options={["trial", "pro", "business", "admin"]} onChange={(value) => updateDraft(user.id, "plan", value)} />
                      <AdminSelect label="Status" value={draft.status} options={["trialing", "active", "past_due", "canceled", "inactive"]} onChange={(value) => updateDraft(user.id, "status", value)} />
                      <AdminSelect label="Role" value={draft.role} options={["owner", "admin", "manager", "operator"]} onChange={(value) => updateDraft(user.id, "role", value)} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Section>

      {/* Recent Errors Dark Terminal */}
      {data.recentErrors.length > 0 && (
        <Section icon={<Terminal className="h-5 w-5" />} title="Exception Stream Logs" description="Live streaming execution logs for debugging tool failures.">
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0A0E17] font-mono text-[12.5px] leading-relaxed shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 bg-[#111622] px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-[#FF5F56] shadow-sm" />
                <div className="h-3 w-3 rounded-full bg-[#FFBD2E] shadow-sm" />
                <div className="h-3 w-3 rounded-full bg-[#27C93F] shadow-sm" />
                <span className="ml-2.5 font-bold text-slate-400 text-xs uppercase tracking-wider">Exception Feed</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
                <span>monitoring active</span>
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto p-4 space-y-3.5 scrollbar-thin scrollbar-thumb-slate-800">
              {data.recentErrors.slice(0, 15).map((err, index) => (
                <div key={`${err.createdAt}-${index}`} className="flex flex-col md:flex-row gap-2 border-b border-slate-900/50 pb-2.5 last:border-0 last:pb-0">
                  <span className="text-[#FF6B47] shrink-0 font-semibold md:w-40 overflow-hidden text-ellipsis whitespace-nowrap">{err.email ?? "Unknown User"}</span>
                  <div className="flex-1">
                    <span className="inline-block rounded-md bg-slate-900 border border-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-300 mr-2 uppercase tracking-wider">{err.toolName.replace(/_/g, " ")}</span>
                    <span className="text-slate-400">{err.errorMessage ?? "Unspecified error exceptions details."}</span>
                  </div>
                  <span className="text-slate-600 text-xs shrink-0 font-semibold">{new Date(err.createdAt).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

function AdminMetricCard({ label, value, icon, bgColor, textColor, isFailure = false }: { label: string; value: number; icon: ReactNode; bgColor: string; textColor: string; isFailure?: boolean }) {
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border bg-white/60 p-4 shadow-sm hover:shadow transition duration-200" style={{ borderColor: "rgba(10,10,11,0.06)" }}>
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-inner ${bgColor} ${textColor}`}>
        {icon}
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.14em] font-bold" style={{ color: "var(--color-vl-ink-faint)" }}>{label}</p>
        <p className="text-[20px] font-bold tabular-nums mt-0.5 leading-none" style={{ color: isFailure ? "var(--color-vl-danger)" : "var(--color-vl-ink)" }}>
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

  const limit = isAdmin || plan === "admin"
    ? -1
    : getPlan(plan ?? "trial")?.includedVoiceMinutes ?? getPlan("trial")?.includedVoiceMinutes ?? 60;
  const used = data?.voiceMinutes?.used ?? 0;
  const hasFiniteLimit = limit !== -1;
  const pct = hasFiniteLimit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const limitLabel = hasFiniteLimit ? limit.toLocaleString() : "Unlimited";

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
            <div className="flex justify-between text-[14px] mb-2 font-bold">
              <span style={{ color: "var(--color-vl-ink)" }}>Voice minutes</span>
              <span className="tabular-nums" style={{ color: "var(--color-vl-ink-muted)" }}>
                {used.toLocaleString()} <span className="text-slate-400 font-medium">/ {limitLabel} min</span>
              </span>
            </div>
            {hasFiniteLimit && (
              <div className="h-3 rounded-full overflow-hidden bg-slate-100 shadow-inner" style={{ border: "1px solid rgba(14,27,44,0.04)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-[#FF6B47] to-[#D7402E]"
                  style={{
                    width: `${pct}%`,
                  }}
                />
              </div>
            )}
            {hasFiniteLimit && pct >= 80 && (
              <p className="text-xs mt-1.5 font-bold" style={{ color: "var(--color-vl-coral-deep, #e04323)" }}>
                {pct >= 100 ? "Overage mode active: overage charges will apply" : "Approaching monthly plan limits"}
              </p>
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
