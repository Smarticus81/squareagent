import { Link, useLocation } from "wouter";
import { Logo } from "./logo";
import { useAuth, useLogout } from "@/hooks/use-auth";
import { LogOut, Menu, X, ArrowRight } from "lucide-react";
import { useState } from "react";

const APP_NAV = [
  { href: "/assistants", label: "Assistants" },
  { href: "/services", label: "Integrations" },
  { href: "/settings", label: "Account" },
];

const LANDING_NAV: { href: string; label: string }[] = [
  { href: "/pricing", label: "Pricing" },
];

/** Map legacy URLs so nav highlighting matches canonical routes. */
function normalizeAppPath(loc: string): string {
  if (loc === "/dashboard") return "/assistants";
  if (loc === "/account") return "/settings";
  if (loc === "/plans") return "/pricing";
  if (loc.startsWith("/agents")) return `/assistants${loc.slice("/agents".length)}`;
  return loc;
}

const PUBLIC_SITE_NAV = [
  { href: "/", label: "Home" },
  { href: "/pricing", label: "Pricing" },
];

function navLinkActive(canonicalPath: string, href: string): boolean {
  return canonicalPath === href || canonicalPath.startsWith(`${href}/`);
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: auth, isLoading } = useAuth();
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);

  const canonicalPath = normalizeAppPath(location);
  const isAuthPage = canonicalPath === "/login" || canonicalPath === "/signup";
  const isLanding = canonicalPath === "/";

  const showAppShellNav = Boolean(auth?.user) && !isLanding && !isAuthPage;
  const showPublicInteriorNav = !auth?.user && !isLanding && !isAuthPage;

  const headerNavItems = showAppShellNav ? APP_NAV : isLanding ? LANDING_NAV : PUBLIC_SITE_NAV;

  return (
    <div className="min-h-screen flex flex-col relative">
      {!isAuthPage && (
        <header className={`fixed top-0 inset-x-0 z-50 ${isLanding ? "vl-landing-header" : ""}`}>
          <div className="vl-glass">
            <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 h-16 sm:h-18 flex items-center justify-between gap-2 sm:gap-4">
              <Link href="/" className="hover:opacity-90 transition-opacity min-w-0 shrink">
                <Logo size={isLanding ? "md" : "md"} withTagline={isLanding} hideTaglineOnMobile={isLanding} />
              </Link>

              <nav className="hidden lg:flex items-center gap-1">
                {headerNavItems.map((item, idx) => {
                  const isAnchor = item.href.startsWith("#");
                  const active =
                    !isAnchor &&
                    (showAppShellNav || showPublicInteriorNav) &&
                    navLinkActive(canonicalPath, item.href);

                  if (isLanding && isAnchor) {
                    return (
                      <a
                        key={`${item.href}-${idx}`}
                        href={item.href}
                        className="text-[13px] font-medium px-3 py-1.5 transition-colors"
                        style={{ color: "rgba(10, 10, 11, 0.62)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#0A0A0B")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(10, 10, 11, 0.62)")}
                      >
                        {item.label}
                      </a>
                    );
                  }

                  return (
                    <Link
                      key={`${item.href}-${idx}`}
                      href={item.href}
                      className="rounded-xl px-3 py-1.5 text-[13px] font-medium transition-colors"
                      style={{
                        color: active ? "var(--color-vl-coral-deep)" : "rgba(10, 10, 11, 0.62)",
                        background: active ? "var(--color-vl-coral-tint)" : "transparent",
                      }}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>

              <div className="flex items-center gap-3">
                {!isLoading &&
                  (auth?.user ? (
                    <>
                      {!showAppShellNav && (
                        <Link
                          href="/assistants"
                          className="hidden rounded-xl px-4 py-1.5 text-[13px] font-medium sm:inline-flex vl-btn-outline"
                          style={{ padding: "0.5rem 1.1rem" }}
                        >
                          Open assistants
                        </Link>
                      )}
                      <button
                        onClick={() => logout.mutate()}
                        className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] font-medium transition-colors"
                        style={{ color: "rgba(10, 10, 11, 0.62)" }}
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Sign out</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <Link
                        href="/login"
                        className="text-[13px] font-medium"
                        style={{ color: "rgba(10, 10, 11, 0.62)" }}
                      >
                        Sign in
                      </Link>
                      <Link href="/book-demo" className="inline-block">
                        <button
                          className="vl-btn-primary text-[13px] inline-flex items-center gap-2"
                          style={{ padding: "0.5rem 1.1rem 0.5rem 1.2rem" }}
                        >
                          Book a demo
                          <span
                            className="flex h-4 w-4 items-center justify-center rounded-md bg-white/25"
                          >
                            <ArrowRight className="w-2.5 h-2.5 text-white" />
                          </span>
                        </button>
                      </Link>
                    </>
                  ))}

                <button
                  className="flex h-9 w-9 items-center justify-center rounded-xl lg:hidden"
                  onClick={() => setMobileOpen((s) => !s)}
                  aria-label="Toggle menu"
                  style={{
                    color: "var(--color-vl-ink)",
                    border: "1px solid rgba(10, 10, 11,0.10)",
                    background: "rgba(255,255,255,0.6)",
                  }}
                >
                  {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {mobileOpen && (
              <div
                className="lg:hidden px-4 sm:px-6 py-4 flex flex-col gap-2"
                style={{
                  borderTop: "1px solid rgba(10, 10, 11,0.08)",
                  background: "rgba(255, 255, 255,0.92)",
                }}
              >
                {headerNavItems.map((item, idx) => {
                  const isAnchor = item.href.startsWith("#");
                  if (isLanding && isAnchor) {
                    return (
                      <a
                        key={`${item.href}-${idx}`}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className="text-[14px] py-2"
                        style={{ color: "rgba(10, 10, 11, 0.75)" }}
                      >
                        {item.label}
                      </a>
                    );
                  }
                  return (
                    <Link
                      key={`${item.href}-${idx}`}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className="text-[14px] py-2"
                      style={{ color: "rgba(10, 10, 11, 0.75)" }}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </header>
      )}

      <main className={`flex-1 flex flex-col ${isAuthPage ? "" : "pt-16 sm:pt-18"}`}>{children}</main>

      {!isAuthPage && (
        <footer
          className={`mt-auto ${isLanding ? "vl-landing-footer" : ""}`}
          style={{ borderTop: "1px solid rgba(10, 10, 11,0.08)" }}
        >
          <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
            <div className="grid sm:grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr_1fr] gap-8 md:gap-10">
              <div>
                <Logo size="md" withTagline />
                <p
                  className="text-[13px] mt-5 max-w-85 leading-relaxed"
                  style={{ color: "var(--color-vl-ink-muted)" }}
                >
                  Hospitality, orchestrated by voice. VoyceLab connects to your POS,
                  inventory, events, and team — and turns conversation into action.
                </p>
              </div>
              <FooterCol
                title="Product"
                links={[
                  { href: "/assistants/new", label: "Create your assistant" },
                  { href: "/assistants", label: "Assistants" },
                  { href: "/services", label: "Integrations" },
                  { href: "/pricing", label: "Pricing" },
                ]}
              />
              <FooterCol
                title="Account"
                links={[
                  { href: "/settings", label: "Settings" },
                  { href: "/pricing", label: "Plans & billing" },
                ]}
              />
              <FooterCol
                title="Start"
                links={[
                  { href: "/login", label: "Sign in" },
                  { href: "/signup", label: "Create account" },
                ]}
              />
            </div>
            <div className="vl-line my-10" />
            <div
              className="flex flex-col sm:flex-row justify-between items-center gap-2 text-[11.5px]"
              style={{ color: "var(--color-vl-ink-faint)" }}
            >
              <p className="tracking-wider">&copy; {new Date().getFullYear()} VoyceLab</p>
              <p className="tracking-[0.22em] uppercase">Where voice runs hospitality</p>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div className="space-y-2.5">
      <p
        className="mb-3 text-[11px] font-semibold tracking-[0.22em] uppercase"
        style={{ color: "var(--color-vl-coral)" }}
      >
        {title}
      </p>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="block text-[13.5px] transition-colors hover:opacity-80"
          style={{ color: "var(--color-vl-ink-soft)" }}
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
