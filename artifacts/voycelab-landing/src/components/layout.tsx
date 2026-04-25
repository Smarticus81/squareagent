import { Link, useLocation } from "wouter";
import { Logo } from "./logo";
import { useAuth, useLogout } from "@/hooks/use-auth";
import { LogOut, Menu, X } from "lucide-react";
import { useState } from "react";

const APP_NAV = [
  { href: "/command", label: "Command" },
  { href: "/assistants", label: "Assistants" },
  { href: "/services", label: "Connected services" },
  { href: "/conversations", label: "Conversations" },
  { href: "/routines", label: "Routines" },
  { href: "/settings", label: "Settings" },
];

// Landing has no brochure nav — the page itself is the journey.
// We keep one tiny anchor so people can skim to the start CTA at the bottom.
const LANDING_NAV: { href: string; label: string }[] = [];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: auth, isLoading } = useAuth();
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isAuthPage = location === "/login" || location === "/signup";
  const isLanding = location === "/";
  const isAppPage =
    !isLanding &&
    !isAuthPage &&
    APP_NAV.some((n) => location.startsWith(n.href));

  return (
    <div className="min-h-screen flex flex-col relative">
      {!isAuthPage && (
        <header className="fixed top-0 inset-x-0 z-50">
          <div className="vl-glass">
            <div className="w-full max-w-[1400px] mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
              <Link href="/" className="hover:opacity-90 transition-opacity">
                <Logo size="md" />
              </Link>

              {/* Desktop nav */}
              <nav className="hidden md:flex items-center gap-1">
                {(isAppPage ? APP_NAV : LANDING_NAV).map((item) => {
                  const active = isAppPage && location.startsWith(item.href);
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      className="text-[13px] font-medium px-3 py-1.5 rounded-full transition-colors"
                      style={{
                        color: active ? "var(--color-vl-ivory)" : "rgba(245,239,227,0.62)",
                        background: active ? "rgba(245,239,227,0.06)" : "transparent",
                      }}
                    >
                      {item.label}
                    </a>
                  );
                })}
              </nav>

              <div className="flex items-center gap-3">
                {!isLoading &&
                  (auth?.user ? (
                    <>
                      {!isAppPage && (
                        <Link
                          href="/command"
                          className="hidden sm:inline-flex text-[13px] font-medium px-4 py-1.5 rounded-full vl-btn-ghost"
                        >
                          Open console
                        </Link>
                      )}
                      <button
                        onClick={() => logout.mutate()}
                        className="text-[13px] font-medium flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors hover:bg-white/5"
                        style={{ color: "rgba(245,239,227,0.7)" }}
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Sign out</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <Link
                        href="/login"
                        className="hidden sm:inline text-[13px] font-medium px-4 py-1.5"
                        style={{ color: "rgba(245,239,227,0.7)" }}
                      >
                        Sign in
                      </Link>
                      <Link href="/signup" className="inline-block">
                        <button className="vl-btn-primary text-[13px] py-2 px-5">
                          Create your assistant
                        </button>
                      </Link>
                    </>
                  ))}

                <button
                  className="md:hidden text-ivory"
                  onClick={() => setMobileOpen((s) => !s)}
                  aria-label="Toggle menu"
                  style={{ color: "var(--color-vl-ivory)" }}
                >
                  {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {mobileOpen && (
              <div className="md:hidden border-t border-white/10 px-6 py-4 flex flex-col gap-2">
                {(isAppPage ? APP_NAV : LANDING_NAV).map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className="text-[14px] py-2"
                    style={{ color: "rgba(245,239,227,0.78)" }}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </header>
      )}

      <main className="flex-1 flex flex-col">{children}</main>

      {!isAuthPage && (
        <footer className="border-t border-white/[0.06] mt-auto">
          <div className="w-full max-w-[1400px] mx-auto px-6 lg:px-10 py-14">
            <div className="grid md:grid-cols-[1.4fr_1fr_1fr_1fr] gap-10">
              <div>
                <Logo size="md" />
                <p className="text-[13px] mt-4 max-w-[320px] leading-relaxed" style={{ color: "rgba(245,239,227,0.55)" }}>
                  The voice layer for modern venue operations. Bolt onto Square or another connected service. Speak. Confirm. Sync.
                </p>
              </div>
              <FooterCol
                title="Product"
                links={[
                  { href: "/assistants/new", label: "Create your assistant" },
                  { href: "/command", label: "Console" },
                  { href: "/services", label: "Connected services" },
                ]}
              />
              <FooterCol
                title="Trust"
                links={[
                  { href: "/settings", label: "Approval rules" },
                  { href: "/conversations", label: "Conversations" },
                ]}
              />
              <FooterCol
                title="Account"
                links={[
                  { href: "/login", label: "Sign in" },
                  { href: "/signup", label: "Create account" },
                ]}
              />
            </div>
            <div className="vl-line my-10" />
            <div className="flex flex-col sm:flex-row justify-between items-center gap-2 text-[11px]" style={{ color: "rgba(245,239,227,0.45)" }}>
              <p className="tracking-wider">© {new Date().getFullYear()} VoyceLab. Speak. Confirm. Sync.</p>
              <p className="tracking-[0.2em] uppercase">Voice layer · Not a POS</p>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div className="space-y-2.5">
      <p className="vl-eyebrow mb-3">{title}</p>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="block text-[13px] transition-colors"
          style={{ color: "rgba(245,239,227,0.62)" }}
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
