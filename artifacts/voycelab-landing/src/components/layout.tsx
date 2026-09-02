import { Link, useLocation } from "wouter";
import { useReducedMotion } from "framer-motion";
import { Logo } from "./logo";
import { useAuth, useLogout } from "@/hooks/use-auth";
import { LogOut, Menu, X, ArrowRight } from "lucide-react";
import { useState } from "react";

/** The ambient film that runs behind every screen of the product. */
export const AMBIENT_VIDEO_SRC = "https://cdn.midjourney.com/video/71048e88-d8e6-470e-88ef-555c01eacb12/0.mp4";

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

/**
 * Fixed ambient backdrop: aurora fallback -> looping film -> dimming veil.
 * Content pages get a deeper veil so long-form text stays readable; the
 * landing and auth screens keep the film bright.
 */
export function AmbientBackdrop({ deep = false }: { deep?: boolean }) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="vl-premium-backdrop" aria-hidden="true">
      <div className="vl-ambient-aurora" />
      <video
        className="vl-ambient-video"
        src={AMBIENT_VIDEO_SRC}
        autoPlay={!reduceMotion}
        muted
        loop
        playsInline
        preload="auto"
      />
      <div className="vl-ambient-veil" />
      {deep && <div className="vl-ambient-veil vl-ambient-veil-deep" />}
      <div className="vl-premium-grain" />
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: auth, isLoading } = useAuth();
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);

  const canonicalPath = normalizeAppPath(location);
  // Onboarding is a full-screen guided flow — it renders its own minimal
  // chrome, so it gets the same bare shell as the auth pages.
  const isAuthPage =
    canonicalPath === "/login" ||
    canonicalPath === "/signup" ||
    canonicalPath === "/onboarding";
  const isLanding = canonicalPath === "/";

  const showAppShellNav = Boolean(auth?.user) && !isLanding && !isAuthPage;
  const showPublicInteriorNav = !auth?.user && !isLanding && !isAuthPage;

  const headerNavItems = showAppShellNav ? APP_NAV : isLanding ? LANDING_NAV : PUBLIC_SITE_NAV;

  return (
    <div className="vl-app-shell min-h-screen flex flex-col relative">
      <AmbientBackdrop deep={!isLanding && !isAuthPage} />

      {!isAuthPage && (
        <header className={`fixed top-0 inset-x-0 z-50 ${isLanding ? "vl-landing-header" : ""}`}>
          <div className="vl-glass">
            <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 h-16 sm:h-18 flex items-center justify-between gap-2 sm:gap-4">
              <Link href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity min-w-0 shrink">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white shadow-[0_8px_24px_-10px_rgba(0,0,0,0.8)]">
                  <Logo size="sm" iconOnly />
                </span>
                <span className="hidden text-[14px] font-semibold tracking-tight text-white sm:inline">VoyceLab</span>
              </Link>

              <nav className="hidden lg:flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 backdrop-blur-md">
                {headerNavItems.map((item, idx) => {
                  const isAnchor = item.href.startsWith("#");
                  const active =
                    !isAnchor &&
                    (showAppShellNav || showPublicInteriorNav) &&
                    navLinkActive(canonicalPath, item.href);

                  const cls = `rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                    active ? "bg-white text-gray-900 shadow-sm" : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`;

                  if (isLanding && isAnchor) {
                    return (
                      <a key={`${item.href}-${idx}`} href={item.href} className={cls}>
                        {item.label}
                      </a>
                    );
                  }

                  return (
                    <Link key={`${item.href}-${idx}`} href={item.href} className={cls}>
                      {item.label}
                    </Link>
                  );
                })}
              </nav>

              <div className="flex items-center gap-2 sm:gap-3">
                {!isLoading &&
                  (auth?.user ? (
                    <>
                      {!showAppShellNav && (
                        <Link
                          href="/assistants"
                          className="vl-btn-outline hidden text-[13px] sm:inline-flex"
                          style={{ padding: "0.5rem 1.1rem" }}
                        >
                          Open assistants
                        </Link>
                      )}
                      <button
                        onClick={() => logout.mutate()}
                        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Sign out</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <Link
                        href="/login"
                        className="rounded-full px-3 py-1.5 text-[13px] font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        Sign in
                      </Link>
                      <Link
                        href="/book-demo"
                        className="vl-btn-primary text-[13px] gap-2"
                        style={{ padding: "0.5rem 0.6rem 0.5rem 1.1rem" }}
                      >
                        Book a demo
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15">
                          <ArrowRight className="w-3 h-3 text-white" />
                        </span>
                      </Link>
                    </>
                  ))}

                <button
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/8 text-white lg:hidden"
                  onClick={() => setMobileOpen((s) => !s)}
                  aria-label="Toggle menu"
                >
                  {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {mobileOpen && (
              <div className="lg:hidden px-4 sm:px-6 py-4 flex flex-col gap-1 border-t border-white/8 bg-[#050506]/90">
                {headerNavItems.map((item, idx) => {
                  const isAnchor = item.href.startsWith("#");
                  const cls = "rounded-2xl px-3 py-2.5 text-[14px] text-white/80 hover:bg-white/8 hover:text-white";
                  if (isLanding && isAnchor) {
                    return (
                      <a key={`${item.href}-${idx}`} href={item.href} onClick={() => setMobileOpen(false)} className={cls}>
                        {item.label}
                      </a>
                    );
                  }
                  return (
                    <Link key={`${item.href}-${idx}`} href={item.href} onClick={() => setMobileOpen(false)} className={cls}>
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
        <footer className="vl-footer mt-auto border-t">
          <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
            <div className="grid sm:grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr_1fr] gap-8 md:gap-10">
              <div>
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white">
                    <Logo size="sm" iconOnly />
                  </span>
                  <span className="text-[15px] font-semibold tracking-tight text-white">VoyceLab</span>
                </div>
                <p className="text-[13px] mt-5 max-w-85 leading-relaxed text-white/55">
                  VoyceLab synchronizes data and actions across your POS, inventory,
                  and team accounts.
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
            <div className="flex flex-col sm:flex-row justify-between items-center gap-2 text-[11.5px] text-white/40">
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
      <p className="vl-gradient-text mb-3 text-[11px] font-semibold tracking-[0.22em] uppercase">{title}</p>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="block text-[13.5px] text-white/70 transition-colors hover:text-white"
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
