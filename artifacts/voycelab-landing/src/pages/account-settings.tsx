import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { ArrowLeft, Loader2 } from "lucide-react";

const bg = "#F7F7F8";
const card = "#FFFFFF";
const text = "#111827";
const muted = "#6B7280";
const primary = "#2563EB";
const neuShadow = "6px 6px 12px rgba(0,0,0,0.05), -6px -6px 12px rgba(255,255,255,0.9)";
const neuInset = "inset 2px 2px 4px rgba(0,0,0,0.04), inset -2px -2px 4px rgba(255,255,255,0.7)";

export default function AccountSettings() {
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

  const user = auth?.user;
  if (user && !name && !email) {
    setName(user.name);
    setEmail(user.email);
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: bg }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: primary }} />
      </div>
    );
  }

  if (!user) {
    setLocation("/login");
    return null;
  }

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
      if (!res.ok) throw new Error(data.error || "Failed to update profile");
      setProfileMsg("Profile updated.");
      refetch();
    } catch (err: any) {
      setProfileMsg(err.message);
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
      if (!res.ok) throw new Error(data.error || "Failed to change password");
      setPwMsg("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err: any) {
      setPwMsg(err.message);
    } finally {
      setPwLoading(false);
    }
  };

  const inputStyle = {
    backgroundColor: bg,
    boxShadow: neuInset,
    color: text,
    border: "1px solid #E5E7EB",
  };

  return (
    <div className="flex-1" style={{ backgroundColor: bg, color: text }}>
      <div className="w-full max-w-[800px] mx-auto px-6 lg:px-10 py-12 pt-28">
        <button
          onClick={() => setLocation("/dashboard")}
          className="flex items-center gap-1.5 mb-8 text-[13px] font-medium transition-colors"
          style={{ color: "#9CA3AF" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = text)}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#9CA3AF")}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to dashboard
        </button>

        <h1 className="text-3xl font-bold tracking-tight mb-10" style={{ color: text }}>
          Account Settings
        </h1>

        <div className="grid gap-6">
          {/* Profile */}
          <div className="rounded-2xl p-8" style={{ backgroundColor: card, boxShadow: neuShadow }}>
            <p className="text-[11px] font-bold tracking-[0.15em] uppercase mb-6" style={{ color: "#9CA3AF" }}>
              Profile
            </p>
            <form onSubmit={handleProfileUpdate} className="space-y-5">
              <div>
                <label className="block text-[13px] font-medium mb-1.5" style={{ color: muted }}>Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl text-[14px] outline-none transition-all focus:ring-2 focus:ring-[#2563EB]/20"
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium mb-1.5" style={{ color: muted }}>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl text-[14px] outline-none transition-all focus:ring-2 focus:ring-[#2563EB]/20"
                  style={inputStyle}
                />
              </div>
              {profileMsg && (
                <p className="text-[13px]" style={{ color: profileMsg.includes("updated") ? "#16A34A" : "#EF4444" }}>
                  {profileMsg}
                </p>
              )}
              <button
                type="submit"
                disabled={profileLoading}
                className="h-11 px-8 rounded-xl text-[13px] font-semibold text-white transition-all hover:shadow-lg hover:shadow-blue-500/20 hover:-translate-y-0.5 disabled:opacity-60 inline-flex items-center gap-2"
                style={{ backgroundColor: primary }}
              >
                {profileLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save changes
              </button>
            </form>
          </div>

          {/* Password */}
          <div className="rounded-2xl p-8" style={{ backgroundColor: card, boxShadow: neuShadow }}>
            <p className="text-[11px] font-bold tracking-[0.15em] uppercase mb-6" style={{ color: "#9CA3AF" }}>
              Change Password
            </p>
            <form onSubmit={handlePasswordChange} className="space-y-5">
              <div>
                <label className="block text-[13px] font-medium mb-1.5" style={{ color: muted }}>
                  Current password
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl text-[14px] outline-none transition-all focus:ring-2 focus:ring-[#2563EB]/20"
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium mb-1.5" style={{ color: muted }}>
                  New password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl text-[14px] outline-none transition-all focus:ring-2 focus:ring-[#2563EB]/20"
                  style={inputStyle}
                />
              </div>
              {pwMsg && (
                <p className="text-[13px]" style={{ color: pwMsg.includes("success") ? "#16A34A" : "#EF4444" }}>
                  {pwMsg}
                </p>
              )}
              <button
                type="submit"
                disabled={pwLoading || !currentPassword || !newPassword}
                className="h-11 px-8 rounded-xl text-[13px] font-semibold transition-all hover:-translate-y-0.5 disabled:opacity-50 inline-flex items-center gap-2"
                style={{ backgroundColor: bg, boxShadow: neuShadow, color: text }}
              >
                {pwLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Change password
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
