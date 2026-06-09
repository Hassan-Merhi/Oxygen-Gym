import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useGetMe, useGetDashboardKpis } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, Receipt, CalendarCheck, Clock,
  PackageX, TrendingUp, TrendingDown, ChevronDown, ChevronUp,
  Lock, ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  LineChart, Line, CartesianGrid, AreaChart, Area,
} from "recharts";
import { cn } from "@/lib/utils";

function fmtMoney(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

function TrendPill({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full",
      up ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"
    )}>
      {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {Math.abs(pct)}%
    </span>
  );
}

function StatCard({
  label,
  value,
  trend,
  sub,
  loading,
  restricted,
  accentColor,
  icon: Icon,
}: {
  label: string;
  value?: React.ReactNode;
  trend?: number;
  sub?: string;
  loading?: boolean;
  restricted?: boolean;
  accentColor: string;
  icon: React.ElementType;
}) {
  return (
    <div className="bg-white dark:bg-card rounded-2xl border border-border/50 shadow-sm p-5 flex flex-col gap-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div className={cn("p-2.5 rounded-xl", accentColor)}>
          <Icon className="w-5 h-5" />
        </div>
        {trend !== undefined && !restricted && !loading && (
          <TrendPill pct={trend} />
        )}
      </div>
      {restricted ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Lock className="w-4 h-4" />
          <span className="text-sm">Restricted</span>
        </div>
      ) : loading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-3 w-28" />
        </div>
      ) : (
        <div>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      )}
      <p className="text-sm font-medium text-muted-foreground -mt-1">{label}</p>
    </div>
  );
}

