import { useState, useEffect } from "react";
import { useGetMe } from "@/hooks/use-me";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Printer,
  Trash2,
  Wallet,
  AlertCircle,
  BookOpen,
  BarChart3,
  Receipt,
  Scale,
  ChevronRight,
  FileText,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/date";
import { Textarea } from "@/components/ui/textarea";

type AccountType = "asset" | "liability" | "income" | "expense" | "equity";

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
  voucherDate: string;
  type: string;
  description: string;
  amountUsd: string;
  currency: string;
  receivedFrom: string | null;
  paidTo: string | null;
  runningBalance: number;
}

interface Statement {
  account: Account;
  rows: StatementRow[];
}

const TYPE_CONF: Record<AccountType, {
  label: string;
  plural: string;
  icon: React.ReactNode;
  iconBg: string;
  accent: string;
  badge: string;
}> = {
  asset:     { label: "Asset",     plural: "Assets",      icon: <Wallet className="w-4 h-4" />,    iconBg: "bg-blue-50",   accent: "border-l-blue-400",   badge: "bg-blue-100 text-blue-700 border border-blue-200/60" },
  income:    { label: "Income",    plural: "Income",      icon: <TrendingUp className="w-4 h-4" />, iconBg: "bg-emerald-50", accent: "border-l-emerald-400", badge: "bg-emerald-100 text-emerald-700 border border-emerald-200/60" },
  expense:   { label: "Expense",   plural: "Expenses",    icon: <Receipt className="w-4 h-4" />,   iconBg: "bg-rose-50",   accent: "border-l-rose-400",   badge: "bg-rose-100 text-rose-700 border border-rose-200/60" },
  liability: { label: "Liability", plural: "Liabilities", icon: <AlertCircle className="w-4 h-4" />, iconBg: "bg-amber-50", accent: "border-l-amber-400",  badge: "bg-amber-100 text-amber-700 border border-amber-200/60" },
  equity:    { label: "Equity",    plural: "Equity",      icon: <Scale className="w-4 h-4" />,     iconBg: "bg-violet-50", accent: "border-l-violet-400", badge: "bg-violet-100 text-violet-700 border border-violet-200/60" },
};

const TYPE_ORDER: AccountType[] = ["asset", "income", "expense", "liability", "equity"];

const ICON_COLOR: Record<AccountType, string> = {
  asset: "text-blue-500", income: "text-emerald-500",
  expense: "text-rose-500", liability: "text-amber-500", equity: "text-violet-500",
};

function fmt(n: number) {
  return n % 1 === 0 ? `$${n.toLocaleString()}` : `$${n.toFixed(2)}`;
}

function voucherTypeLabel(type: string) {
  const map: Record<string, string> = {
    cash_receipt: "Cash Receipt",
    customer_payment: "Payment In",
    cash_payment: "Cash Payment",
    expense: "Expense",
  };
  return map[type] ?? type;
}

function isIncoming(type: string) {
  return type === "cash_receipt" || type === "customer_payment";
}

async function apiFetch(path: string, options?: RequestInit) {
  const token = localStorage.getItem("gym_token");
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  });
}

