import { useState, useRef, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { useGetMe } from "@/hooks/use-me";
import {
  useListPayments,
  useCreatePayment,
  useUpdatePayment,
  useDeletePayment,
  useGetPaymentSummary,
  useListVouchers,
  useCreateVoucher,
  useDeleteVoucher,
  useGetVoucher,
  useGetSettings,
  type PaymentInputDirection,
  type PaymentInputCategory,
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
  Printer,
  Loader2,
  Receipt,
  Banknote,
} from "lucide-react";

// ─── Constants ─────────────────────────────────────────────────────────────
const PAY_CATEGORIES = [
  "membership",
  "product_sale",
  "expense",
  "payroll",
  "stock_purchase",
  "other",
] as const;

const VOUCHER_TYPES = [
  "cash_receipt",
  "cash_payment",
  "expense",
  "customer_payment",
] as const;

// ─── Form types ────────────────────────────────────────────────────────────
type PayForm = {
  direction: string;
  category: string;
  linkedEntityName: string;
  amount: string;
  currency: string;
  exchangeRate: string;
  account: string;
  notes: string;
  paymentDate: string;
};

type VchForm = {
  voucherType: string;
  voucherDate: string;
  receivedFrom: string;
  paidTo: string;
  amount: string;
  currency: string;
  description: string;
};

const emptyPayForm = (): PayForm => ({
  direction: "in",
  category: "membership",
  linkedEntityName: "",
  amount: "",
  currency: "USD",
  exchangeRate: "1",
  account: "cash",
  notes: "",
  paymentDate: new Date().toISOString().slice(0, 10),
});

const emptyVchForm = (): VchForm => ({
  voucherType: "cash_receipt",
  voucherDate: new Date().toISOString().slice(0, 10),
  receivedFrom: "",
  paidTo: "",
  amount: "",
  currency: "USD",
  description: "",
});

// ─── Main component ────────────────────────────────────────────────────────
export default function CashBook() {
  const { t } = useI18n();
  const me = useGetMe();
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const [tab, setTab] = useState<"transactions" | "vouchers">("transactions");
  const canManage = me?.role === "admin" || me?.permissions?.viewAccounting;

  // ── Transaction state ──
  const [paySearch, setPaySearch] = useState("");
  const [paySearchD, setPaySearchD] = useState("");
  const [payDir, setPayDir] = useState("all");
  const [payCat, setPayCat] = useState("all");
  const [payCur, setPayCur] = useState("all");
  const [payDateFrom, setPayDateFrom] = useState("");
  const [payDateTo, setPayDateTo] = useState("");
  const [payPage, setPayPage] = useState(1);
  const [payModal, setPayModal] = useState(false);
  const [payEditId, setPayEditId] = useState<number | null>(null);
  const [payForm, setPayForm] = useState<PayForm>(emptyPayForm());
  const [payDeleteId, setPayDeleteId] = useState<number | null>(null);

  // ── Voucher state ──
  const [vchSearch, setVchSearch] = useState("");
  const [vchSearchD, setVchSearchD] = useState("");
  const [vchType, setVchType] = useState("all");
  const [vchCur, setVchCur] = useState("all");
  const [vchDateFrom, setVchDateFrom] = useState("");
  const [vchDateTo, setVchDateTo] = useState("");
  const [vchPage, setVchPage] = useState(1);
  const [vchModal, setVchModal] = useState(false);
  const [vchForm, setVchForm] = useState<VchForm>(emptyVchForm());
  const [vchDeleteId, setVchDeleteId] = useState<number | null>(null);
  const [printId, setPrintId] = useState<number | null>(null);

  const LIMIT = 20;

  // ── Queries ──
  const summaryQ = useGetPaymentSummary();
  const summary = summaryQ.data;
  const settingsQ = useGetSettings();
  const settings = settingsQ.data;

  const payListQ = useListPayments({
    page: payPage, limit: LIMIT,
    ...(paySearchD && { search: paySearchD }),
    ...(payDir !== "all" && { direction: payDir }),
    ...(payCat !== "all" && { category: payCat }),
    ...(payCur !== "all" && { currency: payCur }),
    ...(payDateFrom && { dateFrom: payDateFrom }),
    ...(payDateTo && { dateTo: payDateTo }),
  });

  const vchListQ = useListVouchers({
    page: vchPage, limit: LIMIT,
    ...(vchSearchD && { search: vchSearchD }),
    ...(vchType !== "all" && { voucherType: vchType }),
    ...(vchCur !== "all" && { currency: vchCur }),
    ...(vchDateFrom && { dateFrom: vchDateFrom }),
    ...(vchDateTo && { dateTo: vchDateTo }),
  });

  const printVoucherQ = useGetVoucher(printId ?? 0, { query: { enabled: !!printId, queryKey: ["voucher-print", printId] } });

  const payItems = payListQ.data?.items ?? [];
  const payTotal = payListQ.data?.total ?? 0;
  const payPages = Math.ceil(payTotal / LIMIT);

  const vchItems = vchListQ.data?.items ?? [];
  const vchTotal = vchListQ.data?.total ?? 0;
  const vchPages = Math.ceil(vchTotal / LIMIT);

  // Running balance maps: computed oldest→newest within the visible page
  const payRunning = useMemo(() => {
    const reversed = [...payItems].reverse();
    let sum = 0;
    const map = new Map<number, number>();
    reversed.forEach((item) => {
      const usd = (item.amountUsd as number | null) ?? item.amount ?? 0;
      sum += item.direction === "in" ? usd : -usd;
      map.set(item.id, sum);
    });
    return map;
  }, [payItems]);

  const vchRunning = useMemo(() => {
    const reversed = [...vchItems].reverse();
    let sum = 0;
    const map = new Map<number, number>();
    reversed.forEach((item) => {
      const usd = (item.amountUsd as number | null) ?? item.amount ?? 0;
      sum += item.direction === "in" ? usd : -usd;
      map.set(item.id, sum);
    });
    return map;
  }, [vchItems]);

  // ── Mutations ──
  const createPayM = useCreatePayment();
  const updatePayM = useUpdatePayment();
  const deletePayM = useDeletePayment();
  const createVchM = useCreateVoucher();
  const deleteVchM = useDeleteVoucher();

  // ── Helpers ──
  function fmtAmt(n: number | null | undefined, cur?: string) {
    if (n === null || n === undefined) return "—";
    const s = n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return cur ? `${s} ${cur}` : s;
  }

  function debounce(key: string, fn: () => void, ms = 400) {
    clearTimeout((window as unknown as Record<string, ReturnType<typeof setTimeout>>)[key]);
    (window as unknown as Record<string, ReturnType<typeof setTimeout>>)[key] = setTimeout(fn, ms);
  }

  // ── Pay handlers ──
  function openPayCreate() { setPayEditId(null); setPayForm(emptyPayForm()); setPayModal(true); }
  function openPayEdit(item: typeof payItems[0]) {
    setPayEditId(item.id);
    setPayForm({
      direction: item.direction,
      category: item.category,
      linkedEntityName: item.linkedEntityName ?? "",
      amount: String(item.amount),
      currency: item.currency,
      exchangeRate: String(item.exchangeRate),
      account: item.account,
      notes: item.notes ?? "",
      paymentDate: item.paymentDate ? item.paymentDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
    });
    setPayModal(true);
  }

  async function submitPay() {
    const payload = {
      direction: payForm.direction as PaymentInputDirection,
      category: payForm.category as PaymentInputCategory,
      linkedEntityName: payForm.linkedEntityName || undefined,
      amount: parseFloat(payForm.amount) || 0,
      discount: 0,
      currency: payForm.currency as "USD" | "CDF",
      exchangeRate: parseFloat(payForm.exchangeRate) || 1,
      account: payForm.account,
      notes: payForm.notes || undefined,
      paymentDate: payForm.paymentDate || undefined,
    };
    if (!payload.amount) { toast({ title: "Amount is required", variant: "destructive" }); return; }
    const opts = {
      onSuccess: () => { toast({ title: t("pay.recorded") }); setPayModal(false); payListQ.refetch(); summaryQ.refetch(); },
      onError: () => toast({ title: t("common.error"), variant: "destructive" }),
    };
    if (payEditId) updatePayM.mutate({ id: payEditId, data: payload }, opts);
    else createPayM.mutate({ data: payload }, opts);
  }

  async function deletePay() {
    if (!payDeleteId) return;
    deletePayM.mutate({ id: payDeleteId }, {
      onSuccess: () => { toast({ title: t("pay.cancelled") }); setPayDeleteId(null); payListQ.refetch(); summaryQ.refetch(); },
      onError: () => toast({ title: t("common.error"), variant: "destructive" }),
    });
  }

  // ── Voucher handlers ──
  function openVchCreate() { setVchForm(emptyVchForm()); setVchModal(true); }

  async function submitVch() {
    const isIn = ["cash_receipt", "customer_payment"].includes(vchForm.voucherType);
    const payload = {
      voucherType: vchForm.voucherType as VoucherInputVoucherType,
      voucherDate: vchForm.voucherDate || undefined,
      receivedFrom: isIn ? (vchForm.receivedFrom || undefined) : undefined,
      paidTo: !isIn ? (vchForm.paidTo || undefined) : undefined,
      amount: parseFloat(vchForm.amount) || 0,
      currency: vchForm.currency as "USD" | "CDF",
      exchangeRate: 1,
      description: vchForm.description,
      account: "cash",
    };
    if (!payload.amount) { toast({ title: "Amount is required", variant: "destructive" }); return; }
    if (!payload.description) { toast({ title: "Description is required", variant: "destructive" }); return; }
    createVchM.mutate({ data: payload }, {
      onSuccess: () => { toast({ title: t("vch.created") }); setVchModal(false); vchListQ.refetch(); },
      onError: () => toast({ title: t("common.error"), variant: "destructive" }),
    });
  }

  async function deleteVch() {
    if (!vchDeleteId) return;
    deleteVchM.mutate({ id: vchDeleteId }, {
      onSuccess: () => { toast({ title: t("vch.cancelled") }); setVchDeleteId(null); vchListQ.refetch(); },
      onError: () => toast({ title: t("common.error"), variant: "destructive" }),
    });
  }

  function triggerPrint(id: number) {
    setPrintId(id);
    setTimeout(() => {
      if (printRef.current) {
        const w = window.open("", "_blank", "width=800,height=600");
        if (w) {
          w.document.write(`<html><head><title>Voucher</title><style>
            body{font-family:Arial,sans-serif;padding:40px}
            .header{text-align:center;margin-bottom:32px}
            .logo{font-size:24px;font-weight:bold}
            .title{font-size:20px;margin:8px 0}
            table{width:100%;border-collapse:collapse;margin:20px 0}
            td{padding:8px 12px;border:1px solid #ddd}
            td:first-child{font-weight:600;width:40%;background:#f9f9f9}
            .sig{margin-top:48px;display:flex;justify-content:space-between}
            .sig-line{border-top:1px solid #333;width:200px;text-align:center;padding-top:4px;font-size:12px}
          </style></head><body>${printRef.current.innerHTML}</body></html>`);
          w.document.close();
          w.print();
        }
      }
    }, 800);
  }

  const vchIsIn = ["cash_receipt", "customer_payment"].includes(vchForm.voucherType);
  const printVoucher = printVoucherQ.data;

  // ── PDF export ──────────────────────────────────────────────────────────────
  function exportPdf() {
    const gymName = (settings as Record<string, unknown> | undefined)?.gymName as string ?? "GymPro";
    const isVch = tab === "vouchers";
    const title = isVch ? "Cash Book — Vouchers" : "Cash Book — Transactions";
    const dateLabel = isVch
      ? `${vchDateFrom || "all"} → ${vchDateTo || "all"}`
      : `${payDateFrom || "all"} → ${payDateTo || "all"}`;

    const payRows = payItems.map((item, idx) => {
      const bal = payRunning.get(item.id) ?? 0;
      const sign = item.direction === "in" ? "+" : "−";
      const color = item.direction === "in" ? "#059669" : "#dc2626";
      return `<tr style="background:${idx % 2 === 0 ? "#fff" : "#f9fafb"}">
        <td>${fmtDate(item.paymentDate)}</td>
        <td>${item.direction === "in" ? "In" : "Out"} / ${item.category.replace(/_/g, " ")}</td>
        <td style="text-align:right;color:${color};font-weight:600">${sign}${fmtAmt(item.amount)} ${item.currency}</td>
        <td style="text-align:right;font-weight:600;color:${bal < 0 ? "#dc2626" : "#111"}">${bal >= 0 ? "" : "−"}$${fmtAmt(Math.abs(bal))}</td>
        <td>${item.notes ?? "—"}</td>
      </tr>`;
    }).join("");

    const vchRows = vchItems.map((item, idx) => {
      const bal = vchRunning.get(item.id) ?? 0;
      const isIn = ["cash_receipt", "customer_payment"].includes(item.voucherType);
      const sign = isIn ? "+" : "−";
      const color = isIn ? "#059669" : "#dc2626";
      return `<tr style="background:${idx % 2 === 0 ? "#fff" : "#f9fafb"}">
        <td>${fmtDate(item.voucherDate)}</td>
        <td>${item.voucherType.replace(/_/g, " ")}</td>
        <td style="text-align:right;color:${color};font-weight:600">${sign}${fmtAmt(item.amount)} ${item.currency}</td>
        <td style="text-align:right;font-weight:600;color:${bal < 0 ? "#dc2626" : "#111"}">${bal >= 0 ? "" : "−"}$${fmtAmt(Math.abs(bal))}</td>
        <td>${item.description ?? "—"}</td>
        <td>${item.receivedFrom ?? item.paidTo ?? "—"}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  @page { size: A4; margin: 15mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 2px solid #6366f1; }
  .gym { font-size: 18px; font-weight: 700; color: #6366f1; }
  .meta { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .report-title { font-size: 14px; font-weight: 700; text-align: right; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 10px; }
  th { background: #6366f1; color: #fff; padding: 7px 8px; text-align: left; font-weight: 600; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 6px 8px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
  .footer { margin-top: 12px; text-align: right; font-size: 9px; color: #9ca3af; }
  @media print { button { display: none; } }
</style></head>
<body>
  <div class="header">
    <div>
      <div class="gym">${gymName}</div>
      <div class="meta">${title}</div>
      <div class="meta">Period: ${dateLabel}</div>
    </div>
    <div>
      <div class="report-title">${title}</div>
      <div class="meta" style="text-align:right">Printed: ${new Date().toLocaleDateString("en-GB")} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
    </div>
  </div>
  ${isVch
    ? `<table>
        <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Balance (USD)</th><th>Description</th><th>Party</th></tr></thead>
        <tbody>${vchRows || "<tr><td colspan='6' style='text-align:center;padding:16px;color:#9ca3af'>No records</td></tr>"}</tbody>
       </table>`
    : `<table>
        <thead><tr><th>Date</th><th>Type / Category</th><th>Amount</th><th>Balance (USD)</th><th>Notes</th></tr></thead>
        <tbody>${payRows || "<tr><td colspan='5' style='text-align:center;padding:16px;color:#9ca3af'>No records</td></tr>"}</tbody>
       </table>`
  }
  <div class="footer">GymPro Cash Book — Generated ${new Date().toISOString().slice(0, 10)}</div>
</body></html>`;

    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
  }

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("nav.cashbook")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("cashbook.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportPdf} className="gap-2">
            <Printer className="w-4 h-4" />
            Export PDF
          </Button>
          {canManage && (
            <Button
              onClick={() => tab === "transactions" ? openPayCreate() : openVchCreate()}
              className="gap-2"
            >
              <Plus className="w-4 h-4" />
              {tab === "transactions" ? t("pay.recordPayment") : t("vch.newVoucher")}
            </Button>
          )}
        </div>
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Cash In Today"
          value={`$${fmtAmt(summary?.cashInToday)}`}
          icon={<ArrowDownCircle className="w-4 h-4" />}
          trend="up"
        />
        <KpiCard
          label="Cash Out Today"
          value={`$${fmtAmt(summary?.cashOutToday)}`}
          icon={<ArrowUpCircle className="w-4 h-4" />}
          trend="down"
        />
        <KpiCard
          label="Net Today"
          value={`$${fmtAmt(summary?.netCashToday)}`}
          icon={<TrendingUp className="w-4 h-4" />}
          trend="neutral"
        />
        <KpiCard
          label="Cash Balance"
          value={`$${fmtAmt(summary?.balanceUsd)}`}
          icon={<DollarSign className="w-4 h-4" />}
          trend="balance"
        />
      </div>

      {/* ── Tabs ── */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-border bg-muted/20">
          <TabButton active={tab === "transactions"} onClick={() => setTab("transactions")} icon={<Banknote className="w-4 h-4" />} label="Transactions" count={payTotal} />
          <TabButton active={tab === "vouchers"} onClick={() => setTab("vouchers")} icon={<Receipt className="w-4 h-4" />} label="Vouchers" count={vchTotal} />
        </div>

        {/* ── Transactions tab ── */}
        {tab === "transactions" && (
          <>
            {/* Filters */}
            <div className="flex flex-wrap gap-2 p-4 border-b border-border/50 bg-muted/10">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input className="pl-8 h-8 text-sm" placeholder="Search…" value={paySearch}
                  onChange={(e) => { setPaySearch(e.target.value); debounce("_ps", () => { setPaySearchD(e.target.value); setPayPage(1); }); }} />
              </div>
              <Select value={payDir} onValueChange={(v) => { setPayDir(v); setPayPage(1); }}>
                <SelectTrigger className="h-8 w-32 text-sm"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="in">Received</SelectItem>
                  <SelectItem value="out">Paid Out</SelectItem>
                </SelectContent>
              </Select>
              <Select value={payCat} onValueChange={(v) => { setPayCat(v); setPayPage(1); }}>
                <SelectTrigger className="h-8 w-40 text-sm"><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {PAY_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{t(`pay.cat.${c}`)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={payCur} onValueChange={(v) => { setPayCur(v); setPayPage(1); }}>
                <SelectTrigger className="h-8 w-24 text-sm"><SelectValue placeholder="Currency" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="CDF">CDF</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" className="h-8 w-36 text-sm" value={payDateFrom} onChange={(e) => { setPayDateFrom(e.target.value); setPayPage(1); }} />
              <Input type="date" className="h-8 w-36 text-sm" value={payDateTo} onChange={(e) => { setPayDateTo(e.target.value); setPayPage(1); }} />
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/20">
                    <th className="text-left px-5 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Date</th>
                    <th className="text-left px-5 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Type</th>
                    <th className="text-right px-5 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Amount</th>
                    <th className="text-right px-5 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Balance</th>
                    <th className="text-left px-5 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground hidden sm:table-cell">Notes</th>
                    {canManage && <th className="px-5 py-3 w-20" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {payListQ.isLoading ? (
                    <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">Loading…</td></tr>
                  ) : payItems.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-16">
                      <Banknote className="w-9 h-9 mx-auto text-muted-foreground/30 mb-2" />
                      <p className="text-muted-foreground font-medium">No transactions yet</p>
                      <p className="text-muted-foreground/50 text-xs mt-0.5">Record your first payment to get started</p>
                    </td></tr>
                  ) : payItems.map((item) => {
                    const bal = payRunning.get(item.id) ?? 0;
                    return (
                    <tr key={item.id} className="hover:bg-muted/20 transition-colors group">
                      <td className="px-5 py-3.5 whitespace-nowrap text-sm font-medium">{fmtDate(item.paymentDate)}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <DirBadge dir={item.direction} t={t} />
                          <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">{t(`pay.cat.${item.category}`)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <span className={`font-bold tabular-nums text-base ${item.direction === "in" ? "text-emerald-600" : "text-rose-600"}`}>
                          {item.direction === "out" ? "−" : "+"}
                          {fmtAmt(item.amount)}
                        </span>
                        <span className="ml-1.5 text-xs font-medium text-muted-foreground">{item.currency}</span>
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <span className={`font-bold tabular-nums text-sm ${bal >= 0 ? "text-foreground" : "text-rose-600"}`}>
                          ${fmtAmt(bal)}
                        </span>
                        <span className="ml-1 text-xs text-muted-foreground">USD</span>
                      </td>
                      <td className="px-5 py-3.5 hidden sm:table-cell max-w-[220px]">
                        <p className="text-sm text-muted-foreground truncate">{item.notes || "—"}</p>
                      </td>
                      {canManage && (
                        <td className="px-5 py-3.5">
                          <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openPayEdit(item)}><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setPayDeleteId(item.id)} disabled={item.status === "cancelled"}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {payPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border/50">
                <span className="text-xs text-muted-foreground">{payTotal} records</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPayPage((p) => Math.max(1, p - 1))} disabled={payPage === 1}><ChevronLeft className="w-4 h-4" /></Button>
                  <span className="text-xs">Page {payPage} of {payPages}</span>
                  <Button variant="outline" size="sm" onClick={() => setPayPage((p) => Math.min(payPages, p + 1))} disabled={payPage === payPages}><ChevronRight className="w-4 h-4" /></Button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Vouchers tab ── */}
        {tab === "vouchers" && (
          <>
            {/* Filters */}
            <div className="flex flex-wrap gap-2 p-4 border-b border-border/50 bg-muted/10">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input className="pl-8 h-8 text-sm" placeholder="Search…" value={vchSearch}
                  onChange={(e) => { setVchSearch(e.target.value); debounce("_vs", () => { setVchSearchD(e.target.value); setVchPage(1); }); }} />
              </div>
              <Select value={vchType} onValueChange={(v) => { setVchType(v); setVchPage(1); }}>
                <SelectTrigger className="h-8 w-44 text-sm"><SelectValue placeholder="All Types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {VOUCHER_TYPES.map((vt) => <SelectItem key={vt} value={vt}>{t(`vch.type.${vt}`)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={vchCur} onValueChange={(v) => { setVchCur(v); setVchPage(1); }}>
                <SelectTrigger className="h-8 w-24 text-sm"><SelectValue placeholder="Currency" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="CDF">CDF</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" className="h-8 w-36 text-sm" value={vchDateFrom} onChange={(e) => { setVchDateFrom(e.target.value); setVchPage(1); }} />
              <Input type="date" className="h-8 w-36 text-sm" value={vchDateTo} onChange={(e) => { setVchDateTo(e.target.value); setVchPage(1); }} />
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/20">
                    <th className="text-left px-5 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Date</th>
                    <th className="text-left px-5 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Type</th>
                    <th className="text-left px-5 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground hidden md:table-cell">From / To</th>
                    <th className="text-right px-5 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Amount</th>
                    <th className="text-right px-5 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Balance</th>
                    <th className="text-left px-5 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground hidden md:table-cell">Description</th>
                    {canManage && <th className="px-5 py-3 w-20" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {vchListQ.isLoading ? (
                    <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">Loading…</td></tr>
                  ) : vchItems.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-16">
                      <Receipt className="w-9 h-9 mx-auto text-muted-foreground/30 mb-2" />
                      <p className="text-muted-foreground font-medium">No vouchers yet</p>
                      <p className="text-muted-foreground/50 text-xs mt-0.5">Create your first voucher to get started</p>
                    </td></tr>
                  ) : vchItems.map((item) => {
                    const isIn = item.direction === "in";
                    const vbal = vchRunning.get(item.id) ?? 0;
                    return (
                      <tr key={item.id} className="hover:bg-muted/20 transition-colors group">
                        <td className="px-5 py-3.5 whitespace-nowrap text-sm font-medium">{fmtDate(item.voucherDate)}</td>
                        <td className="px-5 py-3.5">
                          <Badge className={`${isIn ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"} border-0 gap-1 text-xs`}>
                            {isIn ? <ArrowDownCircle className="w-3 h-3" /> : <ArrowUpCircle className="w-3 h-3" />}
                            {t(`vch.type.${item.voucherType}`)}
                          </Badge>
                        </td>
                        <td className="px-5 py-3.5 hidden md:table-cell text-sm font-medium">
                          {item.paidTo ?? item.receivedFrom ?? item.linkedEntityName ?? "—"}
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <span className={`font-bold tabular-nums text-base ${isIn ? "text-emerald-600" : "text-rose-600"}`}>
                            {isIn ? "+" : "−"}{fmtAmt(item.amount)}
                          </span>
                          <span className="ml-1.5 text-xs font-medium text-muted-foreground">{item.currency}</span>
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <span className={`font-bold tabular-nums text-sm ${vbal >= 0 ? "text-foreground" : "text-rose-600"}`}>
                            ${fmtAmt(vbal)}
                          </span>
                          <span className="ml-1 text-xs text-muted-foreground">USD</span>
                        </td>
                        <td className="px-5 py-3.5 hidden md:table-cell max-w-[200px]">
                          <p className="text-sm text-muted-foreground truncate">{item.description}</p>
                        </td>
                        {canManage && (
                          <td className="px-5 py-3.5">
                            <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => triggerPrint(item.id)} title="Print">
                                <Printer className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setVchDeleteId(item.id)} disabled={item.status === "cancelled"}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {vchPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border/50">
                <span className="text-xs text-muted-foreground">{vchTotal} records</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setVchPage((p) => Math.max(1, p - 1))} disabled={vchPage === 1}><ChevronLeft className="w-4 h-4" /></Button>
                  <span className="text-xs">Page {vchPage} of {vchPages}</span>
                  <Button variant="outline" size="sm" onClick={() => setVchPage((p) => Math.min(vchPages, p + 1))} disabled={vchPage === vchPages}><ChevronRight className="w-4 h-4" /></Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Hidden print template ── */}
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
              <tr><td>Voucher #</td><td>{printVoucher.voucherNumber ?? "—"}</td></tr>
              <tr><td>Date</td><td>{fmtDate(printVoucher.voucherDate)}</td></tr>
              <tr><td>Type</td><td>{t(`vch.type.${printVoucher.voucherType}`)}</td></tr>
              {printVoucher.receivedFrom && <tr><td>Received From</td><td>{printVoucher.receivedFrom}</td></tr>}
              {printVoucher.paidTo && <tr><td>Paid To</td><td>{printVoucher.paidTo}</td></tr>}
              <tr><td>Amount</td><td>{printVoucher.amount.toLocaleString()} {printVoucher.currency}</td></tr>
              <tr><td>Description</td><td>{printVoucher.description}</td></tr>
              <tr><td>Created By</td><td>{printVoucher.createdBy ?? "—"}</td></tr>
            </tbody>
          </table>
          <div className="sig">
            <div className="sig-line">Authorized By</div>
            <div className="sig-line">Received By</div>
          </div>
        </div>
      )}

      {/* ── Payment create/edit modal ── */}
      <Dialog open={payModal} onOpenChange={setPayModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{payEditId ? "Edit Transaction" : "Record Payment"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {/* Direction pills */}
            <div className="space-y-1.5">
              <Label>Type</Label>
              <div className="grid grid-cols-2 gap-2">
                {[{ v: "in", label: "Money In", icon: ArrowDownCircle }, { v: "out", label: "Money Out", icon: ArrowUpCircle }].map(({ v, label, icon: Icon }) => (
                  <button key={v} type="button" onClick={() => setPayForm({ ...payForm, direction: v })}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${payForm.direction === v
                      ? v === "in" ? "bg-emerald-50 border-emerald-400 text-emerald-700" : "bg-rose-50 border-rose-400 text-rose-700"
                      : "bg-muted/30 border-border text-muted-foreground hover:bg-muted"}`}>
                    <Icon className="w-3.5 h-3.5 shrink-0" />{label}
                  </button>
                ))}
              </div>
            </div>

            {/* Category */}
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={payForm.category} onValueChange={(v) => setPayForm({ ...payForm, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAY_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{t(`pay.cat.${c}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Name + Date */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Name / Person</Label>
                <Input placeholder="Member, vendor…" value={payForm.linkedEntityName} onChange={(e) => setPayForm({ ...payForm, linkedEntityName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={payForm.paymentDate} onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })} />
              </div>
            </div>

            {/* Amount + Currency */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Amount</Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={payForm.currency} onValueChange={(v) => setPayForm({ ...payForm, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="CDF">CDF</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea placeholder="Optional note…" value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayModal(false)}>Cancel</Button>
            <Button onClick={submitPay} disabled={createPayM.isPending || updatePayM.isPending}>
              {(createPayM.isPending || updatePayM.isPending) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Voucher create modal ── */}
      <Dialog open={vchModal} onOpenChange={setVchModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Voucher</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {/* Type pills */}
            <div className="space-y-1.5">
              <Label>Voucher Type</Label>
              <div className="grid grid-cols-2 gap-2">
                {VOUCHER_TYPES.map((vt) => {
                  const isIn = ["cash_receipt", "customer_payment"].includes(vt);
                  const active = vchForm.voucherType === vt;
                  return (
                    <button key={vt} type="button" onClick={() => setVchForm({ ...vchForm, voucherType: vt })}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                        active
                          ? isIn ? "bg-emerald-50 border-emerald-400 text-emerald-700" : "bg-rose-50 border-rose-400 text-rose-700"
                          : "bg-muted/30 border-border text-muted-foreground hover:bg-muted"}`}>
                      {isIn ? <ArrowDownCircle className="w-3.5 h-3.5 shrink-0" /> : <ArrowUpCircle className="w-3.5 h-3.5 shrink-0" />}
                      {t(`vch.type.${vt}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date */}
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={vchForm.voucherDate} onChange={(e) => setVchForm({ ...vchForm, voucherDate: e.target.value })} />
            </div>

            {/* From / To */}
            <div className="space-y-1.5">
              <Label>{vchIsIn ? "Received From" : "Paid To"}</Label>
              <Input
                placeholder={vchIsIn ? "Member name or payer…" : "Payee name…"}
                value={vchIsIn ? vchForm.receivedFrom : vchForm.paidTo}
                onChange={(e) => vchIsIn
                  ? setVchForm({ ...vchForm, receivedFrom: e.target.value })
                  : setVchForm({ ...vchForm, paidTo: e.target.value })}
              />
            </div>

            {/* Amount + Currency */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Amount</Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={vchForm.amount} onChange={(e) => setVchForm({ ...vchForm, amount: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={vchForm.currency} onValueChange={(v) => setVchForm({ ...vchForm, currency: v })}>
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
              <Label>Description *</Label>
              <Textarea placeholder="What is this for?" value={vchForm.description} onChange={(e) => setVchForm({ ...vchForm, description: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVchModal(false)}>Cancel</Button>
            <Button onClick={submitVch} disabled={createVchM.isPending}>
              {createVchM.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirms ── */}
      <AlertDialog open={!!payDeleteId} onOpenChange={(o) => !o && setPayDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this payment?</AlertDialogTitle>
            <AlertDialogDescription>This will mark the payment as cancelled.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deletePay} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!vchDeleteId} onOpenChange={(o) => !o && setVchDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this voucher?</AlertDialogTitle>
            <AlertDialogDescription>This will mark the voucher as cancelled.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteVch} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function TabButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
      }`}
    >
      {icon}
      {label}
      {count > 0 && (
        <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function KpiCard({ label, value, icon, trend }: { label: string; value: string; icon: React.ReactNode; trend: "up" | "down" | "neutral" | "balance" }) {
  const styles = {
    up: "bg-emerald-50 border-emerald-100 text-emerald-700",
    down: "bg-rose-50 border-rose-100 text-rose-700",
    neutral: "bg-blue-50 border-blue-100 text-blue-700",
    balance: "bg-violet-50 border-violet-100 text-violet-700",
  };
  const iconBg = {
    up: "bg-emerald-100",
    down: "bg-rose-100",
    neutral: "bg-blue-100",
    balance: "bg-violet-100",
  };
  return (
    <div className={`rounded-xl border p-4 ${styles[trend]}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium opacity-70">{label}</span>
        <span className={`w-7 h-7 rounded-full flex items-center justify-center ${iconBg[trend]}`}>
          {icon}
        </span>
      </div>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}

function DirBadge({ dir, t }: { dir: string; t: (k: string) => string }) {
  return dir === "in" ? (
    <Badge className="bg-emerald-100 text-emerald-700 border-0 gap-1 text-xs">
      <ArrowDownCircle className="w-3 h-3" />{t("pay.direction.in")}
    </Badge>
  ) : (
    <Badge className="bg-rose-100 text-rose-700 border-0 gap-1 text-xs">
      <ArrowUpCircle className="w-3 h-3" />{t("pay.direction.out")}
    </Badge>
  );
}
