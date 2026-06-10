import { useEffect } from "react";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useI18nDirection } from "@/lib/i18n";
import { AuthProvider } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";

// Pages
import Dashboard from "@/pages/dashboard";
import Staff from "@/pages/staff";
import Settings from "@/pages/settings";
import Members from "@/pages/members";
import MemberProfile from "@/pages/member-profile";
import Payments from "@/pages/payments";
import Accounts from "@/pages/accounts";
import Financials from "@/pages/financials";
import Stock from "@/pages/stock";
import Sales from "@/pages/sales";
import Plans from "@/pages/plans";
import Attendance from "@/pages/attendance";
import NotificationsPage from "@/pages/notifications";
import AuditPage from "@/pages/audit";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import SetupPage from "@/pages/setup";
import { AppLayout } from "@/components/layout/app-layout";

const queryClient = new QueryClient();

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Protected wrapper ─────────────────────────────────────────────────────────
function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Redirect to="/login" />;

  return (
    <AppLayout>
      <Component />
    </AppLayout>
  );
}

// ── Protected member profile (needs params) ───────────────────────────────────
function ProtectedMemberProfile({ id }: { id: number }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Redirect to="/login" />;
  return (
    <AppLayout>
      <MemberProfile id={id} />
    </AppLayout>
  );
}

// ── Loading screen ────────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center animate-pulse" />
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    </div>
  );
}

// ── Root redirect: checks setup, then auth ────────────────────────────────────
function RootRedirect() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) return <Redirect to="/dashboard" />;
  return <Redirect to="/login" />;
}

// ── Guards for login/setup pages ──────────────────────────────────────────────
function LoginGuard() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) return <Redirect to="/dashboard" />;
  return <LoginPage />;
}

// ── Main app shell ────────────────────────────────────────────────────────────
function AppShell() {
  useI18nDirection();
  const queryClientHook = useQueryClient();
  const { isAuthenticated } = useAuth();

  // Clear query cache on logout
  useEffect(() => {
    if (!isAuthenticated) {
      queryClientHook.clear();
    }
  }, [isAuthenticated, queryClientHook]);

  return (
    <>
      <Switch>
        <Route path="/" component={RootRedirect} />
        <Route path="/login" component={LoginGuard} />
        <Route path="/setup" component={SetupPage} />

        <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
        <Route path="/staff"><ProtectedRoute component={Staff} /></Route>
        <Route path="/settings"><ProtectedRoute component={Settings} /></Route>
        <Route path="/members"><ProtectedRoute component={Members} /></Route>
        <Route path="/members/:id">{(params) => <ProtectedMemberProfile id={Number(params.id)} />}</Route>
        <Route path="/plans"><ProtectedRoute component={Plans} /></Route>
        <Route path="/payroll"><Redirect to="/staff" /></Route>
        <Route path="/attendance"><ProtectedRoute component={Attendance} /></Route>
        <Route path="/notifications"><ProtectedRoute component={NotificationsPage} /></Route>
        <Route path="/audit"><ProtectedRoute component={AuditPage} /></Route>
        <Route path="/payments"><ProtectedRoute component={Payments} /></Route>
        <Route path="/vouchers"><Redirect to="/payments" /></Route>
        <Route path="/accounts"><ProtectedRoute component={Accounts} /></Route>
        <Route path="/financials"><ProtectedRoute component={Financials} /></Route>
        <Route path="/stock"><ProtectedRoute component={Stock} /></Route>
        <Route path="/sales"><ProtectedRoute component={Sales} /></Route>

        <Route path="*"><NotFound /></Route>
      </Switch>
      <Toaster />
    </>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <AppShell />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
