import { Link, useLocation } from "wouter";
import { Logo } from "./logo";
import { Button } from "./ui/button";
import { useAuth, useLogout } from "@/hooks/use-auth";
import { LogOut } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: auth, isLoading } = useAuth();
  const logout = useLogout();

  const isAuthPage = location === "/login" || location === "/signup";

  return (
    <div className="min-h-screen flex flex-col relative">
      {!isAuthPage && (
        <header
          className="fixed top-0 w-full z-50 border-b border-black/[0.04]"
          style={{
            background: "rgba(247,247,248,0.8)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
          }}
        >
          <div className="w-full max-w-[1400px] mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
            <Link href="/" className="hover:opacity-80 transition-opacity">
              <Logo />
            </Link>

            <nav className="flex items-center gap-6">
              <Link
                href="/capabilities"
                className="text-[13px] font-medium text-[#6B7280] hover:text-[#111827] transition-colors hidden sm:block"
              >
                Capabilities
              </Link>
              {!isLoading && (
                auth?.user ? (
                  <>
                    <Link
                      href="/dashboard"
                      className="text-[13px] font-medium text-[#6B7280] hover:text-[#111827] transition-colors"
                    >
                      Dashboard
                    </Link>
                    <button
                      className="text-[13px] font-medium flex items-center gap-1.5 px-4 py-2 rounded-xl text-[#2563EB] hover:bg-[#2563EB]/5 transition-colors"
                      onClick={() => logout.mutate()}
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Sign Out
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      href="/login"
                      className="text-[13px] font-medium text-[#6B7280] hover:text-[#111827] transition-colors hidden sm:block"
                    >
                      Sign In
                    </Link>
                    <Link href="/signup" className="inline-block">
                      <Button
                        size="sm"
                        className="text-[13px] h-9 px-6 rounded-xl bg-[#2563EB] text-white hover:bg-[#1D4ED8] shadow-sm"
                      >
                        Get Started
                      </Button>
                    </Link>
                  </>
                )
              )}
            </nav>
          </div>
        </header>
      )}

      <main className="flex-1 flex flex-col">
        {children}
      </main>

      {!isAuthPage && (
        <footer className="border-t border-black/[0.04] py-16 mt-auto" style={{ backgroundColor: "#F7F7F8" }}>
          <div className="w-full max-w-[1400px] mx-auto px-6 lg:px-10">
            <div className="flex flex-col md:flex-row justify-between items-start gap-10">
              <div>
                <Logo />
                <p className="text-[13px] text-[#6B7280] mt-3 max-w-[300px] leading-relaxed">
                  Voice-powered AI operations for venues, bars, and events. Connect your POS, speak to your agent, and go.
                </p>
              </div>
              <div className="flex gap-16 text-[13px]">
                <div className="space-y-2.5">
                  <p className="text-[#9CA3AF] font-semibold text-[10px] tracking-[0.2em] uppercase mb-3">Product</p>
                  <Link href="/signup" className="block text-[#6B7280] hover:text-[#111827] transition-colors">Get Started</Link>
                  <Link href="/login" className="block text-[#6B7280] hover:text-[#111827] transition-colors">Sign In</Link>
                  <Link href="/capabilities" className="block text-[#6B7280] hover:text-[#111827] transition-colors">Capabilities</Link>
                </div>
                <div className="space-y-2.5">
                  <p className="text-[#9CA3AF] font-semibold text-[10px] tracking-[0.2em] uppercase mb-3">Company</p>
                  <span className="block text-[#6B7280] cursor-default">About</span>
                  <span className="block text-[#6B7280] cursor-default">Contact</span>
                </div>
              </div>
            </div>
            <div className="mt-12 pt-6 border-t border-black/[0.04] flex flex-col sm:flex-row justify-between items-center gap-2">
              <p className="text-[11px] text-[#9CA3AF] tracking-wider">
                &copy; {new Date().getFullYear()} VoyceLabs. All rights reserved.
              </p>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