function ExpandCard({
  label,
  count,
  loading,
  accentColor,
  icon: Icon,
  children,
}: {
  label: string;
  count: number;
  loading?: boolean;
  accentColor: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white dark:bg-card rounded-2xl border border-border/50 shadow-sm p-5 flex flex-col gap-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div className={cn("p-2.5 rounded-xl", accentColor)}>
          <Icon className="w-5 h-5" />
        </div>
        {count > 0 && !loading && (
          <button
            onClick={() => setOpen(v => !v)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {open ? "Hide" : "View"}
          </button>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        <div>
          <p className="text-2xl font-bold tracking-tight">{count}</p>
          {open && count > 0 && (
            <div className="mt-3 text-xs space-y-1 max-h-36 overflow-y-auto pr-1">{children}</div>
          )}
        </div>
      )}
      <p className="text-sm font-medium text-muted-foreground -mt-1">{label}</p>
    </div>
  );
}

const CHART_COLORS = { revenue: "#6366f1", expense: "#f43f5e", growth: "#10b981", checkin: "#06b6d4" };

const CustomTooltipStyle = {
  contentStyle: {
    fontSize: 12,
    borderRadius: 8,
    border: "1px solid var(--border)",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
  },
};

export default function Dashboard() {
  const { t } = useI18n();
  const { data: me, isLoading: meLoading } = useGetMe();
  const { data: kpis, isLoading: kpiLoading } = useGetDashboardKpis();

  const canViewProfit = me?.permissions?.viewProfit ?? false;
  const loading = kpiLoading;

  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{dateStr}</p>
          <h1 className="text-2xl font-bold tracking-tight mt-0.5">
            {meLoading ? <Skeleton className="h-8 w-48 inline-block" /> : `${t("dashboard.welcome")}, ${me?.name} 👋`}
          </h1>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="xl:col-span-2">
          <StatCard
            icon={Users}
            label={t("dashboard.activeMembers")}
            loading={loading}
            value={kpis?.activeMembers.count.toLocaleString()}
            sub="Active subscriptions"
            accentColor="bg-blue-50 text-blue-500"
          />
        </div>

        <div className="xl:col-span-2">
          <StatCard
            icon={Receipt}
            label={t("dashboard.monthlyExpenses")}
            loading={loading}
            value={fmtMoney(kpis?.monthlyExpenses.current ?? 0)}
            trend={kpis?.monthlyExpenses.changePercent}
            sub="vs last month"
            accentColor="bg-rose-50 text-rose-500"
          />
        </div>

        <div className="xl:col-span-2">
          <StatCard
            icon={TrendingUp}
            label={t("dashboard.totalProfit")}
            loading={loading}
            restricted={!canViewProfit}
            value={fmtMoney(kpis?.profit.current ?? 0)}
            trend={canViewProfit ? kpis?.profit.changePercent : undefined}
            sub="vs last month"
            accentColor="bg-emerald-50 text-emerald-500"
          />
        </div>

        <div className="xl:col-span-2">
          <StatCard
            icon={CalendarCheck}
            label={t("dashboard.todayCheckins")}
            loading={loading}
            value={kpis?.todayCheckins.count.toLocaleString()}
            sub="Today's attendance"
            accentColor="bg-cyan-50 text-cyan-500"
          />
        </div>

        <div className="xl:col-span-1">
          <ExpandCard
            icon={Clock}
            label={t("dashboard.expiringSoon")}
            loading={loading}
            count={kpis?.expiringSoon.in30Days.length ?? 0}
            accentColor="bg-amber-50 text-amber-500"
          >
            <div className="grid grid-cols-3 font-semibold text-muted-foreground border-b pb-1 mb-1">
              <span>Name</span><span>Plan</span><span className="text-right">Days</span>
            </div>
            {kpis?.expiringSoon.in30Days.map((m) => (
              <div key={m.id} className="grid grid-cols-3">
                <span className="truncate">{m.name}</span>
                <span className="truncate text-muted-foreground">{m.planName ?? "—"}</span>
                <span className={cn("text-right font-medium",
                  m.daysRemaining <= 7 ? "text-red-500" : m.daysRemaining <= 14 ? "text-amber-500" : "text-emerald-600"
                )}>{m.daysRemaining}d</span>
              </div>
            ))}
          </ExpandCard>
        </div>

        <div className="xl:col-span-1">
          <ExpandCard
            icon={PackageX}
            label={t("dashboard.lowStock")}
            loading={loading}
            count={kpis?.lowStock.length ?? 0}
            accentColor="bg-orange-50 text-orange-500"
          >
            <div className="grid grid-cols-3 font-semibold text-muted-foreground border-b pb-1 mb-1">
              <span className="col-span-2">Product</span><span className="text-right">Qty</span>
            </div>
            {kpis?.lowStock.map((p) => (
              <div key={p.id} className="grid grid-cols-3">
                <span className="col-span-2 truncate">{p.name}</span>
                <span className="text-right font-medium text-orange-500">{p.quantity}/{p.alertQuantity}</span>
              </div>
            ))}
          </ExpandCard>
        </div>
      </div>

      {/* Charts — 2×2 grid */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Revenue */}
        <div className="bg-white dark:bg-card rounded-2xl border border-border/50 shadow-sm p-5">
          <p className="text-sm font-semibold mb-4">Revenue — Last 12 Months</p>
          {loading ? <Skeleton className="h-48 w-full" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={kpis?.revenueChart ?? []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.revenue} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={CHART_COLORS.revenue} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip {...CustomTooltipStyle} formatter={(v: number) => [`$${v.toFixed(2)}`, "Revenue"]} />
                <Area type="monotone" dataKey="amount" stroke={CHART_COLORS.revenue} fill="url(#revGrad)" strokeWidth={2.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Expenses */}
        <div className="bg-white dark:bg-card rounded-2xl border border-border/50 shadow-sm p-5">
          <p className="text-sm font-semibold mb-4">Expenses — Last 12 Months</p>
          {loading ? <Skeleton className="h-48 w-full" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={kpis?.expenseChart ?? []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip {...CustomTooltipStyle} formatter={(v: number) => [`$${v.toFixed(2)}`, "Expenses"]} />
                <Bar dataKey="amount" fill={CHART_COLORS.expense} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* New Members */}
        <div className="bg-white dark:bg-card rounded-2xl border border-border/50 shadow-sm p-5">
          <p className="text-sm font-semibold mb-4">New Members — Last 12 Months</p>
          {loading ? <Skeleton className="h-48 w-full" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={kpis?.membershipGrowth ?? []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip {...CustomTooltipStyle} formatter={(v: number) => [v, "New members"]} />
                <Line type="monotone" dataKey="count" stroke={CHART_COLORS.growth} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Check-ins by Hour */}
        <div className="bg-white dark:bg-card rounded-2xl border border-border/50 shadow-sm p-5">
          <p className="text-sm font-semibold mb-4">Today's Check-ins by Hour</p>
          {loading ? <Skeleton className="h-48 w-full" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={kpis?.todayCheckins.hourly ?? []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(h) => `${h}h`} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip {...CustomTooltipStyle} formatter={(v: number) => [v, "Check-ins"]} labelFormatter={(l) => `${l}:00`} />
                <Bar dataKey="count" fill={CHART_COLORS.checkin} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
