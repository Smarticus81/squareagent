import { Suspense, lazy, useLayoutEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, SignedIn, SignedOut, OrganizationProfile, OrganizationSwitcher } from "@clerk/clerk-react";
import { ThemeProvider } from "next-themes";
import { Layout } from "@/components/layout";
import { ClerkIdentityBridge } from "@/components/clerk-identity-bridge";
import { AutonomyTelemetry } from "@/components/autonomy-telemetry";

const Landing = lazy(() => import("@/pages/landing"));
const Login = lazy(() => import("@/pages/login"));
const Signup = lazy(() => import("@/pages/signup"));
const Assistants = lazy(() => import("@/pages/assistants"));
const CreateAssistant = lazy(() => import("@/pages/create-assistant"));
const ConnectedServices = lazy(() => import("@/pages/connected-services"));
const Settings = lazy(() => import("@/pages/settings"));
const DataSources = lazy(() => import("@/pages/data-sources"));
const Pricing = lazy(() => import("@/pages/pricing"));
const BookDemo = lazy(() => import("@/pages/book-demo"));
const Onboarding = lazy(() => import("@/pages/onboarding"));
const Autonomy = lazy(() => import("@/pages/autonomy"));
const NotFound = lazy(() => import("@/pages/not-found"));

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

function NavigateReplace({ to, preserveLocationExtras = true }: { to: string; preserveLocationExtras?: boolean }) {
  const [, setLocation] = useLocation();
  useLayoutEffect(() => {
    const search = preserveLocationExtras && typeof window !== "undefined" ? window.location.search : "";
    const hash = preserveLocationExtras && typeof window !== "undefined" ? window.location.hash : "";
    setLocation(`${to}${search}${hash}`, { replace: true });
  }, [preserveLocationExtras, setLocation, to]);
  return null;
}

/**
 * Railway/custom-domain deep links may arrive through the root fallback as
 * /?view=autonomy. Promote that transport-safe URL back to the canonical
 * client-side /autonomy route without another network request.
 */
function RootRoute() {
  const missionControl =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("view") === "autonomy";

  if (missionControl) {
    return <NavigateReplace to="/autonomy" preserveLocationExtras={false} />;
  }
  return <Landing />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Suspense fallback={<RouteFallback />}>
        <Switch>
          <Route path="/" component={RootRoute} />
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
          <Route path="/command">
            <NavigateReplace to="/assistants" />
          </Route>
          <Route path="/console">
            <NavigateReplace to="/assistants" />
          </Route>
          <Route path="/mission-control">
            <NavigateReplace to="/autonomy" preserveLocationExtras={false} />
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
          <Route path="/book-demo" component={BookDemo} />
          <Route path="/autonomy" component={Autonomy} />
          {/* Legacy redirects so existing links still resolve */}
          <Route path="/agents" component={Assistants} />
          <Route path="/agents/new" component={CreateAssistant} />
          <Route path="/agent-setup" component={CreateAssistant} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Layout>
  );
}

function RouteFallback() {
  return (
    <div className="vl-page-shell flex-1 px-4 pb-24 pt-24 sm:px-6 lg:px-10">
      <div className="mx-auto h-1.5 max-w-28 overflow-hidden rounded-lg bg-black/10">
        <div className="h-full w-1/2 animate-pulse rounded-lg bg-black" />
      </div>
    </div>
  );
}

function Billing() {
  if (!clerkPublishableKey) {
    return (
      <div className="vl-page-shell flex-1 px-4 pb-24 pt-24 sm:px-6 lg:px-10">
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
    <div className="vl-page-shell flex-1 px-4 pb-24 pt-24 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <SignedIn>
          <div className="mb-6 flex items-center gap-4">
            <OrganizationSwitcher hidePersonal />
          </div>
          <OrganizationProfile routing="path" path="/billing" />
        </SignedIn>
        <SignedOut>
          <BillingSignedOut />
        </SignedOut>
      </div>
    </div>
  );
}

function BillingSignedOut() {
  const hasToken = typeof window !== "undefined" && Boolean(localStorage.getItem("voycelab_token"));
  if (hasToken) {
    return (
      <div className="vl-panel flex items-center gap-3 p-8">
        <span className="h-4 w-4 animate-spin rounded-lg border-2 border-black/15 border-t-black/60" />
        <p className="text-[14px]" style={{ color: "var(--color-vl-ink-muted)" }}>
          Preparing your organization's billing…
        </p>
      </div>
    );
  }
  return (
    <div className="vl-panel p-8">
      <p className="vl-eyebrow">Billing</p>
      <h1 className="vl-display mt-3 text-[36px]" style={{ color: "var(--color-vl-ink)" }}>
        Log in to manage billing.
      </h1>
      <p className="mt-2 text-[14px]" style={{ color: "var(--color-vl-ink-muted)" }}>
        Billing lives at the organization level. Log in to your VoyceLab account to view and manage your subscription.
      </p>
      <a href="/login" className="vl-btn-primary mt-6 inline-flex text-[14px]">Log in</a>
    </div>
  );
}

function AppContent() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        {clerkPublishableKey && <ClerkIdentityBridge />}
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
          <AutonomyTelemetry />
          <Router />
        </WouterRouter>
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
