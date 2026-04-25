import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Settings as Cog, ChevronDown } from "lucide-react";
import { roomSettings } from "@/lib/tokens";

export default function Settings() {
  const [, setLocation] = useLocation();
  const { data: auth, isLoading, refetch } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg] = useState("");

  const [defaultRoom, setDefaultRoom] = useState("bar");
  const [defaultApprovalLevel, setDefaultApprovalLevel] = useState("standard");
  const [advancedOpen, setAdvancedOpen] = useState(false);

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

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileLoading(true);
    setProfileMsg("");
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save your profile.");
      setProfileMsg("Profile updated.");
      refetch();
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : "Could not save your profile.");
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwLoading(true);
    setPwMsg("");
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not change your password.");
      setPwMsg("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setPwMsg(err instanceof Error ? err.message : "Could not change your password.");
    } finally {
      setPwLoading(false);
    }
  };

  const handleManageBilling = async () => {
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
    }
  };

  return (
    <div className="flex-1 pt-24 pb-24">
      <div className="w-full max-w-[900px] mx-auto px-6 lg:px-10">
        <div className="mb-10 flex items-center gap-3">
          <Cog className="w-5 h-5" style={{ color: "var(--color-vl-brass2)" }} />
          <p className="vl-eyebrow">Settings</p>
        </div>

        <div className="space-y-3">
          {/* Account */}
          <SettingCard title="Account" subtitle="Your name and email on the console.">
            <form onSubmit={handleProfileUpdate} className="grid sm:grid-cols-2 gap-4">
              <Field label="Name">
                <input value={name} onChange={(e) => setName(e.target.value)} className="vl-input" />
              </Field>
              <Field label="Email">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="vl-input" />
              </Field>
              <div className="sm:col-span-2 flex items-center gap-3">
                <button type="submit" disabled={profileLoading} className="vl-btn-primary inline-flex items-center gap-2 text-[13px]">
                  {profileLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save profile
                </button>
                {profileMsg && (
                  <span
                    className="text-[12px]"
                    style={{ color: profileMsg.includes("updated") ? "var(--color-vl-success)" : "var(--color-vl-danger)" }}
                  >
                    {profileMsg}
                  </span>
                )}
              </div>
            </form>
          </SettingCard>

          {/* Security */}
          <SettingCard title="Security" subtitle="Change your password.">
            <form onSubmit={handlePasswordChange} className="grid sm:grid-cols-2 gap-4">
              <Field label="Current password">
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="vl-input"
                />
              </Field>
              <Field label="New password">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  className="vl-input"
                />
              </Field>
              <div className="sm:col-span-2 flex items-center gap-3">
                <button type="submit" disabled={pwLoading} className="vl-btn-ghost inline-flex items-center gap-2 text-[13px]">
                  {pwLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Change password
                </button>
                {pwMsg && (
                  <span
                    className="text-[12px]"
                    style={{ color: pwMsg.includes("updated") ? "var(--color-vl-success)" : "var(--color-vl-danger)" }}
                  >
                    {pwMsg}
                  </span>
                )}
              </div>
            </form>
          </SettingCard>

          {/* Assistant defaults */}
          <SettingCard title="Assistant defaults" subtitle="Apply to new assistants. You can override per assistant.">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Default room setting">
                <select value={defaultRoom} onChange={(e) => setDefaultRoom(e.target.value)} className="vl-input">
                  {roomSettings.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Default approval rule">
                <select value={defaultApprovalLevel} onChange={(e) => setDefaultApprovalLevel(e.target.value)} className="vl-input">
                  <option value="loose">Loose · only sensitive actions ask</option>
                  <option value="standard">Standard · risky actions ask</option>
                  <option value="strict">Strict · everything that changes asks</option>
                </select>
              </Field>
            </div>
          </SettingCard>

          {/* Connected services pointer */}
          <SettingCard title="Connected services" subtitle="Manage Square and other connections.">
            <button onClick={() => setLocation("/services")} className="vl-btn-ghost text-[13px]">
              Open connected services
            </button>
          </SettingCard>

          {/* Team access */}
          <SettingCard title="Team access" subtitle="Invite people who can open and manage your assistants.">
            <p className="text-[13px]" style={{ color: "rgba(245,239,227,0.6)" }}>
              Team access is on the way. Today you and admins on your account can manage assistants.
            </p>
          </SettingCard>

          {/* Billing */}
          <SettingCard title="Billing" subtitle="Plan and trial status.">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-[13px]" style={{ color: "rgba(245,239,227,0.7)" }}>
                {auth.subscription?.status === "trialing" ? (
                  <>
                    Free trial · {auth.subscription?.plan ?? "trial"} · Ends{" "}
                    {auth.subscription?.trialEndsAt
                      ? new Date(auth.subscription.trialEndsAt).toLocaleDateString()
                      : "—"}
                  </>
                ) : auth.subscription?.status === "active" ? (
                  <>Active · {auth.subscription?.plan ?? "—"}</>
                ) : (
                  <>{auth.subscription?.status ?? "No plan"}</>
                )}
              </p>
              <button onClick={handleManageBilling} className="vl-btn-ghost text-[13px]">Manage billing</button>
            </div>
          </SettingCard>

          {/* Advanced — disclosed */}
          <section className="vl-panel">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="w-full p-7 flex items-center justify-between text-left"
            >
              <div>
                <h2 className="text-[18px] font-semibold tracking-tight" style={{ color: "var(--color-vl-ivory)" }}>
                  Advanced
                </h2>
                <p className="text-[13px] mt-1" style={{ color: "rgba(245,239,227,0.6)" }}>
                  Developer connection keys, voice provider details, diagnostics. Hidden from the default journey.
                </p>
              </div>
              <ChevronDown
                className="w-4 h-4 transition-transform"
                style={{ transform: advancedOpen ? "rotate(180deg)" : "none", color: "rgba(245,239,227,0.55)" }}
              />
            </button>
            {advancedOpen && (
              <div className="px-7 pb-7 space-y-4 text-[13px]" style={{ color: "rgba(245,239,227,0.7)" }}>
                <div>
                  <p className="vl-eyebrow mb-1.5">Voice provider details</p>
                  <p>
                    Server-side keys (OPENAI_API_KEY, GEMINI_API_KEY, ELEVENLABS_API_KEY, DEEPGRAM_API_KEY, LIVEKIT_*) are configured by environment. Availability shows up automatically in the voice option picker.
                  </p>
                </div>
                <div>
                  <p className="vl-eyebrow mb-1.5">Custom connection</p>
                  <p>
                    Bridge a custom system over REST or webhook. Contact support to enable for your account.
                  </p>
                </div>
                <div>
                  <p className="vl-eyebrow mb-1.5">Diagnostics</p>
                  <p>
                    Connection logs, response times, and event traces live here when needed. Not shown in the default UI.
                  </p>
                </div>
                <div>
                  <p className="vl-eyebrow mb-1.5">Data retention</p>
                  <p>
                    Conversations are kept for 90 days by default. Contact support to extend.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      <style>{`
        .vl-input {
          width: 100%;
          height: 44px;
          padding: 0 14px;
          border-radius: 12px;
          background: rgba(245,239,227,0.04);
          border: 1px solid rgba(245,239,227,0.12);
          color: var(--color-vl-ivory);
          font-size: 14px;
          outline: none;
          transition: border-color .2s ease, background .2s ease;
        }
        .vl-input::placeholder { color: rgba(245,239,227,0.32); }
        .vl-input:focus { border-color: rgba(124,110,245,0.7); background: rgba(245,239,227,0.06); }
        select.vl-input { appearance: none; }
      `}</style>
    </div>
  );
}

function SettingCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="vl-panel p-7">
      <h2 className="text-[18px] font-semibold tracking-tight" style={{ color: "var(--color-vl-ivory)" }}>{title}</h2>
      {subtitle && (
        <p className="text-[13px] mt-1 mb-5" style={{ color: "rgba(245,239,227,0.6)" }}>{subtitle}</p>
      )}
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="vl-eyebrow block mb-1.5">{label}</span>
      {children}
    </label>
  );
}
