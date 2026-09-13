import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
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
const PAYMENT_PAGE_SIZE = 100;
const VOUCHER_PAGE_SIZE = 100;

type DatePreset = "all" | "today" | "yesterday" | "tomorrow" | "month" | "year" | "custom";
type DirectionFilter = "all" | "in" | "out";
type CurrencyFilter = "all" | "USD" | "CDF";

type PagedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};

type PaymentRow = {
  id: number;
  paymentNumber?: string | null;
  direction: "in" | "out" | string;
  category: string;
  type?: string | null;
  linkedEntityName?: string | null;
  memberId?: number | null;
  memberName?: string | null;
  planName?: string | null;
  amount: number;
  currency: string;
  exchangeRate?: number | null;
  amountUsd?: number | null;
  amountCdf?: number | null;
  account?: string | null;
  notes?: string | null;
  paymentDate: string;
  status?: string | null;
};

type VoucherRow = {
  id: number;
  voucherNumber?: string | null;
  voucherType: string;
  direction: "in" | "out" | string;
  voucherDate: string;
  receivedFrom?: string | null;
  paidTo?: string | null;
  linkedEntityName?: string | null;
  amount: number;
  currency: string;
  exchangeRate?: number | null;
  amountUsd?: number | null;
  amountCdf?: number | null;
  description?: string | null;
  category?: string | null;
  status?: string | null;
  createdBy?: string | null;
};

type UnifiedEntry =
  | (PaymentRow & { _kind: "payment" })
  | (VoucherRow & { _kind: "voucher" });

type BalanceResponse = {
  balanceUsd: number;
  balanceCdf: number;
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
  { value: "supplement", label: "Supplement" },
  { value: "commission", label: "Commission" },
  { value: "expense", label: "Expense" },
  { value: "payroll", label: "Payroll" },
  { value: "stock_purchase", label: "Stock Purchase" },
  { value: "voucher", label: "Voucher" },
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

async function fetchAllPages<T>(path: string, pageSize: number): Promise<T[]> {
  const first = await fetchJson<PagedResponse<T>>(`${path}?page=1&limit=${pageSize}`);
  if (first.total <= first.items.length) return first.items;

  const totalPages = Math.ceil(first.total / pageSize);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) =>
      fetchJson<PagedResponse<T>>(`${path}?page=${index + 2}&limit=${pageSize}`),
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

function businessDateString() {
  const date = new Date();
  if (date.getHours() >= 21) date.setDate(date.getDate() + 1);
  return localDateString(date);
}

function rangeForPreset(preset: DatePreset, customFrom: string, customTo: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = localDateString(now);

  if (preset === "all") return { from: "", to: "" };
  if (preset === "custom") return { from: customFrom, to: customTo };
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    const day = localDateString(date);
    return { from: day, to: day };
  }
  if (preset === "tomorrow") {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    const day = localDateString(date);
    return { from: day, to: day };
  }
  if (preset === "month") {
    return {
      from: localDateString(new Date(year, month, 1)),
      to: localDateString(new Date(year, month + 1, 0)),
    };
  }
  return {
    from: localDateString(new Date(year, 0, 1)),
    to: localDateString(new Date(year, 11, 31)),
  };
}

function presetLabel(preset: DatePreset) {
  return DATE_PRESETS.find((item) => item.value === preset)?.label ?? "Period";
}

function entryDate(entry: UnifiedEntry) {
  return entry._kind === "payment" ? entry.paymentDate : entry.voucherDate;
}

function entryDateKey(entry: UnifiedEntry) {
  return String(entryDate(entry) ?? "").slice(0, 10);
}

function entryCategory(entry: UnifiedEntry) {
  return entry._kind === "voucher" ? "voucher" : entry.category;
}

function entryParty(entry: UnifiedEntry) {
  if (entry._kind === "payment") {
    if (entry.category === "product_sale") return entry.notes || entry.linkedEntityName || entry.memberName || "—";
    return entry.memberName || entry.linkedEntityName || "—";
  }
  return entry.paidTo || entry.receivedFrom || entry.linkedEntityName || "—";
}

function entryDescription(entry: UnifiedEntry) {
  if (entry._kind === "payment") {
    if (entry.category === "product_sale") return "";
    return entry.notes || "";
  }
  return entry.description || "";
}

function formatUsd(value: number | null | undefined) {
  return `$${numberFormat.format(Number(value ?? 0))}`;
}

