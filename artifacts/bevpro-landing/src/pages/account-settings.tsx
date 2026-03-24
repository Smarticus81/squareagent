import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";

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

  // Initialize form fields from auth data
  const user = auth?.user;
  if (user && !name && !email) {
    setName(user.name);
    setEmail(user.email);
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="w-5 h-5 border border-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    setLocation("/login");
    return null;
  }

  const getHeaders = () => {
    const token = localStorage.getItem("bevpro_token");
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

  return (
    <div className="flex-1 bg-background text-foreground">
      <div className="max-w-xl w-full mx-auto px-6 py-12 pt-28">
        <button onClick={() => setLocation("/dashboard")} className="text-[13px] text-foreground/40 hover:text-foreground transition-colors flex items-center gap-1.5 mb-8">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to dashboard
        </button>

        <h1 className="text-2xl font-display font-medium tracking-tight text-foreground mb-10">Account Settings</h1>

        {/* Profile */}
        <div className="border border-foreground/8 p-8 mb-6">
          <p className="text-[12px] tracking-[0.15em] uppercase text-foreground/30 mb-6">Profile</p>
          <form onSubmit={handleProfileUpdate} className="space-y-4">
            <div>
              <label className="block text-[13px] text-foreground/50 font-light mb-1.5">Name</label>
              <input
                type="text" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full h-10 px-3 bg-foreground/[0.03] border border-foreground/10 text-[14px] text-foreground outline-none focus:border-foreground/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[13px] text-foreground/50 font-light mb-1.5">Email</label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full h-10 px-3 bg-foreground/[0.03] border border-foreground/10 text-[14px] text-foreground outline-none focus:border-foreground/30 transition-colors"
              />
            </div>
            {profileMsg && <p className="text-[13px] text-foreground/50">{profileMsg}</p>}
            <Button type="submit" className="h-10 px-7 text-[13px]" disabled={profileLoading}>
              {profileLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : null}
              Save changes
            </Button>
          </form>
        </div>

        {/* Password */}
        <div className="border border-foreground/8 p-8">
          <p className="text-[12px] tracking-[0.15em] uppercase text-foreground/30 mb-6">Change Password</p>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <label className="block text-[13px] text-foreground/50 font-light mb-1.5">Current password</label>
              <input
                type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full h-10 px-3 bg-foreground/[0.03] border border-foreground/10 text-[14px] text-foreground outline-none focus:border-foreground/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[13px] text-foreground/50 font-light mb-1.5">New password</label>
              <input
                type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                className="w-full h-10 px-3 bg-foreground/[0.03] border border-foreground/10 text-[14px] text-foreground outline-none focus:border-foreground/30 transition-colors"
              />
            </div>
            {pwMsg && <p className="text-[13px] text-foreground/50">{pwMsg}</p>}
            <Button type="submit" variant="outline" className="h-10 px-7 text-[13px]" disabled={pwLoading || !currentPassword || !newPassword}>
              {pwLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : null}
              Change password
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
