import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { useFmtDate } from "@/lib/useFmtDate";
import { useGetMe } from "@/hooks/use-me";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  BarChart3,
  CalendarRange,
  Loader2,
  Send,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";

const PERIODS = ["today", "month", "last_month", "year", "custom"] as const;
type Period = (typeof PERIODS)[number];
type Kind = "revenue" | "expense";

type Money = {
  usd: number;
  cdf: number;
};

type FinancialTransaction = {
  id: string;
  sourceType: "payment" | "voucher" | "sale_cogs";
  sourceId: number;
  reference: string;
  date: string;
  dateKey: string;
  monthKey: string;
  kind: Kind;
  category: string;
  description: string;
  party: string;
  amountUsd: number;
  amountCdf: number;
};

type FinancialCategory = {
  category: string;
  kind: Kind;
  usd: number;
  cdf: number;
};

type FinancialMonth = {
  key: string;
  label: string;
  revenue: Money;
  expenses: Money;
  net: Money;
  transactions: FinancialTransaction[];
};

type FinancialReport = {
  period: Period;
  dateFrom: string;
  dateTo: string;
  rate: number;
  currency: { base: "USD"; display: "CDF" };
  revenue: Money;
  expenses: Money;
  net: Money;
  categories: FinancialCategory[];
  months: FinancialMonth[];
};

const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  month: "This Month",
  last_month: "Last Month",
  year: "This Year",
  custom: "Custom Range",
};

