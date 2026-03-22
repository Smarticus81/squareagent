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
    <div className="min-h-screen flex flex-col relative selection:bg-primary/20 selection:text-primary">
      {!isAuthPage && (
        <header className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
            <Link href="/" className="hover:opacity-80 transition-opacity">
              <Logo />
            </Link>

            <nav className="hidden md:flex items-center gap-8">
              <Link href="/#how-it-works" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">How it works</Link>
              <Link href="/#pricing" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
            </nav>

            <div className="flex items-center gap-4">
              {!isLoading && (
                auth?.user ? (
                  <>
                    <Link href="/dashboard" className="text-sm font-medium text-foreground hover:text-primary transition-colors">
                      Dashboard
                    </Link>
                    <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground rounded-xl" onClick={() => logout.mutate()}>
                      Sign Out
                    </Button>
                  </>
                ) : (
                  <>
                    <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden sm:block">
                      Sign In
                    </Link>
                    <Link href="/signup" className="inline-block">
                      <Button variant="default" size="sm" className="rounded-xl">Start Free Trial</Button>
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
        <footer className="border-t border-border/50 bg-background py-12 mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-6">
            <Logo iconOnly className="opacity-50 grayscale hover:grayscale-0 hover:opacity-100 transition-all duration-500" />
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} Bevpro Inc. All rights reserved.
            </p>
            <div className="flex gap-6">
              <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Terms</a>
              <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Privacy</a>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
