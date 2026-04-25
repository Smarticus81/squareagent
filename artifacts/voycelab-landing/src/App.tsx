import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";

import Landing from "@/pages/landing";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import Command from "@/pages/command";
import Agents from "@/pages/agents";
import AgentSetup from "@/pages/agent-setup";
import ConnectedServices from "@/pages/connected-services";
import Sessions from "@/pages/sessions";
import Workflows from "@/pages/workflows";
import Settings from "@/pages/settings";
import NotFound from "@/pages/not-found";

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
        <Route path="/command" component={Command} />
        <Route path="/agents" component={Agents} />
        <Route path="/agents/new" component={AgentSetup} />
        <Route path="/services" component={ConnectedServices} />
        <Route path="/sessions" component={Sessions} />
        <Route path="/workflows" component={Workflows} />
        <Route path="/settings" component={Settings} />
        {/* Legacy redirects so existing links still resolve */}
        <Route path="/dashboard" component={Command} />
        <Route path="/agent-setup" component={AgentSetup} />
        <Route path="/account" component={Settings} />
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
