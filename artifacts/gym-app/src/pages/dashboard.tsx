import { useI18n } from "@/lib/i18n";
import { useFmtDate } from "@/lib/useFmtDate";
import { useGetMe, useGetDashboardKpis } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { Users, TrendingUp, Wallet, Receipt, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtMoney(n: number) {
  return moneyFormatter.format(n);
}

type Tone = "blue" | "emerald" | "indigo" | "rose";

const toneClass: Record<Tone, string> = {
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

function Restricted() {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <Lock className="w-4 h-4" />
      <span className="text-sm font-medium">Restricted</span>
    </div>
  );
}

// ─── Hero card: one big number ────────────────────────────────────────────────

function HeroCard({
  icon: Icon,
  tone,
  label,
  value,
  hint,
  loading,
  restricted,
}: {
  icon: React.ElementType;
  tone: Tone;
  label: string;
  value: string;
  hint: string;
  loading?: boolean;
  restricted?: boolean;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border/60 shadow-sm p-6">
      <div className="flex items-center gap-3">
        <div className={cn("p-2.5 rounded-xl shrink-0", toneClass[tone])}>
          <Icon className="w-5 h-5" />
        </div>
        <p className="text-sm font-semibold">{label}</p>
      </div>

      <div className="mt-5 min-h-[2.75rem]">
        {restricted ? (
          <Restricted />
        ) : loading ? (
          <Skeleton className="h-10 w-44" />
        ) : (
          <p className="text-3xl sm:text-4xl font-bold tracking-tight tabular-nums">{value}</p>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-2">{hint}</p>
    </div>
  );
}

// ─── Period card: today / this month / this year ──────────────────────────────

function PeriodCard({
  icon: Icon,
  tone,
  label,
  day,
  month,
  year,
  labels,
  loading,
}: {
  icon: React.ElementType;
  tone: Tone;
  label: string;
  day: number;
  month: number;
  year: number;
  labels: { day: string; month: string; year: string };
  loading?: boolean;
}) {
  const rows = [
    { key: "day", label: labels.day, value: day },
    { key: "month", label: labels.month, value: month },
    { key: "year", label: labels.year, value: year },
  ];

  return (
    <div className="bg-card rounded-2xl border border-border/60 shadow-sm p-6">
      <div className="flex items-center gap-3">
        <div className={cn("p-2.5 rounded-xl shrink-0", toneClass[tone])}>
          <Icon className="w-5 h-5" />
        </div>
        <p className="text-sm font-semibold">{label}</p>
      </div>

      <dl className="mt-4 divide-y divide-border/50">
        {rows.map((row, i) => (
          <div key={row.key} className="flex items-center justify-between gap-4 py-3 first:pt-1">
            <dt
              className={cn(
                "text-sm",
                i === 0 ? "font-medium" : "text-muted-foreground",
              )}
            >
              {row.label}
            </dt>
            <dd>
              {loading ? (
                <Skeleton className="h-5 w-24 ml-auto" />
              ) : (
                <span
                  className={cn(
                    "tabular-nums",
                    i === 0 ? "text-lg font-bold" : "text-sm font-semibold",
                  )}
                >
                  {fmtMoney(row.value)}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
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

  const dateStr = new Date().toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const periodLabels = {
    day: t("dashboard.today"),
    month: t("dashboard.thisMonth"),
    year: t("dashboard.thisYear"),
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          meLoading ? (
            <Skeleton className="h-7 w-52 inline-block" />
          ) : (
            `${t("dashboard.welcome")}, ${me?.name} 👋`
          )
        }
        subtitle={`${dateStr} · ${t("dashboard.amountsInUsd")}`}
      />

      {/* Active members + all-time profit */}
      <div className="grid md:grid-cols-2 gap-4">
        <HeroCard
          icon={Users}
          tone="blue"
          label={t("dashboard.activeMembers")}
          loading={loading}
          value={(kpis?.activeMembers.count ?? 0).toLocaleString()}
          hint={t("dashboard.activeMembersHint")}
        />
        <HeroCard
          icon={TrendingUp}
          tone="emerald"
          label={t("dashboard.totalProfit")}
          loading={loading}
          restricted={!canViewProfit}
          value={fmtMoney(kpis?.profit.total ?? 0)}
          hint={t("dashboard.totalProfitHint")}
        />
      </div>

      {/* Revenue and expenses, per day / month / year */}
      <div className="grid md:grid-cols-2 gap-4">
        <PeriodCard
          icon={Wallet}
          tone="indigo"
          label={t("dashboard.revenue")}
          loading={loading}
          day={kpis?.revenue.day ?? 0}
          month={kpis?.revenue.month ?? 0}
          year={kpis?.revenue.year ?? 0}
          labels={periodLabels}
        />
        <PeriodCard
          icon={Receipt}
          tone="rose"
          label={t("dashboard.expenses")}
          loading={loading}
          day={kpis?.expenses.day ?? 0}
          month={kpis?.expenses.month ?? 0}
          year={kpis?.expenses.year ?? 0}
          labels={periodLabels}
        />
      </div>
    </div>
  );
}
