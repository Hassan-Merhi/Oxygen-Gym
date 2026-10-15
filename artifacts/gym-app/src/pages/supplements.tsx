import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n-format";
import { useToast } from "@/hooks/use-toast";
import { useGetMe } from "@/hooks/use-me";
import { canApproveCorrections } from "@/lib/permissions";
import { useFmtDate } from "@/lib/useFmtDate";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/pager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Package, TrendingUp, TrendingDown, Wallet, AlertTriangle,
  Plus, Pencil, Trash2, ChevronDown, CreditCard, Undo2, PackageOpen,
} from "lucide-react";

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
  const token = localStorage.getItem("gym_token");
  if (token) base["Authorization"] = `Bearer ${token}`;
  return base;
}
async function parse(r: Response) {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string })?.error || r.statusText);
  return body;
}
const api = {
  get: (path: string) => fetch(`${API}${path}`, { headers: h() }).then(parse),
  post: (path: string, body: unknown) => fetch(`${API}${path}`, { method: "POST", headers: h(), body: JSON.stringify(body) }).then(parse),
  patch: (path: string, body: unknown) => fetch(`${API}${path}`, { method: "PATCH", headers: h(), body: JSON.stringify(body) }).then(parse),
  del: (path: string) => fetch(`${API}${path}`, { method: "DELETE", headers: h() }).then(parse),
};

