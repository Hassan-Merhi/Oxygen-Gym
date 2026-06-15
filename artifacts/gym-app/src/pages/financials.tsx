import { useState, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { useGetMe } from "@/hooks/use-me";
import { TOKEN_KEY } from "@/lib/auth-context";
import {
  useGetAccountSummary,
  useGetProfitLoss,
} from "@workspace/api-client-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Printer,
  AlertCircle,
} from "lucide-react";

const PERIODS = ["today", "month", "last_month", "year", "custom"] as const;
type Period = (typeof PERIODS)[number];

export default function Financials() {
  const { t } = useI18n();
  const me = useGetMe();

  const canView = me?.role === "admin" || me?.permissions?.viewAccounting;
  const canViewProfit = me?.role === "admin" || me?.permissions?.viewProfit;

  const summaryQuery = useGetAccountSummary({ query: { enabled: canView, queryKey: ["accounts-summary"] } });
  const summary = summaryQuery.data;

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3">
        <AlertCircle className="w-10 h-10 text-muted-foreground" />
        <p className="text-muted-foreground">{t("acc.restricted")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BarChart3}
        iconClass="bg-violet-500/10 text-violet-600"
        title={t("acc.title")}
      />

      {/* Account cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <AccCard
          icon={<Wallet className="w-5 h-5 text-indigo-600" />}
          label={t("acc.card.cash")}
          mainValue={`$${fmt(summary?.cash.balanceUsd)}`}
          subValue={`${fmtCdf(summary?.cash.balanceCdf)} CDF`}
          todayLabel={t("acc.today")}
          todayValue={`$${fmt(summary?.cash.todayInUsd)} / $${fmt(summary?.cash.todayOutUsd)}`}
          monthLabel={t("acc.month")}
          monthValue={`$${fmt(summary?.cash.monthInUsd)} / $${fmt(summary?.cash.monthOutUsd)}`}
          color="indigo"
        />
        <AccCard
          icon={<TrendingUp className="w-5 h-5 text-emerald-600" />}
          label={t("acc.card.sales")}
          mainValue={`$${fmt(summary?.sales.monthUsd)}`}
          subValue={`${fmtCdf(summary?.sales.monthCdf)} CDF`}
          todayLabel={t("acc.today")}
          todayValue={`$${fmt(summary?.sales.todayUsd)}`}
          monthLabel={t("acc.month")}
          monthValue={`$${fmt(summary?.sales.monthUsd)}`}
          color="emerald"
        />
        <AccCard
          icon={<TrendingDown className="w-5 h-5 text-rose-600" />}
          label={t("acc.card.expenses")}
          mainValue={`$${fmt(summary?.expenses.monthUsd)}`}
          subValue={`${fmtCdf(summary?.expenses.monthCdf)} CDF`}
          todayLabel={t("acc.today")}
          todayValue={`$${fmt(summary?.expenses.todayUsd)}`}
          monthLabel={t("acc.month")}
          monthValue={`$${fmt(summary?.expenses.monthUsd)}`}
          color="rose"
        />
        {canViewProfit ? (
          <AccCard
            icon={<BarChart3 className="w-5 h-5 text-blue-600" />}
            label={t("acc.card.profit")}
            mainValue={`$${fmt(summary?.profit.monthUsd)}`}
            subValue={`${fmtCdf(summary?.profit.monthCdf)} CDF`}
            todayLabel={t("acc.today")}
            todayValue={`$${fmt(summary?.profit.todayUsd)}`}
            monthLabel={t("acc.month")}
            monthValue={`$${fmt(summary?.profit.monthUsd)}`}
            color="blue"
            profit
          />
        ) : (
          <div className="rounded-xl border border-border bg-muted/30 p-4 flex items-center justify-center">
            <span className="text-xs text-muted-foreground text-center">{t("acc.profitRestricted")}</span>
          </div>
        )}
      </div>

      {canViewProfit ? (
        <ProfitLossTab t={t} />
      ) : (
        <div className="rounded-xl border border-border bg-muted/30 p-8 flex items-center justify-center">
          <span className="text-sm text-muted-foreground">{t("acc.profitRestricted")}</span>
        </div>
      )}
    </div>
  );
}

// ── Profit / Loss ─────────────────────────────────────────────────────────────

interface DetailRow {
  id: string;
  date: string;
  description: string;
  party: string;
  amount: number;
  currency: string;
  amountUsd: number;
  sourceType: string;
}

function ProfitLossTab({ t }: { t: (k: string) => string }) {
  const [period, setPeriod] = useState<Period>("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [catDetails, setCatDetails] = useState<Record<string, DetailRow[]>>({});
  const [catLoading, setCatLoading] = useState<Record<string, boolean>>({});

  const fetchCategoryDetails = useCallback(
    async (cat: string, from: string, to: string) => {
      const cacheKey = `${cat}::${from.slice(0, 10)}::${to.slice(0, 10)}`;
      if (catDetails[cacheKey]) return; // already loaded for this period
      setCatLoading((prev) => ({ ...prev, [cacheKey]: true }));
      try {
        const token = localStorage.getItem(TOKEN_KEY);
        const authHeaders: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const params = new URLSearchParams({ dateFrom: from.slice(0, 10), dateTo: to.slice(0, 10), limit: "200" });
        const [salesRes, expRes] = await Promise.all([
          fetch(`/api/accounts/sales?${params}`, { headers: authHeaders }),
          fetch(`/api/accounts/expenses?${params}`, { headers: authHeaders }),
        ]);
        const salesJson = salesRes.ok ? await salesRes.json() : { items: [] };
        const expJson = expRes.ok ? await expRes.json() : { items: [] };

        // Normalize both API shapes into one DetailRow shape.
        // Sales endpoint: raw DB rows → paymentDate, notes, memberName, linkedEntityName.
        // Expenses endpoint: normalized rows → date, description, party.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const normalize = (r: any): DetailRow => ({
          id: r.id,
          date: r.date ?? r.paymentDate ?? r.voucherDate ?? "",
          description: r.description ?? r.notes ?? r.category ?? "",
          party: r.party ?? r.memberName ?? r.linkedEntityName ?? "",
          amount: Number(r.amount ?? 0),
          currency: r.currency ?? "USD",
          amountUsd: Number(r.amountUsd ?? 0),
          sourceType: r.sourceType ?? "payment",
        });

        const matchCat = cat.toLowerCase().replace(/[_ ]/g, "");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const filterByCat = (raw: any[]) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          raw.filter((r: any) => {
            const rowCat = (r.category ?? r.voucherType ?? "").toLowerCase().replace(/[_ ]/g, "");
            return rowCat === matchCat;
          }).map(normalize);

        const catRows: DetailRow[] = [
          ...filterByCat(salesJson.items ?? []),
          ...filterByCat(expJson.items ?? []),
        ].sort((a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime());

        setCatDetails((prev) => ({ ...prev, [cacheKey]: catRows }));
      } finally {
        setCatLoading((prev) => ({ ...prev, [cacheKey]: false }));
      }
    },
    [catDetails],
  );

  function toggleCat(cat: string, from: string, to: string) {
    if (expandedCat === cat) {
      setExpandedCat(null);
    } else {
      setExpandedCat(cat);
      fetchCategoryDetails(cat, from, to);
    }
  }

  const query = useGetProfitLoss({
    period,
    ...(period === "custom" && dateFrom && { dateFrom }),
    ...(period === "custom" && dateTo && { dateTo }),
  });

  const pl = query.data;

  function printReport() {
    if (!pl) return;
    const breakdownRows = Object.entries(pl.breakdown)
      .map(([cat, v]) => `<tr><td>${cat}</td><td>${v.usd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td><td>${v.cdf.toLocaleString(undefined, { minimumFractionDigits: 0 })}</td></tr>`)
      .join("");

    const content = `
      <h2>Profit / Loss — ${pl.period}</h2>
      <p>${new Date(pl.dateFrom).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} — ${new Date(pl.dateTo).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr style="background:#f0f0f0"><td style="padding:8px;font-weight:600">Item</td><td style="padding:8px;font-weight:600">USD</td><td style="padding:8px;font-weight:600">CDF</td></tr>
        <tr><td style="padding:8px">Revenue</td><td style="padding:8px">${pl.revenue.usd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td><td style="padding:8px">${pl.revenue.cdf.toLocaleString(undefined, { minimumFractionDigits: 0 })}</td></tr>
        <tr><td style="padding:8px">Expenses</td><td style="padding:8px">${pl.expenses.usd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td><td style="padding:8px">${pl.expenses.cdf.toLocaleString(undefined, { minimumFractionDigits: 0 })}</td></tr>
        <tr style="background:#f0f0f0;font-weight:bold"><td style="padding:8px">Net Profit / Loss</td><td style="padding:8px;color:${pl.net.usd >= 0 ? "green" : "red"}">${pl.net.usd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td><td style="padding:8px;color:${pl.net.cdf >= 0 ? "green" : "red"}">${pl.net.cdf.toLocaleString(undefined, { minimumFractionDigits: 0 })}</td></tr>
      </table>
      <h3>Category Breakdown</h3>
      <table style="width:100%;border-collapse:collapse;">
        <tr style="background:#f0f0f0"><td style="padding:8px;font-weight:600">Category</td><td style="padding:8px;font-weight:600">USD</td><td style="padding:8px;font-weight:600">CDF</td></tr>
        ${breakdownRows}
      </table>
    `;
    const w = window.open("", "_blank", "width=800,height=600");
    if (w) {
      w.document.write(`<html><head><title>P&L Report</title><style>body{font-family:Arial,sans-serif;padding:40px;}table{width:100%;}td{border:1px solid #ddd;}</style></head><body>${content}</body></html>`);
      w.document.close();
      w.print();
    }
  }

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">{t("acc.period")}:</span>
        <div className="flex gap-2 flex-wrap">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm rounded-full font-medium transition-colors ${
                period === p
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {t(`acc.${p === "last_month" ? "lastMonth" : p}`)}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <>
            <Input type="date" className="w-36" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span className="text-muted-foreground">→</span>
            <Input type="date" className="w-36" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </>
        )}
        <Button variant="outline" size="sm" onClick={printReport} className="gap-2 ml-auto">
          <Printer className="w-4 h-4" />{t("acc.print")}
        </Button>
      </div>

      {query.isLoading ? (
        <p className="text-muted-foreground py-8 text-center">{t("common.loading")}</p>
      ) : pl ? (
        <>
          {/* P&L Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <PLCard label={t("acc.pl.revenue")} usd={pl.revenue.usd} cdf={pl.revenue.cdf} color="emerald" />
            <PLCard label={t("acc.pl.expenses")} usd={pl.expenses.usd} cdf={pl.expenses.cdf} color="rose" />
            <PLCard label={t("acc.pl.net")} usd={pl.net.usd} cdf={pl.net.cdf} color={pl.net.usd >= 0 ? "emerald" : "rose"} large />
          </div>

          {/* Category breakdown — expandable */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">{t("acc.pl.breakdown")}</h3>

            {/* Mobile card rows — shown below md */}
            <div className="md:hidden rounded-xl border border-border overflow-hidden bg-card divide-y divide-border/40">
              {Object.entries(pl.breakdown).map(([cat, v]) => (
                <div key={cat} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full capitalize">
                      {cat.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold text-sm tabular-nums">{fmt(v.usd)}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">{fmtCdf(v.cdf)} CDF</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop expandable table — hidden on mobile */}
            <div className="hidden md:block rounded-xl border border-border overflow-hidden bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground w-8"></th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("acc.col.category")}</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">USD</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">CDF</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(pl.breakdown).map(([cat, v]) => {
                    const isOpen = expandedCat === cat;
                    const cacheKey = `${cat}::${pl.dateFrom.slice(0, 10)}::${pl.dateTo.slice(0, 10)}`;
                    const rows = catDetails[cacheKey] ?? [];
                    const loading = catLoading[cacheKey];
                    return (
                      <>
                        <tr
                          key={cat}
                          className="border-b border-border/50 hover:bg-muted/20 cursor-pointer select-none"
                          onClick={() => toggleCat(cat, pl.dateFrom, pl.dateTo)}
                        >
                          <td className="px-4 py-3 text-muted-foreground">
                            <span className={`inline-block transition-transform duration-150 text-xs ${isOpen ? "rotate-90" : ""}`}>▶</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full capitalize">{cat.replace(/_/g, " ")}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold">{fmt(v.usd)}</td>
                          <td className="px-4 py-3 text-right text-muted-foreground">{fmtCdf(v.cdf)}</td>
                        </tr>
                        {isOpen && (
                          <tr key={`${cat}-detail`} className="bg-muted/10">
                            <td colSpan={4} className="px-0 py-0">
                              {loading ? (
                                <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>
                              ) : rows.length === 0 ? (
                                <p className="text-xs text-muted-foreground text-center py-4">No transactions found for this category in this period.</p>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs border-t border-border/40 min-w-[560px]">
                                    <thead>
                                      <tr className="bg-muted/30">
                                        <th className="text-left px-8 py-2 font-medium text-muted-foreground">Date</th>
                                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Description</th>
                                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Party</th>
                                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Amount</th>
                                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">USD</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {rows.map((r) => (
                                        <tr key={r.id} className="border-t border-border/20 hover:bg-muted/20">
                                          <td className="px-8 py-2 tabular-nums text-muted-foreground">
                                            {new Date(r.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                                          </td>
                                          <td className="px-4 py-2 max-w-[200px] truncate">{r.description ?? "—"}</td>
                                          <td className="px-4 py-2 text-muted-foreground">{r.party ?? "—"}</td>
                                          <td className="px-4 py-2 text-right tabular-nums">
                                            {Number(r.amount).toLocaleString()} <span className="text-muted-foreground">{r.currency}</span>
                                          </td>
                                          <td className="px-4 py-2 text-right tabular-nums font-medium">{fmt(Number(r.amountUsd))}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── Shared components ─────────────────────────────────────────────────────────

function AccCard({
  icon, label, mainValue, subValue, todayLabel, todayValue, monthLabel, monthValue, color, profit,
}: {
  icon: React.ReactNode;
  label: string;
  mainValue: string;
  subValue: string;
  todayLabel: string;
  todayValue: string;
  monthLabel: string;
  monthValue: string;
  color: "indigo" | "emerald" | "rose" | "blue";
  profit?: boolean;
}) {
  const bg = { indigo: "bg-indigo-50 border-indigo-100", emerald: "bg-emerald-50 border-emerald-100", rose: "bg-rose-50 border-rose-100", blue: "bg-blue-50 border-blue-100" }[color];
  const isNeg = profit && mainValue.startsWith("-") || (mainValue.includes("-0") && mainValue !== "$0.00");
  return (
    <div className={`rounded-xl border p-4 ${bg}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <p className={`text-xl font-bold ${profit && isNeg ? "text-rose-700" : "text-foreground"}`}>{mainValue}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{subValue}</p>
      <div className="mt-3 pt-3 border-t border-black/5 space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{todayLabel}</span>
          <span className="font-medium">{todayValue}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{monthLabel}</span>
          <span className="font-medium">{monthValue}</span>
        </div>
      </div>
    </div>
  );
}

function PLCard({ label, usd, cdf, color, large }: { label: string; usd: number; cdf: number; color: "emerald" | "rose"; large?: boolean }) {
  const bg = color === "emerald" ? "bg-emerald-50 border-emerald-100" : "bg-rose-50 border-rose-100";
  const textColor = color === "emerald" ? "text-emerald-700" : "text-rose-700";
  return (
    <div className={`rounded-xl border p-5 ${bg}`}>
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <p className={`${large ? "text-3xl" : "text-2xl"} font-bold ${textColor}`}>${fmt(usd)}</p>
      <p className="text-sm text-muted-foreground mt-0.5">{fmtCdf(cdf)} CDF</p>
    </div>
  );
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCdf(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Math.round(n).toLocaleString();
}

function printTable(title: string, headers: string[], rows: string) {
  const w = window.open("", "_blank", "width=900,height=600");
  if (!w) return;
  w.document.write(`<html><head><title>${title}</title><style>
    body{font-family:Arial,sans-serif;padding:32px;}
    h2{margin-bottom:4px;}
    table{width:100%;border-collapse:collapse;font-size:13px;margin-top:16px;}
    th{background:#f0f0f0;padding:8px;border:1px solid #ccc;text-align:left;}
    td{padding:7px 8px;border:1px solid #e5e5e5;}
    @media print{button{display:none;}}
  </style></head><body>
    <h2>${title}</h2>
    <p style="color:#666;font-size:12px">Printed: ${new Date().toLocaleString()}</p>
    <table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
  </body></html>`);
  w.document.close();
  w.print();
}
