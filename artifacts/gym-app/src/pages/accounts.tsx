import { useEffect, useRef, useState } from "react";
import { useGetMe } from "@/hooks/use-me";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Trash2,
  Wallet,
  AlertCircle,
  BookOpen,
  BarChart3,
  Receipt,
  Scale,
  ChevronRight,
  FileText,
  RefreshCw,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useFmtDate } from "@/lib/useFmtDate";


type AccountType = "asset" | "liability" | "income" | "expense" | "equity";
type PeriodFilter = "day" | "month" | "year" | "custom";
type CurrencyView = "USD" | "CDF" | "BOTH";

interface Account {
  id: number;
  name: string;
  type: AccountType;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

interface StatementRow {
  id: number;
  date: string;
  description: string;
  party: string;
  sourceType: string;
  sourceId: number | null;
  amount: number | null;
  currency: string | null;
  debitUsd: number | null;
  creditUsd: number | null;
  debitCdf: number | null;
  creditCdf: number | null;
  exchangeRate: number | null;
  runningBalance: number;
}

interface Statement {
  account: Account;
  rows: StatementRow[];
}

interface EffectiveRow extends StatementRow {
  debitUsd: number;
  creditUsd: number;
  debitCdf: number;
  creditCdf: number;
}

interface DisplayRow extends EffectiveRow {
  inAmount: number;
  outAmount: number;
  balance: number;
}

const TYPE_ORDER: AccountType[] = ["asset", "income", "expense", "liability", "equity"];

const TYPE_CONF: Record<AccountType, {
  label: string;
  plural: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  badge: string;
}> = {
  asset: {
    label: "Asset",
    plural: "Assets",
    icon: Wallet,
    iconBg: "bg-blue-500/10",
    iconColor: "text-blue-500",
    badge: "bg-blue-500/10 text-blue-500",
  },
  income: {
    label: "Income",
    plural: "Income",
    icon: TrendingUp,
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-500",
  },
  expense: {
    label: "Expense",
    plural: "Expenses",
    icon: Receipt,
    iconBg: "bg-rose-500/10",
    iconColor: "text-rose-500",
    badge: "bg-rose-500/10 text-rose-500",
  },
  liability: {
    label: "Liability",
    plural: "Liabilities",
    icon: AlertCircle,
    iconBg: "bg-amber-500/10",
    iconColor: "text-amber-500",
    badge: "bg-amber-500/10 text-amber-500",
  },
  equity: {
    label: "Equity",
    plural: "Equity",
    icon: Scale,
    iconBg: "bg-violet-500/10",
    iconColor: "text-violet-500",
    badge: "bg-violet-500/10 text-violet-500",
  },
};

const numberFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatMoney(value: number, currency: "USD" | "CDF") {
  const sign = value < 0 ? "−" : "";
  const formatted = numberFormat.format(Math.abs(value));
  return currency === "CDF" ? `${sign}FC ${formatted}` : `${sign}$${formatted}`;
}

function localDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getPresetRange(period: Exclude<PeriodFilter, "custom">) {
  const now = new Date();
  if (period === "day") {
    const today = localDateInput(now);
    return { from: today, to: today };
  }
  if (period === "month") {
    return {
      from: localDateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: localDateInput(now),
    };
  }
  return {
    from: localDateInput(new Date(now.getFullYear(), 0, 1)),
    to: localDateInput(now),
  };
}

function logicalSourceType(sourceType: string) {
  return sourceType.replace(/_(correction|reversal)$/i, "");
}

function collapseAccountingRows(rows: StatementRow[]): EffectiveRow[] {
  const groups = new Map<string, StatementRow[]>();

  for (const row of rows) {
    const base = logicalSourceType(row.sourceType || "entry");
    const key = row.sourceId != null ? `${base}:${row.sourceId}` : `row:${row.id}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const EPSILON = 0.000001;
  const effective: EffectiveRow[] = [];

  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => {
      const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
      return dateDiff || a.id - b.id;
    });

    const latest = ordered[ordered.length - 1];
    const original = ordered.find((row) => !/_(correction|reversal)$/i.test(row.sourceType));

    const netUsd = ordered.reduce(
      (sum, row) => sum + Number(row.debitUsd ?? 0) - Number(row.creditUsd ?? 0),
      0,
    );
    const netCdf = ordered.reduce(
      (sum, row) => sum + Number(row.debitCdf ?? 0) - Number(row.creditCdf ?? 0),
      0,
    );

    if (Math.abs(netUsd) < EPSILON && Math.abs(netCdf) < EPSILON) continue;

    const debitSide = Math.abs(netUsd) >= EPSILON ? netUsd > 0 : netCdf > 0;
    effective.push({
      ...latest,
      date: original?.date ?? latest.date,
      description: original?.description || latest.description,
      currency: latest.currency,
      amount: latest.amount,
      exchangeRate: latest.exchangeRate,
      debitUsd: debitSide ? Math.abs(netUsd) : 0,
      creditUsd: debitSide ? 0 : Math.abs(netUsd),
      debitCdf: debitSide ? Math.abs(netCdf) : 0,
      creditCdf: debitSide ? 0 : Math.abs(netCdf),
      runningBalance: 0,
    });
  }

  return effective.sort((a, b) => {
    const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
    return dateDiff || a.id - b.id;
  });
}

function withinDateRange(row: EffectiveRow, from: string, to: string) {
  const date = new Date(row.date);
  if (Number.isNaN(date.getTime())) return false;
  if (from && date < new Date(`${from}T00:00:00`)) return false;
  if (to && date > new Date(`${to}T23:59:59.999`)) return false;
  return true;
}

async function apiFetch(path: string, options?: RequestInit) {
  const token = localStorage.getItem("gym_token");
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
  return fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  });
}

export default function AccountsPage() {
  const { fmtDate } = useFmtDate();
  const me = useGetMe();
  const canView = me?.role === "admin" || me?.permissions?.viewAccounting;
  const canManage = me?.role === "admin";

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Account | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [stmtLoading, setStmtLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const deepLinkHandled = useRef(false);

  const [period, setPeriod] = useState<PeriodFilter>(() => {
    const requested = new URLSearchParams(window.location.search).get("period");
    return requested === "day" || requested === "month" || requested === "year" || requested === "custom"
      ? requested
      : "month";
  });
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [currencyView, setCurrencyView] = useState<CurrencyView>("BOTH");

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", type: "asset" as AccountType, description: "" });
  const [saving, setSaving] = useState(false);
  const [deleteAccountId, setDeleteAccountId] = useState<number | null>(null);

  const preset = period === "custom" ? null : getPresetRange(period);
  const dateFrom = period === "custom" ? customFrom : preset?.from ?? "";
  const dateTo = period === "custom" ? customTo : preset?.to ?? "";

  async function loadAccounts(silent = false) {
    if (!silent) setLoading(true);
    try {
      const response = await apiFetch("/api/accounts/chart");
      if (!response.ok) return;
      const next: Account[] = await response.json();
      setAccounts(next);
      setSelected((current) => {
        if (current) return next.find((account) => account.id === current.id) ?? current;
        if (deepLinkHandled.current) return current;

        deepLinkHandled.current = true;
        const requestedType = new URLSearchParams(window.location.search).get("type");
        if (requestedType && TYPE_ORDER.includes(requestedType as AccountType)) {
          return next.find((account) => account.isActive && account.type === requestedType) ?? null;
        }
        return current;
      });
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadStatement(account: Account, silent = false) {
    if (!silent) setStmtLoading(true);
    try {
      // Always fetch the complete ledger before collapsing corrections. Filtering
      // corrections server-side by date can separate a reversal from its original
      // row and produce a false balance.
      const response = await apiFetch(`/api/accounts/chart/${account.id}/statement`);
      if (!response.ok) return;
      setStatement(await response.json());
      setLastRefresh(new Date());
    } finally {
      if (!silent) setStmtLoading(false);
    }
  }

  useEffect(() => {
    if (canView === undefined) return;
    void loadAccounts();
    const timer = window.setInterval(() => void loadAccounts(true), 60_000);
    return () => window.clearInterval(timer);
  }, [canView]);

  useEffect(() => {
    if (!selected) return;
    void loadStatement(selected);

    const refresh = () => void loadStatement(selected, true);
    const timer = window.setInterval(refresh, 20_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function changePeriod(next: PeriodFilter) {
    if (next === "custom" && !customFrom && !customTo) {
      const month = getPresetRange("month");
      setCustomFrom(month.from);
      setCustomTo(month.to);
    }
    setPeriod(next);
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await apiFetch("/api/accounts/chart", {
        method: "POST",
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        const error = await response.json();
        toast({ title: error.error ?? "Unable to create account", variant: "destructive" });
        return;
      }
      setShowCreate(false);
      setForm({ name: "", type: "asset", description: "" });
      await loadAccounts(true);
      toast({ title: "Account created" });
    } finally {
      setSaving(false);
    }
  }

  async function doDeleteAccount() {
    if (!deleteAccountId) return;
    const id = deleteAccountId;
    const response = await apiFetch(`/api/accounts/chart/${id}`, { method: "DELETE" });
    setDeleteAccountId(null);
    if (!response.ok) {
      toast({ title: "Cannot delete an account with transactions", variant: "destructive" });
      return;
    }
    setAccounts((current) => current.filter((account) => account.id !== id));
    if (selected?.id === id) setSelected(null);
    toast({ title: "Account removed" });
  }

  if (!canView) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
        <AlertCircle className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">You don't have permission to view accounts.</p>
      </div>
    );
  }

  if (selected) {
    const conf = TYPE_CONF[selected.type];
    const Icon = conf.icon;
    const isDebitNormal = selected.type === "asset" || selected.type === "expense";
    const effectiveRows = collapseAccountingRows(statement?.rows ?? []);

    // Build the true all-time account balance first. Date and currency filters below
    // must never change this canonical balance. Every ledger entry keeps both USD
    // and FC/CDF equivalents so the running/current balance can follow the selected
    // display currency without changing the underlying accounting.
    let allTimeBalanceUsd = 0;
    let allTimeBalanceCdf = 0;
    const balanceAfterRowUsd = new Map<number, number>();
    const balanceAfterRowCdf = new Map<number, number>();
    for (const row of effectiveRows) {
      const deltaUsd = isDebitNormal
        ? row.debitUsd - row.creditUsd
        : row.creditUsd - row.debitUsd;
      const deltaCdf = isDebitNormal
        ? row.debitCdf - row.creditCdf
        : row.creditCdf - row.debitCdf;
      allTimeBalanceUsd += deltaUsd;
      allTimeBalanceCdf += deltaCdf;
      balanceAfterRowUsd.set(row.id, allTimeBalanceUsd);
      balanceAfterRowCdf.set(row.id, allTimeBalanceCdf);
    }

    const periodRows = effectiveRows.filter((row) => withinDateRange(row, dateFrom, dateTo));
    const nativeRows = periodRows.filter((row) => {
      const nativeCurrency = (row.currency ?? "USD").toUpperCase();
      if (currencyView === "USD") return nativeCurrency === "USD";
      if (currencyView === "CDF") return nativeCurrency === "CDF";
      return true;
    });

    const displayCurrency: "USD" | "CDF" = currencyView === "CDF" ? "CDF" : "USD";
    const balanceAfterRow = displayCurrency === "CDF" ? balanceAfterRowCdf : balanceAfterRowUsd;
    const allTimeBalance = displayCurrency === "CDF" ? allTimeBalanceCdf : allTimeBalanceUsd;
    const rows: DisplayRow[] = nativeRows.map((row) => {
      const debit = displayCurrency === "CDF" ? row.debitCdf : row.debitUsd;
      const credit = displayCurrency === "CDF" ? row.creditCdf : row.creditUsd;
      const inAmount = isDebitNormal ? debit : credit;
      const outAmount = isDebitNormal ? credit : debit;
      return {
        ...row,
        inAmount,
        outAmount,
        balance: balanceAfterRow.get(row.id) ?? allTimeBalance,
      };
    });

    const totalIn = rows.reduce((sum, row) => sum + row.inAmount, 0);
    const totalOut = rows.reduce((sum, row) => sum + row.outAmount, 0);
    const balance = allTimeBalance;
    const balanceLabel = displayCurrency === "CDF" ? "FC" : "USD";

    return (
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setSelected(null)} className="h-9 gap-1.5">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", conf.iconBg)}>
              <Icon className={cn("h-5 w-5", conf.iconColor)} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold tracking-tight">{selected.name}</h1>
              <div className="mt-0.5 flex items-center gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", conf.badge)}>{conf.label}</span>
                {selected.description && <span className="truncate text-xs text-muted-foreground">{selected.description}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className={cn("h-3.5 w-3.5", stmtLoading && "animate-spin")} />
            <span>Auto-refresh 20s{lastRefresh ? ` · ${lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex min-h-[112px] flex-col justify-between rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Total In</span>
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="mt-3 text-right text-2xl font-bold tabular-nums text-emerald-500">{formatMoney(totalIn, displayCurrency)}</p>
          </div>
          <div className="flex min-h-[112px] flex-col justify-between rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Total Out</span>
              <TrendingDown className="h-4 w-4 text-rose-500" />
            </div>
            <p className="mt-3 text-right text-2xl font-bold tabular-nums text-rose-500">{formatMoney(totalOut, displayCurrency)}</p>
          </div>
          <div className="flex min-h-[112px] flex-col justify-between rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-muted-foreground">Balance</span>
                <p className="mt-0.5 text-[11px] text-muted-foreground/70">Current · all time · {balanceLabel}</p>
              </div>
              <BarChart3 className="h-4 w-4 text-blue-500" />
            </div>
            <p className={cn("mt-3 text-right text-2xl font-bold tabular-nums", balance < 0 ? "text-rose-500" : "text-blue-500")}>
              {formatMoney(balance, displayCurrency)}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted/50 p-1">
              {(["day", "month", "year", "custom"] as PeriodFilter[]).map((value) => (
                <Button
                  key={value}
                  variant={period === value ? "default" : "ghost"}
                  size="sm"
                  className="h-8 capitalize"
                  onClick={() => changePeriod(value)}
                >
                  {value}
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted/50 p-1">
              <Button
                variant={currencyView === "USD" ? "default" : "ghost"}
                size="sm"
                className="h-8 min-w-16"
                onClick={() => setCurrencyView("USD")}
              >
                USD
              </Button>
              <Button
                variant={currencyView === "CDF" ? "default" : "ghost"}
                size="sm"
                className="h-8 min-w-20"
                onClick={() => setCurrencyView("CDF")}
              >
                CFA / FC
              </Button>
              <Button
                variant={currencyView === "BOTH" ? "default" : "ghost"}
                size="sm"
                className="h-8 min-w-24"
                onClick={() => setCurrencyView("BOTH")}
              >
                Both (USD)
              </Button>
            </div>
          </div>

          {period === "custom" && (
            <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <Label className="w-10 text-xs text-muted-foreground">From</Label>
                <Input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="h-9 sm:w-40" />
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-10 text-xs text-muted-foreground">To</Label>
                <Input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="h-9 sm:w-40" />
              </div>
            </div>
          )}

          <p className="mt-2 text-xs text-muted-foreground">
            {currencyView === "USD" && "Showing only transactions originally paid in USD. Current and running balances are shown in USD."}
            {currencyView === "CDF" && "Showing only transactions originally paid in FC/CDF, with no USD conversion. Current and running balances are shown in FC/CDF."}
            {currencyView === "BOTH" && "Showing USD and FC/CDF transactions together in USD using each transaction's saved exchange rate. Current and running balances are shown in USD."}
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="w-[150px] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</th>
                  <th className="w-[150px] px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">In</th>
                  <th className="w-[150px] px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Out</th>
                  <th className="w-[170px] px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Balance ({balanceLabel})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {stmtLoading && !statement && (
                  <tr><td colSpan={5} className="py-16 text-center text-muted-foreground">Loading account…</td></tr>
                )}
                {!stmtLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-16 text-center">
                      <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
                      <p className="font-medium text-muted-foreground">No transactions for this view</p>
                      <p className="mt-1 text-xs text-muted-foreground/60">Try another period or currency.</p>
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr key={`${row.sourceType}-${row.sourceId ?? row.id}-${row.id}`} className="transition-colors hover:bg-muted/20">
                    <td className="whitespace-nowrap px-4 py-3.5 align-middle font-medium tabular-nums">{fmtDate(row.date)}</td>
                    <td className="px-4 py-3.5 align-middle">
                      <p className="truncate" title={row.description || ""}>{row.description || "—"}</p>
                    </td>
                    <td className="px-4 py-3.5 text-right align-middle tabular-nums">
                      {row.inAmount > 0 ? <span className="font-semibold text-emerald-500">{formatMoney(row.inAmount, displayCurrency)}</span> : <span className="text-muted-foreground/30">—</span>}
                    </td>
                    <td className="px-4 py-3.5 text-right align-middle tabular-nums">
                      {row.outAmount > 0 ? <span className="font-semibold text-rose-500">{formatMoney(row.outAmount, displayCurrency)}</span> : <span className="text-muted-foreground/30">—</span>}
                    </td>
                    <td className={cn("px-4 py-3.5 text-right align-middle font-semibold tabular-nums", row.balance < 0 && "text-rose-500")}>
                      {formatMoney(row.balance, displayCurrency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 border-t border-border bg-muted/20 px-4 py-3 text-sm">
              <span className="mr-auto text-muted-foreground">{rows.length.toLocaleString()} transactions</span>
              <span className="font-medium text-emerald-500">In {formatMoney(totalIn, displayCurrency)}</span>
              <span className="font-medium text-rose-500">Out {formatMoney(totalOut, displayCurrency)}</span>
              <span className="font-bold">Current balance {formatMoney(balance, displayCurrency)}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  const activeAccounts = accounts.filter((account) => account.isActive);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        icon={BookOpen}
        iconClass="bg-indigo-500/10 text-indigo-500"
        title="Accounts"
        subtitle="Income, expenses, cash and other account ledgers"
        actions={canManage ? (
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="h-4 w-4" /> New Account
          </Button>
        ) : undefined}
      />

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading accounts…</div>
        ) : activeAccounts.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">No accounts yet.</div>
        ) : (
          <div className="divide-y divide-border/50">
            {activeAccounts.map((account) => {
              const conf = TYPE_CONF[account.type];
              const Icon = conf.icon;
              return (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => setSelected(account)}
                  className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/30"
                >
                  <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", conf.iconBg)}>
                    <Icon className={cn("h-4 w-4", conf.iconColor)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold">{account.name}</p>
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", conf.badge)}>{conf.label}</span>
                    </div>
                    {account.description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{account.description}</p>}
                  </div>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-rose-500"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteAccountId(account.id);
                      }}
                      aria-label={`Delete ${account.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Account</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="account-name">Name</Label>
              <Input
                id="account-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="e.g. Cash, Rent Expense"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-type">Type</Label>
              <select
                id="account-type"
                value={form.type}
                onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as AccountType }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {TYPE_ORDER.map((type) => <option key={type} value={type}>{TYPE_CONF[type].label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-description">Description</Label>
              <Input
                id="account-description"
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Optional"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={saving || !form.name.trim()}>{saving ? "Creating…" : "Create"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteAccountId !== null} onOpenChange={(open) => !open && setDeleteAccountId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this account?</AlertDialogTitle>
            <AlertDialogDescription>
              Accounts with transactions cannot be removed. Empty accounts will be deactivated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doDeleteAccount()} className="bg-rose-600 text-white hover:bg-rose-700">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
