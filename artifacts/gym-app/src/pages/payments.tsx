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
import { PageHeader } from "@/components/ui/page-header";
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
import { useFmtDate } from "@/lib/useFmtDate";

import {
  ArrowDownCircle,
  ArrowUpCircle,
  DollarSign,
  TrendingUp,
  Plus,
  Search,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  Printer,
  Loader2,
  Receipt,
  Banknote,
  ChevronDown,
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
  category: string;
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
  category: "",
});

// ─── Main component ────────────────────────────────────────────────────────
export default function CashBook() {
  const { t } = useI18n();
  const { fmtDate } = useFmtDate();
  const me = useGetMe();
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const canAdd = true; // anyone with Cash Book page access can add entries
  const canManage = me?.role === "admin" || me?.permissions?.viewAccounting; // edit/delete restricted

  // ── Unified filter state ──
  const [search, setSearch] = useState("");
  const [searchD, setSearchD] = useState("");
  const [dirFilter, setDirFilter] = useState("all");
  const [curFilter, setCurFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [dateTo, setDateTo] = useState("");

  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
  const isTodayActive = dateFrom === todayStr && dateTo === todayStr;
  const isYesterdayActive = dateFrom === yesterdayStr && dateTo === yesterdayStr;
  const setQuickDate = (d: string) => {
    const already = dateFrom === d && dateTo === d;
    setDateFrom(already ? "" : d);
    setDateTo(already ? "" : d);
    setPage(1);
  };
  const [page, setPage] = useState(1);

  // ── Modal state ──
  const [payModal, setPayModal] = useState(false);
  const [payEditId, setPayEditId] = useState<number | null>(null);
  const [payForm, setPayForm] = useState<PayForm>(emptyPayForm());
  const [payDeleteId, setPayDeleteId] = useState<number | null>(null);
  const [vchModal, setVchModal] = useState(false);
  const [vchForm, setVchForm] = useState<VchForm>(emptyVchForm());
  const [vchDeleteId, setVchDeleteId] = useState<number | null>(null);
  const [printId, setPrintId] = useState<number | null>(null);

  const LIMIT = 20;

  // ── Queries (fetch all for client-side merge) ──
  const summaryQ = useGetPaymentSummary();
  const summary = summaryQ.data;
  const settingsQ = useGetSettings();
  const settings = settingsQ.data;

  const payListQ = useListPayments({ page: 1, limit: 500 });
  const vchListQ = useListVouchers({ page: 1, limit: 500 });
  const printVoucherQ = useGetVoucher(printId ?? 0, {
    query: { enabled: !!printId, queryKey: ["voucher-print", printId] },
  });

  const payItemsRaw = payListQ.data?.items ?? [];
  const vchItemsRaw = vchListQ.data?.items ?? [];

  type PayEntry = (typeof payItemsRaw)[0] & { _kind: "payment" };
  type VchEntry = (typeof vchItemsRaw)[0] & { _kind: "voucher" };
  type UnifiedEntry = PayEntry | VchEntry;

  // ── Merge ──
  const allEntries = useMemo<UnifiedEntry[]>(() => {
    const pays = payItemsRaw.map((p) => ({ ...p, _kind: "payment" as const }));
    const vchs = vchItemsRaw.map((v) => ({ ...v, _kind: "voucher" as const }));
    return [...pays, ...vchs];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payListQ.data, vchListQ.data]);

  // ── Filter ──
  const filtered = useMemo(() => {
    return allEntries.filter((entry) => {
      const isIn = entry.direction === "in";
      if (dirFilter === "in" && !isIn) return false;
      if (dirFilter === "out" && isIn) return false;
      if (curFilter !== "all" && entry.currency !== curFilter) return false;
      const dateStr =
        entry._kind === "payment"
          ? (entry as PayEntry).paymentDate
          : (entry as VchEntry).voucherDate;
      if (dateFrom && dateStr && dateStr < dateFrom) return false;
      if (dateTo && dateStr && dateStr > dateTo) return false;
      if (searchD) {
        const q = searchD.toLowerCase();
        if (entry._kind === "payment") {
          const p = entry as PayEntry;
          const haystack = `${p.linkedEntityName ?? ""} ${p.notes ?? ""}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        } else {
          const v = entry as VchEntry;
          const haystack = `${v.receivedFrom ?? ""} ${v.paidTo ?? ""} ${v.description ?? ""} ${v.linkedEntityName ?? ""}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
      }
      return true;
    });
  }, [allEntries, dirFilter, curFilter, dateFrom, dateTo, searchD]);

  // ── Sort: newest day first; within same day payments before vouchers ──
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const dateA =
        a._kind === "payment" ? (a as PayEntry).paymentDate ?? "" : (a as VchEntry).voucherDate ?? "";
      const dateB =
        b._kind === "payment" ? (b as PayEntry).paymentDate ?? "" : (b as VchEntry).voucherDate ?? "";
      // Compare day portion only (first 10 chars of ISO string)
      const dayA = dateA.slice(0, 10);
      const dayB = dateB.slice(0, 10);
      if (dayA !== dayB) return dayB.localeCompare(dayA); // newest day first
      // Same day: payments (0) before vouchers (1)
      const kindA = a._kind === "payment" ? 0 : 1;
      const kindB = b._kind === "payment" ? 0 : 1;
      if (kindA !== kindB) return kindA - kindB;
      // Same kind: newest time first
      return dateB.localeCompare(dateA);
    });
  }, [filtered]);

  // ── Running balance (oldest→newest, tracking USD and CDF separately) ──
  const runningMap = useMemo(() => {
    const reversed = [...sorted].reverse();
    let sumUsd = 0, sumCdf = 0;
    const map = new Map<string, { usd: number; cdf: number }>();
    reversed.forEach((entry) => {
      const u = (entry.amountUsd as number | null) ?? 0;
      const c = (entry.amountCdf as number | null) ?? 0;
      if (entry.direction === "in") { sumUsd += u; sumCdf += c; }
      else { sumUsd -= u; sumCdf -= c; }
      map.set(`${entry._kind}-${entry.id}`, { usd: sumUsd, cdf: sumCdf });
    });
    return map;
  }, [sorted]);

  // ── Pagination ──
  const total = sorted.length;
  const pages = Math.ceil(total / LIMIT);
  const pageItems = sorted.slice((page - 1) * LIMIT, page * LIMIT);

  const isLoading = payListQ.isLoading || vchListQ.isLoading;

  // ── Mutations ──
  const createPayM = useCreatePayment();
  const updatePayM = useUpdatePayment();
  const deletePayM = useDeletePayment();
  const createVchM = useCreateVoucher();
  const deleteVchM = useDeleteVoucher();

  // ── Helpers ──
  function fmtAmt(n: number | null | undefined, cur?: string) {
    if (n === null || n === undefined) return "—";
    const s = n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return cur ? `${s} ${cur}` : s;
  }

  function debounce(key: string, fn: () => void, ms = 400) {
    clearTimeout(
      (window as unknown as Record<string, ReturnType<typeof setTimeout>>)[key]
    );
    (window as unknown as Record<string, ReturnType<typeof setTimeout>>)[key] =
      setTimeout(fn, ms);
  }

  const isAdmin = me?.role === "admin";

  // ── Payment handlers ──
  function openPayCreate() {
    setPayEditId(null);
    // Staff are locked to expense/out — prefill accordingly
    if (!isAdmin) {
      setPayForm({ ...emptyPayForm(), direction: "out", category: "expense" });
    } else {
      setPayForm(emptyPayForm());
    }
    setPayModal(true);
  }
  function openPayEdit(item: PayEntry) {
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
      paymentDate: item.paymentDate
        ? item.paymentDate.slice(0, 10)
        : new Date().toISOString().slice(0, 10),
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
      exchangeRate: settings?.usdToCdfRate ?? 2800,
      account: payForm.account,
      notes: payForm.notes || undefined,
      paymentDate: payForm.paymentDate || undefined,
    };
    if (!payload.amount) {
      toast({ title: "Amount is required", variant: "destructive" });
      return;
    }
    const opts = {
      onSuccess: () => {
        toast({ title: t("pay.recorded") });
        setPayModal(false);
        payListQ.refetch();
        summaryQ.refetch();
      },
      onError: () =>
        toast({ title: t("common.error"), variant: "destructive" }),
    };
    if (payEditId) updatePayM.mutate({ id: payEditId, data: payload }, opts);
    else createPayM.mutate({ data: payload }, opts);
  }

  async function deletePay() {
    if (!payDeleteId) return;
    deletePayM.mutate(
      { id: payDeleteId },
      {
        onSuccess: () => {
          toast({ title: t("pay.cancelled") });
          setPayDeleteId(null);
          payListQ.refetch();
          summaryQ.refetch();
        },
        onError: () =>
          toast({ title: t("common.error"), variant: "destructive" }),
      }
    );
  }

  // ── Voucher handlers ──
  function openVchCreate() {
    setVchForm(emptyVchForm());
    setVchModal(true);
  }

  async function submitVch() {
    const isIn = ["cash_receipt", "customer_payment"].includes(
      vchForm.voucherType
    );
    const payload = {
      voucherType: vchForm.voucherType as VoucherInputVoucherType,
      voucherDate: vchForm.voucherDate || undefined,
      receivedFrom: isIn ? vchForm.receivedFrom || undefined : undefined,
      paidTo: !isIn ? vchForm.paidTo || undefined : undefined,
      amount: parseFloat(vchForm.amount) || 0,
      currency: vchForm.currency as "USD" | "CDF",
      exchangeRate: settings?.usdToCdfRate ?? 1,
      description: vchForm.description,
      account: "cash",
      ...(vchForm.category ? { category: vchForm.category } : {}),
    };
    if (!payload.amount) {
      toast({ title: "Amount is required", variant: "destructive" });
      return;
    }
    if (!payload.description) {
      toast({ title: "Description is required", variant: "destructive" });
      return;
    }
    createVchM.mutate(
      { data: payload },
      {
        onSuccess: () => {
          toast({ title: t("vch.created") });
          setVchModal(false);
          vchListQ.refetch();
        },
        onError: () =>
          toast({ title: t("common.error"), variant: "destructive" }),
      }
    );
  }

  async function deleteVch() {
    if (!vchDeleteId) return;
    deleteVchM.mutate(
      { id: vchDeleteId },
      {
        onSuccess: () => {
          toast({ title: t("vch.cancelled") });
          setVchDeleteId(null);
          vchListQ.refetch();
        },
        onError: () =>
          toast({ title: t("common.error"), variant: "destructive" }),
      }
    );
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

  const vchIsIn = ["cash_receipt", "customer_payment"].includes(
    vchForm.voucherType
  );
  const printVoucher = printVoucherQ.data;

  // ── PDF export ──────────────────────────────────────────────────────────────
  function exportPdf() {
    const gymName =
      (settings as Record<string, unknown> | undefined)?.gymName as string ??
      "GymPro";
    const dateLabel = `${dateFrom || "all"} → ${dateTo || "all"}`;

    const rows = sorted.map((entry, idx) => {
      const key = `${entry._kind}-${entry.id}`;
      const balObj = runningMap.get(key) ?? { usd: 0, cdf: 0 };
      const isIn = entry.direction === "in";
      const sign = isIn ? "" : "−";
      const color = isIn ? "#059669" : "#dc2626";
      const date =
        entry._kind === "payment"
          ? fmtDate((entry as PayEntry).paymentDate)
          : fmtDate((entry as VchEntry).voucherDate);
      const typeStr =
        entry._kind === "payment"
          ? `${isIn ? "In" : "Out"} / ${(entry as PayEntry).category.replace(/_/g, " ")}`
          : (entry as VchEntry).voucherType.replace(/_/g, " ");
      const party =
        entry._kind === "payment"
          ? ((entry as PayEntry).linkedEntityName ?? "—")
          : ((entry as VchEntry).paidTo ?? (entry as VchEntry).receivedFrom ?? "—");
      const desc =
        entry._kind === "payment"
          ? ((entry as PayEntry).notes ?? "—")
          : ((entry as VchEntry).description ?? "—");

      return `<tr style="background:${idx % 2 === 0 ? "#fff" : "#f9fafb"}">
        <td>${date}</td>
        <td>${typeStr}</td>
        <td>${party}</td>
        <td style="text-align:right;color:${color};font-weight:600">${sign}${fmtAmt(entry.amount)} ${entry.currency}</td>
        <td style="text-align:right;font-weight:600;color:${balObj.usd < 0 ? "#dc2626" : "#111"}">$${fmtAmt(Math.abs(balObj.usd))} / FC ${Math.round(Math.abs(balObj.cdf)).toLocaleString()}</td>
        <td>${desc}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Cash Book</title>
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
      <div class="meta">Cash Book — All Entries</div>
      <div class="meta">Period: ${dateLabel}</div>
    </div>
    <div>
      <div class="report-title">Cash Book</div>
      <div class="meta" style="text-align:right">Printed: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
    </div>
  </div>
  <table>
    <thead><tr><th>Date</th><th>Type / Category</th><th>Party</th><th>Amount</th><th>Balance (USD)</th><th>Description</th></tr></thead>
    <tbody>${rows || "<tr><td colspan='6' style='text-align:center;padding:16px;color:#9ca3af'>No records</td></tr>"}</tbody>
  </table>
  <div class="footer">GymPro Cash Book — Generated ${new Date().toISOString().slice(0, 10)}</div>
</body></html>`;

    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => {
      w.focus();
      w.print();
    }, 400);
  }

  return (
    <div className="space-y-6">

      <PageHeader
        icon={Banknote}
        iconClass="bg-emerald-500/10 text-emerald-600"
        title={t("nav.cashbook")}
        subtitle={t("cashbook.subtitle")}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportPdf} className="gap-2">
              <Printer className="w-4 h-4" />
              Export PDF
            </Button>
            {canAdd && (
              <Button className="gap-2" onClick={openPayCreate}>
                <Plus className="w-4 h-4" />
                New Entry
              </Button>
            )}
          </>
        }
      />

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Cash In Today"
          value={`$${fmtAmt(summary?.cashInToday)}`}
          sub={`FC ${fmtAmt(summary?.cashInTodayCdf)}`}
          icon={<ArrowDownCircle className="w-4 h-4" />}
          trend="up"
        />
        <KpiCard
          label="Cash Out Today"
          value={`$${fmtAmt(summary?.cashOutToday)}`}
          sub={`FC ${fmtAmt(summary?.cashOutTodayCdf)}`}
          icon={<ArrowUpCircle className="w-4 h-4" />}
          trend="down"
        />
        <KpiCard
          label="Net Today"
          value={`$${fmtAmt(summary?.netCashToday)}`}
          sub={`FC ${fmtAmt(summary?.netCashTodayCdf)}`}
          icon={<TrendingUp className="w-4 h-4" />}
          trend="neutral"
        />
        <KpiCard
          label="Cash Balance"
          value={`$${fmtAmt(summary?.balanceUsd)}`}
          sub={`FC ${fmtAmt(summary?.balanceCdf)}`}
          icon={<DollarSign className="w-4 h-4" />}
          trend="balance"
        />
      </div>

      {/* ── Unified table ── */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">

        {/* Filters */}
        <div className="p-4 border-b border-border/50 bg-muted/10 space-y-2">
          {/* Search row — always visible */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                className="pl-8 h-8 text-sm"
                placeholder="Search name, description…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  debounce("_cs", () => {
                    setSearchD(e.target.value);
                    setPage(1);
                  });
                }}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="md:hidden h-8 gap-1.5 shrink-0 text-sm"
              onClick={() => setShowFilters(v => !v)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
              {(dirFilter !== "all" || curFilter !== "all" || dateFrom || dateTo) && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </Button>
          </div>
          {/* Collapsible filters — hidden on mobile by default, always shown on md+ */}
          <div className={`flex flex-wrap gap-2 ${showFilters ? "flex" : "hidden md:flex"}`}>
            <Select
              value={dirFilter}
              onValueChange={(v) => { setDirFilter(v); setPage(1); }}
            >
              <SelectTrigger className="h-8 w-32 text-sm">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="in">Money In</SelectItem>
                <SelectItem value="out">Money Out</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex rounded-lg border border-border overflow-hidden text-xs font-semibold">
              {(["all", "USD", "CDF"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => { setCurFilter(v); setPage(1); }}
                  className={`px-3 h-8 transition-colors ${
                    curFilter === v
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted"
                  } ${v !== "all" ? "border-l border-border" : ""}`}
                >
                  {v === "all" ? "All" : v}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg border border-border overflow-hidden text-xs font-semibold">
              {([["Today", todayStr, isTodayActive], ["Yesterday", yesterdayStr, isYesterdayActive]] as const).map(([label, d, active]) => (
                <button
                  key={label}
                  onClick={() => setQuickDate(d)}
                  className={`px-3 h-8 transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted"
                  } ${label === "Yesterday" ? "border-l border-border" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <Input
              type="date"
              className="h-8 w-36 text-sm"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            />
            <Input
              type="date"
              className="h-8 w-36 text-sm"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        {/* Mobile card view */}
        <div className="md:hidden divide-y divide-border/40">
          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground text-sm">Loading…</div>
          ) : pageItems.length === 0 ? (
            <div className="p-10 text-center">
              <Banknote className="w-9 h-9 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground font-medium">No entries found</p>
            </div>
          ) : pageItems.map((entry) => {
            const key = `${entry._kind}-${entry.id}`;
            const bal = runningMap.get(key) ?? { usd: 0, cdf: 0 };
            const isIn = entry.direction === "in";
            const date = entry._kind === "payment" ? (entry as PayEntry).paymentDate : (entry as VchEntry).voucherDate;
            const party = entry._kind === "payment" ? (entry as PayEntry).linkedEntityName : ((entry as VchEntry).paidTo ?? (entry as VchEntry).receivedFrom ?? (entry as VchEntry).linkedEntityName);
            const desc = entry._kind === "payment" ? (entry as PayEntry).notes : (entry as VchEntry).description;
            return (
              <div key={key} className="flex items-start gap-3 px-4 py-3.5 border-b border-border/30 last:border-0">
                {/* Color stripe */}
                <div className={`w-0.5 self-stretch rounded-full shrink-0 ${isIn ? "bg-emerald-400" : "bg-rose-400"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs text-muted-foreground">{fmtDate(date)}</span>
                    {entry._kind === "payment" ? (
                      <DirBadge dir={(entry as PayEntry).direction} t={t} />
                    ) : (
                      <Badge className={`${isIn ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"} border-0 gap-1 text-xs`}>
                        {isIn ? <ArrowDownCircle className="w-3 h-3" /> : <ArrowUpCircle className="w-3 h-3" />}
                        {t(`vch.type.${(entry as VchEntry).voucherType}`)}
                      </Badge>
                    )}
                    {entry._kind === "payment" && (entry as PayEntry).category === "membership" && (entry as PayEntry).planName && (
                      <span className="text-xs text-muted-foreground">— {(entry as PayEntry).planName}</span>
                    )}
                  </div>
                  {party && <p className="text-sm font-medium truncate">{party}</p>}
                  {desc && <p className="text-xs text-muted-foreground truncate mt-0.5">{desc}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className={`font-bold tabular-nums text-sm ${isIn ? "text-emerald-600" : "text-rose-600"}`}>
                    {entry.currency === "USD" ? "$" : "FC "}{isIn ? "" : "−"}{fmtAmt(entry.amount)}
                  </p>
                  <p className={`text-xs tabular-nums mt-0.5 ${bal.usd >= 0 ? "text-muted-foreground" : "text-rose-600"}`}>
                    ${fmtAmt(bal.usd)}
                  </p>
                  {bal.cdf !== 0 && (
                    <p className={`text-xs tabular-nums ${bal.cdf >= 0 ? "text-muted-foreground" : "text-rose-600"}`}>
                      FC {Math.round(bal.cdf).toLocaleString()}
                    </p>
                  )}
                </div>
                {canManage && (
                  <div className="flex gap-1 shrink-0 mt-0.5">
                    {entry._kind === "payment" ? (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openPayEdit(entry as PayEntry)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setPayDeleteId(entry.id)} disabled={entry.status === "cancelled"}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => triggerPrint(entry.id)}>
                          <Printer className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setVchDeleteId(entry.id)} disabled={entry.status === "cancelled"}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/20">
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground w-28">Date</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Details</th>
                <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground w-36">Amount</th>
                <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground w-44">Running Balance</th>
                {canManage && <th className="px-4 py-3 w-20" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-muted-foreground">Loading…</td>
                </tr>
              ) : pageItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-16">
                    <Banknote className="w-9 h-9 mx-auto text-muted-foreground/30 mb-2" />
                    <p className="text-muted-foreground font-medium">No entries found</p>
                    <p className="text-muted-foreground/50 text-xs mt-0.5">Try adjusting your filters</p>
                  </td>
                </tr>
              ) : (
                pageItems.map((entry) => {
                  const key = `${entry._kind}-${entry.id}`;
                  const bal = runningMap.get(key) ?? { usd: 0, cdf: 0 };
                  const isIn = entry.direction === "in";
                  const date = entry._kind === "payment" ? (entry as PayEntry).paymentDate : (entry as VchEntry).voucherDate;
                  const party = entry._kind === "payment"
                    ? (entry as PayEntry).linkedEntityName
                    : ((entry as VchEntry).paidTo ?? (entry as VchEntry).receivedFrom ?? (entry as VchEntry).linkedEntityName);
                  const description = entry._kind === "payment"
                    ? (entry as PayEntry).notes
                    : (entry as VchEntry).description;

                  return (
                    <tr key={key} className="border-b border-border/30 hover:bg-muted/20 transition-colors group">
                      {/* Date */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-xs text-muted-foreground font-medium">{fmtDate(date)}</span>
                      </td>

                      {/* Details — badge + party + description */}
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2.5">
                          {/* Left color stripe */}
                          <div className={`w-0.5 self-stretch rounded-full shrink-0 mt-0.5 ${isIn ? "bg-emerald-400" : "bg-rose-400"}`} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-0.5">
                              {entry._kind === "payment" ? (
                                <span className="text-xs font-semibold text-foreground/80">
                                  {t(`pay.cat.${(entry as PayEntry).category}`)}
                                </span>
                              ) : (
                                <span className="text-xs font-semibold text-foreground/80">
                                  {t(`vch.type.${(entry as VchEntry).voucherType}`)}
                                </span>
                              )}
                              {entry._kind === "payment" && (entry as PayEntry).category === "membership" && (entry as PayEntry).planName && (
                                <span className="text-xs text-muted-foreground">— {(entry as PayEntry).planName}</span>
                              )}
                            </div>
                            {party && <p className="text-sm font-medium truncate max-w-xs">{party}</p>}
                            {description && <p className="text-xs text-muted-foreground truncate max-w-xs mt-0.5">{description}</p>}
                          </div>
                        </div>
                      </td>

                      {/* Amount */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className={`font-bold tabular-nums text-base ${isIn ? "text-emerald-600" : "text-rose-600"}`}>
                          {entry.currency === "USD" ? "$" : "FC "}{isIn ? "" : "−"}{fmtAmt(entry.amount)}
                        </span>
                      </td>

                      {/* Running Balance — USD + CDF */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <p className={`font-semibold tabular-nums text-sm ${bal.usd >= 0 ? "text-foreground" : "text-rose-600"}`}>
                          ${fmtAmt(bal.usd)}
                        </p>
                        <p className={`text-xs tabular-nums mt-0.5 ${bal.cdf >= 0 ? "text-muted-foreground" : "text-rose-500"}`}>
                          FC {Math.round(bal.cdf).toLocaleString()}
                        </p>
                      </td>

                      {/* Actions */}
                      {canManage && (
                        <td className="px-4 py-3">
                          <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            {entry._kind === "payment" ? (
                              <>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openPayEdit(entry as PayEntry)}>
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setPayDeleteId(entry.id)} disabled={entry.status === "cancelled"}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => triggerPrint(entry.id)} title="Print voucher">
                                  <Printer className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setVchDeleteId(entry.id)} disabled={entry.status === "cancelled"}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border/50">
            <span className="text-xs text-muted-foreground">
              {total} entries
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-xs">
                Page {page} of {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page === pages}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Hidden print template ── */}
      {printVoucher && (
        <div ref={printRef} className="hidden">
          <div className="header">
            <div className="logo">
              {settings?.gymName ?? "Oxygen Fitness Gym"}
            </div>
            {settings?.address && (
              <div style={{ fontSize: 13, color: "#666" }}>
                {settings.address}
              </div>
            )}
            {settings?.phone && (
              <div style={{ fontSize: 13, color: "#666" }}>
                {settings.phone}
              </div>
            )}
            <div className="title">
              {t(`vch.type.${printVoucher.voucherType}`)}
            </div>
          </div>
          <table>
            <tbody>
              <tr>
                <td>Date</td>
                <td>{fmtDate(printVoucher.voucherDate)}</td>
              </tr>
              <tr>
                <td>Type</td>
                <td>{t(`vch.type.${printVoucher.voucherType}`)}</td>
              </tr>
              {printVoucher.receivedFrom && (
                <tr>
                  <td>Received From</td>
                  <td>{printVoucher.receivedFrom}</td>
                </tr>
              )}
              {printVoucher.paidTo && (
                <tr>
                  <td>Paid To</td>
                  <td>{printVoucher.paidTo}</td>
                </tr>
              )}
              <tr>
                <td>Amount</td>
                <td>
                  {printVoucher.amount.toLocaleString()} {printVoucher.currency}
                </td>
              </tr>
              <tr>
                <td>Description</td>
                <td>{printVoucher.description}</td>
              </tr>
              <tr>
                <td>Created By</td>
                <td>{printVoucher.createdBy ?? "—"}</td>
              </tr>
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
            <DialogTitle>
              {payEditId ? "Edit Transaction" : "Record Payment"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {/* Type — locked to Money Out for staff */}
            {isAdmin ? (
              <div className="space-y-1.5">
                <Label>Type</Label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { v: "in", label: "Money In", icon: ArrowDownCircle },
                    { v: "out", label: "Money Out", icon: ArrowUpCircle },
                  ].map(({ v, label, icon: Icon }) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setPayForm({ ...payForm, direction: v })}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                        payForm.direction === v
                          ? v === "in"
                            ? "bg-emerald-50 border-emerald-400 text-emerald-700"
                            : "bg-rose-50 border-rose-400 text-rose-700"
                          : "bg-muted/30 border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-rose-400 bg-rose-50 text-rose-700 text-sm font-medium w-full">
                <ArrowUpCircle className="w-3.5 h-3.5 shrink-0" />
                Money Out — Expense
              </div>
            )}

            {/* Category — locked to Expense for staff */}
            {isAdmin && (
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select
                  value={payForm.category}
                  onValueChange={(v) => setPayForm({ ...payForm, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAY_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {t(`pay.cat.${c}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={payForm.paymentDate}
                onChange={(e) =>
                  setPayForm({ ...payForm, paymentDate: e.target.value })
                }
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Amount</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={payForm.amount}
                  onChange={(e) =>
                    setPayForm({ ...payForm, amount: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select
                  value={payForm.currency}
                  onValueChange={(v) =>
                    setPayForm({ ...payForm, currency: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="CDF">CDF</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                placeholder="Optional note…"
                value={payForm.notes}
                onChange={(e) =>
                  setPayForm({ ...payForm, notes: e.target.value })
                }
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitPay}
              disabled={createPayM.isPending || updatePayM.isPending}
            >
              {(createPayM.isPending || updatePayM.isPending) && (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              )}
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
            <div className="space-y-1.5">
              <Label>Voucher Type</Label>
              <div className="grid grid-cols-2 gap-2">
                {VOUCHER_TYPES.map((vt) => {
                  const isIn = ["cash_receipt", "customer_payment"].includes(vt);
                  const active = vchForm.voucherType === vt;
                  return (
                    <button
                      key={vt}
                      type="button"
                      onClick={() =>
                        setVchForm({ ...vchForm, voucherType: vt })
                      }
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                        active
                          ? isIn
                            ? "bg-emerald-50 border-emerald-400 text-emerald-700"
                            : "bg-rose-50 border-rose-400 text-rose-700"
                          : "bg-muted/30 border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {isIn ? (
                        <ArrowDownCircle className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <ArrowUpCircle className="w-3.5 h-3.5 shrink-0" />
                      )}
                      {t(`vch.type.${vt}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={vchForm.voucherDate}
                onChange={(e) =>
                  setVchForm({ ...vchForm, voucherDate: e.target.value })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>{vchIsIn ? "Received From" : "Paid To"}</Label>
              <Input
                placeholder={
                  vchIsIn ? "Member name or payer…" : "Payee name…"
                }
                value={vchIsIn ? vchForm.receivedFrom : vchForm.paidTo}
                onChange={(e) =>
                  vchIsIn
                    ? setVchForm({ ...vchForm, receivedFrom: e.target.value })
                    : setVchForm({ ...vchForm, paidTo: e.target.value })
                }
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Amount</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={vchForm.amount}
                  onChange={(e) =>
                    setVchForm({ ...vchForm, amount: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select
                  value={vchForm.currency}
                  onValueChange={(v) =>
                    setVchForm({ ...vchForm, currency: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="CDF">CDF</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={vchForm.category}
                onValueChange={(v) => setVchForm({ ...vchForm, category: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="membership">Membership</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="payroll">Payroll</SelectItem>
                  <SelectItem value="stock_purchase">Stock Purchase</SelectItem>
                  <SelectItem value="product_sale">Product Sale</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Description *</Label>
              <Textarea
                placeholder="What is this for?"
                value={vchForm.description}
                onChange={(e) =>
                  setVchForm({ ...vchForm, description: e.target.value })
                }
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVchModal(false)}>
              Cancel
            </Button>
            <Button onClick={submitVch} disabled={createVchM.isPending}>
              {createVchM.isPending && (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirms ── */}
      <AlertDialog
        open={!!payDeleteId}
        onOpenChange={(o) => !o && setPayDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this payment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the payment as cancelled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deletePay}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!vchDeleteId}
        onOpenChange={(o) => !o && setVchDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this voucher?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the voucher as cancelled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteVch}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function DirBadge({ dir, t }: { dir: string; t: (k: string) => string }) {
  const isIn = dir === "in";
  return (
    <Badge
      className={`${isIn ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"} border-0 gap-1 text-xs`}
    >
      {isIn ? (
        <ArrowDownCircle className="w-3 h-3" />
      ) : (
        <ArrowUpCircle className="w-3 h-3" />
      )}
      {t(isIn ? "pay.in" : "pay.out")}
    </Badge>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  trend: "up" | "down" | "neutral" | "balance";
}) {
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
        <span
          className={`w-7 h-7 rounded-full flex items-center justify-center ${iconBg[trend]}`}
        >
          {icon}
        </span>
      </div>
      <p className="text-xl font-bold">{value}</p>
      {sub && <p className="text-xs font-medium opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
}
