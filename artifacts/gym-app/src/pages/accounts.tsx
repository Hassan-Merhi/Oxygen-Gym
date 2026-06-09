import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useGetMe } from "@/hooks/use-me";
import {
  useGetAccountSummary,
  useListLedger,
  useListSalesEntries,
  useListExpenseEntries,
  useGetProfitLoss,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Search,
  ChevronLeft,
  ChevronRight,
  Printer,
  ArrowDownCircle,
  ArrowUpCircle,
  AlertCircle,
} from "lucide-react";

const PERIODS = ["today", "month", "last_month", "year", "custom"] as const;
type Period = (typeof PERIODS)[number];

export default function Accounts() {
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
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <h1 className="text-2xl font-bold text-foreground">{t("acc.title")}</h1>

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

      {/* Tabs */}
      <Tabs defaultValue="cash">
        <TabsList className="mb-4">
          <TabsTrigger value="cash">{t("acc.tab.cash")}</TabsTrigger>
          <TabsTrigger value="sales">{t("acc.tab.sales")}</TabsTrigger>
          <TabsTrigger value="expenses">{t("acc.tab.expenses")}</TabsTrigger>
          {canViewProfit && <TabsTrigger value="pl">{t("acc.tab.pl")}</TabsTrigger>}
        </TabsList>

        <TabsContent value="cash">
          <CashLedgerTab t={t} />
        </TabsContent>

        <TabsContent value="sales">
          <SalesTab t={t} />
        </TabsContent>

        <TabsContent value="expenses">
          <ExpensesTab t={t} />
        </TabsContent>

        {canViewProfit && (
          <TabsContent value="pl">
            <ProfitLossTab t={t} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ── Cash Ledger Tab ────────────────────────────────────────────────────────────

function CashLedgerTab({ t }: { t: (k: string) => string }) {
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const limit = 50;

  const query = useListLedger({
    page,
    limit,
    ...(direction !== "all" && { direction }),
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  function printReport() {
    const rows = items.map((r) =>
      `<tr><td>${new Date(r.entryDate).toLocaleDateString()}</td><td>${r.sourceType}</td><td>${r.sourceNumber ?? ""}</td><td>${r.description ?? ""}</td><td>${r.direction === "in" ? "▲" : "▼"}</td><td>${r.amount.toLocaleString()} ${r.currency}</td><td>${r.amountUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td><td>${r.balanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td><td>${r.createdBy ?? ""}</td></tr>`
    ).join("");
    printTable("Cash Ledger Report", ["Date", "Source", "Ref#", "Description", "Dir", "Amount", "USD", "Balance USD", "By"], rows);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder={t("acc.col.description")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={direction} onValueChange={(v) => { setDirection(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("acc.col.direction")}</SelectItem>
            <SelectItem value="in">{t("acc.in")}</SelectItem>
            <SelectItem value="out">{t("acc.out")}</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" className="w-36" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
        <Input type="date" className="w-36" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        <Button variant="outline" size="sm" onClick={printReport} className="gap-2">
          <Printer className="w-4 h-4" />{t("acc.print")}
        </Button>
      </div>

      <DataTable
        loading={query.isLoading}
        empty={t("acc.empty")}
        emptyHint={t("acc.emptyHint")}
        cols={[
          t("acc.col.date"), t("acc.col.source"), t("acc.col.number"),
          t("acc.col.description"), t("acc.col.direction"),
          t("acc.col.amount"), t("acc.col.currency"),
          t("acc.col.usd"), t("acc.col.cdf"),
          t("acc.col.balanceUsd"), t("acc.col.balanceCdf"),
          t("acc.col.by"),
        ]}
        rows={items.map((r) => [
          <span className="text-xs">{new Date(r.entryDate).toLocaleDateString()}</span>,
          <span className="text-xs font-medium">{r.sourceType}</span>,
          <span className="font-mono text-xs text-muted-foreground">{r.sourceNumber ?? "—"}</span>,
          <span className="text-xs max-w-[140px] truncate block">{r.description ?? "—"}</span>,
          r.direction === "in"
            ? <Badge className="bg-emerald-100 text-emerald-700 border-0 gap-1 text-xs"><ArrowDownCircle className="w-3 h-3" />{t("acc.in")}</Badge>
            : <Badge className="bg-rose-100 text-rose-700 border-0 gap-1 text-xs"><ArrowUpCircle className="w-3 h-3" />{t("acc.out")}</Badge>,
          <span className="font-semibold text-sm">{r.amount.toLocaleString()}</span>,
          <span className="text-xs text-muted-foreground">{r.currency}</span>,
          <span className="text-xs">{fmt(r.amountUsd)}</span>,
          <span className="text-xs">{fmtCdf(r.amountCdf)}</span>,
          <span className={`text-xs font-semibold ${r.balanceUsd >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{fmt(r.balanceUsd)}</span>,
          <span className="text-xs text-muted-foreground">{fmtCdf(r.balanceCdf)}</span>,
          <span className="text-xs text-muted-foreground">{r.createdBy ?? "—"}</span>,
        ])}
      />
      <Pagination page={page} totalPages={totalPages} total={total} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} t={t} />
    </div>
  );
}

// ── Sales Tab ─────────────────────────────────────────────────────────────────

function SalesTab({ t }: { t: (k: string) => string }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currency, setCurrency] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const limit = 50;

  const query = useListSalesEntries({
    page, limit,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(currency !== "all" && { currency }),
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  function handleSearch(v: string) {
    setSearch(v);
    clearTimeout((window as unknown as Record<string, ReturnType<typeof setTimeout>>)._salesTimer);
    (window as unknown as Record<string, ReturnType<typeof setTimeout>>)._salesTimer = setTimeout(() => { setDebouncedSearch(v); setPage(1); }, 400);
  }

  const totalUsd = items.reduce((s, r) => s + (r.amountUsd ?? 0), 0);
  const totalCdf = items.reduce((s, r) => s + (r.amountCdf ?? 0), 0);

  function printReport() {
    const rows = items.map((r) =>
      `<tr><td>${new Date(r.paymentDate).toLocaleDateString()}</td><td>${r.paymentNumber ?? ""}</td><td>${r.memberName ?? r.linkedEntityName ?? ""}</td><td>${r.planName ?? ""}</td><td>${r.category}</td><td>${r.amount.toLocaleString()} ${r.currency}</td><td>${(r.amountUsd ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td><td>${r.createdBy ?? ""}</td></tr>`
    ).join("");
    printTable("Sales Report", ["Date", "Ref#", "Member / Party", "Plan", "Category", "Amount", "USD", "By"], rows);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder={t("acc.col.description")} value={search} onChange={(e) => handleSearch(e.target.value)} />
        </div>
        <Select value={currency} onValueChange={(v) => { setCurrency(v); setPage(1); }}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
            <SelectItem value="CDF">CDF</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" className="w-36" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
        <Input type="date" className="w-36" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        <Button variant="outline" size="sm" onClick={printReport} className="gap-2">
          <Printer className="w-4 h-4" />{t("acc.print")}
        </Button>
      </div>

      {items.length > 0 && (
        <div className="flex gap-6 text-sm px-1">
          <span className="text-muted-foreground">Total: <strong className="text-foreground">${fmt(totalUsd)}</strong></span>
          <span className="text-muted-foreground">CDF: <strong className="text-foreground">{fmtCdf(totalCdf)}</strong></span>
        </div>
      )}

      <DataTable
        loading={query.isLoading}
        empty={t("acc.empty")}
        emptyHint={t("acc.emptyHint")}
        cols={[t("acc.col.date"), t("acc.col.number"), t("acc.col.member"), t("acc.col.plan"), t("acc.col.category"), t("acc.col.amount"), t("acc.col.usd"), t("acc.col.cdf"), t("acc.col.by")]}
        rows={items.map((r) => [
          <span className="text-xs">{new Date(r.paymentDate).toLocaleDateString()}</span>,
          <span className="font-mono text-xs text-muted-foreground">{r.paymentNumber ?? "—"}</span>,
          <span className="text-sm">{r.memberName ?? r.linkedEntityName ?? "—"}</span>,
          <span className="text-xs text-muted-foreground">{r.planName ?? "—"}</span>,
          <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">{r.category}</span>,
          <span className="font-semibold">{r.amount.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">{r.currency}</span></span>,
          <span className="text-xs">{fmt(r.amountUsd)}</span>,
          <span className="text-xs text-muted-foreground">{fmtCdf(r.amountCdf)}</span>,
          <span className="text-xs text-muted-foreground">{r.createdBy ?? "—"}</span>,
        ])}
      />
      <Pagination page={page} totalPages={totalPages} total={total} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} t={t} />
    </div>
  );
}

// ── Expenses Tab ──────────────────────────────────────────────────────────────

function ExpensesTab({ t }: { t: (k: string) => string }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currency, setCurrency] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const limit = 50;

  const query = useListExpenseEntries({
    page, limit,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(currency !== "all" && { currency }),
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  function handleSearch(v: string) {
    setSearch(v);
    clearTimeout((window as unknown as Record<string, ReturnType<typeof setTimeout>>)._expTimer);
    (window as unknown as Record<string, ReturnType<typeof setTimeout>>)._expTimer = setTimeout(() => { setDebouncedSearch(v); setPage(1); }, 400);
  }

  const totalUsd = items.reduce((s, r) => s + r.amountUsd, 0);
  const totalCdf = items.reduce((s, r) => s + r.amountCdf, 0);

  function printReport() {
    const rows = items.map((r) =>
      `<tr><td>${new Date(r.date).toLocaleDateString()}</td><td>${r.sourceType}</td><td>${r.sourceNumber ?? ""}</td><td>${r.party ?? ""}</td><td>${r.category ?? ""}</td><td>${r.description ?? ""}</td><td>${r.amount.toLocaleString()} ${r.currency}</td><td>${r.amountUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td><td>${r.createdBy ?? ""}</td></tr>`
    ).join("");
    printTable("Expense Report", ["Date", "Source", "Ref#", "Party", "Category", "Description", "Amount", "USD", "By"], rows);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder={t("acc.col.description")} value={search} onChange={(e) => handleSearch(e.target.value)} />
        </div>
        <Select value={currency} onValueChange={(v) => { setCurrency(v); setPage(1); }}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
            <SelectItem value="CDF">CDF</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" className="w-36" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
        <Input type="date" className="w-36" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        <Button variant="outline" size="sm" onClick={printReport} className="gap-2">
          <Printer className="w-4 h-4" />{t("acc.print")}
        </Button>
      </div>

      {items.length > 0 && (
        <div className="flex gap-6 text-sm px-1">
          <span className="text-muted-foreground">Total: <strong className="text-foreground">${fmt(totalUsd)}</strong></span>
          <span className="text-muted-foreground">CDF: <strong className="text-foreground">{fmtCdf(totalCdf)}</strong></span>
        </div>
      )}

      <DataTable
        loading={query.isLoading}
        empty={t("acc.empty")}
        emptyHint={t("acc.emptyHint")}
        cols={[t("acc.col.date"), t("acc.col.source"), t("acc.col.number"), t("acc.col.description"), t("acc.col.member"), t("acc.col.category"), t("acc.col.amount"), t("acc.col.usd"), t("acc.col.by")]}
        rows={items.map((r) => [
          <span className="text-xs">{new Date(r.date).toLocaleDateString()}</span>,
          <span className="text-xs font-medium capitalize">{r.sourceType}</span>,
          <span className="font-mono text-xs text-muted-foreground">{r.sourceNumber ?? "—"}</span>,
          <span className="text-xs max-w-[160px] truncate block">{r.description ?? "—"}</span>,
          <span className="text-sm">{r.party ?? "—"}</span>,
          <span className="text-xs text-muted-foreground">{r.category ?? "—"}</span>,
          <span className="font-semibold">{r.amount.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">{r.currency}</span></span>,
          <span className="text-xs">{fmt(r.amountUsd)}</span>,
          <span className="text-xs text-muted-foreground">{r.createdBy ?? "—"}</span>,
        ])}
      />
      <Pagination page={page} totalPages={totalPages} total={total} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} t={t} />
    </div>
  );
}

// ── Profit / Loss Tab ─────────────────────────────────────────────────────────

function ProfitLossTab({ t }: { t: (k: string) => string }) {
  const [period, setPeriod] = useState<Period>("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

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
      <p>${new Date(pl.dateFrom).toLocaleDateString()} — ${new Date(pl.dateTo).toLocaleDateString()}</p>
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

          {/* Category breakdown */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">{t("acc.pl.breakdown")}</h3>
            <div className="rounded-xl border border-border overflow-hidden bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("acc.col.category")}</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">USD</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">CDF</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(pl.breakdown).map(([cat, v]) => (
                    <tr key={cat} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full capitalize">{cat}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{fmt(v.usd)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{fmtCdf(v.cdf)}</td>
                    </tr>
                  ))}
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

function DataTable({
  loading, empty, emptyHint, cols, rows,
}: {
  loading: boolean;
  empty: string;
  emptyHint: string;
  cols: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {cols.map((c, i) => (
                <th key={i} className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cols.length} className="text-center py-12 text-muted-foreground">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={cols.length} className="text-center py-16">
                  <p className="text-muted-foreground font-medium">{empty}</p>
                  <p className="text-muted-foreground/60 text-xs mt-1">{emptyHint}</p>
                </td>
              </tr>
            ) : rows.map((row, ri) => (
              <tr key={ri} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-4 py-3">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Pagination({ page, totalPages, total, onPrev, onNext, t }: {
  page: number; totalPages: number; total: number; onPrev: () => void; onNext: () => void; t: (k: string) => string;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{total} {t("members.total")}</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onPrev} disabled={page === 1}><ChevronLeft className="w-4 h-4" /></Button>
        <span className="text-sm">{t("common.page")} {page} {t("common.of")} {totalPages}</span>
        <Button variant="outline" size="sm" onClick={onNext} disabled={page === totalPages}><ChevronRight className="w-4 h-4" /></Button>
      </div>
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
