import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useGetMe } from "@/hooks/use-me";
import {
  useListPayments,
  useCreatePayment,
  useUpdatePayment,
  useDeletePayment,
  useGetPaymentSummary,
  type PaymentInputDirection,
  type PaymentInputCategory,
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  DollarSign,
  TrendingUp,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
} from "lucide-react";

const CATEGORIES = [
  "membership",
  "product_sale",
  "expense",
  "payroll",
  "stock_purchase",
  "other",
] as const;

type PaymentForm = {
  direction: string;
  category: string;
  linkedEntityName: string;
  amount: string;
  discount: string;
  currency: string;
  exchangeRate: string;
  account: string;
  notes: string;
  paymentDate: string;
};

const emptyForm = (): PaymentForm => ({
  direction: "in",
  category: "membership",
  linkedEntityName: "",
  amount: "",
  discount: "0",
  currency: "USD",
  exchangeRate: "1",
  account: "cash",
  notes: "",
  paymentDate: new Date().toISOString().slice(0, 10),
});

export default function Payments() {
  const { t } = useI18n();
  const me = useGetMe();
  const { toast } = useToast();

  // Filters
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [direction, setDirection] = useState("all");
  const [category, setCategory] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<PaymentForm>(emptyForm());
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const limit = 20;

  const summaryQuery = useGetPaymentSummary();
  const summary = summaryQuery.data;

  const listQuery = useListPayments({
    page,
    limit,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(direction !== "all" && { direction }),
    ...(category !== "all" && { category }),
    ...(currency !== "all" && { currency }),
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
  });

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const createMutation = useCreatePayment();
  const updateMutation = useUpdatePayment();
  const deleteMutation = useDeletePayment();

  const canManage = me?.role === "admin" || me?.permissions?.viewAccounting;

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setModalOpen(true);
  }

  function openEdit(item: (typeof items)[0]) {
    setEditingId(item.id);
    setForm({
      direction: item.direction,
      category: item.category,
      linkedEntityName: item.linkedEntityName ?? "",
      amount: String(item.amount),
      discount: String(item.discount ?? 0),
      currency: item.currency,
      exchangeRate: String(item.exchangeRate),
      account: item.account,
      notes: item.notes ?? "",
      paymentDate: item.paymentDate ? item.paymentDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
    });
    setModalOpen(true);
  }

  function handleSearchChange(v: string) {
    setSearch(v);
    clearTimeout((window as unknown as Record<string, ReturnType<typeof setTimeout>>)._paySearchTimer);
    (window as unknown as Record<string, ReturnType<typeof setTimeout>>)._paySearchTimer = setTimeout(() => {
      setDebouncedSearch(v);
      setPage(1);
    }, 400);
  }

  async function handleSubmit() {
    const payload = {
      direction: form.direction as PaymentInputDirection,
      category: form.category as PaymentInputCategory,
      linkedEntityName: form.linkedEntityName || undefined,
      amount: parseFloat(form.amount) || 0,
      discount: parseFloat(form.discount) || 0,
      currency: form.currency as "USD" | "CDF",
      exchangeRate: parseFloat(form.exchangeRate) || 1,
      account: form.account,
      notes: form.notes || undefined,
      paymentDate: form.paymentDate || undefined,
    };

    if (!payload.amount) {
      toast({ title: "Amount is required", variant: "destructive" });
      return;
    }

    if (editingId) {
      updateMutation.mutate(
        { id: editingId, data: payload },
        {
          onSuccess: () => {
            toast({ title: t("pay.recorded") });
            setModalOpen(false);
            listQuery.refetch();
            summaryQuery.refetch();
          },
          onError: () => toast({ title: t("common.error"), variant: "destructive" }),
        }
      );
    } else {
      createMutation.mutate(
        { data: payload },
        {
          onSuccess: () => {
            toast({ title: t("pay.recorded") });
            setModalOpen(false);
            listQuery.refetch();
            summaryQuery.refetch();
          },
          onError: () => toast({ title: t("common.error"), variant: "destructive" }),
        }
      );
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    deleteMutation.mutate(
      { id: deleteId },
      {
        onSuccess: () => {
          toast({ title: t("pay.cancelled") });
          setDeleteId(null);
          listQuery.refetch();
          summaryQuery.refetch();
        },
        onError: () => toast({ title: t("common.error"), variant: "destructive" }),
      }
    );
  }

  function fmt(n: number | null | undefined, cur?: string) {
    if (n === null || n === undefined) return "—";
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur ? ` ${cur}` : "");
  }

  function dirBadge(dir: string) {
    return dir === "in" ? (
      <Badge className="bg-emerald-100 text-emerald-700 border-0 gap-1">
        <ArrowDownCircle className="w-3 h-3" />
        {t("pay.direction.in")}
      </Badge>
    ) : (
      <Badge className="bg-rose-100 text-rose-700 border-0 gap-1">
        <ArrowUpCircle className="w-3 h-3" />
        {t("pay.direction.out")}
      </Badge>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t("pay.title")}</h1>
        {canManage && (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" />
            {t("pay.recordPayment")}
          </Button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          icon={<ArrowDownCircle className="w-5 h-5 text-emerald-600" />}
          label={t("pay.summary.cashIn")}
          value={fmt(summary?.cashInToday)}
          color="emerald"
        />
        <SummaryCard
          icon={<ArrowUpCircle className="w-5 h-5 text-rose-600" />}
          label={t("pay.summary.cashOut")}
          value={fmt(summary?.cashOutToday)}
          color="rose"
        />
        <SummaryCard
          icon={<TrendingUp className="w-5 h-5 text-blue-600" />}
          label={t("pay.summary.net")}
          value={fmt(summary?.netCashToday)}
          color="blue"
        />
        <SummaryCard
          icon={<DollarSign className="w-5 h-5 text-indigo-600" />}
          label={t("pay.summary.balance")}
          value={`$${fmt(summary?.balanceUsd)}`}
          color="indigo"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={t("pay.search")}
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <Select value={direction} onValueChange={(v) => { setDirection(v); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder={t("pay.filter.direction")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("pay.filter.direction")}</SelectItem>
            <SelectItem value="in">{t("pay.direction.in")}</SelectItem>
            <SelectItem value="out">{t("pay.direction.out")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder={t("pay.filter.category")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("pay.filter.category")}</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{t(`pay.cat.${c}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={currency} onValueChange={(v) => { setCurrency(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder={t("pay.filter.currency")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("pay.filter.currency")}</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
            <SelectItem value="CDF">CDF</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" className="w-36" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
        <Input type="date" className="w-36" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("pay.col.number")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("pay.col.date")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("pay.col.type")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("pay.col.category")}</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">{t("pay.col.amount")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("pay.col.currency")}</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">{t("pay.col.usd")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden xl:table-cell">{t("pay.col.linked")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden xl:table-cell">{t("pay.col.notes")}</th>
                {canManage && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading ? (
                <tr><td colSpan={10} className="text-center py-12 text-muted-foreground">{t("common.loading")}</td></tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-16">
                    <p className="text-muted-foreground font-medium">{t("pay.empty")}</p>
                    <p className="text-muted-foreground/60 text-xs mt-1">{t("pay.emptyHint")}</p>
                  </td>
                </tr>
              ) : items.map((item) => (
                <tr key={item.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.paymentNumber ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(item.paymentDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">{dirBadge(item.direction)}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
                      {t(`pay.cat.${item.category}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {fmt(item.amount)}
                  </td>
                  <td className="px-4 py-3 text-xs font-medium text-muted-foreground">{item.currency}</td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground hidden lg:table-cell">
                    {fmt(item.amountUsd)}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground hidden xl:table-cell">
                    {item.linkedEntityName ?? item.memberName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground hidden xl:table-cell max-w-[160px] truncate">
                    {item.notes ?? "—"}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(item.id)}
                          disabled={item.status === "cancelled"}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-sm text-muted-foreground">{total} {t("members.total")}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm">{t("common.page")} {page} {t("common.of")} {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? t("pay.editPayment") : t("pay.recordPayment")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("pay.form.type")}</Label>
                <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">{t("pay.direction.in")}</SelectItem>
                    <SelectItem value="out">{t("pay.direction.out")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("pay.form.category")}</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{t(`pay.cat.${c}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>{t("pay.form.amount")}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("pay.form.currency")}</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="CDF">CDF</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("pay.form.rate")}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.exchangeRate}
                  onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("pay.form.date")}</Label>
                <Input
                  type="date"
                  value={form.paymentDate}
                  onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t("pay.form.linked")}</Label>
              <Input
                value={form.linkedEntityName}
                onChange={(e) => setForm({ ...form, linkedEntityName: e.target.value })}
                placeholder="Member, vendor, or person name..."
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("pay.form.notes")}</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>{t("common.cancel")}</Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pay.cancel.confirm")}</AlertDialogTitle>
            <AlertDialogDescription>This will mark the payment as cancelled.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: "emerald" | "rose" | "blue" | "indigo";
}) {
  const bg = {
    emerald: "bg-emerald-50 border-emerald-100",
    rose: "bg-rose-50 border-rose-100",
    blue: "bg-blue-50 border-blue-100",
    indigo: "bg-indigo-50 border-indigo-100",
  }[color];

  return (
    <div className={`rounded-xl border p-4 ${bg}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="text-xl font-bold text-foreground">{value}</p>
    </div>
  );
}