// ─── Format helpers ───────────────────────────────────────────────────────────
function fmtAmt(n: number, cur = "USD") {
  if (cur === "CDF") return `FC ${Math.round(n).toLocaleString("fr-FR")}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function pct(paid: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((paid / total) * 100));
}
const profitTone = (n: number) => n >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400";

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <div className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", color)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-lg font-bold leading-tight tabular-nums">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
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
    try { await onSubmit(form); } catch { /* toast handled by mutation */ } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="credit-supplier">{t("supplements.supplier")} *</Label>
            <Input id="credit-supplier" value={form.supplier} onChange={e => set("supplier", e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="credit-description">{t("supplements.description")}</Label>
            <Input id="credit-description" value={form.description} onChange={e => set("description", e.target.value)} placeholder={t("supplements.descriptionPlaceholder")} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="credit-total">{t("supplements.totalAmount")} *</Label>
              <Input id="credit-total" type="number" inputMode="decimal" step="0.01" min="0.01" value={form.totalAmount} onChange={e => set("totalAmount", e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="credit-currency">{t("common.currency")}</Label>
              <Select value={form.currency} onValueChange={v => set("currency", v)}>
                <SelectTrigger id="credit-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="CDF">CDF (FC)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="credit-date">{t("supplements.purchaseDate")}</Label>
            <Input id="credit-date" type="date" value={form.purchaseDate} onChange={e => set("purchaseDate", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="credit-notes">{t("supplements.notes")}</Label>
            <Input id="credit-notes" value={form.notes} onChange={e => set("notes", e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={saving}>{saving ? t("common.saving") : t("common.save")}</Button>
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
    try { await onSubmit(n, date, notes); } catch { /* toast handled by mutation */ } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("supplements.payInstallment")}</DialogTitle>
          <DialogDescription>
            {credit.supplier} — {t("supplements.remainingBalance")}:{" "}
            <span className="font-semibold text-orange-700 dark:text-orange-400">{fmtAmt(credit.remaining, credit.currency)}</span>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">{t("supplements.payAmount")} *</Label>
            <Input id="pay-amount" type="number" inputMode="decimal" step="0.01" min="0.01" max={credit.remaining} value={amount} onChange={e => setAmount(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-date">{t("supplements.payDate")}</Label>
            <Input id="pay-date" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-notes">{t("supplements.notes")}</Label>
            <Input id="pay-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder={t("common.optional")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={saving}>{saving ? t("common.saving") : t("supplements.payInstallment")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Credit Row ───────────────────────────────────────────────────────────────
function CreditRow({
  credit, onEdit, onDelete, onPay, canManage, canCorrect,
}: {
  credit: SupplierCredit;
  onEdit: () => void;
  onDelete: () => void;
  onPay: () => void;
  canManage: boolean;
  /** Reversing or rewriting recorded payments needs admin or approveCorrections. */
  canCorrect: boolean;
}) {
  const { t } = useI18n();
  const { fmtDate } = useFmtDate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const { data: payments = [], isLoading: paymentsLoading } = useQuery<SupplierPayment[]>({
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
      toast({ title: t("supplements.paymentReversed") });
    },
    onError: (e: Error) => toast({ title: e.message || t("common.error"), variant: "destructive" }),
  });

  const paidPct = pct(credit.amountPaid, credit.totalAmount);
  const isFullyPaid = credit.status === "paid";
  // A credit that already has payments is a posted record: only correctors may edit or delete it.
  const canChange = canManage && (credit.amountPaid <= 0 || canCorrect);
  const historyId = `credit-${credit.id}-payments`;

  return (
    <article className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{credit.supplier}</h3>
            {credit.creditNumber && <span className="text-xs text-muted-foreground">{credit.creditNumber}</span>}
            <Badge
              variant={isFullyPaid ? "default" : "secondary"}
              className={isFullyPaid
                ? "bg-emerald-600 text-white hover:bg-emerald-600"
                : "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"}
            >
              {isFullyPaid ? t("supplements.status.paid") : t("supplements.status.open")}
            </Badge>
            {credit.productName && <Badge variant="outline" className="text-xs">{credit.productName}</Badge>}
          </div>
          {credit.description && <p className="mt-1 text-xs text-muted-foreground">{credit.description}</p>}
          <p className="mt-0.5 text-xs text-muted-foreground">{fmtDate(credit.purchaseDate)}</p>
        </div>
        <div className="flex items-center gap-1">
          {canManage && !isFullyPaid && (
            <Button size="sm" className="gap-1.5" onClick={onPay}>
              <CreditCard className="h-4 w-4" aria-hidden="true" />{t("supplements.payInstallment")}
            </Button>
          )}
          {canChange && (
            <>
              <Button size="icon" variant="ghost" onClick={onEdit} aria-label={fmt(t("supplements.aria.edit"), { name: credit.supplier })} title={t("common.edit")}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button size="icon" variant="ghost" className="text-red-700 hover:text-red-800 dark:text-red-400" onClick={onDelete} aria-label={fmt(t("supplements.aria.delete"), { name: credit.supplier })} title={t("common.delete")}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="px-4 pb-3">
        <div className="mb-1.5 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">{t("supplements.amountPaid")}: <span className="font-medium text-foreground">{fmtAmt(credit.amountPaid, credit.currency)}</span></span>
          <span className="text-muted-foreground">{t("supplements.totalAmount")}: <span className="font-medium text-foreground">{fmtAmt(credit.totalAmount, credit.currency)}</span></span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={paidPct}
          aria-label={t("supplements.amountPaid")}
        >
          <div
            className={cn("h-full rounded-full transition-all", isFullyPaid ? "bg-emerald-500" : "bg-orange-400")}
            style={{ width: `${paidPct}%` }}
          />
        </div>
        <div className="mt-1 flex flex-wrap justify-between gap-x-4 text-xs">
          <span className="text-muted-foreground">{fmt(t("supplements.paidPct"), { pct: paidPct })}</span>
          {!isFullyPaid && (
            <span className="font-semibold text-orange-700 dark:text-orange-400">{fmtAmt(credit.remaining, credit.currency)} {t("supplements.remainingBalance")}</span>
          )}
        </div>
      </div>

      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        aria-controls={historyId}
      >
        <span>{t("supplements.payments")}</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
      </button>

      {expanded && (
        <div id={historyId} className="border-t bg-muted/20 px-4 py-3">
          {paymentsLoading ? (
            <Skeleton className="h-6 w-full" />
          ) : payments.length === 0 ? (
            <p className="py-2 text-center text-sm text-muted-foreground">{t("supplements.noPayments")}</p>
          ) : (
            <ul className="space-y-1">
              {payments.map(p => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                    <span className="font-medium tabular-nums">{fmtAmt(p.amount, p.currency)}</span>
                    <span className="text-xs text-muted-foreground">{fmtDate(p.paymentDate)}</span>
                    {p.notes && <span className="truncate text-xs text-muted-foreground">— {p.notes}</span>}
                  </div>
                  {canManage && canCorrect && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-muted-foreground hover:text-red-700 dark:hover:text-red-400"
                      title={t("supplements.undoPayment")}
                      aria-label={`${t("supplements.undoPayment")} — ${fmtAmt(p.amount, p.currency)}`}
                      disabled={undoMut.isPending}
                      onClick={() => undoMut.mutate(p.id)}
                    >
                      <Undo2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Supplements() {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const me = useGetMe();
  const canManage = me?.role === "admin" || me?.role === "manager";
  const canCorrect = canApproveCorrections(me);

  const { data: summary } = useQuery<Summary>({
    queryKey: ["/api/supplier-credits/summary"],
    queryFn: () => api.get("/api/supplier-credits/summary"),
  });

  const { data: credits = [], isLoading } = useQuery<SupplierCredit[]>({
    queryKey: ["/api/supplier-credits"],
    queryFn: () => api.get("/api/supplier-credits"),
  });

  const { data: products = [], isLoading: productsLoading } = useQuery<SupplierProduct[]>({
    queryKey: ["/api/supplier-credits/products"],
    queryFn: () => api.get("/api/supplier-credits/products"),
  });

  const [addOpen, setAddOpen] = useState(false);
  const [editCredit, setEditCredit] = useState<SupplierCredit | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SupplierCredit | null>(null);
  const [payTarget, setPayTarget] = useState<SupplierCredit | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/supplier-credits"] });
    qc.invalidateQueries({ queryKey: ["/api/supplier-credits/summary"] });
  };

  const onError = (e: Error) => toast({ title: e.message || t("common.error"), variant: "destructive" });

  const createMut = useMutation({
    mutationFn: (body: unknown) => api.post("/api/supplier-credits", body),
    onSuccess: () => { invalidate(); setAddOpen(false); toast({ title: t("common.success") }); },
    onError,
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: unknown }) => api.patch(`/api/supplier-credits/${id}`, body),
    onSuccess: () => { invalidate(); setEditCredit(null); toast({ title: t("common.success") }); },
    onError,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.del(`/api/supplier-credits/${id}`),
    onSuccess: () => { invalidate(); setDeleteTarget(null); toast({ title: t("common.success") }); },
    onError,
  });

  const payMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: unknown }) => api.post(`/api/supplier-credits/${id}/payments`, body),
    onSuccess: () => { invalidate(); setPayTarget(null); toast({ title: t("supplements.paymentRecorded") }); },
    onError,
  });

  const openCredits = credits.filter(c => c.status === "open");
  const paidCredits = credits.filter(c => c.status === "paid");
  const totalProfit = products.reduce((s, p) => s + p.totalProfit, 0);

  const creditRow = (c: SupplierCredit) => (
    <CreditRow
      key={c.id}
      credit={c}
      canManage={canManage}
      canCorrect={canCorrect}
      onEdit={() => setEditCredit(c)}
      onDelete={() => setDeleteTarget(c)}
      onPay={() => setPayTarget(c)}
    />
  );

  const th = "px-4 py-3 text-xs font-medium uppercase text-muted-foreground";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        icon={PackageOpen}
        iconClass="bg-orange-500/10 text-orange-700 dark:text-orange-400"
        title={t("supplements.title")}
        subtitle={t("supplements.subtitle")}
        actions={canManage ? (
          <Button onClick={() => setAddOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" aria-hidden="true" />{t("supplements.addCredit")}
          </Button>
        ) : undefined}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label={t("supplements.totalOwed")} value={fmtAmt(summary?.totalOwed ?? 0)} icon={Wallet} color="bg-red-500/10 text-red-700 dark:text-red-400" />
        <KpiCard label={t("supplements.totalPaid")} value={fmtAmt(summary?.totalPaid ?? 0)} icon={CreditCard} color="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" />
        <KpiCard
          label={t("supplements.remaining")}
          value={fmtAmt(summary?.remaining ?? 0)}
          sub={openCredits.length ? fmt(t("supplements.openCount"), { count: openCredits.length }) : undefined}
          icon={TrendingDown}
          color="bg-orange-500/10 text-orange-700 dark:text-orange-400"
        />
        <KpiCard label={t("supplements.totalProfit")} value={fmtAmt(summary?.totalProfitUsd ?? 0)} icon={TrendingUp} color="bg-indigo-500/10 text-indigo-700 dark:text-indigo-400" />
        <KpiCard label={t("supplements.productCount")} value={String(summary?.productCount ?? 0)} icon={Package} color="bg-blue-500/10 text-blue-700 dark:text-blue-400" />
        <KpiCard
          label={t("supplements.lowStock")}
          value={String(summary?.lowStock ?? 0)}
          icon={AlertTriangle}
          color={(summary?.lowStock ?? 0) > 0 ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground"}
        />
      </div>

      <Tabs defaultValue="credits">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="credits" className="pointer-coarse:min-h-11">{t("supplements.tabs.credits")}</TabsTrigger>
          <TabsTrigger value="products" className="pointer-coarse:min-h-11">{t("supplements.tabs.products")}</TabsTrigger>
        </TabsList>

        <TabsContent value="credits" className="mt-4 space-y-6">
          <section aria-labelledby="open-credits">
            <h2 id="open-credits" className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-orange-400" aria-hidden="true" />
              {t("supplements.status.open")} ({openCredits.length})
            </h2>
            {isLoading ? (
              <div className="space-y-3" aria-busy="true">{[1, 2, 3].map(i => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}</div>
            ) : openCredits.length === 0 ? (
              <div className="rounded-xl border border-dashed">
                <EmptyState icon={Package} title={t("supplements.noCredits")} hint={t("supplements.noCreditsHint")} />
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">{openCredits.map(creditRow)}</div>
            )}
          </section>

          {paidCredits.length > 0 && (
            <section aria-labelledby="paid-credits">
              <h2 id="paid-credits" className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                {t("supplements.status.paid")} ({paidCredits.length})
              </h2>
              <div className="grid gap-3 lg:grid-cols-2">{paidCredits.map(creditRow)}</div>
            </section>
          )}
        </TabsContent>

        <TabsContent value="products" className="mt-4">
          {productsLoading ? (
            <div className="space-y-2" aria-busy="true">{[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : products.length === 0 ? (
            <div className="rounded-xl border border-dashed">
              <EmptyState icon={Package} title={t("supplements.noProducts")} />
            </div>
          ) : (
            <>
              {/* Cards below lg */}
              <ul className="grid gap-3 md:grid-cols-2 lg:hidden">
                {products.map(p => (
                  <li key={p.id} className="rounded-xl border bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p.name}</p>
                        {p.supplier && <p className="truncate text-xs text-muted-foreground">{p.supplier}</p>}
                      </div>
                      {p.isLowStock && (
                        <Badge className="shrink-0 gap-1 bg-amber-100 text-xs text-amber-800 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />{t("supplements.product.lowStock")}
                        </Badge>
                      )}
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                      <div><dt className="text-xs text-muted-foreground">{t("supplements.product.stock")}</dt><dd className={cn("font-medium tabular-nums", p.isLowStock && "text-amber-700 dark:text-amber-400")}>{p.quantity}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">{t("supplements.product.sold")}</dt><dd className="tabular-nums">{p.qtySold}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">{t("supplements.product.profitUnit")}</dt><dd className={cn("font-medium tabular-nums", profitTone(p.profitPerUnit))}>{p.profitPerUnit >= 0 ? "+" : ""}{fmtAmt(p.profitPerUnit, "USD")}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">{t("supplements.product.cost")}</dt><dd className="tabular-nums">{fmtAmt(p.costPrice, p.currency)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">{t("supplements.product.selling")}</dt><dd className="tabular-nums">{fmtAmt(p.sellingPrice, p.currency)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">{t("supplements.product.totalProfit")}</dt><dd className={cn("font-bold tabular-nums", profitTone(p.totalProfit))}>{p.totalProfit >= 0 ? "+" : ""}{fmtAmt(p.totalProfit, "USD")}</dd></div>
                    </dl>
                  </li>
                ))}
                <li className="flex items-center justify-between rounded-xl border bg-muted/50 px-4 py-3 text-sm md:col-span-2">
                  <span className="font-semibold">{t("supplements.product.totalProfit")}</span>
                  <span className={cn("font-bold tabular-nums", profitTone(totalProfit))}>{fmtAmt(totalProfit, "USD")}</span>
                </li>
              </ul>

              <div className="hidden overflow-hidden rounded-xl border lg:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th scope="col" className={cn(th, "text-start")}>{t("supplements.product.name")}</th>
                      <th scope="col" className={cn(th, "text-end")}>{t("supplements.product.stock")}</th>
                      <th scope="col" className={cn(th, "text-end")}>{t("supplements.product.sold")}</th>
                      <th scope="col" className={cn(th, "text-end")}>{t("supplements.product.cost")}</th>
                      <th scope="col" className={cn(th, "text-end")}>{t("supplements.product.selling")}</th>
                      <th scope="col" className={cn(th, "text-end")}>{t("supplements.product.profitUnit")}</th>
                      <th scope="col" className={cn(th, "text-end")}>{t("supplements.product.totalProfit")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {products.map(p => (
                      <tr key={p.id} className="transition-colors hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="font-medium">{p.name}</div>
                          {p.supplier && <div className="text-xs text-muted-foreground">{p.supplier}</div>}
                          {p.isLowStock && (
                            <Badge className="mt-0.5 gap-1 bg-amber-100 text-xs text-amber-800 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300">
                              <AlertTriangle className="h-3 w-3" aria-hidden="true" />{t("supplements.product.lowStock")}
                            </Badge>
                          )}
                        </td>
                        <td className={cn("px-4 py-3 text-end font-medium tabular-nums", p.isLowStock && "text-amber-700 dark:text-amber-400")}>{p.quantity}</td>
                        <td className="px-4 py-3 text-end tabular-nums text-muted-foreground">{p.qtySold}</td>
                        <td className="px-4 py-3 text-end tabular-nums text-muted-foreground">{fmtAmt(p.costPrice, p.currency)}</td>
                        <td className="px-4 py-3 text-end tabular-nums">{fmtAmt(p.sellingPrice, p.currency)}</td>
                        <td className={cn("px-4 py-3 text-end font-medium tabular-nums", profitTone(p.profitPerUnit))}>
                          {p.profitPerUnit >= 0 ? "+" : ""}{fmtAmt(p.profitPerUnit, "USD")}
                        </td>
                        <td className={cn("px-4 py-3 text-end font-bold tabular-nums", profitTone(p.totalProfit))}>
                          {p.totalProfit >= 0 ? "+" : ""}{fmtAmt(p.totalProfit, "USD")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/50">
                      <td className="px-4 py-3 text-sm font-semibold" colSpan={6}>{t("supplements.product.totalProfit")}</td>
                      <td className={cn("px-4 py-3 text-end font-bold tabular-nums", profitTone(totalProfit))}>{fmtAmt(totalProfit, "USD")}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <CreditFormDialog
        key={addOpen ? "add-open" : "add-closed"}
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

      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("supplements.deleteCredit")}</AlertDialogTitle>
            <AlertDialogDescription>{t("supplements.deleteCreditConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