export default function AccountsPage() {
  const me = useGetMe();
  const canView = me?.role === "admin" || me?.permissions?.viewAccounting;
  const canManage = me?.role === "admin";

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<Account | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [stmtLoading, setStmtLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", type: "asset" as AccountType, description: "" });
  const [saving, setSaving] = useState(false);

  async function loadAccounts() {
    setLoading(true);
    try {
      const r = await apiFetch("/api/accounts/chart");
      if (r.ok) setAccounts(await r.json());
    } finally {
      setLoading(false);
    }
  }

  async function loadStatement(acc: Account) {
    setStmtLoading(true);
    setStatement(null);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const r = await apiFetch(`/api/accounts/chart/${acc.id}/statement?${params}`);
      if (r.ok) setStatement(await r.json());
    } finally {
      setStmtLoading(false);
    }
  }

  useEffect(() => { if (canView !== undefined) loadAccounts(); }, [canView]);
  useEffect(() => { if (selected) loadStatement(selected); }, [selected, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await apiFetch("/api/accounts/chart", {
        method: "POST",
        body: JSON.stringify(form),
      });
      if (!r.ok) {
        const err = await r.json();
        toast({ title: err.error ?? "Error", variant: "destructive" });
        return;
      }
      const created: Account = await r.json();
      setAccounts((prev) =>
        [...prev, created].sort(
          (a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name),
        ),
      );
      setShowCreate(false);
      setForm({ name: "", type: "asset", description: "" });
      toast({ title: "Account created" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this account? This cannot be undone.")) return;
    const r = await apiFetch(`/api/accounts/chart/${id}`, { method: "DELETE" });
    if (!r.ok) { toast({ title: "Cannot delete account with transactions", variant: "destructive" }); return; }
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    if (selected?.id === id) setSelected(null);
    toast({ title: "Account deleted" });
  }

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3">
        <AlertCircle className="w-10 h-10 text-muted-foreground" />
        <p className="text-muted-foreground">You don't have permission to view accounts.</p>
      </div>
    );
  }

  // ── Statement view ───────────────────────────────────────────────────────────
  if (selected) {
    const conf = TYPE_CONF[selected.type];
    const rows = statement?.rows ?? [];
    const totalIn  = rows.filter((r) =>  isIncoming(r.type)).reduce((s, r) => s + Number(r.amountUsd), 0);
    const totalOut = rows.filter((r) => !isIncoming(r.type)).reduce((s, r) => s + Number(r.amountUsd), 0);
    const balance  = rows.at(-1)?.runningBalance ?? 0;

    return (
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setSelected(null)} className="h-9 gap-1.5">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", conf.iconBg)}>
              <span className={ICON_COLOR[selected.type]}>{conf.icon}</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{selected.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", conf.badge)}>
                  {conf.label}
                </span>
                {selected.description && (
                  <span className="text-xs text-muted-foreground">{selected.description}</span>
                )}
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="h-9 gap-1.5">
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-border bg-card shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Total In</span>
            </div>
            <p className="text-2xl font-bold text-emerald-600 tabular-nums">{fmt(totalIn)}</p>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center">
                <TrendingDown className="w-4 h-4 text-rose-500" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Total Out</span>
            </div>
            <p className="text-2xl font-bold text-rose-600 tabular-nums">{fmt(totalOut)}</p>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", balance >= 0 ? "bg-blue-50" : "bg-amber-50")}>
                <BarChart3 className={cn("w-4 h-4", balance >= 0 ? "text-blue-500" : "text-amber-500")} />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Balance</span>
            </div>
            <p className={cn("text-2xl font-bold tabular-nums", balance >= 0 ? "text-blue-600" : "text-amber-600")}>
              {fmt(balance)}
            </p>
          </div>
        </div>

        {/* Date filter bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground whitespace-nowrap">From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-38 h-9 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground whitespace-nowrap">To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-38 h-9 text-sm" />
          </div>
          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>
              Clear
            </Button>
          )}
        </div>

        {/* Mobile statement cards */}
        <div className="md:hidden rounded-xl border border-border bg-card shadow-sm overflow-hidden divide-y divide-border/50">
          {stmtLoading ? (
            <div className="p-6 text-center text-muted-foreground text-sm">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center">
              <FileText className="w-9 h-9 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No transactions yet</p>
            </div>
          ) : rows.map((row) => {
            const incoming = isIncoming(row.type);
            const amt = Number(row.amountUsd);
            return (
              <div key={row.id} className="px-3 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn(
                      "inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium shrink-0",
                      incoming ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700",
                    )}>
                      {voucherTypeLabel(row.type)}
                    </span>
                    <span className="text-xs text-muted-foreground">{fmtDate(row.voucherDate)}</span>
                  </div>
                  {row.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{row.description}</p>}
                  {(row.receivedFrom ?? row.paidTo) && <p className="text-xs text-muted-foreground/70 truncate">{row.receivedFrom ?? row.paidTo}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className={`font-bold tabular-nums text-sm ${incoming ? "text-emerald-600" : "text-rose-600"}`}>
                    {incoming ? "+" : "−"}{fmt(amt)}
                  </p>
                  <p className={cn("text-xs tabular-nums", row.runningBalance >= 0 ? "text-muted-foreground" : "text-rose-600")}>
                    Bal: {fmt(row.runningBalance)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop statement table */}
        <div className="hidden md:block rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto min-w-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Date</th>
                  <th className="text-left px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Type</th>
                  <th className="text-left px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Description</th>
                  <th className="text-left px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Party</th>
                  <th className="text-right px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">In</th>
                  <th className="text-right px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Out</th>
                  <th className="text-right px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {stmtLoading && (
                  <tr><td colSpan={7} className="text-center py-14 text-muted-foreground">Loading…</td></tr>
                )}
                {!stmtLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-20">
                      <FileText className="w-9 h-9 mx-auto text-muted-foreground/30 mb-2" />
                      <p className="text-muted-foreground font-medium">No transactions yet</p>
                      <p className="text-xs text-muted-foreground/60 mt-0.5">Vouchers linked to this account will appear here</p>
                    </td>
                  </tr>
                )}
                {!stmtLoading && rows.map((row) => {
                  const incoming = isIncoming(row.type);
                  const amt = Number(row.amountUsd);
                  return (
                    <tr key={row.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-3.5 whitespace-nowrap tabular-nums text-sm font-medium">{fmtDate(row.voucherDate)}</td>
                      <td className="px-5 py-3.5">
                        <span className={cn(
                          "inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium",
                          incoming ? "bg-emerald-100 text-emerald-700 border border-emerald-200/60" : "bg-rose-100 text-rose-700 border border-rose-200/60",
                        )}>
                          {voucherTypeLabel(row.type)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 max-w-[200px]">
                        <p className="text-sm truncate">{row.description || "—"}</p>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground whitespace-nowrap">
                        {row.receivedFrom ?? row.paidTo ?? "—"}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums">
                        {incoming ? <span className="font-semibold text-emerald-600">{fmt(amt)}</span> : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums">
                        {!incoming ? <span className="font-semibold text-rose-600">{fmt(amt)}</span> : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className={cn(
                        "px-5 py-3.5 text-right tabular-nums font-bold text-sm",
                        row.runningBalance >= 0 ? "text-foreground" : "text-rose-600",
                      )}>
                        {fmt(row.runningBalance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 0 && (
            <div className="px-5 py-3 border-t border-border/60 bg-muted/20 flex items-center justify-end gap-8 text-sm">
              <span className="text-muted-foreground">{rows.length} transactions</span>
              <span className="text-emerald-600 font-semibold">In: {fmt(totalIn)}</span>
              <span className="text-rose-600 font-semibold">Out: {fmt(totalOut)}</span>
              <span className={cn("font-bold", balance >= 0 ? "text-blue-600" : "text-amber-600")}>Balance: {fmt(balance)}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Account list ─────────────────────────────────────────────────────────────
  const grouped = TYPE_ORDER.reduce((acc, type) => {
    acc[type] = accounts.filter((a) => a.type === type && a.isActive);
    return acc;
  }, {} as Record<AccountType, Account[]>);

  const totalActive = accounts.filter((a) => a.isActive).length;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-blue-500/20 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Chart of Accounts</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {totalActive} {totalActive === 1 ? "account" : "accounts"} · click any to view its ledger
            </p>
          </div>
        </div>
        {canManage && (
          <Button onClick={() => setShowCreate(true)} className="gap-2 shadow-sm">
            <Plus className="w-4 h-4" /> New Account
          </Button>
        )}
      </div>

      {/* Type summary pills */}
      {!loading && totalActive > 0 && (
        <div className="flex flex-wrap gap-2">
          {TYPE_ORDER.map((type) => {
            const count = grouped[type]?.length ?? 0;
            if (!count) return null;
            const conf = TYPE_CONF[type];
            return (
              <div key={type} className={cn("inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium", conf.badge)}>
                <span className={ICON_COLOR[type]}>{conf.icon}</span>
                {count} {conf.plural}
              </div>
            );
          })}
        </div>
      )}

      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      )}

      {/* Grouped accounts */}
      {!loading && TYPE_ORDER.map((type) => {
        const items = grouped[type];
        if (!items || items.length === 0) return null;
        const conf = TYPE_CONF[type];
        return (
          <div key={type} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={cn("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest", ICON_COLOR[type])}>
                {conf.icon}
                {conf.plural}
              </span>
              <span className="text-xs text-muted-foreground font-normal">({items.length})</span>
            </div>
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              {items.map((acc, i) => (
                <div
                  key={acc.id}
                  className={cn(
                    "flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors group border-l-4",
                    conf.accent,
                    i < items.length - 1 && "border-b border-border/60",
                  )}
                  onClick={() => setSelected(acc)}
                >
                  <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0", conf.iconBg)}>
                    <span className={ICON_COLOR[type]}>{conf.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-foreground">{acc.name}</p>
                    {acc.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{acc.description}</p>
                    )}
                  </div>
                  <span className={cn("text-xs px-2.5 py-1 rounded-full font-medium hidden sm:inline-flex", conf.badge)}>
                    {conf.label}
                  </span>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                    <span className="hidden md:block">View ledger</span>
                    <ChevronRight className="w-4 h-4" />
                  </div>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                      onClick={(e) => handleDelete(acc.id, e)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {!loading && totalActive === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <div className="w-16 h-16 rounded-2xl bg-muted/60 flex items-center justify-center">
            <BookOpen className="w-8 h-8 text-muted-foreground/40" />
          </div>
          <p className="font-semibold text-muted-foreground">No accounts yet</p>
          <p className="text-sm text-muted-foreground/60">Create your first account to get started</p>
          {canManage && (
            <Button onClick={() => setShowCreate(true)} className="mt-2 gap-2">
              <Plus className="w-4 h-4" /> New Account
            </Button>
          )}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>New Account</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label>Account Name <span className="text-destructive">*</span></Label>
              <Input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Cash on Hand"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Account Type <span className="text-destructive">*</span></Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as AccountType })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_ORDER.map((type) => (
                    <SelectItem key={type} value={type}>
                      <div className="flex items-center gap-2">
                        <span className={ICON_COLOR[type]}>{TYPE_CONF[type].icon}</span>
                        {TYPE_CONF[type].label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief description of this account"
                rows={2}
                className="resize-none"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create Account"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
