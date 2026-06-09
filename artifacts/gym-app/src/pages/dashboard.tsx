import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useGetMe, useGetDashboardKpis } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users, CreditCard, Receipt, CalendarCheck, Clock,
  PackageX, TrendingUp, TrendingDown, ChevronDown, ChevronUp,
  Lock, Activity,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  LineChart, Line, CartesianGrid, AreaChart, Area,
} from "recharts";
import { cn } from "@/lib/utils";

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function TrendBadge({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", up ? "text-emerald-600" : "text-red-500")}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {Math.abs(pct)}%
    </span>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  loading,
  restricted = false,
  color = "text-primary",
}: {
  icon: React.ElementType;
  label: string;
  value?: React.ReactNode;
  sub?: React.ReactNode;
  loading?: boolean;
  restricted?: boolean;
  color?: string;
}) {
  return (
    <Card className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={cn("w-4 h-4 opacity-70", color)} />
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {restricted ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Lock className="w-4 h-4" />
            <span className="text-sm">Access Restricted</span>
          </div>
        ) : loading ? (
          <>
            <Skeleton className="h-8 w-24 mb-1" />
            <Skeleton className="h-3 w-32" />
          </>
        ) : (
          <>
            <div className="text-2xl font-bold">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ExpandableCard({
  icon: Icon,
  label,
  count,
  loading,
  children,
  color = "text-primary",
}: {
  icon: React.ElementType;
  label: string;
  count: number;
  loading?: boolean;
  children: React.ReactNode;
  color?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={cn("w-4 h-4 opacity-70", color)} />
      </CardHeader>
      <CardContent className="px-4 pb-3">
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <>
            <div className="text-2xl font-bold mb-2">{count}</div>
            {count > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs -ml-2"
                onClick={() => setOpen((v) => !v)}
              >
                {open ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
                {open ? "Hide" : "View"}
              </Button>
            )}
            {open && <div className="mt-3 space-y-1">{children}</div>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

const CHART_COLORS = { revenue: "#6366f1", expense: "#f43f5e", growth: "#10b981" };

export default function Dashboard() {
  const { t } = useI18n();
  const { data: me, isLoading: meLoading } = useGetMe();
  const { data: kpis, isLoading: kpiLoading } = useGetDashboardKpis();

  const canViewProfit = me?.permissions?.viewProfit ?? false;
  const canViewCost = me?.permissions?.viewCost ?? false;

  const loading = kpiLoading;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("dashboard.title")}</h1>
        <p className="text-muted-foreground mt-1">
          {meLoading ? <Skeleton className="h-5 w-48 inline-block" /> : `${t("dashboard.welcome")}, ${me?.name}`}
        </p>
      </div>

      {/* KPI Cards Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {/* Active Members */}
        <KpiCard
          icon={Users}
          label={t("dashboard.activeMembers")}
          loading={loading}
          value={kpis?.activeMembers.count.toLocaleString()}
          sub="Currently active subscriptions"
          color="text-blue-500"
        />

        {/* Monthly Revenue */}
        <KpiCard
          icon={CreditCard}
          label={t("dashboard.monthlyRevenue")}
          loading={loading}
          value={fmt(kpis?.monthlyRevenue.current ?? 0)}
          sub={
            kpis ? (
              <span className="flex items-center gap-1">
                <TrendBadge pct={kpis.monthlyRevenue.changePercent} />
                <span>vs last month</span>
              </span>
            ) : undefined
          }
          color="text-indigo-500"
        />

        {/* Monthly Expenses */}
        <KpiCard
          icon={Receipt}
          label={t("dashboard.monthlyExpenses")}
          loading={loading}
          value={fmt(kpis?.monthlyExpenses.current ?? 0)}
          sub={
            kpis ? (
              <span className="flex items-center gap-1">
                <TrendBadge pct={kpis.monthlyExpenses.changePercent} />
                <span>vs last month</span>
              </span>
            ) : undefined
          }
          color="text-rose-500"
        />

        {/* Today's Check-ins */}
        <KpiCard
          icon={CalendarCheck}
          label={t("dashboard.todayCheckins")}
          loading={loading}
          value={kpis?.todayCheckins.count.toLocaleString()}
          sub="Today's attendance"
          color="text-cyan-500"
        />

        {/* Expiring Soon — expandable */}
        <ExpandableCard
          icon={Clock}
          label={t("dashboard.expiringSoon")}
          loading={loading}
          count={kpis?.expiringSoon.in30Days.length ?? 0}
          color="text-amber-500"
        >
          <div className="text-xs space-y-1 max-h-36 overflow-y-auto">
            <div className="grid grid-cols-3 font-semibold text-muted-foreground border-b pb-1 mb-1">
              <span>Name</span><span>Plan</span><span className="text-right">Days</span>
            </div>
            {kpis?.expiringSoon.in30Days.map((m) => (
              <div key={m.id} className="grid grid-cols-3">
                <span className="truncate">{m.name}</span>
                <span className="truncate text-muted-foreground">{m.planName ?? "—"}</span>
                <span className={cn("text-right font-medium", m.daysRemaining <= 7 ? "text-red-500" : m.daysRemaining <= 14 ? "text-amber-500" : "text-green-600")}>
                  {m.daysRemaining}d
                </span>
              </div>
            ))}
          </div>
        </ExpandableCard>

        {/* Low Stock — expandable */}
        <ExpandableCard
          icon={PackageX}
          label={t("dashboard.lowStock")}
          loading={loading}
          count={kpis?.lowStock.length ?? 0}
          color="text-orange-500"
        >
          <div className="text-xs space-y-1 max-h-36 overflow-y-auto">
            <div className="grid grid-cols-3 font-semibold text-muted-foreground border-b pb-1 mb-1">
              <span className="col-span-2">Product</span><span className="text-right">Qty</span>
            </div>
            {kpis?.lowStock.map((p) => (
              <div key={p.id} className="grid grid-cols-3">
                <span className="col-span-2 truncate">{p.name}</span>
                <span className="text-right font-medium text-orange-500">{p.quantity}/{p.alertQuantity}</span>
              </div>
            ))}
          </div>
        </ExpandableCard>

        {/* Total Profit — permission gated */}
        <KpiCard
          icon={TrendingUp}
          label={t("dashboard.totalProfit")}
          loading={loading}
          restricted={!canViewProfit}
          value={fmt(kpis?.profit.current ?? 0)}
          sub={
            kpis && canViewProfit ? (
              <span className="flex items-center gap-1">
                <TrendBadge pct={kpis.profit.changePercent} />
                <span>vs last month</span>
              </span>
            ) : undefined
          }
          color="text-emerald-500"
        />
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Revenue Chart */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Revenue — Last 12 Months</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={kpis?.revenueChart ?? []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.revenue} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={CHART_COLORS.revenue} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, "Revenue"]} />
                  <Area type="monotone" dataKey="amount" stroke={CHART_COLORS.revenue} fill="url(#revGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Expense Chart */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Expenses — Last 12 Months</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={kpis?.expenseChart ?? []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, "Expenses"]} />
                  <Bar dataKey="amount" fill={CHART_COLORS.expense} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Membership Growth Chart */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">New Members — Last 12 Months</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={kpis?.membershipGrowth ?? []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip formatter={(v: number) => [v, "New members"]} />
                  <Line type="monotone" dataKey="count" stroke={CHART_COLORS.growth} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Today's Check-ins Hourly Chart */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Today's Check-ins by Hour</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={kpis?.todayCheckins.hourly ?? []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(h) => `${h}h`} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip formatter={(v: number) => [v, "Check-ins"]} labelFormatter={(l) => `${l}:00`} />
                  <Bar dataKey="count" fill="#06b6d4" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : !kpis?.recentActivity.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No activity yet</p>
          ) : (
            <div className="divide-y divide-border/50">
              {kpis.recentActivity.map((log) => (
                <div key={log.id} className="flex items-start justify-between py-2.5">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Activity className="w-3 h-3 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{log.action.replace(/_/g, " ")}</p>
                      <p className="text-xs text-muted-foreground">by {log.userName}</p>
                    </div>
                  </div>
                  <time className="text-xs text-muted-foreground whitespace-nowrap ml-4">
                    {new Date(log.createdAt).toLocaleString()}
                  </time>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
