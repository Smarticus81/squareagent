import { useLayoutEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, SignInButton, SignedIn, SignedOut, OrganizationProfile, OrganizationSwitcher } from "@clerk/clerk-react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";

import Landing from "@/pages/landing";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import Assistants from "@/pages/assistants";
import CreateAssistant from "@/pages/create-assistant";
import ConnectedServices from "@/pages/connected-services";
import Settings from "@/pages/settings";
import DataSources from "@/pages/data-sources";
import Pricing from "@/pages/pricing";
import Onboarding from "@/pages/onboarding";
import NotFound from "@/pages/not-found";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

function NavigateReplace({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useLayoutEffect(() => {
    const search = typeof window !== "undefined" ? window.location.search : "";
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    setLocation(`${to}${search}${hash}`, { replace: true });
  }, [setLocation, to]);
  return null;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't hammer the API on 4xx/5xx — a server error won't self-heal
      // before the user can act, and a single failure should not cascade
      // into 8–10 retries across page navigations.
      retry: false,
      refetchOnWindowFocus: false,
      // Keep cache fresh across page navigations so visiting Assistants,
      // Services, and assistant setup in sequence does not re-fetch
      // /api/venues four times.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/login" component={Login} />
        <Route path="/signup" component={Signup} />
        <Route path="/dashboard">
          <NavigateReplace to="/assistants" />
        </Route>
        <Route path="/account">
          <NavigateReplace to="/settings" />
        </Route>
        <Route path="/plans">
          <NavigateReplace to="/pricing" />
        </Route>
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/assistants" component={Assistants} />
        <Route path="/assistants/new" component={CreateAssistant} />
        <Route path="/assistants/edit/:id" component={CreateAssistant} />
        <Route path="/services" component={ConnectedServices} />
        <Route path="/data-sources" component={DataSources} />
        <Route path="/settings" component={Settings} />
        <Route path="/billing" component={Billing} />
        <Route path="/pricing" component={Pricing} />
        {/* Legacy redirects so existing links still resolve */}
        <Route path="/agents" component={Assistants} />
        <Route path="/agents/new" component={CreateAssistant} />
        <Route path="/agent-setup" component={CreateAssistant} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function Billing() {
  if (!clerkPublishableKey) {
    return (
      <div className="flex-1 px-4 pb-24 pt-24 sm:px-6 lg:px-10">
        <div className="vl-panel mx-auto max-w-2xl p-8">
          <p className="vl-eyebrow">Billing</p>
          <h1 className="vl-display mt-3 text-[36px]" style={{ color: "var(--color-vl-ink)" }}>
            Clerk billing is not configured.
          </h1>
          <p className="mt-3 text-[14px]" style={{ color: "var(--color-vl-ink-muted)" }}>
            Add VITE_CLERK_PUBLISHABLE_KEY to enable Clerk subscription management.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 px-4 pb-24 pt-24 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <SignedIn>
          <div className="mb-6 flex items-center gap-4">
            <OrganizationSwitcher hidePersonal />
          </div>
          <OrganizationProfile routing="path" path="/billing" />
        </SignedIn>
        <SignedOut>
          <div className="vl-panel p-8">
            <p className="vl-eyebrow">Billing</p>
            <h1 className="vl-display mt-3 text-[36px]" style={{ color: "var(--color-vl-ink)" }}>
              Sign in to manage billing.
            </h1>
            <p className="mt-2 text-[14px]" style={{ color: "var(--color-vl-ink-muted)" }}>
              Billing is managed at the organization level. Sign in to view and manage your organization's subscription.
            </p>
            <SignInButton mode="modal">
              <button className="vl-btn-primary mt-6 text-[14px]">Sign in with Clerk</button>
            </SignInButton>
          </div>
        </SignedOut>
      </div>
    </div>
  );
}

function AppContent() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

function App() {
  if (!clerkPublishableKey) return <AppContent />;
  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <AppContent />
    </ClerkProvider>
  );
}

export default App;
