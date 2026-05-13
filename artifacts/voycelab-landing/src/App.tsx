import { useLayoutEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";

import Landing from "@/pages/landing";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import Command from "@/pages/command";
import Assistants from "@/pages/assistants";
import CreateAssistant from "@/pages/create-assistant";
import ConnectedServices from "@/pages/connected-services";
import Settings from "@/pages/settings";
import DataSources from "@/pages/data-sources";
import Pricing from "@/pages/pricing";
import NotFound from "@/pages/not-found";

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
      // Keep cache fresh across page navigations so visiting Command,
      // Agents, Services, and AgentSetup in sequence does not re-fetch
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
          <NavigateReplace to="/command" />
        </Route>
        <Route path="/account">
          <NavigateReplace to="/settings" />
        </Route>
        <Route path="/plans">
          <NavigateReplace to="/pricing" />
        </Route>
        <Route path="/command" component={Command} />
        <Route path="/assistants" component={Assistants} />
        <Route path="/assistants/new" component={CreateAssistant} />
        <Route path="/assistants/edit/:id" component={CreateAssistant} />
        <Route path="/services" component={ConnectedServices} />
        <Route path="/data-sources" component={DataSources} />
        <Route path="/settings" component={Settings} />
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

function App() {
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

export default App;