export default function Financials() {
  const { t } = useI18n();
  const { locale } = useFmtDate();
  const me = useGetMe();
  const { toast } = useToast();

  const canView = me?.role === "admin" || me?.permissions?.viewAccounting;
  const canViewProfit = me?.role === "admin" || me?.permissions?.viewProfit;

  const [period, setPeriod] = useState<Period>("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharingWA, setSharingWA] = useState(false);

  useEffect(() => {
    if (!canView || !canViewProfit) return;
    if (period === "custom" && (!dateFrom || !dateTo)) {
      setReport(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ period });
    if (period === "custom") {
      params.set("dateFrom", dateFrom);
      params.set("dateTo", dateTo);
    }

    setLoading(true);
    setError(null);

    fetch(`/api/financials?${params.toString()}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error || "Unable to load financials.");
        }
        return response.json() as Promise<FinancialReport>;
      })
      .then((body) => setReport(body))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Unable to load financials.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [canView, canViewProfit, period, dateFrom, dateTo]);

  const selectedRange = useMemo(() => {
    if (!report) return "";
    const from = formatDateKey(toDateKey(report.dateFrom), locale);
    const to = formatDateKey(toDateKey(report.dateTo), locale);
    return from === to ? from : `${from} – ${to}`;
  }, [report, locale]);

  if (!canView) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
        <AlertCircle className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">{t("acc.restricted")}</p>
      </div>
    );
  }

  if (!canViewProfit) {
    return (
      <div className="space-y-5">
        <PageHeader
          icon={BarChart3}
          iconClass="bg-violet-500/10 text-violet-600"
          title="Financials"
        />
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          {t("acc.profitRestricted")}
        </div>
      </div>
    );
  }

  async function shareOnWhatsApp() {
    if (!report) return;
    setSharingWA(true);
    try {
      const lines = report.categories
        .map((category) => `${category.category}: $${fmtUsd(category.usd)} / FC ${fmtFc(category.cdf)}`)
        .join("\n");
      const message = [
        `📊 *Oxygen Gym Financials*`,
        selectedRange,
        "",
        `Revenue: $${fmtUsd(report.revenue.usd)} / FC ${fmtFc(report.revenue.cdf)}`,
        `Expenses: $${fmtUsd(report.expenses.usd)} / FC ${fmtFc(report.expenses.cdf)}`,
        `Net: $${fmtUsd(report.net.usd)} / FC ${fmtFc(report.net.cdf)}`,
        "",
        "*Breakdown*",
        lines,
      ].join("\n");

      const response = await fetch("/api/whatsapp/broadcast", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || "Unable to send WhatsApp report.");
      }
      toast({ title: "Financial report sent on WhatsApp ✓" });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Unable to send WhatsApp report.",
        variant: "destructive",
      });
    } finally {
      setSharingWA(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={BarChart3}
        iconClass="bg-violet-500/10 text-violet-600"
        title="Financials"
      />

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-sm font-semibold">Financial period</p>
            <p className="text-xs text-muted-foreground">
              Revenue, expenses and profit update from the selected period only.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select value={period} onValueChange={(value) => setPeriod(value as Period)}>
              <SelectTrigger className="w-full sm:w-[190px]">
                <span className="flex items-center gap-2">
                  <CalendarRange className="h-4 w-4 text-muted-foreground" />
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((item) => (
                  <SelectItem key={item} value={item}>{PERIOD_LABELS[item]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {period === "custom" && (
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  aria-label="Start date"
                  className="w-[150px]"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="date"
                  aria-label="End date"
                  className="w-[150px]"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={shareOnWhatsApp}
              disabled={!report || sharingWA}
              className="gap-2"
            >
              {sharingWA ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              WhatsApp
            </Button>
          </div>
        </div>

        {report && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
            <span>{selectedRange}</span>
            <span className="hidden h-3 w-px bg-border sm:block" />
            <span>Reporting currency: USD</span>
            <span className="hidden h-3 w-px bg-border sm:block" />
            <span>Taux: 1 USD = FC {fmtFc(report.rate)}</span>
          </div>
        )}
      </div>

      {period === "custom" && (!dateFrom || !dateTo) ? (
        <EmptyState message="Choose a start and end date to view the report." />
      ) : loading ? (
        <div className="flex min-h-44 items-center justify-center rounded-xl border border-border bg-card">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex min-h-44 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 text-center text-sm text-destructive">
          {error}
        </div>
      ) : report ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <MetricCard
              label="Revenue"
              icon={<TrendingUp className="h-4 w-4" />}
              value={report.revenue}
              tone="positive"
            />
            <MetricCard
              label="Expenses"
              icon={<TrendingDown className="h-4 w-4" />}
              value={report.expenses}
              tone="negative"
            />
            <MetricCard
              label={report.net.usd >= 0 ? "Net Profit" : "Net Loss"}
              icon={<WalletCards className="h-4 w-4" />}
              value={report.net}
              tone={report.net.usd >= 0 ? "positive" : "negative"}
              emphasize
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="font-semibold">Breakdown by category</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Every transaction below follows the period filter above. FC is converted from USD using the current taux.
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">{report.months.reduce((sum, month) => sum + month.transactions.length, 0)} transactions</span>
              </div>
            </div>

            {report.categories.length > 0 ? (
              <>
                <div className="hidden border-b border-border md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/35 text-xs text-muted-foreground">
                        <th className="px-5 py-2.5 text-left font-medium">Category</th>
                        <th className="px-4 py-2.5 text-left font-medium">Type</th>
                        <th className="px-4 py-2.5 text-right font-medium">USD</th>
                        <th className="px-5 py-2.5 text-right font-medium">FC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.categories.map((category) => (
                        <tr key={`${category.kind}-${category.category}`} className="border-t border-border/50 first:border-t-0">
                          <td className="px-5 py-3 font-medium">{category.category}</td>
                          <td className="px-4 py-3">
                            <KindBadge kind={category.kind} />
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums">${fmtUsd(category.usd)}</td>
                          <td className="px-5 py-3 text-right text-muted-foreground tabular-nums">FC {fmtFc(category.cdf)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="divide-y divide-border md:hidden">
                  {report.categories.map((category) => (
                    <div key={`${category.kind}-${category.category}`} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{category.category}</p>
                        <div className="mt-1"><KindBadge kind={category.kind} /></div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums">${fmtUsd(category.usd)}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">FC {fmtFc(category.cdf)}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-muted/15 px-4 py-3 sm:px-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transactions</p>
                </div>

                <div className="divide-y divide-border">
                  {report.months.map((month) => (
                    <MonthSection key={month.key} month={month} locale={locale} />
                  ))}
                </div>
              </>
            ) : (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                No financial transactions were found for this period.
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  icon,
  value,
  tone,
  emphasize = false,
}: {
  label: string;
  icon: React.ReactNode;
  value: Money;
  tone: "positive" | "negative";
  emphasize?: boolean;
}) {
  const toneClass = tone === "positive"
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";
  const iconClass = tone === "positive"
    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : "bg-rose-500/10 text-rose-600 dark:text-rose-400";

  return (
    <div className={`rounded-xl border border-border bg-card p-4 shadow-sm ${emphasize ? "ring-1 ring-border/50" : ""}`}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${iconClass}`}>{icon}</span>
        {label}
      </div>
      <p className={`mt-3 text-2xl font-bold tracking-tight tabular-nums ${toneClass}`}>
        {value.usd < 0 ? "-" : ""}${fmtUsd(Math.abs(value.usd))}
      </p>
      <p className="mt-1 text-sm text-muted-foreground tabular-nums">
        {value.cdf < 0 ? "-" : ""}FC {fmtFc(Math.abs(value.cdf))}
      </p>
    </div>
  );
}

function MonthSection({ month, locale }: { month: FinancialMonth; locale: string }) {
  const dayGroups = useMemo(() => {
    const grouped = new Map<string, FinancialTransaction[]>();
    for (const transaction of month.transactions) {
      const rows = grouped.get(transaction.dateKey) ?? [];
      rows.push(transaction);
      grouped.set(transaction.dateKey, rows);
    }
    return [...grouped.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [month.transactions]);

  return (
    <section>
      <div className="flex flex-col gap-3 bg-muted/25 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <p className="text-sm font-semibold">{month.label}</p>
          <p className="text-xs text-muted-foreground">{month.transactions.length} transactions</p>
        </div>
        <div className="grid grid-cols-3 gap-4 text-right text-xs sm:gap-6">
          <MonthTotal label="Revenue" value={month.revenue} />
          <MonthTotal label="Expenses" value={month.expenses} />
          <MonthTotal label="Net" value={month.net} strong />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-y border-border/60 bg-background text-xs text-muted-foreground">
              <th className="w-[130px] px-5 py-2.5 text-left font-medium">Date</th>
              <th className="w-[155px] px-4 py-2.5 text-left font-medium">Category</th>
              <th className="px-4 py-2.5 text-left font-medium">Transaction</th>
              <th className="w-[130px] px-4 py-2.5 text-right font-medium">USD</th>
              <th className="w-[155px] px-5 py-2.5 text-right font-medium">FC</th>
            </tr>
          </thead>
          <tbody>
            {dayGroups.map(([dateKey, transactions]) => (
              <DayRows key={dateKey} dateKey={dateKey} transactions={transactions} locale={locale} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DayRows({
  dateKey,
  transactions,
  locale,
}: {
  dateKey: string;
  transactions: FinancialTransaction[];
  locale: string;
}) {
  return (
    <>
      <tr className="border-t border-border/60 bg-muted/10">
        <td colSpan={5} className="px-5 py-2 text-xs font-medium text-muted-foreground">
          {formatDateKey(dateKey, locale)}
        </td>
      </tr>
      {transactions.map((transaction) => {
        const sign = transaction.kind === "expense" ? "-" : "+";
        const amountClass = transaction.kind === "expense"
          ? "text-rose-600 dark:text-rose-400"
          : "text-emerald-600 dark:text-emerald-400";
        return (
          <tr key={transaction.id} className="border-t border-border/40 hover:bg-muted/15">
            <td className="px-5 py-3 text-xs text-muted-foreground">{transaction.reference}</td>
            <td className="px-4 py-3">
              <p className="font-medium">{transaction.category}</p>
              <div className="mt-1"><KindBadge kind={transaction.kind} /></div>
            </td>
            <td className="px-4 py-3">
              <p className="font-medium">{transaction.description || "—"}</p>
              {transaction.party && transaction.party !== "—" && (
                <p className="mt-0.5 text-xs text-muted-foreground">{transaction.party}</p>
              )}
            </td>
            <td className={`px-4 py-3 text-right font-semibold tabular-nums ${amountClass}`}>
              {sign}${fmtUsd(transaction.amountUsd)}
            </td>
            <td className={`px-5 py-3 text-right tabular-nums ${amountClass}`}>
              {sign}FC {fmtFc(transaction.amountCdf)}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function KindBadge({ kind }: { kind: Kind }) {
  return (
    <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
      kind === "revenue"
        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
        : "bg-rose-500/10 text-rose-700 dark:text-rose-400"
    }`}>
      {kind}
    </span>
  );
}

function MonthTotal({ label, value, strong = false }: { label: string; value: Money; strong?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`${strong ? "font-bold" : "font-semibold"} tabular-nums`}>${fmtUsd(value.usd)}</p>
      <p className="text-[10px] text-muted-foreground tabular-nums">FC {fmtFc(value.cdf)}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-44 items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function toDateKey(iso: string): string {
  const date = new Date(iso);
  const local = new Date(date.getTime() + 2 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function formatDateKey(dateKey: string, locale: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtUsd(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtFc(value: number | null | undefined): string {
  return Math.round(Number(value ?? 0)).toLocaleString("en-US");
}
