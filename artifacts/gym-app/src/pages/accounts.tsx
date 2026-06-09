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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, BookOpen, ArrowLeft, TrendingUp, TrendingDown, Printer, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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

const ACCOUNT_TYPES: { value: AccountType; label: string; color: string }[] = [
  { value: "asset",     label: "Asset",     color: "bg-blue-100 text-blue-800" },
  { value: "income",    label: "Income",    color: "bg-green-100 text-green-800" },
  { value: "expense",   label: "Expense",   color: "bg-red-100 text-red-800" },
  { value: "liability", label: "Liability", color: "bg-orange-100 text-orange-800" },
  { value: "equity",    label: "Equity",    color: "bg-purple-100 text-purple-800" },
];

const TYPE_ORDER: AccountType[] = ["asset", "income", "expense", "liability", "equity"];

function fmt(n: number) {
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

function typeBadgeClass(type: AccountType) {
  return ACCOUNT_TYPES.find((t) => t.value === type)?.color ?? "bg-gray-100 text-gray-700";
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

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  // Statement view
  const [selected, setSelected] = useState<Account | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [stmtLoading, setStmtLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Create dialog
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

  useEffect(() => {
    if (selected) loadStatement(selected);
  }, [selected, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

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
          (a, b) =>
            TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
            a.name.localeCompare(b.name),
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
    if (!confirm("Delete this account?")) return;
    await apiFetch(`/api/accounts/chart/${id}`, { method: "DELETE" });
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    if (selected?.id === id) setSelected(null);
    toast({ title: "Account deleted" });
  }

  if (!canView) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        You don't have permission to view accounts.
      </div>
    );
  }

  // ── Statement view ──────────────────────────────────────────────────────────
  if (selected) {
    const rows = statement?.rows ?? [];
    const totalIn  = rows.filter((r) =>  isIncoming(r.type)).reduce((s, r) => s + Number(r.amountUsd), 0);
    const totalOut = rows.filter((r) => !isIncoming(r.type)).reduce((s, r) => s + Number(r.amountUsd), 0);
    const balance  = rows.at(-1)?.runningBalance ?? 0;

    return (
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{selected.name}</h1>
            <p className="text-sm text-muted-foreground capitalize">
              {selected.type} account{selected.description ? ` · ${selected.description}` : ""}
            </p>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-green-50 border border-green-100 rounded-xl p-4">
            <div className="flex items-center gap-2 text-green-700 mb-1 text-sm font-medium">
              <TrendingUp className="h-4 w-4" /> Total In
            </div>
            <p className="text-2xl font-bold text-green-700">{fmt(totalIn)}</p>
          </div>
          <div className="bg-red-50 border border-red-100 rounded-xl p-4">
            <div className="flex items-center gap-2 text-red-700 mb-1 text-sm font-medium">
              <TrendingDown className="h-4 w-4" /> Total Out
            </div>
            <p className="text-2xl font-bold text-red-700">{fmt(totalOut)}</p>
          </div>
          <div
            className={cn(
              "border rounded-xl p-4",
              balance >= 0 ? "bg-blue-50 border-blue-100" : "bg-orange-50 border-orange-100",
            )}
          >
            <p className="text-sm font-medium text-muted-foreground mb-1">Balance</p>
            <p className={cn("text-2xl font-bold", balance >= 0 ? "text-blue-700" : "text-orange-700")}>
              {fmt(balance)}
            </p>
          </div>
        </div>

        {/* Date filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label className="text-sm">From</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm">To</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-40"
            />
          </div>
          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>
              Clear
            </Button>
          )}
          <div className="ml-auto">
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
          </div>
        </div>

        {/* Statement table */}
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="text-xs uppercase tracking-wide font-semibold">Date</TableHead>
                <TableHead className="text-xs uppercase tracking-wide font-semibold">Type</TableHead>
                <TableHead className="text-xs uppercase tracking-wide font-semibold">Description</TableHead>
                <TableHead className="text-xs uppercase tracking-wide font-semibold">Party</TableHead>
                <TableHead className="text-xs uppercase tracking-wide font-semibold text-right">In</TableHead>
                <TableHead className="text-xs uppercase tracking-wide font-semibold text-right">Out</TableHead>
                <TableHead className="text-xs uppercase tracking-wide font-semibold text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stmtLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!stmtLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    No transactions linked to this account yet.
                  </TableCell>
                </TableRow>
              )}
              {!stmtLoading &&
                rows.map((row) => {
                  const incoming = isIncoming(row.type);
                  const amt = Number(row.amountUsd);
                  return (
                    <TableRow key={row.id} className="hover:bg-muted/30">
                      <TableCell className="tabular-nums text-sm">
                        {new Date(row.voucherDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "text-xs px-2 py-0.5 rounded-full font-medium",
                            incoming ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800",
                          )}
                        >
                          {voucherTypeLabel(row.type)}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm max-w-[220px] truncate">{row.description}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.receivedFrom ?? row.paidTo ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {incoming ? (
                          <span className="text-green-700 font-medium">{fmt(amt)}</span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {!incoming ? (
                          <span className="text-red-600 font-medium">{fmt(amt)}</span>
                        ) : "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums text-sm font-semibold",
                          row.runningBalance >= 0 ? "text-foreground" : "text-red-600",
                        )}
                      >
                        {fmt(row.runningBalance)}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  // ── Account list ────────────────────────────────────────────────────────────
  const grouped = TYPE_ORDER.reduce(
    (acc, type) => {
      acc[type] = accounts.filter((a) => a.type === type && a.isActive);
      return acc;
    },
    {} as Record<AccountType, Account[]>,
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Accounts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Chart of accounts — click any account to view its ledger statement
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> New Account
        </Button>
      </div>

      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}

      {/* Grouped account cards */}
      {!loading &&
        TYPE_ORDER.map((type) => {
          const items = grouped[type];
          if (!items || items.length === 0) return null;
          const typeInfo = ACCOUNT_TYPES.find((t) => t.value === type)!;
          return (
            <div key={type}>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                {typeInfo.label}s
              </h2>
              <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
                {items.map((acc, i) => (
                  <div
                    key={acc.id}
                    className={cn(
                      "flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-muted/40 transition-colors group",
                      i < items.length - 1 && "border-b",
                    )}
                    onClick={() => setSelected(acc)}
                  >
                    <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <BookOpen className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{acc.name}</p>
                      {acc.description && (
                        <p className="text-xs text-muted-foreground truncate">{acc.description}</p>
                      )}
                    </div>
                    <span
                      className={cn(
                        "text-xs px-2.5 py-1 rounded-full font-medium",
                        typeBadgeClass(acc.type),
                      )}
                    >
                      {typeInfo.label}
                    </span>
                    <span className="text-xs text-muted-foreground">View statement →</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
                      onClick={(e) => handleDelete(acc.id, e)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

      {!loading && accounts.filter((a) => a.isActive).length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No accounts yet</p>
          <p className="text-sm">Create your first account to get started</p>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Account</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Account Name *</Label>
              <Input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Savings Account"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type *</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v as AccountType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional description"
              />
            </div>
            <div className="flex gap-2 pt-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Create Account"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
