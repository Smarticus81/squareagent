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
import Assistants from "@/pages/assistants";
import CreateAssistant from "@/pages/create-assistant";
import ConnectedServices from "@/pages/connected-services";
import Conversations from "@/pages/conversations";
import Routines from "@/pages/routines";
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
        <Route path="/assistants" component={Assistants} />
        <Route path="/assistants/new" component={CreateAssistant} />
        <Route path="/services" component={ConnectedServices} />
        <Route path="/conversations" component={Conversations} />
        <Route path="/routines" component={Routines} />
        <Route path="/settings" component={Settings} />
        {/* Legacy redirects so existing links still resolve */}
        <Route path="/dashboard" component={Command} />
        <Route path="/agents" component={Assistants} />
        <Route path="/agents/new" component={CreateAssistant} />
        <Route path="/agent-setup" component={CreateAssistant} />
        <Route path="/sessions" component={Conversations} />
        <Route path="/workflows" component={Routines} />
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
