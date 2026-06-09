import { useState, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { useGetMe } from "@/hooks/use-me";
import {
  useListVouchers,
  useListMembers,
  useCreateVoucher,
  useDeleteVoucher,
  useGetVoucher,
  useGetSettings,
  type VoucherInputVoucherType,
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
import { fmtDate } from "@/lib/date";
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Printer,
  Trash2,
  ArrowDownCircle,
  ArrowUpCircle,
  Loader2,
} from "lucide-react";

const VOUCHER_TYPES = [
  "cash_receipt",
  "cash_payment",
  "expense",
  "customer_payment",
] as const;

type VoucherForm = {
  voucherType: string;
  voucherDate: string;
  paidTo: string;
  receivedFrom: string;
  linkedEntityName: string;
  linkedEntityId: number | null;
  amount: string;
  currency: string;
  exchangeRate: string;
  category: string;
  description: string;
  account: string;
};

const emptyForm = (): VoucherForm => ({
  voucherType: "cash_receipt",
  voucherDate: new Date().toISOString().slice(0, 10),
  paidTo: "",
  receivedFrom: "",
  linkedEntityName: "",
  linkedEntityId: null,
  amount: "",
  currency: "USD",
  exchangeRate: "1",
  category: "",
  description: "",
  account: "cash",
});

const CASH_ACCOUNTS = ["Cash", "Bank", "Mobile Money", "Other"] as const;
const EXPENSE_ACCOUNTS = ["Utilities", "Rent", "Salaries", "Supplies", "Equipment", "Marketing", "Maintenance", "Other"] as const;

export default function Vouchers() {
  const { t } = useI18n();
  const me = useGetMe();
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [voucherType, setVoucherType] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<VoucherForm>(emptyForm());
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [printId, setPrintId] = useState<number | null>(null);

  const limit = 20;

  const settingsQuery = useGetSettings();
  const settings = settingsQuery.data;

  const listQuery = useListVouchers({
    page,
    limit,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(voucherType !== "all" && { voucherType }),
    ...(currency !== "all" && { currency }),
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
  });

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const printVoucherQuery = useGetVoucher(printId ?? 0, { query: { enabled: !!printId, queryKey: ["voucher", printId] } });

  const createMutation = useCreateVoucher();
  const deleteMutation = useDeleteVoucher();

  const canManage = me?.role === "admin" || me?.permissions?.viewAccounting;

  const membersQuery = useListMembers({ page: 1, limit: 200, status: "active" });
  const membersList = membersQuery.data?.items ?? [];

  function handleSearchChange(v: string) {
    setSearch(v);
    clearTimeout((window as unknown as Record<string, ReturnType<typeof setTimeout>>)._vchSearchTimer);
    (window as unknown as Record<string, ReturnType<typeof setTimeout>>)._vchSearchTimer = setTimeout(() => {
      setDebouncedSearch(v);
      setPage(1);
    }, 400);
  }

  async function handleSubmit() {
    const payload = {
      voucherType: form.voucherType as VoucherInputVoucherType,
      voucherDate: form.voucherDate || undefined,
      paidTo: form.paidTo || undefined,
      receivedFrom: form.receivedFrom || undefined,
      linkedEntity: form.linkedEntityId ? "member" : undefined,
      linkedEntityId: form.linkedEntityId ?? undefined,
      linkedEntityName: form.linkedEntityName || undefined,
      amount: parseFloat(form.amount) || 0,
      currency: form.currency as "USD" | "CDF",
      exchangeRate: parseFloat(form.exchangeRate) || 1,
      category: form.category || undefined,
      description: form.description,
      account: form.account,
    };

    if (!payload.amount) {
      toast({ title: "Amount is required", variant: "destructive" });
      return;
    }
    if (!payload.description) {
      toast({ title: "Description is required", variant: "destructive" });
      return;
    }

    createMutation.mutate(
      { data: payload },
      {
        onSuccess: () => {
          toast({ title: t("vch.created") });
          setModalOpen(false);
          listQuery.refetch();
        },
        onError: () => toast({ title: t("common.error"), variant: "destructive" }),
      }
    );
  }

  async function handleDelete() {
    if (!deleteId) return;
    deleteMutation.mutate(
      { id: deleteId },
      {
        onSuccess: () => {
          toast({ title: t("vch.cancelled") });
          setDeleteId(null);
          listQuery.refetch();
        },
        onError: () => toast({ title: t("common.error"), variant: "destructive" }),
      }
    );
  }

  function triggerPrint(id: number) {
    setPrintId(id);
    // Once data loads, print
    setTimeout(() => {
      if (printRef.current) {
        const w = window.open("", "_blank", "width=800,height=600");
        if (w) {
          w.document.write(`<html><head><title>Voucher</title><style>
            body { font-family: Arial, sans-serif; padding: 40px; }
            .header { text-align: center; margin-bottom: 32px; }
            .logo { font-size: 24px; font-weight: bold; }
            .title { font-size: 20px; margin: 8px 0; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            td { padding: 8px 12px; border: 1px solid #ddd; }
            td:first-child { font-weight: 600; width: 40%; background: #f9f9f9; }
            .sig { margin-top: 48px; display: flex; justify-content: space-between; }
            .sig-line { border-top: 1px solid #333; width: 200px; text-align: center; padding-top: 4px; font-size: 12px; }
            @media print { button { display: none; } }
          </style></head><body>${printRef.current.innerHTML}</body></html>`);
          w.document.close();
          w.print();
        }
      }
    }, 800);
  }

  function fmt(n: number | null | undefined) {
    if (n === null || n === undefined) return "—";
    return n % 1 === 0
      ? `$${n.toLocaleString()}`
      : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function typeBadge(type: string, direction: string) {
    const isIn = direction === "in";
    return (
      <Badge className={`${isIn ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"} border-0 gap-1 text-xs`}>
        {isIn ? <ArrowDownCircle className="w-3 h-3" /> : <ArrowUpCircle className="w-3 h-3" />}
        {t(`vch.type.${type}`)}
      </Badge>
    );
  }

  const printVoucher = printVoucherQuery.data;
  const isInVoucher = ["cash_receipt", "customer_payment"].includes(form.voucherType);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t("vch.title")}</h1>
        {canManage && (
          <Button onClick={() => { setForm(emptyForm()); setModalOpen(true); }} className="gap-2">
            <Plus className="w-4 h-4" />
            {t("vch.newVoucher")}
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={t("vch.search")}
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <Select value={voucherType} onValueChange={(v) => { setVoucherType(v); setPage(1); }}>
          <SelectTrigger className="w-48"><SelectValue placeholder={t("vch.filter.type")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("vch.filter.type")}</SelectItem>
            {VOUCHER_TYPES.map((vt) => (
              <SelectItem key={vt} value={vt}>{t(`vch.type.${vt}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={currency} onValueChange={(v) => { setCurrency(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Currency" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Currencies</SelectItem>
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
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">{t("vch.col.date")}</th>
                <th className="text-left px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">{t("vch.col.type")}</th>
                <th className="text-left px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">{t("vch.col.paidTo")}</th>
                <th className="text-right px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">{t("vch.col.amount")}</th>
                <th className="text-left px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground hidden md:table-cell">{t("vch.col.description")}</th>
                {canManage && <th className="px-5 py-3.5" />}
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading ? (
                <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">{t("common.loading")}</td></tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16">
                    <p className="text-muted-foreground font-medium">{t("vch.empty")}</p>
                    <p className="text-muted-foreground/60 text-xs mt-1">{t("vch.emptyHint")}</p>
                  </td>
                </tr>
              ) : items.map((item) => (
                <tr key={item.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
                  <td className="px-5 py-3.5 text-sm text-muted-foreground whitespace-nowrap">
                    {fmtDate(item.voucherDate)}
                  </td>
                  <td className="px-5 py-3.5">{typeBadge(item.voucherType, item.direction)}</td>
                  <td className="px-5 py-3.5 text-sm font-medium">
                    {item.paidTo ?? item.receivedFrom ?? item.linkedEntityName ?? "—"}
                  </td>
                  <td className="px-5 py-3.5 text-right font-semibold tabular-nums">
                    {fmt(item.amount)}
                    {item.currency === "CDF" && <span className="text-xs font-normal text-muted-foreground ml-1">FC</span>}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground hidden md:table-cell max-w-[200px] truncate">
                    {item.description}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => triggerPrint(item.id)}
                          title={t("vch.print")}
                        >
                          <Printer className="w-3.5 h-3.5" />
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

      {/* Hidden print template */}
      {printVoucher && (
        <div ref={printRef} className="hidden">
          <div className="header">
            <div className="logo">{settings?.gymName ?? "Oxygen Fitness Gym"}</div>
            {settings?.address && <div style={{ fontSize: 13, color: "#666" }}>{settings.address}</div>}
            {settings?.phone && <div style={{ fontSize: 13, color: "#666" }}>{settings.phone}</div>}
            <div className="title">{t(`vch.type.${printVoucher.voucherType}`)}</div>
          </div>
          <table>
            <tbody>
              <tr><td>{t("vch.col.number")}</td><td>{printVoucher.voucherNumber ?? "—"}</td></tr>
              <tr><td>{t("vch.col.date")}</td><td>{fmtDate(printVoucher.voucherDate)}</td></tr>
              <tr><td>{t("vch.col.type")}</td><td>{t(`vch.type.${printVoucher.voucherType}`)}</td></tr>
              {printVoucher.receivedFrom && <tr><td>{t("vch.form.receivedFrom")}</td><td>{printVoucher.receivedFrom}</td></tr>}
              {printVoucher.paidTo && <tr><td>{t("vch.form.paidTo")}</td><td>{printVoucher.paidTo}</td></tr>}
              <tr><td>{t("vch.col.amount")}</td><td>{printVoucher.amount.toLocaleString()} {printVoucher.currency}</td></tr>
              {printVoucher.amountUsd && <tr><td>USD</td><td>{printVoucher.amountUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>}
              <tr><td>{t("vch.form.description")}</td><td>{printVoucher.description}</td></tr>
              <tr><td>{t("vch.col.by")}</td><td>{printVoucher.createdBy ?? "—"}</td></tr>
            </tbody>
          </table>
          <div className="sig">
            <div className="sig-line">Authorized By</div>
            <div className="sig-line">Received By</div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("vch.newVoucher")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">

            {/* Type pills */}
            <div className="space-y-1.5">
              <Label>{t("vch.form.type")}</Label>
              <div className="grid grid-cols-2 gap-2">
                {VOUCHER_TYPES.map((vt) => {
                  const isIn = ["cash_receipt", "customer_payment"].includes(vt);
                  const active = form.voucherType === vt;
                  return (
                    <button
                      key={vt}
                      type="button"
                      onClick={() => setForm({ ...form, voucherType: vt })}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                        active
                          ? isIn
                            ? "bg-emerald-50 border-emerald-400 text-emerald-700"
                            : "bg-rose-50 border-rose-400 text-rose-700"
                          : "bg-muted/30 border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {isIn
                        ? <ArrowDownCircle className="w-3.5 h-3.5 shrink-0" />
                        : <ArrowUpCircle className="w-3.5 h-3.5 shrink-0" />
                      }
                      {t(`vch.type.${vt}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date */}
            <div className="space-y-1.5">
              <Label>{t("vch.form.date")}</Label>
              <Input type="date" value={form.voucherDate} onChange={(e) => setForm({ ...form, voucherDate: e.target.value })} />
            </div>

            {/* From / To */}
            <div className="space-y-1.5">
              <Label>{isInVoucher ? t("vch.form.receivedFrom") : t("vch.form.paidTo")}</Label>
              <Input
                placeholder={isInVoucher ? "Member name or payer…" : "Payee name…"}
                value={isInVoucher ? form.receivedFrom : form.paidTo}
                onChange={(e) =>
                  isInVoucher
                    ? setForm({ ...form, receivedFrom: e.target.value })
                    : setForm({ ...form, paidTo: e.target.value })
                }
              />
            </div>

            {/* Amount + Currency */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>{t("vch.form.amount")}</Label>
                <Input
                  type="number" min="0" step="0.01"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("vch.form.currency")}</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="CDF">CDF</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label>{t("vch.form.description")} *</Label>
              <Textarea
                placeholder="What is this for?"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this voucher?</AlertDialogTitle>
            <AlertDialogDescription>This will mark the voucher as cancelled.</AlertDialogDescription>
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
