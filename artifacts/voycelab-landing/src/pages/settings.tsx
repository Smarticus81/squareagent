import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { ArrowLeft, ArrowRight, ArrowUpRight, CheckCircle2, Loader2 } from "lucide-react";

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

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileMsg, setProfileMsg] = useState<null | { tone: "ok" | "error"; text: string }>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg] = useState<null | { tone: "ok" | "error"; text: string }>(null);

  const [billingLoading, setBillingLoading] = useState(false);

  useEffect(() => {
    if (!isLoading && !auth?.user) setLocation("/login");
  }, [auth, isLoading, setLocation]);

  useEffect(() => {
    if (auth?.user && !name && !email) {
      setName(auth.user.name ?? "");
      setEmail(auth.user.email ?? "");
    }
  }, [auth?.user, name, email]);

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

  const handleProfileUpdate = async (e: React.FormEvent) => {
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

  const handlePasswordChange = async (e: React.FormEvent) => {
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
    setBillingLoading(true);
    try {
      const res = await fetch("/api/subscriptions/portal", {
        method: "POST",
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error("Could not open billing.");
      const { url } = await res.json();
      window.location.href = url;
    } catch (e) {
      console.error(e);
      setBillingLoading(false);
    }
  };

  const status = auth.subscription?.status ?? "trialing";
  const trialEndsAt = auth.subscription?.trialEndsAt ? new Date(auth.subscription.trialEndsAt) : null;
  const trialActive = status === "trialing" && (!trialEndsAt || trialEndsAt > new Date());
  const trialExpired = status === "trialing" && trialEndsAt && trialEndsAt < new Date();
  const planActive = status === "active";
  const daysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return (
    <div className="flex-1 pt-24 pb-24">
      <div className="w-full max-w-[760px] mx-auto px-6 lg:px-10">
        {/* Back to the console */}
        <Link
          href="/command"
          className="inline-flex items-center gap-1.5 text-[12px] mb-5 transition-colors"
          style={{ color: "rgba(245,239,227,0.55)" }}
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Console
        </Link>

        <p className="vl-eyebrow">Account</p>
        <h1 className="text-[28px] md:text-[32px] font-semibold tracking-tight mt-2" style={{ color: "var(--color-vl-ivory)" }}>
          Your account
        </h1>
        <p className="text-[14px] mt-2" style={{ color: "rgba(245,239,227,0.55)" }}>
          Manage how you sign in and what you pay for.
        </p>

        <div className="mt-10 divide-y divide-white/[0.06] border-t border-b border-white/[0.06]">
          {/* Profile */}
          <Section title="Profile" description="Your name and email on the console.">
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
          <Section title="Password" description="At least 8 characters.">
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
          <Section title="Billing" description="Your plan and trial.">
            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div>
                <p className="text-[15px] font-medium" style={{ color: "var(--color-vl-ivory)" }}>
                  {planActive
                    ? `${capitalize(auth.subscription?.plan ?? "Plan")} · Active`
                    : trialActive
                    ? `Free trial · ${capitalize(auth.subscription?.plan ?? "trial")}`
                    : trialExpired
                    ? "Trial ended"
                    : capitalize(status)}
                </p>
                <p className="text-[12.5px] mt-1" style={{ color: "rgba(245,239,227,0.55)" }}>
                  {planActive
                    ? "Your plan renews automatically."
                    : trialActive && trialEndsAt
                    ? `${daysLeft} days left · Ends ${trialEndsAt.toLocaleDateString()}`
                    : trialExpired
                    ? "Upgrade to keep using your assistant."
                    : "Pick a plan to get started."}
                </p>
              </div>
              <button
                onClick={handleManageBilling}
                disabled={billingLoading}
                className={
                  trialExpired
                    ? "vl-btn-primary inline-flex items-center gap-2 text-[13px]"
                    : "vl-btn-ghost inline-flex items-center gap-2 text-[13px]"
                }
              >
                {billingLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {trialExpired ? "Choose a plan" : planActive ? "Manage billing" : "Upgrade"}
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </Section>
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
              href="/command"
              title="Back to the console"
              hint="Open your assistant."
            />
          </div>
        </div>
      </div>

      <style>{`
        .vl-compact-input {
          width: 100%;
          height: 40px;
          padding: 0 12px;
          border-radius: 10px;
          background: rgba(245,239,227,0.035);
          border: 1px solid rgba(245,239,227,0.10);
          color: var(--color-vl-ivory);
          font-size: 13.5px;
          outline: none;
          transition: border-color .15s ease, background .15s ease;
        }
        .vl-compact-input::placeholder { color: rgba(245,239,227,0.3); }
        .vl-compact-input:focus {
          border-color: rgba(124,110,245,0.6);
          background: rgba(245,239,227,0.055);
        }
      `}</style>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-7 grid md:grid-cols-[220px_1fr] gap-6 md:gap-10">
      <div>
        <h2 className="text-[15px] font-semibold" style={{ color: "var(--color-vl-ivory)" }}>
          {title}
        </h2>
        {description && (
          <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: "rgba(245,239,227,0.5)" }}>
            {description}
          </p>
        )}
      </div>
      <div>{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.14em] mb-1.5" style={{ color: "rgba(245,239,227,0.45)" }}>
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

function NextLink({ href, title, hint }: { href: string; title: string; hint: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-4 px-5 py-4 rounded-xl border border-white/[0.06] transition-colors hover:border-white/[0.14] hover:bg-white/[0.015]"
    >
      <div>
        <p className="text-[14px] font-medium" style={{ color: "var(--color-vl-ivory)" }}>
          {title}
        </p>
        <p className="text-[12px] mt-0.5" style={{ color: "rgba(245,239,227,0.5)" }}>
          {hint}
        </p>
      </div>
      <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" style={{ color: "rgba(245,239,227,0.5)" }} />
    </Link>
  );
}

function capitalize(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
