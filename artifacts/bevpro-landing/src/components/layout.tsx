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
        <header className="fixed top-0 w-full z-50 bg-background/90 backdrop-blur-md border-b border-border">
          <div className="max-w-5xl mx-auto px-6 lg:px-8 h-14 flex items-center justify-between">
            <Link href="/" className="hover:opacity-70 transition-opacity">
              <Logo />
            </Link>

            <div className="flex items-center gap-5">
              {!isLoading && (
                auth?.user ? (
                  <>
                    <Link href="/dashboard" className="text-[13px] font-medium text-foreground/60 hover:text-foreground transition-colors">
                      Dashboard
                    </Link>
                    <button className="text-[13px] text-foreground/50 hover:text-foreground transition-colors" onClick={() => logout.mutate()}>
                      Sign Out
                    </button>
                  </>
                ) : (
                  <>
                    <Link href="/login" className="text-[13px] font-medium text-foreground/60 hover:text-foreground transition-colors hidden sm:block">
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
        <footer className="border-t border-border py-16 mt-auto">
          <div className="max-w-5xl mx-auto px-6 lg:px-8">
            <div className="flex flex-col md:flex-row justify-between items-start gap-10">
              <div>
                <Logo />
                <p className="text-[13px] text-foreground/40 font-light mt-3 max-w-[280px] leading-relaxed">
                  Voice-powered ordering for bars, venues, and events. Say the order — it's done.
                </p>
                <div className="flex items-center gap-2 mt-4 text-foreground/40">
                  <span className="text-[11px] font-light tracking-wider">Built on</span>
                  <svg className="h-4 w-4" viewBox="0 0 64 64" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10 0C4.477 0 0 4.477 0 10v44c0 5.523 4.477 10 10 10h44c5.523 0 10-4.477 10-10V10c0-5.523-4.477-10-10-10H10zm30.5 16h-17C20.462 16 18 18.462 18 21.5v17c0 3.038 2.462 5.5 5.5 5.5h17c3.038 0 5.5-2.462 5.5-5.5v-17c0-3.038-2.462-5.5-5.5-5.5zM38 34a4 4 0 01-4 4H30a4 4 0 01-4-4v-4a4 4 0 014-4h4a4 4 0 014 4v4z" />
                  </svg>
                  <span className="text-[11px] font-light tracking-wider">Square</span>
                </div>
              </div>
              <div className="flex gap-16 text-[13px]">
                <div className="space-y-2.5">
                  <p className="text-foreground/30 font-medium text-[10px] tracking-[0.2em] uppercase mb-3">Product</p>
                  <Link href="/signup" className="block text-foreground/50 hover:text-foreground transition-colors font-light">Get Started</Link>
                  <Link href="/login" className="block text-foreground/50 hover:text-foreground transition-colors font-light">Sign In</Link>
                </div>
                <div className="space-y-2.5">
                  <p className="text-foreground/30 font-medium text-[10px] tracking-[0.2em] uppercase mb-3">Company</p>
                  <span className="block text-foreground/50 font-light cursor-default">About</span>
                  <span className="block text-foreground/50 font-light cursor-default">Contact</span>
                </div>
              </div>
            </div>
            <div className="mt-12 pt-6 border-t border-border flex flex-col sm:flex-row justify-between items-center gap-2">
              <p className="text-[11px] text-foreground/40 font-light tracking-wider">
                &copy; {new Date().getFullYear()} Bevpro. All rights reserved.
              </p>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
