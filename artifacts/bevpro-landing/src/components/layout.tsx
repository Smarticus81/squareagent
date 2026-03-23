import { Link, useLocation } from "wouter";
import { Logo } from "./logo";
import { Button } from "./ui/button";
import { useAuth, useLogout } from "@/hooks/use-auth";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: auth, isLoading } = useAuth();
  const logout = useLogout();

  const isAuthPage = location === "/login" || location === "/signup";

  return (
    <div className="min-h-screen flex flex-col relative selection:bg-foreground/10 selection:text-foreground">
      {!isAuthPage && (
        <header className="fixed top-0 w-full z-50 bg-background/90 backdrop-blur-md border-b border-foreground/[0.04]">
          <div className="max-w-5xl mx-auto px-6 lg:px-8 h-14 flex items-center justify-between">
            <Link href="/" className="hover:opacity-70 transition-opacity">
              <Logo />
            </Link>

            <div className="flex items-center gap-5">
              {!isLoading && (
                auth?.user ? (
                  <>
                    <Link href="/dashboard" className="text-[13px] font-medium text-foreground/50 hover:text-foreground transition-colors">
                      Dashboard
                    </Link>
                    <button className="text-[13px] text-foreground/35 hover:text-foreground transition-colors" onClick={() => logout.mutate()}>
                      Sign Out
                    </button>
                  </>
                ) : (
                  <>
                    <Link href="/login" className="text-[13px] font-medium text-foreground/50 hover:text-foreground transition-colors hidden sm:block">
                      Sign In
                    </Link>
                    <Link href="/signup" className="inline-block">
                      <Button variant="default" size="sm" className="text-[13px] h-8 px-5">Get Started</Button>
                    </Link>
                  </>
                )
              )}
            </div>
          </div>
        </header>
      )}

      <main className="flex-1 flex flex-col">
        {children}
      </main>

      {!isAuthPage && (
        <footer className="border-t border-foreground/[0.06] py-12 mt-auto">
          <div className="max-w-5xl mx-auto px-6 lg:px-8">
            <div className="flex flex-col md:flex-row justify-between items-start gap-8">
              <div>
                <Logo />
                <p className="text-[13px] text-foreground/30 font-light mt-2 max-w-[260px]">
                  Voice-powered ordering for bars and venues, built on Square.
                </p>
              </div>
              <div className="flex gap-12 text-[13px]">
                <div className="space-y-2">
                  <p className="text-foreground/20 font-medium text-[11px] tracking-[0.15em] uppercase">Product</p>
                  <Link href="/signup" className="block text-foreground/40 hover:text-foreground transition-colors">Get Started</Link>
                  <Link href="/login" className="block text-foreground/40 hover:text-foreground transition-colors">Sign In</Link>
                </div>
              </div>
            </div>
            <div className="mt-10 pt-6 border-t border-foreground/[0.04] flex flex-col sm:flex-row justify-between items-center gap-2">
              <p className="text-[12px] text-foreground/25 font-light">
                &copy; {new Date().getFullYear()} Bevpro. All rights reserved.
              </p>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
