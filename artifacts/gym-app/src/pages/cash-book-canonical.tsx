import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetMe } from "@/hooks/use-me";
import { useGetSettings } from "@workspace/api-client-react";
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
import { cn } from "@/lib/utils";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  FileDown,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

const PAGE_SIZE = 25;
const AUTO_REFRESH_MS = 20_000;
const RAW_PAGE_SIZE = 100;
const GYM_TIME_ZONE = "Africa/Lubumbashi";

type DatePreset = "all" | "today" | "yesterday" | "tomorrow" | "month" | "year" | "custom";
type DirectionFilter = "all" | "in" | "out";
type CurrencyFilter = "all" | "USD" | "CDF";

type PagedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};

type CashMovement = {
  sourceType: string;
  sourceId: number | null;
  sourceNumber: string | null;
  date: string;
  direction: "in" | "out";
  category: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  amountUsd: number;
  amountCdf: number;
  description: string;
  party: string;
};

type CashMovementsResponse = {
  exchangeRate: number;
  items: CashMovement[];
};

type PaymentRow = {
  id: number;
  paymentNumber?: string | null;
  direction: "in" | "out" | string;
  category: string;
  linkedEntityName?: string | null;
  memberId?: number | null;
  memberName?: string | null;
  planName?: string | null;
  amount: number;
  currency: string;
  account?: string | null;
  notes?: string | null;
  paymentDate: string;
};

type VoucherRow = {
  id: number;
  voucherNumber?: string | null;
  voucherType: string;
  direction: "in" | "out" | string;
  voucherDate: string;
  receivedFrom?: string | null;
  paidTo?: string | null;
  amount: number;
  currency: string;
  description?: string | null;
  category?: string | null;
};

type PayForm = {
  direction: string;
  category: string;
  linkedEntityName: string;
  amount: string;
  currency: string;
  account: string;
  notes: string;
  paymentDate: string;
};

type VoucherForm = {
  voucherType: string;
  voucherDate: string;
  receivedFrom: string;
  paidTo: string;
  amount: string;
  currency: string;
  description: string;
  category: string;
};

const CATEGORY_OPTIONS = [
  { value: "all", label: "All categories" },
  { value: "membership", label: "Membership" },
  { value: "product_sale", label: "Product Sale" },
  { value: "expense", label: "Expense" },
  { value: "payroll", label: "Payroll" },
  { value: "stock_purchase", label: "Stock Purchase" },
  { value: "supplier_payment", label: "Supplier Payment" },
  { value: "voucher", label: "Voucher" },
  { value: "opening_balance", label: "Opening Balance" },
  { value: "other", label: "Other" },
] as const;

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

const DATE_PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "month", label: "This Month" },
  { value: "year", label: "This Year" },
  { value: "custom", label: "Custom" },
  { value: "all", label: "All Dates" },
];

const numberFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const gymDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: GYM_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function apiBaseUrl() {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
}

