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
        <header className="fixed top-0 w-full z-50 bg-background/90 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
            <Link href="/" className="hover:opacity-70 transition-opacity">
              <Logo />
            </Link>

            <div className="flex items-center gap-6">
              {!isLoading && (
                auth?.user ? (
                  <>
                    <Link href="/dashboard" className="text-[13px] font-medium text-foreground/60 hover:text-foreground transition-colors">
                      Dashboard
                    </Link>
                    <button className="text-[13px] text-foreground/40 hover:text-foreground transition-colors" onClick={() => logout.mutate()}>
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
        <footer className="py-10 mt-auto">
          <div className="max-w-6xl mx-auto px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <Logo iconOnly className="opacity-30" />
            <p className="text-[12px] text-foreground/30">
              &copy; {new Date().getFullYear()} Bevpro
            </p>
          </div>
        </footer>
      )}
    </div>
  );
}
