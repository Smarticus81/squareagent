import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ExternalLink, CheckCircle2, AlertCircle, LayoutDashboard, Settings } from "lucide-react";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: auth, isLoading, error } = useAuth();

  useEffect(() => {
    if (!isLoading && !auth?.user) {
      setLocation("/login");
    }
  }, [isLoading, auth, setLocation]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-border border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!auth?.user) return null;

  // Mocking Square connection state since we don't have a full /api/venues yet
  const isSquareConnected = false; 

  const getTrialDaysLeft = () => {
    if (!auth.subscription?.trialEndsAt) return 0;
    const end = new Date(auth.subscription.trialEndsAt);
    const now = new Date();
    const diffTime = Math.abs(end.getTime() - now.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="flex-1 bg-background text-foreground">
      <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-12 pt-32">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-16 gap-6">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-foreground mb-2">Welcome, {auth.user.name.split(' ')[0]}</h1>
            <p className="text-muted-foreground font-light text-lg">Manage your venue and voice agent.</p>
          </div>
          
          {auth.subscription?.status === "trialing" && (
            <div className="border border-border bg-card px-4 py-2 flex items-center gap-3">
              <div className="w-2 h-2 bg-primary"></div>
              <span className="text-sm font-medium text-foreground">Trial active • {getTrialDaysLeft()} days left</span>
              <Button variant="outline" size="sm" className="ml-2 h-8 rounded-none border-border">Upgrade</Button>
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Square Integration Card */}
          <div className="bg-card border border-border p-10 flex flex-col">
            <div className="flex items-center gap-5 mb-8">
              <div className="w-12 h-12 bg-foreground flex items-center justify-center">
                <div className="w-5 h-5 bg-foreground relative border-2 border-background">
                  <div className="absolute inset-1 bg-background"></div>
                </div>
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground tracking-tight">Square POS</h2>
                <p className="text-sm text-muted-foreground font-light mt-1">
                  {isSquareConnected ? "Connected & Syncing" : "Not connected"}
                </p>
              </div>
            </div>

            <div className="space-y-4 mb-10 flex-1">
              <div className="flex items-center gap-3 text-sm text-foreground font-light">
                {isSquareConnected ? (
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-muted-foreground" />
                )}
                Menu catalog sync
              </div>
              <div className="flex items-center gap-3 text-sm text-foreground font-light">
                {isSquareConnected ? (
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-muted-foreground" />
                )}
                Order creation & payments
              </div>
            </div>

            {isSquareConnected ? (
              <Button variant="outline" className="w-full rounded-none">Manage Connection</Button>
            ) : (
              <a href="/bevpro-app/setup" className="block">
                <Button className="w-full h-12 rounded-none">Connect Square Account</Button>
              </a>
            )}
          </div>

          {/* Voice Agent App Card */}
          <div className="bg-card border border-border p-10 flex flex-col">
            <div className="flex items-center gap-5 mb-8">
              <div className="w-12 h-12 bg-primary flex items-center justify-center">
                <LayoutDashboard className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground tracking-tight">Voice Agent</h2>
                <p className="text-sm text-primary font-medium mt-1">Ready to take orders</p>
              </div>
            </div>

            <p className="text-muted-foreground font-light mb-10 flex-1 leading-relaxed">
              Launch the Voice POS interface. This is what your bartenders will use on their iPads during service.
            </p>

            <a href="/bevpro-app/" className="block">
              <Button variant="default" className="w-full h-12 text-base group rounded-none">
                Launch Voice Agent
                <ExternalLink className="ml-2 w-4 h-4 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-transform" />
              </Button>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}