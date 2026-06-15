import { useEffect } from "react";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useI18nDirection } from "@/lib/i18n";
import { AuthProvider } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";
import { useGetMe } from "@/hooks/use-me";

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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status === 401) return false;
        return failureCount < 2;
      },
    },
  },
});

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Permission check helper ────────────────────────────────────────────────────
function useHasPermission(permKey?: string): boolean | null {
  const me = useGetMe();
  if (!me) return null;
  if (!permKey) return true;
  if (me.role === "admin" || me.role === "manager") return true;
  const perms = me.permissions as unknown as Record<string, boolean> | undefined;
  return !!perms?.[permKey];
}

// ── First accessible route for the current user ───────────────────────────────
const ORDERED_ROUTES = [
  { permKey: "dashboard",     href: "/dashboard"  },
  { permKey: "members",       href: "/members"    },
  { permKey: "plans",         href: "/plans"      },
  { permKey: "staff",         href: "/staff"      },
  { permKey: "payments",      href: "/payments"   },
  { permKey: "accounts",      href: "/accounts"   },
  { permKey: "viewAccounting",href: "/financials" },
  { permKey: "stock",         href: "/stock"      },
  { permKey: "sales",         href: "/sales"      },
  { permKey: "settings",      href: "/settings"   },
] as const;

function useFirstAccessibleRoute(): string | null {
  const me = useGetMe();
  if (!me) return null;
  if (me.role === "admin" || me.role === "manager") return "/dashboard";
  const perms = me.permissions as unknown as Record<string, boolean> | undefined;
  return ORDERED_ROUTES.find(r => !!perms?.[r.permKey])?.href ?? null;
}

// ── No-access screen (staff with all pages disabled) ─────────────────────────
function NoAccessScreen() {
  const { logout } = useAuth();
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="flex flex-col items-center gap-4 text-center px-6">
        <div className="h-12 w-12 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500 text-2xl">🔒</div>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">No pages accessible</h2>
        <p className="text-sm text-slate-500 max-w-xs">Your account doesn't have access to any pages. Contact your administrator to enable permissions.</p>
        <button onClick={logout} className="mt-2 text-sm text-indigo-600 hover:underline">Sign out</button>
      </div>
    </div>
  );
}

// ── Protected wrapper ─────────────────────────────────────────────────────────
function ProtectedRoute({ component: Component, permKey }: { component: React.ComponentType; permKey?: string }) {
  const { isAuthenticated, isLoading } = useAuth();
  const hasPermission = useHasPermission(permKey);
  const firstRoute = useFirstAccessibleRoute();

  if (isLoading || (isAuthenticated && hasPermission === null)) return <LoadingScreen />;
  if (!isAuthenticated) return <Redirect to="/login" />;
  if (hasPermission === false) {
    if (!firstRoute) return <NoAccessScreen />;
    return <Redirect to={firstRoute} />;
  }

  return (
    <AppLayout>
      <Component />
    </AppLayout>
  );
}

// ── Protected member profile (needs params) ───────────────────────────────────
function ProtectedMemberProfile({ id }: { id: number }) {
  const { isAuthenticated, isLoading } = useAuth();
  const hasPermission = useHasPermission("members");
  const firstRoute = useFirstAccessibleRoute();

  if (isLoading || (isAuthenticated && hasPermission === null)) return <LoadingScreen />;
  if (!isAuthenticated) return <Redirect to="/login" />;
  if (hasPermission === false) {
    if (!firstRoute) return <NoAccessScreen />;
    return <Redirect to={firstRoute} />;
  }

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
  const firstRoute = useFirstAccessibleRoute();
  if (isLoading || (isAuthenticated && firstRoute === null)) return <LoadingScreen />;
  if (isAuthenticated) return <Redirect to={firstRoute ?? "/login"} />;
  return <Redirect to="/login" />;
}

// ── Guards for login/setup pages ──────────────────────────────────────────────
function LoginGuard() {
  const { isAuthenticated, isLoading } = useAuth();
  const firstRoute = useFirstAccessibleRoute();
  if (isLoading || (isAuthenticated && firstRoute === null)) return <LoadingScreen />;
  if (isAuthenticated) return <Redirect to={firstRoute ?? "/login"} />;
  return <LoginPage />;
}

// ── Main app shell ────────────────────────────────────────────────────────────
function AppShell() {
  useI18nDirection();
  const queryClientHook = useQueryClient();
  const { isAuthenticated, logout } = useAuth();

  // Clear query cache on logout
  useEffect(() => {
    if (!isAuthenticated) {
      queryClientHook.clear();
    }
  }, [isAuthenticated, queryClientHook]);

  // Global 401 handler — if any query or mutation returns 401, force logout
  useEffect(() => {
    const is401 = (err: unknown): boolean =>
      err instanceof ApiError && err.status === 401;

    const unsubQ = queryClientHook.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error" && is401(event.action.error)) {
        logout();
      }
    });
    const unsubM = queryClientHook.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error" && is401(event.action.error)) {
        logout();
      }
    });
    return () => { unsubQ(); unsubM(); };
  }, [queryClientHook, logout]);

  return (
    <>
      <Switch>
        <Route path="/" component={RootRedirect} />
        <Route path="/login" component={LoginGuard} />
        <Route path="/setup" component={SetupPage} />

        <Route path="/dashboard"><ProtectedRoute component={Dashboard} permKey="dashboard" /></Route>
        <Route path="/staff"><ProtectedRoute component={Staff} permKey="staff" /></Route>
        <Route path="/settings"><ProtectedRoute component={Settings} permKey="settings" /></Route>
        <Route path="/members"><ProtectedRoute component={Members} permKey="members" /></Route>
        <Route path="/members/:id">{(params) => <ProtectedMemberProfile id={Number(params.id)} />}</Route>
        <Route path="/plans"><ProtectedRoute component={Plans} permKey="plans" /></Route>
        <Route path="/payroll"><Redirect to="/staff" /></Route>
        <Route path="/attendance"><ProtectedRoute component={Attendance} /></Route>
        <Route path="/notifications"><ProtectedRoute component={NotificationsPage} /></Route>
        <Route path="/audit"><ProtectedRoute component={AuditPage} /></Route>
        <Route path="/payments"><ProtectedRoute component={Payments} permKey="payments" /></Route>
        <Route path="/vouchers"><Redirect to="/payments" /></Route>
        <Route path="/accounts"><ProtectedRoute component={Accounts} permKey="accounts" /></Route>
        <Route path="/financials"><ProtectedRoute component={Financials} permKey="viewAccounting" /></Route>
        <Route path="/stock"><ProtectedRoute component={Stock} permKey="stock" /></Route>
        <Route path="/sales"><ProtectedRoute component={Sales} permKey="sales" /></Route>

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
