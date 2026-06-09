import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useI18nDirection } from "@/lib/i18n";

// Pages
import Home from "@/pages/home";
import Dashboard from "@/pages/dashboard";
import Staff from "@/pages/staff";
import Settings from "@/pages/settings";
import Members from "@/pages/members";
import MemberProfile from "@/pages/member-profile";
import Payments from "@/pages/payments";
import Vouchers from "@/pages/vouchers";
import Accounts from "@/pages/accounts";
import Stock from "@/pages/stock";
import Sales from "@/pages/sales";
import Payroll from "@/pages/payroll";
import Attendance from "@/pages/attendance";
import NotificationsPage from "@/pages/notifications";
import ComingSoon from "@/pages/coming-soon";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/app-layout";

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(242 85% 58%)",
    colorForeground: "hsl(222.2 84% 4.9%)",
    colorMutedForeground: "hsl(215.4 16.3% 46.9%)",
    colorDanger: "hsl(0 84.2% 60.2%)",
    colorBackground: "hsl(0 0% 100%)",
    colorInput: "hsl(0 0% 100%)",
    colorInputForeground: "hsl(222.2 84% 4.9%)",
    colorNeutral: "hsl(214.3 31.8% 91.4%)",
    fontFamily: "'Inter', sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white dark:bg-slate-900 rounded-2xl w-[440px] max-w-full overflow-hidden border border-slate-200 dark:border-slate-800 shadow-xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100",
    headerSubtitle: "text-slate-500 dark:text-slate-400",
    socialButtonsBlockButtonText: "text-slate-700 dark:text-slate-300 font-medium",
    formFieldLabel: "text-slate-700 dark:text-slate-300 font-medium",
    footerActionLink: "text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 font-medium",
    footerActionText: "text-slate-500 dark:text-slate-400",
    dividerText: "text-slate-500 dark:text-slate-400 text-xs",
    identityPreviewEditButton: "text-indigo-600 dark:text-indigo-400",
    formFieldSuccessText: "text-green-600 dark:text-green-400",
    alertText: "text-red-600 dark:text-red-400",
    logoBox: "h-12 w-auto mx-auto mb-4",
    logoImage: "w-full h-full object-contain",
    socialButtonsBlockButton: "border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800",
    formButtonPrimary: "bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-sm",
    formFieldInput: "border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500",
    footerAction: "bg-slate-50 dark:bg-slate-800/50 pt-4 pb-6 px-8",
    dividerLine: "bg-slate-200 dark:bg-slate-700",
    alert: "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800",
    otpCodeFieldInput: "border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100",
    formFieldRow: "space-y-1.5",
    main: "p-8",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Home />
      </Show>
    </>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <AppLayout>
          <Component />
        </AppLayout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  useI18nDirection();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ClerkQueryClientCacheInvalidator />
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            
            {/* Protected Routes */}
            <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
            <Route path="/staff"><ProtectedRoute component={Staff} /></Route>
            <Route path="/settings"><ProtectedRoute component={Settings} /></Route>
            <Route path="/members"><ProtectedRoute component={Members} /></Route>
            <Route path="/members/:id">{(params) => (
              <>
                <Show when="signed-in">
                  <AppLayout>
                    <MemberProfile id={Number(params.id)} />
                  </AppLayout>
                </Show>
                <Show when="signed-out">
                  <Redirect to="/" />
                </Show>
              </>
            )}</Route>
            <Route path="/plans"><ProtectedRoute component={ComingSoon} /></Route>
            <Route path="/payroll"><ProtectedRoute component={Payroll} /></Route>
            <Route path="/attendance"><ProtectedRoute component={Attendance} /></Route>
            <Route path="/notifications"><ProtectedRoute component={NotificationsPage} /></Route>
            <Route path="/payments"><ProtectedRoute component={Payments} /></Route>
            <Route path="/vouchers"><ProtectedRoute component={Vouchers} /></Route>
            <Route path="/accounts"><ProtectedRoute component={Accounts} /></Route>
            <Route path="/stock"><ProtectedRoute component={Stock} /></Route>
            <Route path="/sales"><ProtectedRoute component={Sales} /></Route>

            <Route path="*"><NotFound /></Route>
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
