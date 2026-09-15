import { useState, useEffect } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { Button } from "@/components/ui/button";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Loader2, ShieldOff, Home } from "lucide-react";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Accommodation from "@/pages/accommodation";
import Facilities from "@/pages/facilities";
import MovieRoom from "@/pages/movie-room";
import BarRestaurant from "@/pages/bar-restaurant";
import FnbCosting from "@/pages/fnb-costing";
import Tenants from "@/pages/tenants";
import Staff from "@/pages/staff";
import AttendancePage from "@/pages/attendance";
import LeavePage from "@/pages/leave";
import PayrollPage from "@/pages/payroll";
import Expenses from "@/pages/expenses";
import Maintenance from "@/pages/maintenance";
import ListsPage from "@/pages/lists";
import Reports from "@/pages/reports";
import Documents from "@/pages/documents";
import SettingsPage from "@/pages/settings";
import Finance from "@/pages/finance";
import SystemAdmin from "@/pages/system-admin";
import Budgeting from "@/pages/budgeting";
import AssetsPage from "@/pages/assets";
import Inventory from "@/pages/inventory";
import Purchasing from "@/pages/purchasing";
import InternalRequisitions from "@/pages/internal-requisitions";
import LoginPage from "@/pages/login";
import SetupPage from "@/pages/setup";
import ResetPasswordPage from "@/pages/reset-password";
import { useCurrentUser, useSetupStatus, canAccess } from "@/hooks/use-auth";
import { TestDatabaseBanner } from "@/components/test-database-banner";
import type { ModuleKey } from "@shared/schema";

function Guarded({ moduleKey, component: Component, requireAdminUsername }: { moduleKey: ModuleKey; component: React.ComponentType; requireAdminUsername?: boolean }) {
  const { data: user } = useCurrentUser();
  if (!canAccess(user, moduleKey)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
        <ShieldOff className="h-8 w-8" />
        <p>You don't have access to this section. Ask your administrator to grant access.</p>
      </div>
    );
  }
  if (requireAdminUsername && user?.username !== "admin") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
        <ShieldOff className="h-8 w-8" />
        <p>This section is restricted to the primary administrator account.</p>
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
      <Route path="/fnb-costing" component={() => <Guarded moduleKey="fnb-costing" component={FnbCosting} />} />
      <Route path="/tenants" component={() => <Guarded moduleKey="tenants" component={Tenants} />} />
      <Route path="/staff" component={() => <Guarded moduleKey="staff" component={Staff} />} />
      <Route path="/attendance" component={() => <Guarded moduleKey="attendance" component={AttendancePage} />} />
      <Route path="/leave" component={() => <Guarded moduleKey="leave" component={LeavePage} />} />
      <Route path="/payroll" component={() => <Guarded moduleKey="payroll" component={PayrollPage} />} />
      <Route path="/expenses" component={() => <Guarded moduleKey="expenses" component={Expenses} />} />
      <Route path="/maintenance" component={() => <Guarded moduleKey="maintenance" component={Maintenance} />} />
      <Route path="/lists" component={() => <Guarded moduleKey="lists" component={ListsPage} />} />
      <Route path="/reports" component={() => <Guarded moduleKey="reports" component={Reports} />} />
      <Route path="/documents" component={() => <Guarded moduleKey="documents" component={Documents} />} />
      <Route path="/finance" component={() => <Guarded moduleKey="finance" component={Finance} />} />
      <Route path="/inventory" component={() => <Guarded moduleKey="inventory" component={Inventory} />} />
      <Route path="/purchasing" component={() => <Guarded moduleKey="purchasing" component={Purchasing} />} />
      <Route path="/internal-requisitions" component={() => <Guarded moduleKey="internal-requisitions" component={InternalRequisitions} />} />
      <Route path="/budgeting" component={() => <Guarded moduleKey="budgeting" component={Budgeting} />} />
      <Route path="/assets" component={() => <Guarded moduleKey="assets" component={AssetsPage} />} />
      <Route path="/system-admin" component={() => <Guarded moduleKey="system-admin" component={SystemAdmin} />} />
      <Route path="/settings" component={() => <Guarded moduleKey="settings" component={SettingsPage} requireAdminUsername />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function getResetToken(hash: string): string | null {
  const m = hash.match(/^#?\/?reset-password(?:\?(.*))?$/);
  if (!m) return null;
  const params = new URLSearchParams(m[1] ?? "");
  return params.get("token");
}

function useHashChangeTick(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return hash;
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const hash = useHashChangeTick();
  const resetToken = getResetToken(hash);
  const { data: setupStatus, isLoading: setupLoading } = useSetupStatus();
  const { data: user, isLoading: userLoading } = useCurrentUser();

  // Password reset via an emailed link is reachable regardless of sign-in state.
  if (hash.replace(/^#\/?/, "").split("?")[0] === "reset-password") {
    return <ResetPasswordPage token={resetToken} />;
  }

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
                <div className="flex h-screen w-full flex-col overflow-hidden">
                  <TestDatabaseBanner />
                  <div className="flex flex-1 overflow-hidden">
                    <AppSidebar />
                    <div className="flex flex-col flex-1 overflow-hidden">
                      <header className="flex items-center justify-between gap-2 border-b border-border bg-background px-3 py-2 shrink-0">
                        <div className="flex items-center gap-1">
                          <SidebarTrigger data-testid="button-sidebar-toggle" />
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Home"
                            onClick={() => { window.location.hash = "/"; }}
                            data-testid="button-home"
                          >
                            <Home className="h-4 w-4" />
                          </Button>
                        </div>
                        <ThemeToggle />
                      </header>
                      <main className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
                        <AppRouter />
                      </main>
                    </div>
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
