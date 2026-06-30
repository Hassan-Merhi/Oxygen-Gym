import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Package, TrendingUp, TrendingDown, Wallet, AlertTriangle,
  Plus, Pencil, Trash2, ChevronDown, ChevronUp, CreditCard, Undo2,
} from "lucide-react";
import { useGetMe } from "@/hooks/use-me";

// ─── Types ────────────────────────────────────────────────────────────────────
interface SupplierCredit {
  id: number;
  creditNumber?: string | null;
  supplier: string;
  description?: string | null;
  productId?: number | null;
  productName?: string | null;
  totalAmount: number;
  amountPaid: number;
  remaining: number;
  currency: string;
  purchaseDate: string;
  notes?: string | null;
  status: string;
  createdAt: string;
}

interface SupplierPayment {
  id: number;
  creditId: number;
  amount: number;
  currency: string;
  paymentDate: string;
  notes?: string | null;
  createdAt: string;
}

interface SupplierProduct {
  id: number;
  name: string;
  category?: string | null;
  supplier?: string | null;
  quantity: number;
  alertQuantity: number;
  costPrice: number;
  sellingPrice: number;
  currency: string;
  profitPerUnit: number;
  stockValue: number;
  costValue: number;
  qtySold: number;
  totalProfit: number;
  totalRevenue: number;
  isLowStock: boolean;
}

interface Summary {
  totalOwed: number;
  totalPaid: number;
  remaining: number;
  totalProfitUsd: number;
  productCount: number;
  lowStock: number;
}

// ─── API helpers ──────────────────────────────────────────────────────────────
const API = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
function h(): Record<string, string> {
  const base: Record<string, string> = { "Content-Type": "application/json" };
  const t = localStorage.getItem("gym_token");
  if (t) base["Authorization"] = `Bearer ${t}`;
  return base;
}
const api = {
  get: (path: string) => fetch(`${API}${path}`, { headers: h() }).then(r => r.json()),
  post: (path: string, body: unknown) => fetch(`${API}${path}`, { method: "POST", headers: h(), body: JSON.stringify(body) }).then(r => r.json()),
  patch: (path: string, body: unknown) => fetch(`${API}${path}`, { method: "PATCH", headers: h(), body: JSON.stringify(body) }).then(r => r.json()),
  del: (path: string) => fetch(`${API}${path}`, { method: "DELETE", headers: h() }).then(r => r.json()),
};