async function apiFetch(path: string, options?: RequestInit) {
  const token = localStorage.getItem("gym_token");
  return fetch(`${apiBaseUrl()}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  });
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

async function fetchAllPages<T>(path: string): Promise<T[]> {
  const first = await fetchJson<PagedResponse<T>>(`${path}?page=1&limit=${RAW_PAGE_SIZE}`);
  if (first.total <= first.items.length) return first.items;
  const pages = Math.ceil(first.total / RAW_PAGE_SIZE);
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, index) =>
      fetchJson<PagedResponse<T>>(`${path}?page=${index + 2}&limit=${RAW_PAGE_SIZE}`),
    ),
  );
  return [first, ...rest].flatMap((result) => result.items);
}

function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function movementDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  const parts = gymDateFormatter.formatToParts(date);
  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function businessDateString() {
  return movementDateKey(new Date().toISOString());
}

function rangeForPreset(preset: DatePreset, customFrom: string, customTo: string) {
  const now = new Date();
  const today = businessDateString();
  const [year, month] = today.split("-").map(Number);
  if (preset === "all") return { from: "", to: "" };
  if (preset === "custom") return { from: customFrom, to: customTo };
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday" || preset === "tomorrow") {
    const noonUtc = new Date(`${today}T12:00:00Z`);
    noonUtc.setUTCDate(noonUtc.getUTCDate() + (preset === "tomorrow" ? 1 : -1));
    const day = localDateString(noonUtc);
    return { from: day, to: day };
  }
  if (preset === "month") {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { from: `${year}-${String(month).padStart(2, "0")}-01`, to: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function presetLabel(preset: DatePreset) {
  return DATE_PRESETS.find((item) => item.value === preset)?.label ?? "Period";
}

function formatUsd(value: number | null | undefined) {
  return `$${numberFormat.format(Number(value ?? 0))}`;
}

function formatCdf(value: number | null | undefined) {
  return `FC ${numberFormat.format(Number(value ?? 0))}`;
}

function formatNativeAmount(entry: CashMovement) {
  const value = numberFormat.format(Math.abs(Number(entry.amount ?? 0)));
  const prefix = entry.currency === "USD" ? "$" : "FC ";
  return `${entry.direction === "out" ? "−" : ""}${prefix}${value}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function emptyPayForm(): PayForm {
  return {
    direction: "in",
    category: "membership",
    linkedEntityName: "",
    amount: "",
    currency: "USD",
    account: "cash",
    notes: "",
    paymentDate: businessDateString(),
  };
}

function emptyVoucherForm(): VoucherForm {
  return {
    voucherType: "cash_receipt",
    voucherDate: businessDateString(),
    receivedFrom: "",
    paidTo: "",
    amount: "",
    currency: "USD",
    description: "",
    category: "",
  };
}

function MetricCard({ label, value, secondary, icon: Icon, tone, hint }: {
  label: string;
  value: string;
  secondary?: string;
  icon: LucideIcon;
  tone: "emerald" | "rose" | "blue" | "violet";
  hint?: string;
}) {
  const styles = {
    emerald: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/15",
    rose: "bg-rose-500/10 text-rose-400 ring-rose-500/15",
    blue: "bg-blue-500/10 text-blue-400 ring-blue-500/15",
    violet: "bg-violet-500/10 text-violet-400 ring-violet-500/15",
  }[tone];
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
          <p className="mt-3 truncate text-2xl font-bold tracking-tight tabular-nums">{value}</p>
          {secondary && <p className="mt-1 text-xs font-medium tabular-nums text-muted-foreground">{secondary}</p>}
          {hint && <p className="mt-1 text-[11px] text-muted-foreground/70">{hint}</p>}
        </div>
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1", styles)}>
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
    </div>
  );
}

export default function CashBookCanonical() {
  const { fmtDate } = useFmtDate();
  const me = useGetMe();
  const { toast } = useToast();
  const { data: settings } = useGetSettings();
  const isAdmin = me?.role === "admin";
  const canAdd = true;
  const canManage = isAdmin || !!me?.permissions?.viewAccounting;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [category, setCategory] = useState("all");
  const [currency, setCurrency] = useState<CurrencyFilter>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [payModal, setPayModal] = useState(false);
  const [payEditId, setPayEditId] = useState<number | null>(null);
  const [payForm, setPayForm] = useState<PayForm>(emptyPayForm());
  const [paySaving, setPaySaving] = useState(false);
  const [payDeleteId, setPayDeleteId] = useState<number | null>(null);
  const [voucherModal, setVoucherModal] = useState(false);
  const [voucherForm, setVoucherForm] = useState<VoucherForm>(emptyVoucherForm());
  const [voucherSaving, setVoucherSaving] = useState(false);
  const [voucherDeleteId, setVoucherDeleteId] = useState<number | null>(null);
  const [openingModal, setOpeningModal] = useState(false);
  const [openingAmount, setOpeningAmount] = useState("");
  const [openingDate, setOpeningDate] = useState(businessDateString());
  const [openingNotes, setOpeningNotes] = useState("");
  const [openingSaving, setOpeningSaving] = useState(false);
  const [summarySending, setSummarySending] = useState(false);

  const commonQueryOptions = {
    refetchInterval: AUTO_REFRESH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  } as const;

  const movementsQ = useQuery({
    queryKey: ["cash-book-canonical", "movements"],
    queryFn: () => fetchJson<CashMovementsResponse>("/api/ledger/movements"),
    ...commonQueryOptions,
  });
  const paymentsQ = useQuery({
    queryKey: ["cash-book-canonical", "payments"],
    queryFn: () => fetchAllPages<PaymentRow>("/api/payments"),
    ...commonQueryOptions,
  });
  const vouchersQ = useQuery({
    queryKey: ["cash-book-canonical", "vouchers"],
    queryFn: () => fetchAllPages<VoucherRow>("/api/vouchers"),
    ...commonQueryOptions,
  });

  const movements = movementsQ.data?.items ?? [];
  const paymentMap = useMemo(() => new Map((paymentsQ.data ?? []).map((row) => [row.id, row])), [paymentsQ.data]);
  const voucherMap = useMemo(() => new Map((vouchersQ.data ?? []).map((row) => [row.id, row])), [vouchersQ.data]);

  const dateRange = useMemo(() => rangeForPreset(datePreset, customFrom, customTo), [datePreset, customFrom, customTo]);
  const periodEntries = useMemo(() => movements.filter((entry) => {
    const day = movementDateKey(entry.date);
    if (dateRange.from && day < dateRange.from) return false;
    if (dateRange.to && day > dateRange.to) return false;
    return true;
  }), [movements, dateRange.from, dateRange.to]);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return periodEntries
      .filter((entry) => {
        if (direction !== "all" && entry.direction !== direction) return false;
        if (currency !== "all" && entry.currency !== currency) return false;
        if (category !== "all" && entry.category !== category) return false;
        if (!query) return true;
        return [entry.sourceNumber, entry.party, entry.description, entry.category, entry.sourceType]
          .filter(Boolean).join(" ").toLowerCase().includes(query);
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [periodEntries, direction, currency, category, search]);

  const periodKpis = useMemo(() => {
    let inUsd = 0; let inCdf = 0; let outUsd = 0; let outCdf = 0;
    for (const entry of periodEntries) {
      if (entry.direction === "in") { inUsd += entry.amountUsd; inCdf += entry.amountCdf; }
      else { outUsd += entry.amountUsd; outCdf += entry.amountCdf; }
    }
    return { inUsd, inCdf, outUsd, outCdf, netUsd: inUsd - outUsd, netCdf: inCdf - outCdf };
  }, [periodEntries]);

  const balance = useMemo(() => movements.reduce((total, entry) => ({
    usd: total.usd + (entry.direction === "in" ? entry.amountUsd : -entry.amountUsd),
    cdf: total.cdf + (entry.direction === "in" ? entry.amountCdf : -entry.amountCdf),
  }), { usd: 0, cdf: 0 }), [movements]);

  const total = filteredEntries.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageEntries = filteredEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const isLoading = movementsQ.isLoading;
  const isRefreshing = movementsQ.isFetching || paymentsQ.isFetching || vouchersQ.isFetching;
  const lastUpdated = movementsQ.dataUpdatedAt ? new Date(movementsQ.dataUpdatedAt) : null;
  const activeFilterCount = [direction !== "all", category !== "all", currency !== "all", search.trim() !== ""].filter(Boolean).length;

  async function refreshAll() {
    await Promise.allSettled([movementsQ.refetch(), paymentsQ.refetch(), vouchersQ.refetch()]);
  }

  function resetFilters() {
    setSearch(""); setDirection("all"); setCategory("all"); setCurrency("all");
    setDatePreset("all"); setCustomFrom(""); setCustomTo(""); setPage(1);
  }

  function openPaymentCreate() {
    setPayEditId(null);
    setPayForm(isAdmin ? emptyPayForm() : { ...emptyPayForm(), direction: "out", category: "expense" });
    setPayModal(true);
  }

  function openPaymentEdit(movement: CashMovement) {
    if (movement.sourceType !== "payment" || movement.sourceId == null) return;
    const raw = paymentMap.get(movement.sourceId);
    if (!raw) return;
    setPayEditId(raw.id);
    setPayForm({
      direction: raw.direction,
      category: raw.category,
      linkedEntityName: raw.linkedEntityName ?? "",
      amount: String(raw.amount ?? ""),
      currency: raw.currency,
      account: raw.account ?? "cash",
      notes: raw.notes ?? "",
      paymentDate: movementDateKey(raw.paymentDate) || businessDateString(),
    });
    setPayModal(true);
  }

  async function savePayment() {
    const amount = Number(payForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }
    setPaySaving(true);
    try {
      const payload = {
        direction: payForm.direction,
        category: payForm.category,
        linkedEntityName: payForm.linkedEntityName.trim() || undefined,
        amount,
        discount: 0,
        currency: payForm.currency,
        account: payForm.account || "cash",
        notes: payForm.notes.trim() || undefined,
        paymentDate: payForm.paymentDate || undefined,
      };
      const response = await apiFetch(payEditId ? `/api/payments/${payEditId}` : "/api/payments", {
        method: payEditId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to save transaction");
      toast({ title: payEditId ? "Transaction updated" : "Transaction recorded" });
      setPayModal(false);
      await refreshAll();
    } catch (error) { toast({ title: (error as Error).message, variant: "destructive" }); }
    finally { setPaySaving(false); }
  }

  async function deletePayment() {
    if (!payDeleteId) return;
    try {
      const response = await apiFetch(`/api/payments/${payDeleteId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to cancel transaction");
      setPayDeleteId(null); toast({ title: "Transaction cancelled" }); await refreshAll();
    } catch (error) { toast({ title: (error as Error).message, variant: "destructive" }); }
  }

  function openVoucherCreate() { setVoucherForm(emptyVoucherForm()); setVoucherModal(true); }

  async function saveVoucher() {
    const amount = Number(voucherForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }
    if (!voucherForm.description.trim()) { toast({ title: "Description is required", variant: "destructive" }); return; }
    const incoming = ["cash_receipt", "customer_payment"].includes(voucherForm.voucherType);
    setVoucherSaving(true);
    try {
      const response = await apiFetch("/api/vouchers", {
        method: "POST",
        body: JSON.stringify({
          voucherType: voucherForm.voucherType,
          voucherDate: voucherForm.voucherDate || undefined,
          receivedFrom: incoming ? voucherForm.receivedFrom.trim() || undefined : undefined,
          paidTo: incoming ? undefined : voucherForm.paidTo.trim() || undefined,
          amount,
          currency: voucherForm.currency,
          account: "cash",
          category: voucherForm.category || undefined,
          description: voucherForm.description.trim(),
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to save voucher");
      setVoucherModal(false); toast({ title: "Voucher created" }); await refreshAll();
    } catch (error) { toast({ title: (error as Error).message, variant: "destructive" }); }
    finally { setVoucherSaving(false); }
  }

  async function deleteVoucher() {
    if (!voucherDeleteId) return;
    try {
      const response = await apiFetch(`/api/vouchers/${voucherDeleteId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to cancel voucher");
      setVoucherDeleteId(null); toast({ title: "Voucher cancelled" }); await refreshAll();
    } catch (error) { toast({ title: (error as Error).message, variant: "destructive" }); }
  }

  async function saveOpeningBalance() {
    const targetAmountUsd = Number(openingAmount);
    if (!Number.isFinite(targetAmountUsd) || targetAmountUsd < 0) return;
    setOpeningSaving(true);
    try {
      const response = await apiFetch("/api/ledger/opening-balance", {
        method: "POST",
        body: JSON.stringify({ targetAmountUsd, date: openingDate || undefined, notes: openingNotes.trim() || undefined }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; skipped?: boolean };
      if (!response.ok) throw new Error(result.error ?? "Unable to set opening balance");
      setOpeningModal(false); toast({ title: result.skipped ? "Balance already matches" : "Opening balance updated" }); await refreshAll();
    } catch (error) { toast({ title: (error as Error).message, variant: "destructive" }); }
    finally { setOpeningSaving(false); }
  }

  async function sendDailySummary() {
    setSummarySending(true);
    try {
      const response = await apiFetch("/api/whatsapp/send-daily-summary", { method: "POST" });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to send summary");
      toast({ title: "Daily summary sent on WhatsApp" });
    } catch (error) { toast({ title: (error as Error).message, variant: "destructive" }); }
    finally { setSummarySending(false); }
  }

  function printVoucher(movement: CashMovement) {
    if (movement.sourceType !== "voucher" || movement.sourceId == null) return;
    const entry = voucherMap.get(movement.sourceId);
    if (!entry) return;
    const incoming = entry.direction === "in";
    const popup = window.open("", "_blank", "width=800,height=650");
    if (!popup) return;
    popup.document.write(`<!doctype html><html><head><title>Voucher</title><style>body{font-family:Arial,sans-serif;padding:42px;color:#111}table{width:100%;border-collapse:collapse;margin-top:28px}td{padding:11px;border:1px solid #ddd}td:first-child{font-weight:700;background:#f8fafc}</style></head><body><h1>${escapeHtml(settings?.gymName ?? "Oxygen Fitness Gym")}</h1><p>${escapeHtml(entry.voucherNumber ?? "Voucher")}</p><table><tbody><tr><td>Date</td><td>${escapeHtml(fmtDate(entry.voucherDate))}</td></tr><tr><td>Type</td><td>${escapeHtml(entry.voucherType.replace(/_/g, " "))}</td></tr><tr><td>${incoming ? "Received From" : "Paid To"}</td><td>${escapeHtml((incoming ? entry.receivedFrom : entry.paidTo) || "—")}</td></tr><tr><td>Amount</td><td>${escapeHtml(formatNativeAmount(movement))}</td></tr><tr><td>Description</td><td>${escapeHtml(entry.description || "—")}</td></tr></tbody></table></body></html>`);
    popup.document.close(); setTimeout(() => { popup.focus(); popup.print(); }, 300);
  }

  function exportReport() {
    const bodyRows = filteredEntries.map((entry) => `<tr><td>${escapeHtml(fmtDate(entry.date))}</td><td>${escapeHtml(entry.category.replace(/_/g, " "))}</td><td>${escapeHtml(entry.party || entry.sourceNumber || "—")}</td><td style="text-align:right">${escapeHtml(formatNativeAmount(entry))}</td><td>${escapeHtml(entry.description || "—")}</td></tr>`).join("");
    const popup = window.open("", "_blank", "width=1000,height=720");
    if (!popup) return;
    popup.document.write(`<!doctype html><html><head><title>Cash Book</title><style>@page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;font-size:11px;color:#111}table{width:100%;border-collapse:collapse;margin-top:20px}th{background:#111827;color:#fff;text-align:left;padding:8px}td{padding:8px;border-bottom:1px solid #e5e7eb}</style></head><body><h1>${escapeHtml(settings?.gymName ?? "Oxygen Fitness Gym")} — Cash Book</h1><p>${escapeHtml(presetLabel(datePreset))} · Settings rate: ${numberFormat.format(movementsQ.data?.exchangeRate ?? 0)} FC/USD</p><table><thead><tr><th>Date</th><th>Type</th><th>Details</th><th>Amount</th><th>Description</th></tr></thead><tbody>${bodyRows || "<tr><td colspan='5'>No entries</td></tr>"}</tbody></table></body></html>`);
    popup.document.close(); setTimeout(() => { popup.focus(); popup.print(); }, 300);
  }

  const voucherIncoming = ["cash_receipt", "customer_payment"].includes(voucherForm.voucherType);
  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-col gap-4 border-b border-border/70 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/15"><Banknote className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Cash Book</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>Cash movement and transaction history</span>
              <button type="button" onClick={() => void refreshAll()} className="inline-flex items-center gap-1.5 hover:text-foreground">
                <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
                {lastUpdated ? `Live · 20s · ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Connecting…"}
              </button>
              {movementsQ.data && <span>Rate · 1 USD = {numberFormat.format(movementsQ.data.exchangeRate)} FC</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAdd && <Button onClick={openPaymentCreate} className="gap-2"><Plus className="h-4 w-4" /> New Entry</Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" className="gap-2"><MoreHorizontal className="h-4 w-4" /> More</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Cash Book actions</DropdownMenuLabel>
              {canManage && <DropdownMenuItem onClick={openVoucherCreate}><ReceiptText className="mr-2 h-4 w-4" /> New Voucher</DropdownMenuItem>}
              {isAdmin && <DropdownMenuItem onClick={() => { setOpeningAmount(balance.usd.toFixed(2)); setOpeningDate(businessDateString()); setOpeningNotes(""); setOpeningModal(true); }}><CircleDollarSign className="mr-2 h-4 w-4" /> Set Opening Balance</DropdownMenuItem>}
              {isAdmin && <DropdownMenuItem disabled={summarySending} onClick={() => void sendDailySummary()}>{summarySending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Send Daily Summary</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={exportReport}><FileDown className="mr-2 h-4 w-4" /> Export / Print</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label={`Cash In · ${presetLabel(datePreset)}`} value={isLoading ? "—" : formatUsd(periodKpis.inUsd)} secondary={isLoading ? undefined : formatCdf(periodKpis.inCdf)} icon={ArrowDownLeft} tone="emerald" />
        <MetricCard label={`Cash Out · ${presetLabel(datePreset)}`} value={isLoading ? "—" : formatUsd(periodKpis.outUsd)} secondary={isLoading ? undefined : formatCdf(periodKpis.outCdf)} icon={ArrowUpRight} tone="rose" />
        <MetricCard label={`Net · ${presetLabel(datePreset)}`} value={isLoading ? "—" : formatUsd(periodKpis.netUsd)} secondary={isLoading ? undefined : formatCdf(periodKpis.netCdf)} icon={TrendingUp} tone="blue" />
        {isAdmin && <MetricCard label="Current Cash Balance" value={isLoading ? "—" : formatUsd(balance.usd)} secondary={isLoading ? undefined : formatCdf(balance.cdf)} icon={Wallet} tone="violet" hint="All time · same source as Accounts → Cash" />}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="border-b border-border/60 p-3.5">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search member, description, number…" className="h-10 pl-9" /></div>
            <Select value={datePreset} onValueChange={(value) => { setDatePreset(value as DatePreset); setPage(1); }}><SelectTrigger className="h-10 w-full gap-2 lg:w-[154px]"><CalendarDays className="h-4 w-4 text-muted-foreground" /><SelectValue /></SelectTrigger><SelectContent>{DATE_PRESETS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>
            <Select value={direction} onValueChange={(value) => { setDirection(value as DirectionFilter); setPage(1); }}><SelectTrigger className="h-10 w-full lg:w-[140px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All movement</SelectItem><SelectItem value="in">Money In</SelectItem><SelectItem value="out">Money Out</SelectItem></SelectContent></Select>
            <Select value={category} onValueChange={(value) => { setCategory(value); setPage(1); }}><SelectTrigger className="h-10 w-full lg:w-[165px]"><SelectValue /></SelectTrigger><SelectContent>{CATEGORY_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>
            <Select value={currency} onValueChange={(value) => { setCurrency(value as CurrencyFilter); setPage(1); }}><SelectTrigger className="h-10 w-full lg:w-[112px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All currency</SelectItem><SelectItem value="USD">USD</SelectItem><SelectItem value="CDF">CDF / FC</SelectItem></SelectContent></Select>
            {(activeFilterCount > 0 || datePreset !== "today") && <Button variant="ghost" size="sm" className="h-10 gap-1.5 text-muted-foreground" onClick={resetFilters}><X className="h-4 w-4" /> Clear</Button>}
          </div>
          {datePreset === "custom" && <div className="mt-3 flex flex-col gap-2 border-t border-border/50 pt-3 sm:flex-row sm:items-center"><div className="flex items-center gap-2"><Label className="w-10 text-xs text-muted-foreground">From</Label><Input type="date" value={customFrom} onChange={(event) => { setCustomFrom(event.target.value); setPage(1); }} className="h-9 sm:w-40" /></div><div className="flex items-center gap-2"><Label className="w-10 text-xs text-muted-foreground">To</Label><Input type="date" value={customTo} onChange={(event) => { setCustomTo(event.target.value); setPage(1); }} className="h-9 sm:w-40" /></div></div>}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><SlidersHorizontal className="h-3.5 w-3.5" />{total.toLocaleString()} matching {total === 1 ? "entry" : "entries"}</span><span>KPIs and balance use the same physical-cash stream as Accounts → Cash.</span></div>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full table-fixed text-sm">
            <thead><tr className="border-b border-border/60 bg-muted/20"><th className="w-[140px] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date</th><th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</th><th className="w-[160px] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type</th><th className="w-[180px] px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Amount</th>{canManage && <th className="w-[72px] px-4 py-3" />}</tr></thead>
            <tbody className="divide-y divide-border/40">
              {isLoading ? <tr><td colSpan={canManage ? 5 : 4} className="py-16 text-center text-muted-foreground">Loading cash book…</td></tr> : pageEntries.length === 0 ? <tr><td colSpan={canManage ? 5 : 4} className="py-20 text-center"><Banknote className="mx-auto mb-2 h-9 w-9 text-muted-foreground/25" /><p className="font-medium text-muted-foreground">No cash movements found</p></td></tr> : pageEntries.map((entry, index) => {
                const incoming = entry.direction === "in";
                const editablePayment = entry.sourceType === "payment" && entry.sourceId != null && paymentMap.has(entry.sourceId);
                const editableVoucher = entry.sourceType === "voucher" && entry.sourceId != null && voucherMap.has(entry.sourceId);
                return <tr key={`${entry.sourceType}-${entry.sourceId ?? index}-${entry.date}`} className="group transition-colors hover:bg-muted/20">
                  <td className="whitespace-nowrap px-5 py-4 align-middle font-medium tabular-nums">{fmtDate(entry.date)}</td>
                  <td className="px-5 py-4 align-middle"><div className="flex min-w-0 items-start gap-3"><div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", incoming ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400")}>{incoming ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</div><div className="min-w-0"><p className="truncate font-semibold">{entry.party || entry.sourceNumber || "—"}</p>{entry.description && <p className="mt-0.5 truncate text-xs text-muted-foreground" title={entry.description}>{entry.description}</p>}</div></div></td>
                  <td className="px-5 py-4 align-middle"><Badge variant="outline" className="max-w-full capitalize text-xs font-medium"><span className="truncate">{entry.category.replace(/_/g, " ")}</span></Badge></td>
                  <td className="px-5 py-4 text-right align-middle"><p className={cn("text-base font-bold tabular-nums", incoming ? "text-emerald-400" : "text-rose-400")}>{formatNativeAmount(entry)}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{incoming ? "Money in" : "Money out"}</p></td>
                  {canManage && <td className="px-4 py-4 text-right align-middle">{(editablePayment || editableVoucher) && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-44">{editablePayment ? <><DropdownMenuItem onClick={() => openPaymentEdit(entry)}><Pencil className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setPayDeleteId(entry.sourceId)}><Trash2 className="mr-2 h-4 w-4" /> Cancel</DropdownMenuItem></> : <><DropdownMenuItem onClick={() => printVoucher(entry)}><FileDown className="mr-2 h-4 w-4" /> Print Voucher</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setVoucherDeleteId(entry.sourceId)}><Trash2 className="mr-2 h-4 w-4" /> Cancel</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu>}</td>}
                </tr>;
              })}
            </tbody>
          </table>
        </div>

        <div className="md:hidden divide-y divide-border/50">{isLoading ? <div className="py-12 text-center text-sm text-muted-foreground">Loading cash book…</div> : pageEntries.map((entry, index) => <div key={`${entry.sourceType}-${entry.sourceId ?? index}-${entry.date}`} className="flex items-start gap-3 px-4 py-4"><div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", entry.direction === "in" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400")}>{entry.direction === "in" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</div><div className="min-w-0 flex-1"><p className="truncate font-medium">{entry.party || entry.sourceNumber || "—"}</p><p className="mt-1 text-xs text-muted-foreground">{fmtDate(entry.date)} · {entry.category.replace(/_/g, " ")}</p></div><p className={cn("shrink-0 font-bold tabular-nums", entry.direction === "in" ? "text-emerald-400" : "text-rose-400")}>{formatNativeAmount(entry)}</p></div>)}</div>

        <div className="flex flex-col gap-3 border-t border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">Showing {showingFrom.toLocaleString()}–{showingTo.toLocaleString()} of {total.toLocaleString()}</p><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={page <= 1 || isLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft className="mr-1 h-4 w-4" /> Previous</Button><span className="min-w-[76px] text-center text-xs text-muted-foreground">Page {page} / {totalPages}</span><Button variant="outline" size="sm" disabled={page >= totalPages || isLoading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next <ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>
      </div>

      <Dialog open={payModal} onOpenChange={setPayModal}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{payEditId ? "Edit Transaction" : "New Cash Entry"}</DialogTitle></DialogHeader><div className="space-y-4 py-1">{isAdmin ? <div className="space-y-1.5"><Label>Movement</Label><div className="grid grid-cols-2 gap-2"><Button type="button" variant={payForm.direction === "in" ? "default" : "outline"} onClick={() => setPayForm((current) => ({ ...current, direction: "in" }))}><ArrowDownLeft className="mr-2 h-4 w-4" /> Money In</Button><Button type="button" variant={payForm.direction === "out" ? "default" : "outline"} onClick={() => setPayForm((current) => ({ ...current, direction: "out" }))}><ArrowUpRight className="mr-2 h-4 w-4" /> Money Out</Button></div></div> : <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-400">Money Out · Expense</div>}{isAdmin && <div className="space-y-1.5"><Label>Category</Label><Select value={payForm.category} onValueChange={(value) => setPayForm((current) => ({ ...current, category: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PAY_CATEGORIES.map((value) => <SelectItem key={value} value={value}>{value.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></div>}<div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label>Date</Label><Input type="date" value={payForm.paymentDate} onChange={(event) => setPayForm((current) => ({ ...current, paymentDate: event.target.value }))} /></div><div className="space-y-1.5"><Label>Currency</Label><Select value={payForm.currency} onValueChange={(value) => setPayForm((current) => ({ ...current, currency: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="CDF">CDF / FC</SelectItem></SelectContent></Select></div></div><div className="space-y-1.5"><Label>Amount</Label><Input type="number" min="0" step="0.01" value={payForm.amount} onChange={(event) => setPayForm((current) => ({ ...current, amount: event.target.value }))} /></div><div className="space-y-1.5"><Label>Name / Reference</Label><Input value={payForm.linkedEntityName} onChange={(event) => setPayForm((current) => ({ ...current, linkedEntityName: event.target.value }))} /></div><div className="space-y-1.5"><Label>Notes</Label><Textarea rows={2} value={payForm.notes} onChange={(event) => setPayForm((current) => ({ ...current, notes: event.target.value }))} /></div></div><DialogFooter><Button variant="outline" onClick={() => setPayModal(false)}>Cancel</Button><Button onClick={() => void savePayment()} disabled={paySaving}>{paySaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={voucherModal} onOpenChange={setVoucherModal}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>New Voucher</DialogTitle></DialogHeader><div className="space-y-4 py-1"><div className="space-y-1.5"><Label>Voucher Type</Label><Select value={voucherForm.voucherType} onValueChange={(value) => setVoucherForm((current) => ({ ...current, voucherType: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{VOUCHER_TYPES.map((value) => <SelectItem key={value} value={value}>{value.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label>Date</Label><Input type="date" value={voucherForm.voucherDate} onChange={(event) => setVoucherForm((current) => ({ ...current, voucherDate: event.target.value }))} /></div><div className="space-y-1.5"><Label>Currency</Label><Select value={voucherForm.currency} onValueChange={(value) => setVoucherForm((current) => ({ ...current, currency: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="CDF">CDF / FC</SelectItem></SelectContent></Select></div></div><div className="space-y-1.5"><Label>{voucherIncoming ? "Received From" : "Paid To"}</Label><Input value={voucherIncoming ? voucherForm.receivedFrom : voucherForm.paidTo} onChange={(event) => setVoucherForm((current) => voucherIncoming ? ({ ...current, receivedFrom: event.target.value }) : ({ ...current, paidTo: event.target.value }))} /></div><div className="space-y-1.5"><Label>Amount</Label><Input type="number" min="0" step="0.01" value={voucherForm.amount} onChange={(event) => setVoucherForm((current) => ({ ...current, amount: event.target.value }))} /></div><div className="space-y-1.5"><Label>Category</Label><Select value={voucherForm.category || "none"} onValueChange={(value) => setVoucherForm((current) => ({ ...current, category: value === "none" ? "" : value }))}><SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger><SelectContent><SelectItem value="none">No category</SelectItem><SelectItem value="membership">Membership</SelectItem><SelectItem value="expense">Expense</SelectItem><SelectItem value="payroll">Payroll</SelectItem><SelectItem value="stock_purchase">Stock Purchase</SelectItem><SelectItem value="product_sale">Product Sale</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div><div className="space-y-1.5"><Label>Description *</Label><Textarea rows={2} value={voucherForm.description} onChange={(event) => setVoucherForm((current) => ({ ...current, description: event.target.value }))} /></div></div><DialogFooter><Button variant="outline" onClick={() => setVoucherModal(false)}>Cancel</Button><Button onClick={() => void saveVoucher()} disabled={voucherSaving}>{voucherSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Voucher</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={openingModal} onOpenChange={setOpeningModal}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Set Opening Balance</DialogTitle></DialogHeader><div className="space-y-4 py-1"><div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"><span className="text-muted-foreground">Current balance</span><span className="float-right font-semibold tabular-nums">{formatUsd(balance.usd)}</span></div><div className="space-y-1.5"><Label>Target balance (USD)</Label><Input type="number" min="0" step="0.01" value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} /></div><div className="space-y-1.5"><Label>Date</Label><Input type="date" value={openingDate} onChange={(event) => setOpeningDate(event.target.value)} /></div><div className="space-y-1.5"><Label>Notes</Label><Input value={openingNotes} onChange={(event) => setOpeningNotes(event.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={() => setOpeningModal(false)}>Cancel</Button><Button onClick={() => void saveOpeningBalance()} disabled={openingSaving || !openingAmount}>{openingSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Set Balance</Button></DialogFooter></DialogContent></Dialog>

      <AlertDialog open={payDeleteId !== null} onOpenChange={(open) => !open && setPayDeleteId(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Cancel this transaction?</AlertDialogTitle><AlertDialogDescription>The transaction will be marked cancelled and its financial effect reversed.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void deletePayment()}>Cancel Transaction</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <AlertDialog open={voucherDeleteId !== null} onOpenChange={(open) => !open && setVoucherDeleteId(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Cancel this voucher?</AlertDialogTitle><AlertDialogDescription>The voucher will be cancelled and its financial effect reversed.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void deleteVoucher()}>Cancel Voucher</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
}