function formatCdf(value: number | null | undefined) {
  return `FC ${numberFormat.format(Number(value ?? 0))}`;
}

function formatNativeAmount(entry: UnifiedEntry) {
  const value = numberFormat.format(Math.abs(Number(entry.amount ?? 0)));
  const prefix = entry.currency === "USD" ? "$" : "FC ";
  return `${entry.direction === "out" ? "−" : ""}${prefix}${value}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
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

function MetricCard({
  label,
  value,
  secondary,
  icon: Icon,
  tone,
  hint,
}: {
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

export default function CashBookModern() {
  const { t } = useI18n();
  const { fmtDate } = useFmtDate();
  const me = useGetMe();
  const { toast } = useToast();
  const settingsQ = useGetSettings();
  const settings = settingsQ.data;

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
  const [receiptSendingId, setReceiptSendingId] = useState<number | null>(null);

  const commonQueryOptions = {
    refetchInterval: AUTO_REFRESH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  } as const;

  const paymentsQ = useQuery({
    queryKey: ["cash-book-modern", "payments"],
    queryFn: () => fetchAllPages<PaymentRow>("/api/payments", PAYMENT_PAGE_SIZE),
    ...commonQueryOptions,
  });

  const vouchersQ = useQuery({
    queryKey: ["cash-book-modern", "vouchers"],
    queryFn: () => fetchAllPages<VoucherRow>("/api/vouchers", VOUCHER_PAGE_SIZE),
    ...commonQueryOptions,
  });

  const balanceQ = useQuery({
    queryKey: ["cash-book-modern", "balance"],
    queryFn: () => fetchJson<BalanceResponse>("/api/ledger/balance"),
    ...commonQueryOptions,
  });

  const payments = paymentsQ.data ?? [];
  const vouchers = vouchersQ.data ?? [];
  const allEntries = useMemo<UnifiedEntry[]>(() => {
    const paymentRows = payments.map((entry) => ({ ...entry, _kind: "payment" as const }));
    const voucherRows = vouchers.map((entry) => ({ ...entry, _kind: "voucher" as const }));
    return [...paymentRows, ...voucherRows];
  }, [payments, vouchers]);

  const dateRange = useMemo(
    () => rangeForPreset(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo],
  );

  const periodEntries = useMemo(() => {
    return allEntries.filter((entry) => {
      const day = entryDateKey(entry);
      if (dateRange.from && day < dateRange.from) return false;
      if (dateRange.to && day > dateRange.to) return false;
      return true;
    });
  }, [allEntries, dateRange.from, dateRange.to]);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return periodEntries
      .filter((entry) => {
        if (direction !== "all" && entry.direction !== direction) return false;
        if (currency !== "all" && entry.currency !== currency) return false;
        if (category !== "all" && entryCategory(entry) !== category) return false;
        if (!query) return true;

        const searchable = entry._kind === "payment"
          ? [
              entry.paymentNumber,
              entry.memberName,
              entry.linkedEntityName,
              entry.planName,
              entry.notes,
              entry.category,
            ]
          : [
              entry.voucherNumber,
              entry.paidTo,
              entry.receivedFrom,
              entry.linkedEntityName,
              entry.description,
              entry.category,
              entry.voucherType,
            ];
        return searchable.filter(Boolean).join(" ").toLowerCase().includes(query);
      })
      .sort((a, b) => {
        const dateDiff = new Date(entryDate(b)).getTime() - new Date(entryDate(a)).getTime();
        if (dateDiff !== 0) return dateDiff;
        return b.id - a.id;
      });
  }, [periodEntries, direction, currency, category, search]);

  const periodKpis = useMemo(() => {
    let inUsd = 0;
    let inCdf = 0;
    let outUsd = 0;
    let outCdf = 0;
    for (const entry of periodEntries) {
      const usd = Number(entry.amountUsd ?? 0);
      const cdf = Number(entry.amountCdf ?? 0);
      if (entry.direction === "in") {
        inUsd += usd;
        inCdf += cdf;
      } else {
        outUsd += usd;
        outCdf += cdf;
      }
    }
    return {
      inUsd,
      inCdf,
      outUsd,
      outCdf,
      netUsd: inUsd - outUsd,
      netCdf: inCdf - outCdf,
    };
  }, [periodEntries]);

  const total = filteredEntries.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageEntries = filteredEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const isLoading = paymentsQ.isLoading || vouchersQ.isLoading || balanceQ.isLoading;
  const isRefreshing = paymentsQ.isFetching || vouchersQ.isFetching || balanceQ.isFetching;
  const lastUpdatedAt = Math.max(paymentsQ.dataUpdatedAt, vouchersQ.dataUpdatedAt, balanceQ.dataUpdatedAt);
  const lastUpdated = lastUpdatedAt ? new Date(lastUpdatedAt) : null;

  const activeFilterCount = [direction !== "all", category !== "all", currency !== "all", search.trim() !== ""].filter(Boolean).length;

  async function refreshAll() {
    await Promise.allSettled([paymentsQ.refetch(), vouchersQ.refetch(), balanceQ.refetch()]);
  }

  function resetFilters() {
    setSearch("");
    setDirection("all");
    setCategory("all");
    setCurrency("all");
    setDatePreset("all");
    setCustomFrom("");
    setCustomTo("");
    setPage(1);
  }

  function openPaymentCreate() {
    setPayEditId(null);
    setPayForm(isAdmin ? emptyPayForm() : { ...emptyPayForm(), direction: "out", category: "expense" });
    setPayModal(true);
  }

  function openPaymentEdit(entry: PaymentRow) {
    setPayEditId(entry.id);
    setPayForm({
      direction: entry.direction,
      category: entry.category,
      linkedEntityName: entry.linkedEntityName ?? "",
      amount: String(entry.amount ?? ""),
      currency: entry.currency,
      account: entry.account ?? "cash",
      notes: entry.notes ?? "",
      paymentDate: String(entry.paymentDate ?? "").slice(0, 10) || businessDateString(),
    });
    setPayModal(true);
  }

  async function savePayment() {
    const amount = Number(payForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }

    setPaySaving(true);
    try {
      const payload = {
        direction: payForm.direction,
        category: payForm.category,
        linkedEntityName: payForm.linkedEntityName.trim() || undefined,
        amount,
        discount: 0,
        currency: payForm.currency,
        exchangeRate: settings?.usdToCdfRate ?? 2800,
        account: payForm.account || "cash",
        notes: payForm.notes.trim() || undefined,
        paymentDate: payForm.paymentDate || undefined,
      };
      const response = await apiFetch(payEditId ? `/api/payments/${payEditId}` : "/api/payments", {
        method: payEditId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(error.error ?? "Unable to save transaction");
      }
      toast({ title: payEditId ? "Transaction updated" : "Transaction recorded" });
      setPayModal(false);
      await refreshAll();
    } catch (error) {
      toast({ title: (error as Error).message, variant: "destructive" });
    } finally {
      setPaySaving(false);
    }
  }

  async function deletePayment() {
    if (!payDeleteId) return;
    try {
      const response = await apiFetch(`/api/payments/${payDeleteId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to cancel transaction");
      toast({ title: "Transaction cancelled" });
      setPayDeleteId(null);
      await refreshAll();
    } catch (error) {
      toast({ title: (error as Error).message, variant: "destructive" });
    }
  }

  function openVoucherCreate() {
    setVoucherForm(emptyVoucherForm());
    setVoucherModal(true);
  }

  async function saveVoucher() {
    const amount = Number(voucherForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (!voucherForm.description.trim()) {
      toast({ title: "Description is required", variant: "destructive" });
      return;
    }

    const incoming = ["cash_receipt", "customer_payment"].includes(voucherForm.voucherType);
    setVoucherSaving(true);
    try {
      const payload = {
        voucherType: voucherForm.voucherType,
        voucherDate: voucherForm.voucherDate || undefined,
        receivedFrom: incoming ? voucherForm.receivedFrom.trim() || undefined : undefined,
        paidTo: incoming ? undefined : voucherForm.paidTo.trim() || undefined,
        amount,
        currency: voucherForm.currency,
        exchangeRate: settings?.usdToCdfRate ?? 2800,
        account: "cash",
        category: voucherForm.category || undefined,
        description: voucherForm.description.trim(),
      };
      const response = await apiFetch("/api/vouchers", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(error.error ?? "Unable to save voucher");
      }
      toast({ title: "Voucher created" });
      setVoucherModal(false);
      await refreshAll();
    } catch (error) {
      toast({ title: (error as Error).message, variant: "destructive" });
    } finally {
      setVoucherSaving(false);
    }
  }

  async function deleteVoucher() {
    if (!voucherDeleteId) return;
    try {
      const response = await apiFetch(`/api/vouchers/${voucherDeleteId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to cancel voucher");
      toast({ title: "Voucher cancelled" });
      setVoucherDeleteId(null);
      await refreshAll();
    } catch (error) {
      toast({ title: (error as Error).message, variant: "destructive" });
    }
  }

  async function sendReceipt(paymentId: number) {
    setReceiptSendingId(paymentId);
    try {
      const response = await apiFetch(`/api/payments/${paymentId}/send-receipt`, { method: "POST" });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to send receipt");
      toast({ title: "Receipt sent on WhatsApp" });
    } catch (error) {
      toast({ title: (error as Error).message, variant: "destructive" });
    } finally {
      setReceiptSendingId(null);
    }
  }

  async function sendDailySummary() {
    setSummarySending(true);
    try {
      const response = await apiFetch("/api/whatsapp/send-daily-summary", { method: "POST" });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to send summary");
      toast({ title: "Daily summary sent on WhatsApp" });
    } catch (error) {
      toast({ title: (error as Error).message, variant: "destructive" });
    } finally {
      setSummarySending(false);
    }
  }

  async function saveOpeningBalance() {
    const targetAmountUsd = Number(openingAmount);
    if (!Number.isFinite(targetAmountUsd) || targetAmountUsd < 0) return;

    setOpeningSaving(true);
    try {
      const response = await apiFetch("/api/ledger/opening-balance", {
        method: "POST",
        body: JSON.stringify({
          targetAmountUsd,
          date: openingDate || undefined,
          notes: openingNotes.trim() || undefined,
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; skipped?: boolean };
      if (!response.ok) throw new Error(result.error ?? "Unable to set opening balance");
      toast({ title: result.skipped ? "Balance already matches" : "Opening balance updated" });
      setOpeningModal(false);
      await refreshAll();
    } catch (error) {
      toast({ title: (error as Error).message, variant: "destructive" });
    } finally {
      setOpeningSaving(false);
    }
  }

  function printVoucher(entry: VoucherRow) {
    const incoming = entry.direction === "in";
    const party = incoming ? entry.receivedFrom : entry.paidTo;
    const popup = window.open("", "_blank", "width=800,height=650");
    if (!popup) return;
    popup.document.write(`<!doctype html><html><head><title>Voucher</title><style>
      body{font-family:Arial,sans-serif;padding:42px;color:#111}h1{font-size:22px;margin:0}p{margin:5px 0;color:#555}
      table{width:100%;border-collapse:collapse;margin-top:28px}td{padding:11px 12px;border:1px solid #ddd}td:first-child{width:36%;font-weight:700;background:#f8fafc}
      .amount{font-size:20px;font-weight:800}.sig{display:flex;justify-content:space-between;margin-top:60px}.line{width:210px;border-top:1px solid #333;text-align:center;padding-top:7px;font-size:12px}
    </style></head><body>
      <h1>${escapeHtml(settings?.gymName ?? "Oxygen Fitness Gym")}</h1>
      <p>${escapeHtml(entry.voucherNumber ?? "Voucher")}</p>
      <table><tbody>
        <tr><td>Date</td><td>${escapeHtml(fmtDate(entry.voucherDate))}</td></tr>
        <tr><td>Type</td><td>${escapeHtml(entry.voucherType.replace(/_/g, " "))}</td></tr>
        <tr><td>${incoming ? "Received From" : "Paid To"}</td><td>${escapeHtml(party || "—")}</td></tr>
        <tr><td>Amount</td><td class="amount">${escapeHtml(formatNativeAmount({ ...entry, _kind: "voucher" }))}</td></tr>
        <tr><td>Description</td><td>${escapeHtml(entry.description || "—")}</td></tr>
      </tbody></table>
      <div class="sig"><div class="line">Authorized By</div><div class="line">Received By</div></div>
    </body></html>`);
    popup.document.close();
    setTimeout(() => { popup.focus(); popup.print(); }, 300);
  }

  function exportReport() {
    const rows = filteredEntries.map((entry) => {
      const incoming = entry.direction === "in";
      const categoryText = entry._kind === "payment" ? entry.category : entry.voucherType;
      return `<tr>
        <td>${escapeHtml(fmtDate(entryDate(entry)))}</td>
        <td>${escapeHtml(categoryText.replace(/_/g, " "))}</td>
        <td>${escapeHtml(entryParty(entry))}</td>
        <td style="text-align:right;font-weight:700;color:${incoming ? "#059669" : "#e11d48"}">${escapeHtml(formatNativeAmount(entry))}</td>
        <td>${escapeHtml(entryDescription(entry) || "—")}</td>
      </tr>`;
    }).join("");

    const popup = window.open("", "_blank", "width=1000,height=720");
    if (!popup) return;
    popup.document.write(`<!doctype html><html><head><title>Cash Book</title><style>
      @page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;color:#111;font-size:11px}h1{margin:0;font-size:20px}.meta{color:#666;margin-top:4px}
      table{width:100%;border-collapse:collapse;margin-top:20px}th{background:#111827;color:white;text-align:left;padding:8px;font-size:9px;text-transform:uppercase}td{padding:8px;border-bottom:1px solid #e5e7eb}
    </style></head><body>
      <h1>${escapeHtml(settings?.gymName ?? "Oxygen Fitness Gym")} — Cash Book</h1>
      <div class="meta">${escapeHtml(presetLabel(datePreset))}${dateRange.from || dateRange.to ? ` · ${escapeHtml(dateRange.from || "Start")} → ${escapeHtml(dateRange.to || "Now")}` : ""}</div>
      <div class="meta">Generated ${escapeHtml(new Date().toLocaleString())}</div>
      <table><thead><tr><th>Date</th><th>Type</th><th>Details</th><th style="text-align:right">Amount</th><th>Description</th></tr></thead>
      <tbody>${rows || "<tr><td colspan='5' style='text-align:center;padding:20px'>No entries</td></tr>"}</tbody></table>
    </body></html>`);
    popup.document.close();
    setTimeout(() => { popup.focus(); popup.print(); }, 300);
  }

  const voucherIncoming = ["cash_receipt", "customer_payment"].includes(voucherForm.voucherType);
  const balance = balanceQ.data ?? { balanceUsd: 0, balanceCdf: 0 };
  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-col gap-4 border-b border-border/70 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/15">
            <Banknote className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Cash Book</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>Cash movement and transaction history</span>
              <button type="button" onClick={() => void refreshAll()} className="inline-flex items-center gap-1.5 hover:text-foreground">
                <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
                {lastUpdated ? `Live · 20s · ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Connecting…"}
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canAdd && (
            <Button onClick={openPaymentCreate} className="gap-2">
              <Plus className="h-4 w-4" /> New Entry
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <MoreHorizontal className="h-4 w-4" /> More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Cash Book actions</DropdownMenuLabel>
              {canManage && (
                <DropdownMenuItem onClick={openVoucherCreate}>
                  <ReceiptText className="mr-2 h-4 w-4" /> New Voucher
                </DropdownMenuItem>
              )}
              {isAdmin && (
                <DropdownMenuItem onClick={() => {
                  setOpeningAmount(String(Number(balance.balanceUsd ?? 0).toFixed(2)));
                  setOpeningDate(businessDateString());
                  setOpeningNotes("");
                  setOpeningModal(true);
                }}>
                  <CircleDollarSign className="mr-2 h-4 w-4" /> Set Opening Balance
                </DropdownMenuItem>
              )}
              {isAdmin && (
                <DropdownMenuItem disabled={summarySending} onClick={() => void sendDailySummary()}>
                  {summarySending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Send Daily Summary
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={exportReport}>
                <FileDown className="mr-2 h-4 w-4" /> Export / Print
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          label={`Cash In · ${presetLabel(datePreset)}`}
          value={isLoading ? "—" : formatUsd(periodKpis.inUsd)}
          secondary={isLoading ? undefined : formatCdf(periodKpis.inCdf)}
          icon={ArrowDownLeft}
          tone="emerald"
        />
        <MetricCard
          label={`Cash Out · ${presetLabel(datePreset)}`}
          value={isLoading ? "—" : formatUsd(periodKpis.outUsd)}
          secondary={isLoading ? undefined : formatCdf(periodKpis.outCdf)}
          icon={ArrowUpRight}
          tone="rose"
        />
        <MetricCard
          label={`Net · ${presetLabel(datePreset)}`}
          value={isLoading ? "—" : formatUsd(periodKpis.netUsd)}
          secondary={isLoading ? undefined : formatCdf(periodKpis.netCdf)}
          icon={TrendingUp}
          tone="blue"
        />
        {isAdmin && (
          <MetricCard
            label="Current Cash Balance"
            value={balanceQ.isLoading ? "—" : formatUsd(balance.balanceUsd)}
            secondary={balanceQ.isLoading ? undefined : formatCdf(balance.balanceCdf)}
            icon={Wallet}
            tone="violet"
            hint="All time · unaffected by filters"
          />
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="border-b border-border/60 p-3.5">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                placeholder="Search member, description, number…"
                className="h-10 pl-9"
              />
            </div>

            <Select value={datePreset} onValueChange={(value) => { setDatePreset(value as DatePreset); setPage(1); }}>
              <SelectTrigger className="h-10 w-full gap-2 lg:w-[154px]">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_PRESETS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={direction} onValueChange={(value) => { setDirection(value as DirectionFilter); setPage(1); }}>
              <SelectTrigger className="h-10 w-full lg:w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All movement</SelectItem>
                <SelectItem value="in">Money In</SelectItem>
                <SelectItem value="out">Money Out</SelectItem>
              </SelectContent>
            </Select>

            <Select value={category} onValueChange={(value) => { setCategory(value); setPage(1); }}>
              <SelectTrigger className="h-10 w-full lg:w-[165px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={currency} onValueChange={(value) => { setCurrency(value as CurrencyFilter); setPage(1); }}>
              <SelectTrigger className="h-10 w-full lg:w-[112px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All currency</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="CDF">CDF / FC</SelectItem>
              </SelectContent>
            </Select>

            {(activeFilterCount > 0 || datePreset !== "today") && (
              <Button variant="ghost" size="sm" className="h-10 gap-1.5 text-muted-foreground" onClick={resetFilters}>
                <X className="h-4 w-4" /> Clear
              </Button>
            )}
          </div>

          {datePreset === "custom" && (
            <div className="mt-3 flex flex-col gap-2 border-t border-border/50 pt-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <Label className="w-10 text-xs text-muted-foreground">From</Label>
                <Input type="date" value={customFrom} onChange={(event) => { setCustomFrom(event.target.value); setPage(1); }} className="h-9 sm:w-40" />
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-10 text-xs text-muted-foreground">To</Label>
                <Input type="date" value={customTo} onChange={(event) => { setCustomTo(event.target.value); setPage(1); }} className="h-9 sm:w-40" />
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {total.toLocaleString()} matching {total === 1 ? "entry" : "entries"}
              {activeFilterCount > 0 ? ` · ${activeFilterCount} extra ${activeFilterCount === 1 ? "filter" : "filters"}` : ""}
            </span>
            <span>KPIs follow the date period. Current balance always stays all-time.</span>
          </div>
        </div>

        <div className="md:hidden divide-y divide-border/50">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading cash book…</div>
          ) : pageEntries.length === 0 ? (
            <div className="py-14 text-center">
              <Banknote className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
              <p className="font-medium text-muted-foreground">No transactions found</p>
              <p className="mt-1 text-xs text-muted-foreground/60">Try another date or filter.</p>
            </div>
          ) : pageEntries.map((entry) => {
            const incoming = entry.direction === "in";
            const description = entryDescription(entry);
            return (
              <div key={`${entry._kind}-${entry.id}`} className="flex items-start gap-3 px-4 py-4">
                <div className={cn(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  incoming ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400",
                )}>
                  {incoming ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{entryParty(entry)}</p>
                    <Badge variant="outline" className="text-[10px] capitalize">{entryCategory(entry).replace(/_/g, " ")}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{fmtDate(entryDate(entry))}{description ? ` · ${description}` : ""}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={cn("font-bold tabular-nums", incoming ? "text-emerald-400" : "text-rose-400")}>{formatNativeAmount(entry)}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{entry.currency}</p>
                </div>
                {canManage && <EntryMenu entry={entry} onEdit={openPaymentEdit} onDeletePayment={setPayDeleteId} onDeleteVoucher={setVoucherDeleteId} onPrintVoucher={printVoucher} onSendReceipt={sendReceipt} receiptSendingId={receiptSendingId} />}
              </div>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/20">
                <th className="w-[140px] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</th>
                <th className="w-[150px] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type</th>
                <th className="w-[180px] px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Amount</th>
                {canManage && <th className="w-[72px] px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {isLoading ? (
                <tr><td colSpan={canManage ? 5 : 4} className="py-16 text-center text-muted-foreground">Loading cash book…</td></tr>
              ) : pageEntries.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 5 : 4} className="py-20 text-center">
                    <Banknote className="mx-auto mb-2 h-9 w-9 text-muted-foreground/25" />
                    <p className="font-medium text-muted-foreground">No transactions found</p>
                    <p className="mt-1 text-xs text-muted-foreground/60">Try another date or adjust your filters.</p>
                  </td>
                </tr>
              ) : pageEntries.map((entry) => {
                const incoming = entry.direction === "in";
                const description = entryDescription(entry);
                const categoryText = entry._kind === "payment" ? entry.category : entry.voucherType;
                return (
                  <tr key={`${entry._kind}-${entry.id}`} className="group transition-colors hover:bg-muted/20">
                    <td className="whitespace-nowrap px-5 py-4 align-middle font-medium tabular-nums">{fmtDate(entryDate(entry))}</td>
                    <td className="px-5 py-4 align-middle">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className={cn(
                          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          incoming ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400",
                        )}>
                          {incoming ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{entryParty(entry)}</p>
                          {description && <p className="mt-0.5 truncate text-xs text-muted-foreground" title={description}>{description}</p>}
                          {entry._kind === "payment" && entry.planName && <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{entry.planName}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 align-middle">
                      <Badge variant="outline" className="max-w-full capitalize text-xs font-medium">
                        <span className="truncate">{categoryText.replace(/_/g, " ")}</span>
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-right align-middle">
                      <p className={cn("text-base font-bold tabular-nums", incoming ? "text-emerald-400" : "text-rose-400")}>{formatNativeAmount(entry)}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{incoming ? "Money in" : "Money out"}</p>
                    </td>
                    {canManage && (
                      <td className="px-4 py-4 text-right align-middle">
                        <EntryMenu entry={entry} onEdit={openPaymentEdit} onDeletePayment={setPayDeleteId} onDeleteVoucher={setVoucherDeleteId} onPrintVoucher={printVoucher} onSendReceipt={sendReceipt} receiptSendingId={receiptSendingId} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {showingFrom.toLocaleString()}–{showingTo.toLocaleString()} of {total.toLocaleString()}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || isLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Previous
            </Button>
            <span className="min-w-[76px] text-center text-xs text-muted-foreground">Page {page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages || isLoading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={payModal} onOpenChange={setPayModal}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{payEditId ? "Edit Transaction" : "New Cash Entry"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-1">
            {isAdmin ? (
              <div className="space-y-1.5">
                <Label>Movement</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant={payForm.direction === "in" ? "default" : "outline"} onClick={() => setPayForm((current) => ({ ...current, direction: "in" }))} className="gap-2">
                    <ArrowDownLeft className="h-4 w-4" /> Money In
                  </Button>
                  <Button type="button" variant={payForm.direction === "out" ? "default" : "outline"} onClick={() => setPayForm((current) => ({ ...current, direction: "out" }))} className="gap-2">
                    <ArrowUpRight className="h-4 w-4" /> Money Out
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-400">Money Out · Expense</div>
            )}

            {isAdmin && (
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={payForm.category} onValueChange={(value) => setPayForm((current) => ({ ...current, category: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAY_CATEGORIES.map((value) => <SelectItem key={value} value={value}>{value.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={payForm.paymentDate} onChange={(event) => setPayForm((current) => ({ ...current, paymentDate: event.target.value }))} /></div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={payForm.currency} onValueChange={(value) => setPayForm((current) => ({ ...current, currency: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="CDF">CDF / FC</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5"><Label>Amount</Label><Input type="number" min="0" step="0.01" placeholder="0.00" value={payForm.amount} onChange={(event) => setPayForm((current) => ({ ...current, amount: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Name / Reference</Label><Input placeholder="Optional" value={payForm.linkedEntityName} onChange={(event) => setPayForm((current) => ({ ...current, linkedEntityName: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Notes</Label><Textarea rows={2} placeholder="Optional note…" value={payForm.notes} onChange={(event) => setPayForm((current) => ({ ...current, notes: event.target.value }))} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPayModal(false)}>Cancel</Button><Button onClick={() => void savePayment()} disabled={paySaving}>{paySaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={voucherModal} onOpenChange={setVoucherModal}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Voucher</DialogTitle></DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5"><Label>Voucher Type</Label><Select value={voucherForm.voucherType} onValueChange={(value) => setVoucherForm((current) => ({ ...current, voucherType: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{VOUCHER_TYPES.map((value) => <SelectItem key={value} value={value}>{value.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={voucherForm.voucherDate} onChange={(event) => setVoucherForm((current) => ({ ...current, voucherDate: event.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Currency</Label><Select value={voucherForm.currency} onValueChange={(value) => setVoucherForm((current) => ({ ...current, currency: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="CDF">CDF / FC</SelectItem></SelectContent></Select></div>
            </div>
            <div className="space-y-1.5"><Label>{voucherIncoming ? "Received From" : "Paid To"}</Label><Input value={voucherIncoming ? voucherForm.receivedFrom : voucherForm.paidTo} onChange={(event) => setVoucherForm((current) => voucherIncoming ? ({ ...current, receivedFrom: event.target.value }) : ({ ...current, paidTo: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Amount</Label><Input type="number" min="0" step="0.01" value={voucherForm.amount} onChange={(event) => setVoucherForm((current) => ({ ...current, amount: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Category</Label><Select value={voucherForm.category || "none"} onValueChange={(value) => setVoucherForm((current) => ({ ...current, category: value === "none" ? "" : value }))}><SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger><SelectContent><SelectItem value="none">No category</SelectItem><SelectItem value="membership">Membership</SelectItem><SelectItem value="expense">Expense</SelectItem><SelectItem value="payroll">Payroll</SelectItem><SelectItem value="stock_purchase">Stock Purchase</SelectItem><SelectItem value="product_sale">Product Sale</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Description *</Label><Textarea rows={2} value={voucherForm.description} onChange={(event) => setVoucherForm((current) => ({ ...current, description: event.target.value }))} placeholder="What is this for?" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setVoucherModal(false)}>Cancel</Button><Button onClick={() => void saveVoucher()} disabled={voucherSaving}>{voucherSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Voucher</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openingModal} onOpenChange={setOpeningModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Set Opening Balance</DialogTitle></DialogHeader>
          <div className="space-y-4 py-1">
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"><span className="text-muted-foreground">Current balance</span><span className="float-right font-semibold tabular-nums">{formatUsd(balance.balanceUsd)}</span></div>
            <div className="space-y-1.5"><Label>Target balance (USD)</Label><Input type="number" min="0" step="0.01" value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} /></div>
            <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={openingDate} onChange={(event) => setOpeningDate(event.target.value)} /></div>
            <div className="space-y-1.5"><Label>Notes</Label><Input value={openingNotes} onChange={(event) => setOpeningNotes(event.target.value)} placeholder="Optional" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpeningModal(false)}>Cancel</Button><Button onClick={() => void saveOpeningBalance()} disabled={openingSaving || !openingAmount}>{openingSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Set Balance</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={payDeleteId !== null} onOpenChange={(open) => !open && setPayDeleteId(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Cancel this transaction?</AlertDialogTitle><AlertDialogDescription>The transaction will be marked cancelled and its financial effect reversed.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void deletePayment()}>Cancel Transaction</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={voucherDeleteId !== null} onOpenChange={(open) => !open && setVoucherDeleteId(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Cancel this voucher?</AlertDialogTitle><AlertDialogDescription>The voucher will be cancelled and its financial effect reversed.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void deleteVoucher()}>Cancel Voucher</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EntryMenu({
  entry,
  onEdit,
  onDeletePayment,
  onDeleteVoucher,
  onPrintVoucher,
  onSendReceipt,
  receiptSendingId,
}: {
  entry: UnifiedEntry;
  onEdit: (entry: PaymentRow) => void;
  onDeletePayment: (id: number) => void;
  onDeleteVoucher: (id: number) => void;
  onPrintVoucher: (entry: VoucherRow) => void;
  onSendReceipt: (id: number) => Promise<void>;
  receiptSendingId: number | null;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Transaction actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {entry._kind === "payment" ? (
          <>
            {entry.memberId && (
              <DropdownMenuItem disabled={receiptSendingId === entry.id} onClick={() => void onSendReceipt(entry.id)}>
                {receiptSendingId === entry.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Send Receipt
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onEdit(entry)}><Pencil className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDeletePayment(entry.id)}><Trash2 className="mr-2 h-4 w-4" /> Cancel</DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onClick={() => onPrintVoucher(entry)}><FileDown className="mr-2 h-4 w-4" /> Print Voucher</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDeleteVoucher(entry.id)}><Trash2 className="mr-2 h-4 w-4" /> Cancel</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