// ─── Format helpers ───────────────────────────────────────────────────────────
function fmtAmt(n: number, cur = "USD") {
  if (cur === "CDF") return `FC ${Math.round(n).toLocaleString("fr-FR")}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("fr-FR");
}
function pct(paid: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((paid / total) * 100));
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color: string;
}) {
  return (
    <div className={`rounded-xl border bg-card p-4 flex gap-3 items-start shadow-sm`}>
      <div className={`mt-0.5 h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className="text-lg font-bold leading-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Credit Form ──────────────────────────────────────────────────────────────
interface CreditFormValues {
  supplier: string;
  description: string;
  totalAmount: string;
  currency: string;
  purchaseDate: string;
  notes: string;
}

function CreditFormDialog({
  open, onClose, initial, onSubmit, title,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Partial<CreditFormValues>;
  onSubmit: (v: CreditFormValues) => Promise<void>;
  title: string;
}) {
  const { t } = useI18n();
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState<CreditFormValues>({
    supplier: initial?.supplier ?? "",
    description: initial?.description ?? "",
    totalAmount: initial?.totalAmount ?? "",
    currency: initial?.currency ?? "USD",
    purchaseDate: initial?.purchaseDate ?? today,
    notes: initial?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  const set = (k: keyof CreditFormValues, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.supplier.trim() || !form.totalAmount) return;
    setSaving(true);
    try { await onSubmit(form); } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 py-2">
          <div>
            <Label>{t("supplements.supplier")} *</Label>
            <Input className="mt-1" value={form.supplier} onChange={e => set("supplier", e.target.value)} required />
          </div>
          <div>
            <Label>{t("supplements.description")}</Label>
            <Input className="mt-1" value={form.description} onChange={e => set("description", e.target.value)} placeholder="e.g. Whey Protein 5kg × 10" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("supplements.totalAmount")} *</Label>
              <Input className="mt-1" type="number" step="0.01" min="0.01" value={form.totalAmount} onChange={e => set("totalAmount", e.target.value)} required />
            </div>
            <div>
              <Label>{t("common.currency") || "Currency"}</Label>
              <Select value={form.currency} onValueChange={v => set("currency", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="CDF">CDF (FC)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>{t("supplements.purchaseDate")}</Label>
            <Input className="mt-1" type="date" value={form.purchaseDate} onChange={e => set("purchaseDate", e.target.value)} />
          </div>
          <div>
            <Label>{t("supplements.notes")}</Label>
            <Input className="mt-1" value={form.notes} onChange={e => set("notes", e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel") || "Cancel"}</Button>
            <Button type="submit" disabled={saving}>{saving ? "…" : t("common.save") || "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Pay Dialog ───────────────────────────────────────────────────────────────
function PayDialog({
  open, onClose, credit, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  credit: SupplierCredit;
  onSubmit: (amount: number, date: string, notes: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const today = new Date().toISOString().split("T")[0];
  const [amount, setAmount] = useState(String(credit.remaining));
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    setSaving(true);
    try { await onSubmit(n, date, notes); } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("supplements.payInstallment")}</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {credit.supplier} — {t("supplements.remainingBalance")}: <span className="font-semibold text-orange-600">{fmtAmt(credit.remaining, credit.currency)}</span>
          </p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 py-2">
          <div>
            <Label>{t("supplements.payAmount")} *</Label>
            <Input className="mt-1" type="number" step="0.01" min="0.01" max={credit.remaining} value={amount} onChange={e => setAmount(e.target.value)} required />
          </div>
          <div>
            <Label>{t("supplements.payDate")}</Label>
            <Input className="mt-1" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <Label>{t("supplements.notes")}</Label>
            <Input className="mt-1" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel") || "Cancel"}</Button>
            <Button type="submit" disabled={saving}>{saving ? "…" : t("supplements.payInstallment")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Credit Row ───────────────────────────────────────────────────────────────
function CreditRow({
  credit, onEdit, onDelete, onPay, canManage,
}: {
  credit: SupplierCredit;
  onEdit: () => void;
  onDelete: () => void;
  onPay: () => void;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const { data: payments = [] } = useQuery<SupplierPayment[]>({
    queryKey: [`/api/supplier-credits/${credit.id}/payments`],
    queryFn: () => api.get(`/api/supplier-credits/${credit.id}/payments`),
    enabled: expanded,
  });

  const undoMut = useMutation({
    mutationFn: (paymentId: number) => api.del(`/api/supplier-credits/${credit.id}/payments/${paymentId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/supplier-credits"] });
      qc.invalidateQueries({ queryKey: [`/api/supplier-credits/${credit.id}/payments`] });
      qc.invalidateQueries({ queryKey: ["/api/supplier-credits/summary"] });
      toast({ title: "Payment reversed" });
    },
  });

  const paidPct = pct(credit.amountPaid, credit.totalAmount);
  const isFullyPaid = credit.status === "paid";

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-4 flex flex-wrap gap-3 items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{credit.supplier}</span>
            {credit.creditNumber && <span className="text-xs text-muted-foreground">{credit.creditNumber}</span>}
            <Badge variant={isFullyPaid ? "default" : "secondary"} className={isFullyPaid ? "bg-green-500 text-white" : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"}>
              {isFullyPaid ? t("supplements.status.paid") : t("supplements.status.open")}
            </Badge>
            {credit.productName && <Badge variant="outline" className="text-xs">{credit.productName}</Badge>}
          </div>
          {credit.description && <p className="text-xs text-muted-foreground mt-1">{credit.description}</p>}
          <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(credit.purchaseDate)}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {canManage && !isFullyPaid && (
            <Button size="sm" variant="default" className="h-8 gap-1.5 text-xs" onClick={onPay}>
              <CreditCard className="h-3.5 w-3.5" />{t("supplements.payInstallment")}
            </Button>
          )}
          {canManage && (
            <>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-500 hover:text-red-600" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
            </>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-4 pb-3">
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-muted-foreground">{t("supplements.amountPaid")}: <span className="font-medium text-foreground">{fmtAmt(credit.amountPaid, credit.currency)}</span></span>
          <span className="text-muted-foreground">{t("supplements.totalAmount")}: <span className="font-medium text-foreground">{fmtAmt(credit.totalAmount, credit.currency)}</span></span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${isFullyPaid ? "bg-green-500" : "bg-orange-400"}`}
            style={{ width: `${paidPct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs mt-1">
          <span className="text-muted-foreground">{paidPct}% paid</span>
          {!isFullyPaid && (
            <span className="font-semibold text-orange-600">{fmtAmt(credit.remaining, credit.currency)} {t("supplements.remainingBalance")}</span>
          )}
        </div>
      </div>

      {/* Payment history toggle */}
      <button
        className="w-full flex items-center justify-between px-4 py-2 text-xs text-muted-foreground border-t hover:bg-muted/40 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <span>{t("supplements.payments")}</span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {expanded && (
        <div className="border-t bg-muted/20 px-4 py-3">
          {payments.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">{t("supplements.noPayments")}</p>
          ) : (
            <div className="space-y-2">
              {payments.map(p => (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    <span className="font-medium">{fmtAmt(p.amount, p.currency)}</span>
                    <span className="text-xs text-muted-foreground">{fmtDate(p.paymentDate)}</span>
                    {p.notes && <span className="text-xs text-muted-foreground">— {p.notes}</span>}
                  </div>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500"
                      title={t("supplements.undoPayment")}
                      onClick={() => undoMut.mutate(p.id)}
                    >
                      <Undo2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Supplements() {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const me = useGetMe();
  const canManage = me?.role === "admin" || me?.role === "manager";

  // ── Queries
  const { data: summary } = useQuery<Summary>({
    queryKey: ["/api/supplier-credits/summary"],
    queryFn: () => api.get("/api/supplier-credits/summary"),
  });

  const { data: credits = [], isLoading } = useQuery<SupplierCredit[]>({
    queryKey: ["/api/supplier-credits"],
    queryFn: () => api.get("/api/supplier-credits"),
  });

  const { data: products = [] } = useQuery<SupplierProduct[]>({
    queryKey: ["/api/supplier-credits/products"],
    queryFn: () => api.get("/api/supplier-credits/products"),
  });

  // ── Dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [editCredit, setEditCredit] = useState<SupplierCredit | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SupplierCredit | null>(null);
  const [payTarget, setPayTarget] = useState<SupplierCredit | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/supplier-credits"] });
    qc.invalidateQueries({ queryKey: ["/api/supplier-credits/summary"] });
  };

  // ── Mutations
  const createMut = useMutation({
    mutationFn: (body: unknown) => api.post("/api/supplier-credits", body),
    onSuccess: () => { invalidate(); setAddOpen(false); toast({ title: t("common.success") }); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: unknown }) => api.patch(`/api/supplier-credits/${id}`, body),
    onSuccess: () => { invalidate(); setEditCredit(null); toast({ title: t("common.success") }); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.del(`/api/supplier-credits/${id}`),
    onSuccess: () => { invalidate(); setDeleteTarget(null); toast({ title: t("common.success") }); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const payMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: unknown }) => api.post(`/api/supplier-credits/${id}/payments`, body),
    onSuccess: () => { invalidate(); setPayTarget(null); toast({ title: "Payment recorded ✓" }); },
    onError: (e: Error) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const openCredits = credits.filter(c => c.status === "open");
  const paidCredits = credits.filter(c => c.status === "paid");

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("supplements.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("supplements.subtitle")}</p>
        </div>
        {canManage && (
          <Button onClick={() => setAddOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />{t("supplements.addCredit")}
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          label={t("supplements.totalOwed")}
          value={`$${(summary?.totalOwed ?? 0).toFixed(2)}`}
          icon={Wallet}
          color="bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
        />
        <KpiCard
          label={t("supplements.totalPaid")}
          value={`$${(summary?.totalPaid ?? 0).toFixed(2)}`}
          icon={CreditCard}
          color="bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
        />
        <KpiCard
          label={t("supplements.remaining")}
          value={`$${(summary?.remaining ?? 0).toFixed(2)}`}
          sub={openCredits.length ? `${openCredits.length} open` : undefined}
          icon={TrendingDown}
          color="bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400"
        />
        <KpiCard
          label={t("supplements.totalProfit")}
          value={`$${(summary?.totalProfitUsd ?? 0).toFixed(2)}`}
          icon={TrendingUp}
          color="bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400"
        />
        <KpiCard
          label={t("supplements.productCount")}
          value={String(summary?.productCount ?? 0)}
          icon={Package}
          color="bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
        />
        <KpiCard
          label={t("supplements.lowStock")}
          value={String(summary?.lowStock ?? 0)}
          icon={AlertTriangle}
          color={(summary?.lowStock ?? 0) > 0 ? "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400" : "bg-muted text-muted-foreground"}
        />
      </div>

      {/* Main tabs */}
      <Tabs defaultValue="credits">
        <TabsList>
          <TabsTrigger value="credits">{t("supplements.tabs.credits")}</TabsTrigger>
          <TabsTrigger value="products">{t("supplements.tabs.products")}</TabsTrigger>
        </TabsList>

        {/* ── Supplier Credits Tab ── */}
        <TabsContent value="credits" className="mt-4 space-y-6">
          {/* Open credits */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-orange-400" />
              {t("supplements.status.open")} ({openCredits.length})
            </h2>
            {isLoading ? (
              <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />)}</div>
            ) : openCredits.length === 0 ? (
              <div className="rounded-xl border border-dashed p-10 text-center">
                <Package className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">{t("supplements.noCredits")}</p>
                <p className="text-xs text-muted-foreground/70 mt-1">{t("supplements.noCreditsHint")}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {openCredits.map(c => (
                  <CreditRow
                    key={c.id}
                    credit={c}
                    canManage={canManage}
                    onEdit={() => setEditCredit(c)}
                    onDelete={() => setDeleteTarget(c)}
                    onPay={() => setPayTarget(c)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Paid credits */}
          {paidCredits.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                {t("supplements.status.paid")} ({paidCredits.length})
              </h2>
              <div className="space-y-3">
                {paidCredits.map(c => (
                  <CreditRow
                    key={c.id}
                    credit={c}
                    canManage={canManage}
                    onEdit={() => setEditCredit(c)}
                    onDelete={() => setDeleteTarget(c)}
                    onPay={() => setPayTarget(c)}
                  />
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── Product Profits Tab ── */}
        <TabsContent value="products" className="mt-4">
          {products.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center">
              <Package className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No active products found. Add products in the Stock page.</p>
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-xs uppercase text-muted-foreground">{t("supplements.product.name")}</th>
                    <th className="text-right px-4 py-3 font-medium text-xs uppercase text-muted-foreground">{t("supplements.product.stock")}</th>
                    <th className="text-right px-4 py-3 font-medium text-xs uppercase text-muted-foreground">{t("supplements.product.sold")}</th>
                    <th className="text-right px-4 py-3 font-medium text-xs uppercase text-muted-foreground">{t("supplements.product.cost")}</th>
                    <th className="text-right px-4 py-3 font-medium text-xs uppercase text-muted-foreground">{t("supplements.product.selling")}</th>
                    <th className="text-right px-4 py-3 font-medium text-xs uppercase text-muted-foreground">{t("supplements.product.profitUnit")}</th>
                    <th className="text-right px-4 py-3 font-medium text-xs uppercase text-muted-foreground">{t("supplements.product.totalProfit")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {products.map(p => (
                    <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">{p.name}</div>
                        {p.supplier && <div className="text-xs text-muted-foreground">{p.supplier}</div>}
                        {p.isLowStock && (
                          <Badge className="mt-0.5 text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                            ⚠ {t("supplements.product.lowStock")}
                          </Badge>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${p.isLowStock ? "text-yellow-600" : ""}`}>
                        {p.quantity}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{p.qtySold}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{fmtAmt(p.costPrice, p.currency)}</td>
                      <td className="px-4 py-3 text-right">{fmtAmt(p.sellingPrice, p.currency)}</td>
                      <td className={`px-4 py-3 text-right font-medium ${p.profitPerUnit >= 0 ? "text-green-600" : "text-red-500"}`}>
                        {p.profitPerUnit >= 0 ? "+" : ""}{fmtAmt(p.profitPerUnit, "USD")}
                      </td>
                      <td className={`px-4 py-3 text-right font-bold ${p.totalProfit >= 0 ? "text-green-600" : "text-red-500"}`}>
                        {p.totalProfit >= 0 ? "+" : ""}{fmtAmt(p.totalProfit, "USD")}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/50">
                    <td className="px-4 py-3 font-semibold text-xs" colSpan={6}>Total Profit</td>
                    <td className={`px-4 py-3 text-right font-bold ${products.reduce((s, p) => s + p.totalProfit, 0) >= 0 ? "text-green-600" : "text-red-500"}`}>
                      {fmtAmt(products.reduce((s, p) => s + p.totalProfit, 0), "USD")}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add Dialog */}
      <CreditFormDialog
        open={addOpen}
        title={t("supplements.addCredit")}
        onClose={() => setAddOpen(false)}
        onSubmit={async (v) => {
          await createMut.mutateAsync({
            supplier: v.supplier,
            description: v.description || undefined,
            totalAmount: parseFloat(v.totalAmount),
            currency: v.currency,
            purchaseDate: v.purchaseDate,
            notes: v.notes || undefined,
          });
        }}
      />

      {/* Edit Dialog */}
      {editCredit && (
        <CreditFormDialog
          open
          title={t("supplements.editCredit")}
          onClose={() => setEditCredit(null)}
          initial={{
            supplier: editCredit.supplier,
            description: editCredit.description ?? "",
            totalAmount: String(editCredit.totalAmount),
            currency: editCredit.currency,
            purchaseDate: editCredit.purchaseDate.split("T")[0],
            notes: editCredit.notes ?? "",
          }}
          onSubmit={async (v) => {
            await updateMut.mutateAsync({
              id: editCredit.id,
              body: {
                supplier: v.supplier,
                description: v.description || undefined,
                totalAmount: parseFloat(v.totalAmount),
                currency: v.currency,
                purchaseDate: v.purchaseDate,
                notes: v.notes || undefined,
              },
            });
          }}
        />
      )}

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("supplements.deleteCredit")}</AlertDialogTitle>
            <AlertDialogDescription>{t("supplements.deleteCreditConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel") || "Cancel"}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}>
              {t("common.delete") || "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pay Dialog */}
      {payTarget && (
        <PayDialog
          open
          credit={payTarget}
          onClose={() => setPayTarget(null)}
          onSubmit={async (amount, date, notes) => {
            await payMut.mutateAsync({
              id: payTarget.id,
              body: { amount, paymentDate: date, notes: notes || undefined, currency: payTarget.currency },
            });
          }}
        />
      )}
    </div>
  );
}
