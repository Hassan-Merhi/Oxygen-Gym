import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe } from "@/hooks/use-me";
import { useGetSettings } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useFmtDate } from "@/lib/useFmtDate";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  accountLabel,
  apiRequest,
  businessDateKey,
  errorMessage,
  formatAmount,
  formatRate,
  qs,
  rangeForPreset,
  useApi,
  type DatePreset,
  type Money,
} from "@/lib/accounting-client";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Coins,
  FileDown,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

const PAGE_SIZE = 25;
const AUTO_REFRESH_MS = 20_000;

type DirectionFilter = "all" | "in" | "out";
type CurrencyFilter = "all" | "USD" | "CDF";

type CashMovement = {
  entryId: number;
  journalId: string;
  sourceType: string;
  sourceId: number | null;
  sourceNumber: string | null;
  date: string;
  dateKey: string;
  direction: "in" | "out";
  category: string;
  amount: number;
  currency: string;
  amountUsd: number;
  amountCdf: number;
  description: string;
  party: string;
  createdBy: string | null;
  balanceUsd: number;
  balanceCdf: number;
};

type CashBook = {
  account: string;
  exchangeRate: number;
  opening: Money;
  closing: Money;
  totals: { inUsd: number; outUsd: number; inCdf: number; outCdf: number };
  items: CashMovement[];
};

type DrawerBalance = { nativeUsd: number; nativeCdf: number; rate: number; lockedThrough: string | null };

type PaymentRow = {
  id: number;
  paymentNumber?: string | null;
  direction: string;
  category: string;
  linkedEntityName?: string | null;
  amount: number;
  currency: string;
  account?: string | null;
  notes?: string | null;
  paymentDate: string;
};

type PayForm = {
  direction: string;
  category: string;
  linkedEntityName: string;
  amount: string;
  currency: string;
  notes: string;
  paymentDate: string;
};

type VoucherForm = {
  voucherType: string;
  voucherDate: string;
  counterparty: string;
  amount: string;
  currency: string;
  description: string;
  category: string;
};

const PAY_CATEGORIES = ["membership", "product_sale", "expense", "other"] as const;
const VOUCHER_TYPES = ["cash_receipt", "cash_payment", "expense", "customer_payment"] as const;
const DATE_PRESETS: DatePreset[] = ["today", "yesterday", "month", "last_month", "year", "custom", "all"];
const CORRECTABLE = new Set(["payment", "voucher"]);

function emptyPayForm(): PayForm {
  return { direction: "in", category: "other", linkedEntityName: "", amount: "", currency: "USD", notes: "", paymentDate: businessDateKey() };
}

