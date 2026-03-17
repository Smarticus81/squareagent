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
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!auth?.user) return null;

  // Mocking Square connection state since we don't have a full /api/venues yet
  // In a real app, this would come from a useVenues() hook.
  const isSquareConnected = false; 

  const getTrialDaysLeft = () => {
    if (!auth.subscription?.trialEndsAt) return 0;
    const end = new Date(auth.subscription.trialEndsAt);
    const now = new Date();
    const diffTime = Math.abs(end.getTime() - now.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-12 pt-32">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-12 gap-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Welcome, {auth.user.name.split(' ')[0]}</h1>
          <p className="text-muted-foreground">Manage your venue and voice agent.</p>
        </div>
        
        {auth.subscription?.status === "trialing" && (
          <div className="glass-panel px-4 py-2 rounded-xl flex items-center gap-3 border-primary/20">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
            <span className="text-sm font-medium text-white">Trial active • {getTrialDaysLeft()} days left</span>
            <Button variant="outline" size="sm" className="ml-2 h-8">Upgrade</Button>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Square Integration Card */}
        <div className="glass-panel rounded-3xl p-8 relative overflow-hidden">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-lg">
              <div className="w-5 h-5 bg-black rounded-sm relative">
                <div className="absolute inset-1 bg-white rounded-sm"></div>
              </div>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Square POS</h2>
              <p className="text-sm text-muted-foreground">
                {isSquareConnected ? "Connected & Syncing" : "Not connected"}
              </p>
            </div>
          </div>

          <div className="space-y-4 mb-8">
            <div className="flex items-center gap-3 text-sm text-white/80">
              {isSquareConnected ? (
                <CheckCircle2 className="w-5 h-5 text-primary" />
              ) : (
                <AlertCircle className="w-5 h-5 text-muted-foreground" />
              )}
              Menu catalog sync
            </div>
            <div className="flex items-center gap-3 text-sm text-white/80">
              {isSquareConnected ? (
                <CheckCircle2 className="w-5 h-5 text-primary" />
              ) : (
                <AlertCircle className="w-5 h-5 text-muted-foreground" />
              )}
              Order creation & payments
            </div>
          </div>

          {isSquareConnected ? (
            <Button variant="secondary" className="w-full">Manage Connection</Button>
          ) : (
            <a href="/bevpro-app/setup" className="block">
              <Button className="w-full h-12">Connect Square Account</Button>
            </a>
          )}
        </div>

        {/* Voice Agent App Card */}
        <div className="glass-panel rounded-3xl p-8 relative overflow-hidden flex flex-col">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none"></div>
          
          <div className="flex items-center gap-4 mb-6 relative z-10">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-[#A855F7] flex items-center justify-center shadow-[0_0_20px_rgba(124,110,245,0.4)]">
              <LayoutDashboard className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Voice Agent</h2>
              <p className="text-sm text-primary font-medium">Ready to take orders</p>
            </div>
          </div>

          <p className="text-muted-foreground mb-8 relative z-10 flex-1">
            Launch the Voice POS interface. This is what your bartenders will use on their iPads during service.
          </p>

          <a href="/bevpro-app/" className="block relative z-10">
            <Button variant="default" className="w-full h-14 text-base group">
              Launch Voice Agent
              <ExternalLink className="ml-2 w-5 h-5 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-transform" />
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}
