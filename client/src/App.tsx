import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Loader2, ShieldOff } from "lucide-react";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Accommodation from "@/pages/accommodation";
import Facilities from "@/pages/facilities";
import MovieRoom from "@/pages/movie-room";
import BarRestaurant from "@/pages/bar-restaurant";
import Staff from "@/pages/staff";
import Expenses from "@/pages/expenses";
import Maintenance from "@/pages/maintenance";
import ListsPage from "@/pages/lists";
import Reports from "@/pages/reports";
import Documents from "@/pages/documents";
import SettingsPage from "@/pages/settings";
import LoginPage from "@/pages/login";
import SetupPage from "@/pages/setup";
import { useCurrentUser, useSetupStatus, canAccess } from "@/hooks/use-auth";
import type { ModuleKey } from "@shared/schema";

function Guarded({ moduleKey, component: Component }: { moduleKey: ModuleKey; component: React.ComponentType }) {
  const { data: user } = useCurrentUser();
  if (!canAccess(user, moduleKey)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
        <ShieldOff className="h-8 w-8" />
        <p>You don't have access to this section. Ask your administrator to grant access.</p>
      </div>
    );
  }
  return <Component />;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={() => <Guarded moduleKey="dashboard" component={Dashboard} />} />
      <Route path="/accommodation" component={() => <Guarded moduleKey="accommodation" component={Accommodation} />} />
      <Route path="/facilities" component={() => <Guarded moduleKey="facilities" component={Facilities} />} />
      <Route path="/movie-room" component={() => <Guarded moduleKey="movie-room" component={MovieRoom} />} />
      <Route path="/bar-restaurant" component={() => <Guarded moduleKey="bar-restaurant" component={BarRestaurant} />} />
      <Route path="/staff" component={() => <Guarded moduleKey="staff" component={Staff} />} />
      <Route path="/expenses" component={() => <Guarded moduleKey="expenses" component={Expenses} />} />
      <Route path="/maintenance" component={() => <Guarded moduleKey="maintenance" component={Maintenance} />} />
      <Route path="/lists" component={() => <Guarded moduleKey="lists" component={ListsPage} />} />
      <Route path="/reports" component={() => <Guarded moduleKey="reports" component={Reports} />} />
      <Route path="/documents" component={() => <Guarded moduleKey="documents" component={Documents} />} />
      <Route path="/settings" component={() => <Guarded moduleKey="settings" component={SettingsPage} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { data: setupStatus, isLoading: setupLoading } = useSetupStatus();
  const { data: user, isLoading: userLoading } = useCurrentUser();

  if (setupLoading || userLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (setupStatus?.needsSetup) {
    return <SetupPage />;
  }

  if (!user) {
    return <LoginPage />;
  }

  return <>{children}</>;
}

function App() {
  const style = {
    "--sidebar-width": "16.5rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Router hook={useHashLocation}>
            <AuthGate>
              <SidebarProvider style={style as React.CSSProperties}>
                <div className="flex h-screen w-full overflow-hidden">
                  <AppSidebar />
                  <div className="flex flex-col flex-1 overflow-hidden">
                    <header className="flex items-center justify-between gap-2 border-b border-border bg-background px-3 py-2 shrink-0">
                      <SidebarTrigger data-testid="button-sidebar-toggle" />
                      <ThemeToggle />
                    </header>
                    <main className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
                      <AppRouter />
                    </main>
                  </div>
                </div>
              </SidebarProvider>
            </AuthGate>
          </Router>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