function emptyVoucherForm(): VoucherForm {
  return { voucherType: "cash_receipt", voucherDate: businessDateKey(), counterparty: "", amount: "", currency: "USD", description: "", category: "" };
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function MetricCard({ label, usd, cdf, icon: Icon, tone, hint, language }: {
  label: string;
  usd: number | undefined;
  cdf: number | undefined;
  icon: LucideIcon;
  tone: "emerald" | "rose" | "blue" | "violet";
  hint?: string;
  language: string;
}) {
  const styles = {
    emerald: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/15",
    rose: "bg-rose-500/10 text-rose-500 ring-rose-500/15",
    blue: "bg-blue-500/10 text-blue-500 ring-blue-500/15",
    violet: "bg-violet-500/10 text-violet-500 ring-violet-500/15",
  }[tone];
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-2 truncate text-xl font-bold tracking-tight tabular-nums sm:text-2xl">{usd === undefined ? "—" : formatAmount(usd, "USD", language)}</p>
          <p className="mt-0.5 truncate text-sm font-medium tabular-nums text-muted-foreground">{cdf === undefined ? "" : formatAmount(cdf, "CDF", language)}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground/80">{hint}</p>}
        </div>
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1", styles)} aria-hidden="true">
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

export default function CashBookCanonical() {
  const { fmtDate } = useFmtDate();
  const { t, language } = useI18n();
  const me = useGetMe();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings } = useGetSettings();
  const isAdmin = me?.role === "admin";
  const permissions = (me?.permissions ?? {}) as Record<string, boolean | undefined>;
  const canRecordVoucher = isAdmin || !!permissions.vouchers;
  const canCorrect = isAdmin || !!permissions.approveCorrections;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [currency, setCurrency] = useState<CurrencyFilter>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [customFrom, setCustomFrom] = useState(businessDateKey());
  const [customTo, setCustomTo] = useState(businessDateKey());

  const [payModal, setPayModal] = useState(false);
  const [payEditId, setPayEditId] = useState<number | null>(null);
  const [payForm, setPayForm] = useState<PayForm>(emptyPayForm());
  const [paySaving, setPaySaving] = useState(false);
  const [payDeleteId, setPayDeleteId] = useState<number | null>(null);
  const [voucherModal, setVoucherModal] = useState(false);
  const [voucherForm, setVoucherForm] = useState<VoucherForm>(emptyVoucherForm());
  const [voucherSaving, setVoucherSaving] = useState(false);
  const [voucherDeleteId, setVoucherDeleteId] = useState<number | null>(null);
  const [countModal, setCountModal] = useState(false);
  const [countUsd, setCountUsd] = useState("");
  const [countCdf, setCountCdf] = useState("");
  const [countNotes, setCountNotes] = useState("");
  const [countSaving, setCountSaving] = useState(false);
  const [summarySending, setSummarySending] = useState(false);

  const range = useMemo(() => rangeForPreset(datePreset, customFrom, customTo), [datePreset, customFrom, customTo]);
  const refresh = { refetchInterval: AUTO_REFRESH_MS, refetchOnWindowFocus: true } as const;
  const bookQ = useApi<CashBook>(`/api/ledger/movements${qs({ dateFrom: range.from, dateTo: range.to })}`, refresh);
  const balanceQ = useApi<DrawerBalance>("/api/ledger/balance", refresh);

  const book = bookQ.data;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (book?.items ?? [])
      .filter((entry) => {
        if (direction !== "all" && entry.direction !== direction) return false;
        if (currency !== "all" && entry.currency !== currency) return false;
        if (!query) return true;
        return [entry.sourceNumber, entry.party, entry.description, entry.category, entry.createdBy]
          .filter(Boolean).join(" ").toLowerCase().includes(query);
      })
      .reverse();
  }, [book, direction, currency, search]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageEntries = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const lockedThrough = balanceQ.data?.lockedThrough ? businessDateKey(balanceQ.data.lockedThrough) : null;
  const isLocked = (entry: CashMovement) => !!lockedThrough && entry.dateKey <= lockedThrough;
  const activeFilters = direction !== "all" || currency !== "all" || search.trim() !== "";
  const presetLabel = t(`cb.preset.${datePreset}`);

  async function refreshAll() {
    await queryClient.invalidateQueries();
  }

  function fail(error: unknown) {
    toast({ title: errorMessage(error, t), variant: "destructive" });
  }

  function resetFilters() {
    setSearch(""); setDirection("all"); setCurrency("all"); setDatePreset("today"); setPage(1);
  }

  function openPaymentCreate() {
    setPayEditId(null);
    setPayForm(isAdmin ? emptyPayForm() : { ...emptyPayForm(), direction: "out", category: "expense" });
    setPayModal(true);
  }

  async function openPaymentEdit(entry: CashMovement) {
    try {
      const result = await apiRequest<{ items: PaymentRow[] }>(`/api/payments${qs({ page: 1, limit: 10, search: entry.sourceNumber ?? "" })}`);
      const row = result.items.find((item) => item.id === entry.sourceId);
      if (!row) throw new Error(t("cb.error.notFound"));
      setPayEditId(row.id);
      setPayForm({
        direction: row.direction,
        category: row.category,
        linkedEntityName: row.linkedEntityName ?? "",
        amount: String(row.amount ?? ""),
        currency: row.currency,
        notes: row.notes ?? "",
        paymentDate: businessDateKey(row.paymentDate),
      });
      setPayModal(true);
    } catch (error) { fail(error); }
  }

  async function savePayment() {
    const amount = Number(payForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) { toast({ title: t("cb.error.amount"), variant: "destructive" }); return; }
    setPaySaving(true);
    try {
      await apiRequest(payEditId ? `/api/payments/${payEditId}` : "/api/payments", {
        method: payEditId ? "PATCH" : "POST",
        body: JSON.stringify({
          direction: payForm.direction,
          category: payForm.category,
          linkedEntityName: payForm.linkedEntityName.trim() || undefined,
          amount,
          discount: 0,
          currency: payForm.currency,
          account: "cash",
          notes: payForm.notes.trim() || undefined,
          paymentDate: payForm.paymentDate || undefined,
        }),
      });
      toast({ title: payEditId ? t("cb.toast.updated") : t("cb.toast.recorded") });
      setPayModal(false);
      await refreshAll();
    } catch (error) { fail(error); }
    finally { setPaySaving(false); }
  }

  async function cancelPayment() {
    if (!payDeleteId) return;
    try {
      await apiRequest(`/api/payments/${payDeleteId}`, { method: "DELETE" });
      setPayDeleteId(null);
      toast({ title: t("cb.toast.cancelled") });
      await refreshAll();
    } catch (error) { setPayDeleteId(null); fail(error); }
  }

  async function saveVoucher() {
    const amount = Number(voucherForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) { toast({ title: t("cb.error.amount"), variant: "destructive" }); return; }
    if (!voucherForm.description.trim()) { toast({ title: t("cb.error.description"), variant: "destructive" }); return; }
    const incoming = ["cash_receipt", "customer_payment"].includes(voucherForm.voucherType);
    setVoucherSaving(true);
    try {
      await apiRequest("/api/vouchers", {
        method: "POST",
        body: JSON.stringify({
          voucherType: voucherForm.voucherType,
          voucherDate: voucherForm.voucherDate || undefined,
          receivedFrom: incoming ? voucherForm.counterparty.trim() || undefined : undefined,
          paidTo: incoming ? undefined : voucherForm.counterparty.trim() || undefined,
          amount,
          currency: voucherForm.currency,
          account: "cash",
          category: voucherForm.category || undefined,
          description: voucherForm.description.trim(),
        }),
      });
      setVoucherModal(false);
      toast({ title: t("cb.toast.voucher") });
      await refreshAll();
    } catch (error) { fail(error); }
    finally { setVoucherSaving(false); }
  }

  async function cancelVoucher() {
    if (!voucherDeleteId) return;
    try {
      await apiRequest(`/api/vouchers/${voucherDeleteId}`, { method: "DELETE" });
      setVoucherDeleteId(null);
      toast({ title: t("cb.toast.voucherCancelled") });
      await refreshAll();
    } catch (error) { setVoucherDeleteId(null); fail(error); }
  }

  function openCashCount() {
    setCountUsd(String(Math.max(0, balanceQ.data?.nativeUsd ?? 0)));
    setCountCdf(String(Math.max(0, Math.round(balanceQ.data?.nativeCdf ?? 0))));
    setCountNotes("");
    setCountModal(true);
  }

  async function saveCashCount() {
    const countedUsd = Number(countUsd);
    const countedCdf = Number(countCdf);
    if (![countedUsd, countedCdf].every((value) => Number.isFinite(value) && value >= 0)) {
      toast({ title: t("cb.error.amount"), variant: "destructive" });
      return;
    }
    setCountSaving(true);
    try {
      const result = await apiRequest<{ skipped?: boolean }>("/api/ledger/opening-balance", {
        method: "POST",
        body: JSON.stringify({ countedUsd, countedCdf, notes: countNotes.trim() || undefined }),
      });
      setCountModal(false);
      toast({ title: result.skipped ? t("cb.toast.countMatches") : t("cb.toast.countPosted") });
      await refreshAll();
    } catch (error) { fail(error); }
    finally { setCountSaving(false); }
  }

  async function sendDailySummary() {
    setSummarySending(true);
    try {
      await apiRequest("/api/whatsapp/send-daily-summary", { method: "POST" });
      toast({ title: t("cb.toast.summary") });
    } catch (error) { fail(error); }
    finally { setSummarySending(false); }
  }

  function printDocument(title: string, body: string) {
    const popup = window.open("", "_blank", "width=1000,height=720");
    if (!popup) return;
    const dir = language === "ar" ? "rtl" : "ltr";
    popup.document.write(`<!doctype html><html lang="${language}" dir="${dir}"><head><title>${escapeHtml(title)}</title><style>@page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;font-size:11px;color:#111}table{width:100%;border-collapse:collapse;margin-top:16px}th{background:#111827;color:#fff;text-align:start;padding:7px}td{padding:7px;border-bottom:1px solid #e5e7eb}.num{text-align:end;font-variant-numeric:tabular-nums}</style></head><body>${body}</body></html>`);
    popup.document.close();
    setTimeout(() => { popup.focus(); popup.print(); }, 300);
  }

  function printVoucher(entry: CashMovement) {
    const incoming = entry.direction === "in";
    printDocument(entry.sourceNumber ?? t("cb.voucher"), `<h1>${escapeHtml(settings?.gymName ?? "Oxygen Fitness Gym")}</h1><h2>${escapeHtml(entry.sourceNumber ?? "")}</h2><table><tbody><tr><td>${escapeHtml(t("acc.col.date"))}</td><td>${escapeHtml(fmtDate(entry.date))}</td></tr><tr><td>${escapeHtml(incoming ? t("cb.receivedFrom") : t("cb.paidTo"))}</td><td>${escapeHtml(entry.party || "—")}</td></tr><tr><td>${escapeHtml(t("acc.col.amount"))}</td><td>${escapeHtml(formatAmount(entry.amount, entry.currency, language))}</td></tr><tr><td>${escapeHtml(t("acc.col.description"))}</td><td>${escapeHtml(entry.description || "—")}</td></tr></tbody></table>`);
  }

  function exportReport() {
    if (!book) return;
    const rows = filtered.slice().reverse().map((entry) => `<tr><td>${escapeHtml(fmtDate(entry.date))}</td><td>${escapeHtml(entry.sourceNumber ?? "")}</td><td>${escapeHtml(entry.party || entry.description || "—")}</td><td>${escapeHtml(accountLabel(entry.category, t))}</td><td class="num">${entry.direction === "in" ? escapeHtml(formatAmount(entry.amount, entry.currency, language)) : ""}</td><td class="num">${entry.direction === "out" ? escapeHtml(formatAmount(entry.amount, entry.currency, language)) : ""}</td><td class="num">${escapeHtml(formatAmount(entry.balanceUsd, "USD", language))}</td><td class="num">${escapeHtml(formatAmount(entry.balanceCdf, "CDF", language))}</td></tr>`).join("");
    const opening = `${formatAmount(book.opening.usd, "USD", language)} · ${formatAmount(book.opening.cdf, "CDF", language)}`;
    const closing = `${formatAmount(book.closing.usd, "USD", language)} · ${formatAmount(book.closing.cdf, "CDF", language)}`;
    printDocument(t("cb.title"), `<h1>${escapeHtml(settings?.gymName ?? "Oxygen Fitness Gym")} — ${escapeHtml(t("cb.title"))}</h1><p>${escapeHtml(presetLabel)}${range.from ? ` (${escapeHtml(range.from)} → ${escapeHtml(range.to)})` : ""} · 1 USD = ${escapeHtml(formatRate(book.exchangeRate, language))} FC</p><p>${escapeHtml(t("cb.opening"))}: ${escapeHtml(opening)}<br/>${escapeHtml(t("cb.closing"))}: ${escapeHtml(closing)}</p><table><thead><tr><th>${escapeHtml(t("acc.col.date"))}</th><th>${escapeHtml(t("acc.col.number"))}</th><th>${escapeHtml(t("cb.details"))}</th><th>${escapeHtml(t("acc.col.category"))}</th><th class="num">${escapeHtml(t("acc.in"))}</th><th class="num">${escapeHtml(t("acc.out"))}</th><th class="num">${escapeHtml(t("acc.col.balanceUsd"))}</th><th class="num">${escapeHtml(t("acc.col.balanceCdf"))}</th></tr></thead><tbody>${rows || `<tr><td colspan="8">${escapeHtml(t("acc.empty"))}</td></tr>`}</tbody></table>`);
  }

  function rowActions(entry: CashMovement) {
    const correctable = canCorrect && CORRECTABLE.has(entry.sourceType) && entry.sourceId != null && !isLocked(entry);
    const printable = entry.sourceType === "voucher";
    if (!correctable && !printable) {
      return isLocked(entry) ? <Lock className="ms-auto h-4 w-4 text-muted-foreground/60" aria-label={t("cb.locked")} /> : null;
    }
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9 max-md:h-11 max-md:w-11 pointer-coarse:h-11 pointer-coarse:w-11" aria-label={t("cb.actions")}><MoreHorizontal className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {printable && <DropdownMenuItem onClick={() => printVoucher(entry)}><FileDown className="me-2 h-4 w-4" /> {t("cb.printVoucher")}</DropdownMenuItem>}
          {correctable && entry.sourceType === "payment" && <DropdownMenuItem onClick={() => void openPaymentEdit(entry)}><Pencil className="me-2 h-4 w-4" /> {t("cb.edit")}</DropdownMenuItem>}
          {correctable && <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => entry.sourceType === "payment" ? setPayDeleteId(entry.sourceId) : setVoucherDeleteId(entry.sourceId)}>
              <Trash2 className="me-2 h-4 w-4" /> {t("cb.cancel")}
            </DropdownMenuItem>
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const voucherIncoming = ["cash_receipt", "customer_payment"].includes(voucherForm.voucherType);
  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, total);
  const lastUpdated = bookQ.dataUpdatedAt ? new Date(bookQ.dataUpdatedAt) : null;
  const countDiffUsd = Number(countUsd || 0) - (balanceQ.data?.nativeUsd ?? 0);
  const countDiffCdf = Number(countCdf || 0) - (balanceQ.data?.nativeCdf ?? 0);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        icon={Banknote}
        iconClass="bg-emerald-500/10 text-emerald-500"
        title={t("cb.title")}
        subtitle={book ? `${t("cb.subtitle")} · 1 USD = ${formatRate(book.exchangeRate, language)} FC` : t("cb.subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" className="h-10 max-md:h-11 pointer-coarse:h-11 min-w-11 gap-1.5 text-muted-foreground" onClick={() => void refreshAll()} aria-label={t("cb.refresh")}>
              <RefreshCw className={cn("h-4 w-4", bookQ.isFetching && "animate-spin")} />
              <span className="hidden sm:inline">{lastUpdated ? lastUpdated.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" }) : "…"}</span>
            </Button>
            <Button onClick={openPaymentCreate} className="h-10 max-md:h-11 pointer-coarse:h-11 flex-1 gap-2 sm:flex-none"><Plus className="h-4 w-4" /> {t("cb.newEntry")}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" className="h-10 max-md:h-11 pointer-coarse:h-11 gap-2"><MoreHorizontal className="h-4 w-4" /> {t("cb.more")}</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>{t("cb.title")}</DropdownMenuLabel>
                {canRecordVoucher && <DropdownMenuItem onClick={() => { setVoucherForm(emptyVoucherForm()); setVoucherModal(true); }}><ReceiptText className="me-2 h-4 w-4" /> {t("cb.newVoucher")}</DropdownMenuItem>}
                {isAdmin && <DropdownMenuItem onClick={openCashCount}><Coins className="me-2 h-4 w-4" /> {t("cb.cashCount")}</DropdownMenuItem>}
                {isAdmin && <DropdownMenuItem disabled={summarySending} onClick={() => void sendDailySummary()}>{summarySending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Send className="me-2 h-4 w-4" />} {t("cb.sendSummary")}</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={exportReport}><FileDown className="me-2 h-4 w-4" /> {t("cb.export")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {lockedThrough && (
        <p className="flex items-center gap-2 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" /> {t("cb.lockedThrough")} {fmtDate(`${lockedThrough}T12:00:00Z`)}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard language={language} label={t("cb.opening")} usd={book?.opening.usd} cdf={book?.opening.cdf} icon={Wallet} tone="blue" hint={presetLabel} />
        <MetricCard language={language} label={t("cb.cashIn")} usd={book?.totals.inUsd} cdf={book?.totals.inCdf} icon={ArrowDownLeft} tone="emerald" hint={presetLabel} />
        <MetricCard language={language} label={t("cb.cashOut")} usd={book?.totals.outUsd} cdf={book?.totals.outCdf} icon={ArrowUpRight} tone="rose" hint={presetLabel} />
        <MetricCard language={language} label={t("cb.closing")} usd={book?.closing.usd} cdf={book?.closing.cdf} icon={Banknote} tone="violet" hint={t("cb.closingHint")} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="space-y-3 border-b border-border/60 p-3.5">
          <div className="grid grid-cols-2 gap-2 md:flex md:items-center">
            <div className="relative col-span-2 min-w-0 md:flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={t("cb.search")} aria-label={t("cb.search")} className="h-10 ps-9" />
            </div>
            <Select value={datePreset} onValueChange={(value) => { setDatePreset(value as DatePreset); setPage(1); }}>
              <SelectTrigger className="col-span-2 h-10 max-md:h-11 pointer-coarse:h-11 gap-2 md:w-[170px]" aria-label={t("acc.period")}><CalendarDays className="h-4 w-4 text-muted-foreground" /><SelectValue /></SelectTrigger>
              <SelectContent>{DATE_PRESETS.map((value) => <SelectItem key={value} value={value}>{t(`cb.preset.${value}`)}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={direction} onValueChange={(value) => { setDirection(value as DirectionFilter); setPage(1); }}>
              <SelectTrigger className="h-10 max-md:h-11 pointer-coarse:h-11 md:w-[140px]" aria-label={t("cb.movement")}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">{t("cb.allMovement")}</SelectItem><SelectItem value="in">{t("cb.moneyIn")}</SelectItem><SelectItem value="out">{t("cb.moneyOut")}</SelectItem></SelectContent>
            </Select>
            <Select value={currency} onValueChange={(value) => { setCurrency(value as CurrencyFilter); setPage(1); }}>
              <SelectTrigger className="h-10 max-md:h-11 pointer-coarse:h-11 md:w-[130px]" aria-label={t("cb.currency")}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">{t("cb.allCurrency")}</SelectItem><SelectItem value="USD">USD</SelectItem><SelectItem value="CDF">CDF / FC</SelectItem></SelectContent>
            </Select>
            {(activeFilters || datePreset !== "today") && <Button variant="ghost" size="sm" className="col-span-2 h-10 max-md:h-11 pointer-coarse:h-11 gap-1.5 text-muted-foreground md:col-span-1" onClick={resetFilters}><X className="h-4 w-4" /> {t("cb.clear")}</Button>}
          </div>
          {datePreset === "custom" && (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <div className="space-y-1"><Label htmlFor="cb-from" className="text-xs text-muted-foreground">{t("acc.dateFrom")}</Label><Input id="cb-from" type="date" value={customFrom} onChange={(event) => { setCustomFrom(event.target.value); setPage(1); }} className="h-10 sm:w-44" /></div>
              <div className="space-y-1"><Label htmlFor="cb-to" className="text-xs text-muted-foreground">{t("acc.dateTo")}</Label><Input id="cb-to" type="date" value={customTo} onChange={(event) => { setCustomTo(event.target.value); setPage(1); }} className="h-10 sm:w-44" /></div>
            </div>
          )}
          <p className="text-xs text-muted-foreground" aria-live="polite">{t("cb.matching").replace("{count}", total.toLocaleString(language))}{activeFilters ? ` · ${t("cb.filterNote")}` : ""}</p>
        </div>

        {bookQ.isError && <p className="px-4 py-10 text-center text-sm text-destructive">{errorMessage(bookQ.error, t)}</p>}

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/20 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-3 text-start">{t("acc.col.date")}</th>
                <th scope="col" className="px-4 py-3 text-start">{t("cb.details")}</th>
                <th scope="col" className="hidden px-4 py-3 text-start lg:table-cell">{t("acc.col.category")}</th>
                <th scope="col" className="px-4 py-3 text-end">{t("acc.col.amount")}</th>
                <th scope="col" className="px-4 py-3 text-end">{t("acc.balance")}</th>
                <th scope="col" className="w-12 px-2 py-3"><span className="sr-only">{t("cb.actions")}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {bookQ.isLoading ? (
                <tr><td colSpan={6} className="py-16 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
              ) : pageEntries.length === 0 ? (
                <tr><td colSpan={6} className="py-16 text-center"><Banknote className="mx-auto mb-2 h-9 w-9 text-muted-foreground/25" /><p className="font-medium text-muted-foreground">{t("acc.empty")}</p></td></tr>
              ) : pageEntries.map((entry) => {
                const incoming = entry.direction === "in";
                return (
                  <tr key={entry.entryId} className="transition-colors hover:bg-muted/20">
                    <td className="whitespace-nowrap px-4 py-3 align-middle tabular-nums">{fmtDate(entry.date)}</td>
                    <td className="max-w-0 px-4 py-3 align-middle">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", incoming ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500")} aria-hidden="true">
                          {incoming ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{entry.party || entry.description || entry.sourceNumber || "—"}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={entry.description}>{[entry.sourceNumber, entry.party ? entry.description : null, entry.createdBy].filter(Boolean).join(" · ")}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 align-middle lg:table-cell"><Badge variant="outline" className="max-w-[180px] text-xs font-medium"><span className="truncate">{accountLabel(entry.category, t)}</span></Badge></td>
                    <td className="whitespace-nowrap px-4 py-3 text-end align-middle">
                      <span className={cn("font-bold tabular-nums", incoming ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                        <span className="sr-only">{incoming ? t("cb.moneyIn") : t("cb.moneyOut")} </span>
                        {incoming ? "+" : "−"}{formatAmount(entry.amount, entry.currency, language)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-end align-middle text-xs tabular-nums">
                      <p className={cn("font-medium", entry.balanceUsd < 0 && "text-destructive")}>{formatAmount(entry.balanceUsd, "USD", language)}</p>
                      <p className={cn("text-muted-foreground", entry.balanceCdf < 0 && "text-destructive")}>{formatAmount(entry.balanceCdf, "CDF", language)}</p>
                    </td>
                    <td className="px-2 py-3 text-end align-middle">{rowActions(entry)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <ul className="divide-y divide-border/50 md:hidden">
          {bookQ.isLoading ? (
            <li className="py-12 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></li>
          ) : pageEntries.length === 0 ? (
            <li className="py-12 text-center text-sm text-muted-foreground">{t("acc.empty")}</li>
          ) : pageEntries.map((entry) => {
            const incoming = entry.direction === "in";
            return (
              <li key={entry.entryId} className="flex items-start gap-3 px-4 py-3.5">
                <div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", incoming ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500")} aria-hidden="true">
                  {incoming ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-medium">{entry.party || entry.description || entry.sourceNumber || "—"}</p>
                    <p className={cn("shrink-0 font-bold tabular-nums", incoming ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                      {incoming ? "+" : "−"}{formatAmount(entry.amount, entry.currency, language)}
                    </p>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{fmtDate(entry.date)} · {accountLabel(entry.category, t)}{entry.sourceNumber ? ` · ${entry.sourceNumber}` : ""}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{t("acc.balance")}: {formatAmount(entry.balanceUsd, "USD", language)} · {formatAmount(entry.balanceCdf, "CDF", language)}</p>
                </div>
                <div className="shrink-0">{rowActions(entry)}</div>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-3 border-t border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">{showingFrom.toLocaleString(language)}–{showingTo.toLocaleString(language)} / {total.toLocaleString(language)}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-9 min-w-9 max-md:h-11 max-md:min-w-11 pointer-coarse:h-11 pointer-coarse:min-w-11" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} aria-label={t("cb.previous")}><ChevronLeft className="h-4 w-4 rtl:rotate-180" /></Button>
            <span className="min-w-[64px] text-center text-xs text-muted-foreground">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" className="h-9 min-w-9 max-md:h-11 max-md:min-w-11 pointer-coarse:h-11 pointer-coarse:min-w-11" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} aria-label={t("cb.next")}><ChevronRight className="h-4 w-4 rtl:rotate-180" /></Button>
          </div>
        </div>
      </div>

      <Dialog open={payModal} onOpenChange={setPayModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{payEditId ? t("cb.editEntry") : t("cb.newEntry")}</DialogTitle>
            {payEditId && <DialogDescription>{t("cb.editHint")}</DialogDescription>}
          </DialogHeader>
          <div className="space-y-4 py-1">
            {isAdmin ? (
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">{t("cb.movement")}</legend>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" aria-pressed={payForm.direction === "in"} variant={payForm.direction === "in" ? "default" : "outline"} onClick={() => setPayForm((current) => ({ ...current, direction: "in" }))}><ArrowDownLeft className="me-2 h-4 w-4" /> {t("cb.moneyIn")}</Button>
                  <Button type="button" aria-pressed={payForm.direction === "out"} variant={payForm.direction === "out" ? "default" : "outline"} onClick={() => setPayForm((current) => ({ ...current, direction: "out" }))}><ArrowUpRight className="me-2 h-4 w-4" /> {t("cb.moneyOut")}</Button>
                </div>
              </fieldset>
            ) : (
              <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400">{t("cb.moneyOut")} · {t("cb.category.expense")}</p>
            )}
            {isAdmin && (
              <div className="space-y-1.5">
                <Label htmlFor="pay-category">{t("acc.col.category")}</Label>
                <Select value={payForm.category} onValueChange={(value) => setPayForm((current) => ({ ...current, category: value }))}>
                  <SelectTrigger id="pay-category"><SelectValue /></SelectTrigger>
                  <SelectContent>{PAY_CATEGORIES.map((value) => <SelectItem key={value} value={value}>{t(`cb.category.${value}`)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="pay-date">{t("acc.col.date")}</Label><Input id="pay-date" type="date" max={businessDateKey()} value={payForm.paymentDate} onChange={(event) => setPayForm((current) => ({ ...current, paymentDate: event.target.value }))} /></div>
              <div className="space-y-1.5">
                <Label htmlFor="pay-currency">{t("cb.currency")}</Label>
                <Select value={payForm.currency} onValueChange={(value) => setPayForm((current) => ({ ...current, currency: value }))}>
                  <SelectTrigger id="pay-currency"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="CDF">CDF / FC</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="pay-amount">{t("acc.col.amount")}</Label><Input id="pay-amount" type="number" inputMode="decimal" min="0" step="0.01" value={payForm.amount} onChange={(event) => setPayForm((current) => ({ ...current, amount: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="pay-name">{t("cb.reference")}</Label><Input id="pay-name" value={payForm.linkedEntityName} onChange={(event) => setPayForm((current) => ({ ...current, linkedEntityName: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="pay-notes">{t("cb.notes")}</Label><Textarea id="pay-notes" rows={2} value={payForm.notes} onChange={(event) => setPayForm((current) => ({ ...current, notes: event.target.value }))} /></div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPayModal(false)}>{t("cb.close")}</Button>
            <Button onClick={() => void savePayment()} disabled={paySaving}>{paySaving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t("cb.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={voucherModal} onOpenChange={setVoucherModal}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("cb.newVoucher")}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="v-type">{t("cb.voucherType")}</Label>
              <Select value={voucherForm.voucherType} onValueChange={(value) => setVoucherForm((current) => ({ ...current, voucherType: value }))}>
                <SelectTrigger id="v-type"><SelectValue /></SelectTrigger>
                <SelectContent>{VOUCHER_TYPES.map((value) => <SelectItem key={value} value={value}>{t(`cb.voucherType.${value}`)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="v-date">{t("acc.col.date")}</Label><Input id="v-date" type="date" max={businessDateKey()} value={voucherForm.voucherDate} onChange={(event) => setVoucherForm((current) => ({ ...current, voucherDate: event.target.value }))} /></div>
              <div className="space-y-1.5">
                <Label htmlFor="v-currency">{t("cb.currency")}</Label>
                <Select value={voucherForm.currency} onValueChange={(value) => setVoucherForm((current) => ({ ...current, currency: value }))}>
                  <SelectTrigger id="v-currency"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="CDF">CDF / FC</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="v-party">{voucherIncoming ? t("cb.receivedFrom") : t("cb.paidTo")}</Label><Input id="v-party" value={voucherForm.counterparty} onChange={(event) => setVoucherForm((current) => ({ ...current, counterparty: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="v-amount">{t("acc.col.amount")}</Label><Input id="v-amount" type="number" inputMode="decimal" min="0" step="0.01" value={voucherForm.amount} onChange={(event) => setVoucherForm((current) => ({ ...current, amount: event.target.value }))} /></div>
            <div className="space-y-1.5">
              <Label htmlFor="v-category">{t("acc.col.category")}</Label>
              <Select value={voucherForm.category || "none"} onValueChange={(value) => setVoucherForm((current) => ({ ...current, category: value === "none" ? "" : value }))}>
                <SelectTrigger id="v-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("cb.noCategory")}</SelectItem>
                  {["membership", "expense", "product_sale", "other"].map((value) => <SelectItem key={value} value={value}>{t(`cb.category.${value}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="v-desc">{t("acc.col.description")} *</Label><Textarea id="v-desc" rows={2} required value={voucherForm.description} onChange={(event) => setVoucherForm((current) => ({ ...current, description: event.target.value }))} /></div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setVoucherModal(false)}>{t("cb.close")}</Button>
            <Button onClick={() => void saveVoucher()} disabled={voucherSaving}>{voucherSaving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t("cb.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={countModal} onOpenChange={setCountModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("cb.cashCount")}</DialogTitle>
            <DialogDescription>{t("cb.cashCountHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <dl className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <dt className="text-muted-foreground">{t("cb.expectedUsd")}</dt>
              <dd className="text-end font-semibold tabular-nums">{formatAmount(balanceQ.data?.nativeUsd, "USD", language)}</dd>
              <dt className="text-muted-foreground">{t("cb.expectedCdf")}</dt>
              <dd className="text-end font-semibold tabular-nums">{formatAmount(balanceQ.data?.nativeCdf, "CDF", language)}</dd>
            </dl>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="count-usd">{t("cb.countedUsd")}</Label><Input id="count-usd" type="number" inputMode="decimal" min="0" step="0.01" value={countUsd} onChange={(event) => setCountUsd(event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="count-cdf">{t("cb.countedCdf")}</Label><Input id="count-cdf" type="number" inputMode="numeric" min="0" step="1" value={countCdf} onChange={(event) => setCountCdf(event.target.value)} /></div>
            </div>
            <p className="text-sm" aria-live="polite">
              {t("cb.difference")}:{" "}
              <span className={cn("font-semibold tabular-nums", (countDiffUsd < 0 || countDiffCdf < 0) && "text-destructive")}>{formatAmount(countDiffUsd, "USD", language)} · {formatAmount(countDiffCdf, "CDF", language)}</span>
            </p>
            <div className="space-y-1.5"><Label htmlFor="count-notes">{t("cb.notes")}</Label><Input id="count-notes" value={countNotes} onChange={(event) => setCountNotes(event.target.value)} /></div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCountModal(false)}>{t("cb.close")}</Button>
            <Button onClick={() => void saveCashCount()} disabled={countSaving}>{countSaving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t("cb.postCount")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={payDeleteId !== null} onOpenChange={(open) => !open && setPayDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("cb.cancelTitle")}</AlertDialogTitle><AlertDialogDescription>{t("cb.cancelHint")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t("cb.keep")}</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void cancelPayment()}>{t("cb.cancel")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={voucherDeleteId !== null} onOpenChange={(open) => !open && setVoucherDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("cb.cancelVoucherTitle")}</AlertDialogTitle><AlertDialogDescription>{t("cb.cancelHint")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t("cb.keep")}</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void cancelVoucher()}>{t("cb.cancel")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
