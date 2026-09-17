import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useI18nDirection } from "@/lib/i18n";
import { AuthProvider } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";
import { useGetMe } from "@/hooks/use-me";
import { AppLayout } from "@/components/layout/app-layout";

// Route-level code splitting keeps large feature pages out of the initial bundle.
// Only the page the user actually opens is downloaded and evaluated.
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Staff = lazy(() => import("@/pages/staff"));
const Settings = lazy(() => import("@/pages/settings"));
const PeriodReset = lazy(() => import("@/pages/period-reset"));
const Members = lazy(() => import("@/pages/members"));
const MembersOverview = lazy(() => import("@/pages/members-overview"));
const MemberProfile = lazy(() => import("@/pages/member-profile"));
const Payments = lazy(() => import("@/pages/payments"));
const Accounts = lazy(() => import("@/pages/accounts"));
const Financials = lazy(() => import("@/pages/financials"));
const Stock = lazy(() => import("@/pages/stock"));
const Sales = lazy(() => import("@/pages/sales"));
const Supplements = lazy(() => import("@/pages/supplements"));
const Plans = lazy(() => import("@/pages/plans"));
const Attendance = lazy(() => import("@/pages/attendance"));
const NotificationsPage = lazy(() => import("@/pages/notifications"));
const AuditPage = lazy(() => import("@/pages/audit"));
const NotFound = lazy(() => import("@/pages/not-found"));
const LoginPage = lazy(() => import("@/pages/login"));
const SetupPage = lazy(() => import("@/pages/setup"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Most screen data is safe to reuse briefly. This stops duplicate requests
      // while navigating between pages or while multiple components ask for /me.
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        // Authentication/authorization failures are deterministic for the current
        // user. Retrying them only turns one denied request into a log storm.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return false;
        return failureCount < 2;
      },
    },
  },
});

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Permission check helper ────────────────────────────────────────────────────
function useHasAccess(allOf: readonly string[] = [], adminOnly = false): boolean | null {
  const me = useGetMe();
  if (!me) return null;
  if (me.role === "admin") return true;
  if (adminOnly) return false;

  const perms = me.permissions as unknown as Record<string, boolean> | undefined;
  return allOf.every((permission) => perms?.[permission] === true);
}

// ── First accessible route for the current user ───────────────────────────────
const ORDERED_ROUTES = [
  { allOf: ["dashboard", "viewProfit"],                 href: "/dashboard"  },
  { allOf: ["members"],                                  href: "/members"    },
  { allOf: ["plans"],                                    href: "/plans"      },
  { allOf: ["staff", "payroll"],                       href: "/staff"      },
  { allOf: ["payments"],                                 href: "/payments"   },
  { allOf: ["accounts", "viewAccounting"],             href: "/accounts"   },
  { allOf: ["viewAccounting", "viewProfit", "viewCost"], href: "/financials" },
  { allOf: ["stock"],                                    href: "/stock"      },
  { allOf: ["sales"],                                    href: "/sales"      },
  { allOf: ["manageSettings"],                           href: "/settings"   },
] as const;

function useFirstAccessibleRoute(): string | null {
  const me = useGetMe();
  if (!me) return null;
  if (me.role === "admin") return "/dashboard";

  const perms = me.permissions as unknown as Record<string, boolean> | undefined;
  return ORDERED_ROUTES.find((route) =>
    route.allOf.every((permission) => perms?.[permission] === true),
  )?.href ?? null;
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
function ProtectedRoute({
  component: Component,
  allOf = [],
  adminOnly = false,
}: {
  component: React.ComponentType;
  allOf?: readonly string[];
  adminOnly?: boolean;
}) {
  const { isAuthenticated, isLoading } = useAuth();
  const hasAccess = useHasAccess(allOf, adminOnly);
  const firstRoute = useFirstAccessibleRoute();

  if (isLoading || (isAuthenticated && hasAccess === null)) return <LoadingScreen />;
  if (!isAuthenticated) return <Redirect to="/login" />;
  if (hasAccess === false) {
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
  const hasAccess = useHasAccess(["members"]);
  const firstRoute = useFirstAccessibleRoute();

  if (isLoading || (isAuthenticated && hasAccess === null)) return <LoadingScreen />;
  if (!isAuthenticated) return <Redirect to="/login" />;
  if (hasAccess === false) {
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
      <Suspense fallback={<LoadingScreen />}>
        <Switch>
          <Route path="/" component={RootRedirect} />
          <Route path="/login" component={LoginGuard} />
          <Route path="/setup" component={SetupPage} />

          <Route path="/dashboard"><ProtectedRoute component={Dashboard} allOf={["dashboard", "viewProfit"]} /></Route>
          <Route path="/staff"><ProtectedRoute component={Staff} allOf={["staff", "payroll"]} /></Route>
          <Route path="/settings"><ProtectedRoute component={Settings} allOf={["manageSettings"]} /></Route>
          <Route path="/period-reset"><ProtectedRoute component={PeriodReset} adminOnly /></Route>
          <Route path="/members"><ProtectedRoute component={Members} allOf={["members"]} /></Route>
          <Route path="/members-overview"><ProtectedRoute component={MembersOverview} allOf={["members"]} /></Route>
          <Route path="/members/:id">{(params) => <ProtectedMemberProfile id={Number(params.id)} />}</Route>
          <Route path="/plans"><ProtectedRoute component={Plans} allOf={["plans"]} /></Route>
          <Route path="/payroll"><Redirect to="/staff" /></Route>
          <Route path="/attendance"><ProtectedRoute component={Attendance} allOf={["members"]} /></Route>
          <Route path="/notifications"><ProtectedRoute component={NotificationsPage} /></Route>
          <Route path="/audit"><ProtectedRoute component={AuditPage} adminOnly /></Route>
          <Route path="/payments"><ProtectedRoute component={Payments} allOf={["payments"]} /></Route>
          <Route path="/vouchers"><Redirect to="/payments" /></Route>
          <Route path="/accounts"><ProtectedRoute component={Accounts} allOf={["accounts", "viewAccounting"]} /></Route>
          <Route path="/financials"><ProtectedRoute component={Financials} allOf={["viewAccounting", "viewProfit", "viewCost"]} /></Route>
          <Route path="/stock"><ProtectedRoute component={Stock} allOf={["stock"]} /></Route>
          <Route path="/sales"><ProtectedRoute component={Sales} allOf={["sales"]} /></Route>
          <Route path="/supplements"><ProtectedRoute component={Supplements} allOf={["stock", "viewCost", "viewProfit"]} /></Route>

          <Route path="*"><NotFound /></Route>
        </Switch>
      </Suspense>
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
