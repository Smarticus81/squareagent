import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X } from "lucide-react";
import { useAuth, useLogout } from "@/hooks/use-auth";
import { Wordmark } from "./logo";

const APP_NAV = [
  { href: "/assistants", label: "Assistant" },
  { href: "/services", label: "Connections" },
  { href: "/settings", label: "Account" },
];

const PUBLIC_NAV = [
  { href: "/pricing", label: "Pricing" },
];

function normalizeAppPath(loc: string): string {
  if (loc === "/dashboard") return "/assistants";
  if (loc === "/account") return "/settings";
  if (loc === "/plans") return "/pricing";
  if (loc.startsWith("/agents")) return `/assistants${loc.slice("/agents".length)}`;
  return loc;
}

function navLinkActive(canonicalPath: string, href: string): boolean {
  return canonicalPath === href || canonicalPath.startsWith(`${href}/`);
}

/** The quiet backdrop behind every screen. */
export function AmbientBackdrop() {
  return <div className="vl-premium-backdrop" aria-hidden="true" />;
}

/**
 * The shell is a single hairline of navigation. Nothing floats, nothing
 * glows; the assistant is the only thing on any screen that is allowed to.
 */
export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: auth, isLoading } = useAuth();
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);

  const canonicalPath = normalizeAppPath(location);
  const missionControlQuery =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "autonomy";
  const effectivePath = missionControlQuery ? "/autonomy" : canonicalPath;
  const isPlatformAdmin = Boolean(auth?.isAdmin ?? auth?.user?.isAdmin);

  const isAuthPage = effectivePath === "/login" || effectivePath === "/signup" || effectivePath === "/onboarding";
  const isLanding = effectivePath === "/";
  const signedIn = Boolean(auth?.user);

  const nav = signedIn
    ? (isPlatformAdmin ? [...APP_NAV, { href: "/autonomy", label: "Mission Control" }] : APP_NAV)
    : PUBLIC_NAV;

  return (
    <div className="vl-app-shell relative flex min-h-screen flex-col">
      <AmbientBackdrop />

      {!isAuthPage && (
        <header className="fixed inset-x-0 top-0 z-50">
          <div className={isLanding ? "" : "vl-glass"}>
            <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
              <Link href={signedIn ? "/assistants" : "/"} className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
                <Wordmark />
              </Link>

              <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
                {nav.map((item) => {
                  const active = !isLanding && navLinkActive(effectivePath, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="text-[13.5px] font-medium transition-colors"
                      style={{ color: active ? "var(--color-vl-ink)" : "var(--color-vl-ink-muted)" }}
                    >
                      {item.label}
                    </Link>
                  );
                })}
                {!isLoading && (signedIn ? (
                  <button
                    type="button"
                    onClick={() => logout.mutate()}
                    className="text-[13.5px] font-medium transition-colors hover:text-white"
                    style={{ color: "var(--color-vl-ink-faint)" }}
                  >
                    Sign out
                  </button>
                ) : (
                  <>
                    <Link href="/login" className="text-[13.5px] font-medium transition-colors" style={{ color: "var(--color-vl-ink-muted)" }}>
                      Sign in
                    </Link>
                    <Link href="/signup" className="vl-btn-primary text-[13px]" style={{ padding: "0.5rem 1rem" }}>
                      Start free
                    </Link>
                  </>
                ))}
              </nav>

              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full md:hidden"
                style={{ color: "var(--color-vl-ink)", background: "var(--vl-surface)" }}
                onClick={() => setMobileOpen((s) => !s)}
                aria-label="Toggle menu"
                aria-expanded={mobileOpen}
              >
                {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
            </div>

            {mobileOpen && (
              <div className="vl-glass flex flex-col gap-1 border-t px-5 py-4 md:hidden" style={{ borderColor: "var(--vl-line)" }}>
                {nav.map((item) => (
                  <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className="rounded-xl px-3 py-2.5 text-[15px]" style={{ color: "var(--color-vl-ink-soft)" }}>
                    {item.label}
                  </Link>
                ))}
                {signedIn ? (
                  <button type="button" onClick={() => logout.mutate()} className="rounded-xl px-3 py-2.5 text-left text-[15px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                    Sign out
                  </button>
                ) : (
                  <>
                    <Link href="/login" onClick={() => setMobileOpen(false)} className="rounded-xl px-3 py-2.5 text-[15px]" style={{ color: "var(--color-vl-ink-soft)" }}>Sign in</Link>
                    <Link href="/signup" onClick={() => setMobileOpen(false)} className="vl-btn-primary mt-2 justify-center text-[14px]">Start free</Link>
                  </>
                )}
              </div>
            )}
          </div>
        </header>
      )}

      <main className={`flex flex-1 flex-col ${isAuthPage ? "" : "pt-16"}`}>{children}</main>

      {!isAuthPage && (
        <footer className="vl-footer mt-auto border-t">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-3 px-5 py-8 text-[12.5px] sm:flex-row sm:items-center sm:px-8" style={{ color: "var(--color-vl-ink-faint)" }}>
            <p>&copy; {new Date().getFullYear()} VoyceLab · An always-on assistant for venues</p>
            <div className="flex gap-5">
              <Link href="/pricing" className="transition-colors hover:text-white">Pricing</Link>
              <Link href={signedIn ? "/settings" : "/login"} className="transition-colors hover:text-white">{signedIn ? "Account" : "Sign in"}</Link>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
