import { useI18n } from "@/lib/i18n";
import { useFmtDate } from "@/lib/useFmtDate";
import { useGetMe, useGetDashboardKpis } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import {
  Users, CalendarCheck, TrendingUp, Receipt,
  Clock, PackageX, ArrowUpRight, ArrowDownRight, Lock,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  LineChart, Line, CartesianGrid, Legend,
} from "recharts";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

const tooltipStyle = {
  contentStyle: {
    fontSize: 12,
    borderRadius: 8,
    border: "1px solid var(--border)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
    background: "var(--card)",
    color: "var(--foreground)",
  },
};

// ─── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon, label, value, sub, trend, loading, restricted, color,
}: {
  icon: React.ElementType;
  label: string;
  value?: React.ReactNode;
  sub?: string;
  trend?: number;
  loading?: boolean;
  restricted?: boolean;
  color: "blue" | "rose" | "emerald" | "violet";
}) {
  const palette = {
    blue:    { bar: "bg-blue-500",    icon: "bg-blue-50 text-blue-500"    },
    rose:    { bar: "bg-rose-500",    icon: "bg-rose-50 text-rose-500"    },
    emerald: { bar: "bg-emerald-500", icon: "bg-emerald-50 text-emerald-500" },
    violet:  { bar: "bg-violet-500",  icon: "bg-violet-50 text-violet-500"  },
  }[color];

  return (
    <div className="relative bg-card rounded-2xl border border-border/60 shadow-sm p-5 overflow-hidden hover:shadow-md transition-shadow">
      {/* left accent bar */}
      <div className={cn("absolute left-0 top-4 bottom-4 w-1 rounded-r-full", palette.bar)} />

      <div className="flex items-start justify-between gap-3 pl-3">
        <div className={cn("p-2.5 rounded-xl shrink-0", palette.icon)}>
          <Icon className="w-5 h-5" />
        </div>
        {trend !== undefined && !restricted && !loading && (
          <span className={cn(
            "inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full mt-0.5",
            trend >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"
          )}>
            {trend >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {Math.abs(trend)}%
          </span>
        )}
      </div>

      <div className="pl-3 mt-3">
        {restricted ? (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Lock className="w-4 h-4" />
            <span className="text-sm font-medium">Restricted</span>
          </div>
        ) : loading ? (
          <div className="space-y-1.5">
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-28" />
          </div>
        ) : (
          <>
            <p className="text-2xl font-bold tracking-tight leading-none">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </>
        )}
        <p className="text-sm font-medium text-muted-foreground mt-2">{label}</p>
      </div>
    </div>
  );
}

// ─── Chart card wrapper ───────────────────────────────────────────────────────

function ChartCard({ title, sub, loading, height = 200, children }: {
  title: string; sub?: string; loading?: boolean; height?: number; children: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border/60 shadow-sm p-5">
      <div className="mb-4">
        <p className="text-sm font-semibold">{title}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      {loading ? <Skeleton className={`w-full`} style={{ height }} /> : children}
    </div>
  );
}

// ─── Alert row ────────────────────────────────────────────────────────────────

function AlertPanel({ title, icon: Icon, iconClass, empty, children }: {
  title: string; icon: React.ElementType; iconClass: string; empty: boolean; children: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border/60 shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <div className={cn("p-2 rounded-lg", iconClass)}>
          <Icon className="w-4 h-4" />
        </div>
        <p className="text-sm font-semibold">{title}</p>
      </div>
      {empty ? (
        <p className="text-xs text-muted-foreground py-2">All clear — nothing to flag.</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { t } = useI18n();
  const { locale } = useFmtDate();
  const { data: me, isLoading: meLoading } = useGetMe();
  const { data: kpis, isLoading: loading } = useGetDashboardKpis();

  const canViewProfit = me?.permissions?.viewProfit ?? me?.role === "admin";

  const now = new Date();
  const dateStr = now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  // Combined revenue vs expenses data
  const combinedChart = (kpis?.revenueChart ?? []).map((r, i) => ({
    month: r.month,
    revenue: r.amount,
    expenses: kpis?.expenseChart?.[i]?.amount ?? 0,
  }));

  return (
    <div className="space-y-6">

      <PageHeader
        title={meLoading
          ? <Skeleton className="h-7 w-52 inline-block" />
          : `${t("dashboard.welcome")}, ${me?.name} 👋`
        }
        subtitle={dateStr}
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={Users} color="blue"
          label={t("dashboard.activeMembers")}
          loading={loading}
          value={kpis?.activeMembers.count.toLocaleString()}
          sub="Active subscriptions"
        />
        <KpiCard
          icon={Receipt} color="rose"
          label={t("dashboard.monthlyExpenses")}
          loading={loading}
          value={fmtMoney(kpis?.monthlyExpenses.current ?? 0)}
          trend={kpis?.monthlyExpenses.changePercent}
          sub="vs last month"
        />
        <KpiCard
          icon={TrendingUp} color="emerald"
          label={t("dashboard.totalProfit")}
          loading={loading}
          restricted={!canViewProfit}
          value={fmtMoney(kpis?.profit.current ?? 0)}
          trend={canViewProfit ? kpis?.profit.changePercent : undefined}
          sub="vs last month"
        />
        <KpiCard
          icon={CalendarCheck} color="violet"
          label={t("dashboard.todayCheckins")}
          loading={loading}
          value={kpis?.todayCheckins.count.toLocaleString()}
          sub="Today's attendance"
        />
      </div>

      {/* Main content: charts + alerts */}
      <div className="grid lg:grid-cols-3 gap-5">

        {/* Revenue vs Expenses — spans 2 cols */}
        <div className="lg:col-span-2">
          <ChartCard title="Revenue vs Expenses" sub="Last 12 months" loading={loading} height={240}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={combinedChart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} width={45} />
                <Tooltip {...tooltipStyle} formatter={(v: number, name: string) => [fmtMoney(v), name === "revenue" ? "Revenue" : "Expenses"]} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="revenue" fill="#6366f1" radius={[4, 4, 0, 0]} name="revenue" />
                <Bar dataKey="expenses" fill="#f43f5e" radius={[4, 4, 0, 0]} name="expenses" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Alerts column */}
        <div className="flex flex-col gap-4">
          {/* Expiring soon */}
          <AlertPanel
            title={`${t("dashboard.expiringSoon")} (${kpis?.expiringSoon.in30Days.length ?? 0})`}
            icon={Clock}
            iconClass="bg-amber-50 text-amber-500"
            empty={!loading && (kpis?.expiringSoon.in30Days.length ?? 0) === 0}
          >
            {loading
              ? [1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)
              : kpis?.expiringSoon.in30Days.slice(0, 5).map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 text-xs py-1.5 border-b border-border/40 last:border-0">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{m.name}</p>
                    <p className="text-muted-foreground truncate">{m.planName ?? "—"}</p>
                  </div>
                  <span className={cn(
                    "shrink-0 text-xs font-bold px-2 py-0.5 rounded-full",
                    m.daysRemaining <= 7 ? "bg-red-100 text-red-600" :
                    m.daysRemaining <= 14 ? "bg-amber-100 text-amber-600" :
                    "bg-emerald-100 text-emerald-700"
                  )}>
                    {m.daysRemaining}d
                  </span>
                </div>
              ))
            }
          </AlertPanel>

          {/* Low stock */}
          <AlertPanel
            title={`${t("dashboard.lowStock")} (${kpis?.lowStock.length ?? 0})`}
            icon={PackageX}
            iconClass="bg-orange-50 text-orange-500"
            empty={!loading && (kpis?.lowStock.length ?? 0) === 0}
          >
            {loading
              ? [1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)
              : kpis?.lowStock.slice(0, 5).map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 text-xs py-1.5 border-b border-border/40 last:border-0">
                  <p className="font-medium truncate min-w-0">{p.name}</p>
                  <span className="shrink-0 font-bold text-orange-500 bg-orange-50 px-2 py-0.5 rounded-full">
                    {p.quantity}/{p.alertQuantity}
                  </span>
                </div>
              ))
            }
          </AlertPanel>
        </div>
      </div>

      {/* Bottom charts */}
      <div className="grid lg:grid-cols-2 gap-5">
        <ChartCard title="New Members" sub="Last 12 months" loading={loading} height={180}>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={kpis?.membershipGrowth ?? []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} width={30} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [v, "New members"]} />
              <Line type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3, fill: "#10b981" }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Check-ins by Hour" sub="Today" loading={loading} height={180}>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={kpis?.todayCheckins.hourly ?? []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(h) => `${h}h`} interval={2} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} width={30} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [v, "Check-ins"]} labelFormatter={(l) => `${l}:00`} />
              <Bar dataKey="count" fill="#06b6d4" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

    </div>
  );
}
