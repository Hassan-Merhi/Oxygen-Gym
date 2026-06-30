import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useI18n } from "@/lib/i18n";
import { useGetMe } from "@/hooks/use-me";
import { useQuery } from "@tanstack/react-query";
import { useFmtDate } from "@/lib/useFmtDate";
import {
  useListMembers,
  useCreateMember,
  useUpdateMember,
  useDeleteMember,
  useCheckInMember,
  useRenewMember,
  useFreezeMember,
  useReactivateMember,
  useSetMemberStatus,
  useListPlans,
  useGetSettings,
  useSendMemberWhatsapp,
} from "@workspace/api-client-react";
import type { Member, Plan } from "@workspace/api-client-react";
import { useListStaffEmployees, getListStaffEmployeesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyTableState } from "@/components/ui/empty-table-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Search,
  MoreHorizontal,
  Eye,
  Edit,
  RefreshCw,
  LogIn,
  Snowflake,
  Play,
  UserMinus,
  Archive,
  Trash2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Users,
  SlidersHorizontal,
  Printer,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Clock,
  MessageCircle,
} from "lucide-react";

// ─── Date helpers ─────────────────────────────────────────────────────────────
function toDateInput(d: string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toISOString().split("T")[0];
}
function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

// ─── Invoice data type ────────────────────────────────────────────────────────
interface MemberInvoiceData {
  invoiceNum: string;
  memberName: string;
  memberPhone?: string;
  planName: string;
  planPrice: number;
  startDate: string;
  expiryDate: string;
  amountPaid: number;
  discount: number;
  balance: number;
  currency: string;
  isRenewal: boolean;
}

// ─── Invoice Print ────────────────────────────────────────────────────────────
function printMemberInvoice(inv: MemberInvoiceData, settings: Record<string, unknown>) {
  const sym = inv.currency === "CDF" ? "FC" : "$";
  const fmt = (n: number) => inv.currency === "CDF" ? `FC ${n % 1 === 0 ? n : n.toFixed(2)}` : `${sym}${n % 1 === 0 ? n : n.toFixed(2)}`;
  const fmtD = (d: string) => { try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); } catch { return d; } };

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${inv.invoiceNum}</title>
  <style>
    @page { size: 80mm auto; margin: 3mm 6mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; width: 68mm; padding: 0; font-size: 11px; color: #111; background: #fff; }
    .gym-name { font-size: 15px; font-weight: 700; letter-spacing: -0.3px; }
    .gym-sub { font-size: 10px; color: #666; margin-top: 2px; }
    .divider { border: none; border-top: 1px solid #e5e7eb; margin: 8px 0; }
    .divider-dashed { border: none; border-top: 1px dashed #d1d5db; margin: 8px 0; }
    .row { display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 4px; }
    .label { color: #6b7280; }
    .val { font-weight: 500; }
    .badge { display: inline-block; background: #f3f4f6; border-radius: 3px; padding: 1px 4px; font-size: 9px; font-weight: 600; color: #374151; }
    .total-row { display: flex; justify-content: space-between; font-size: 13px; font-weight: 700; padding: 6px 0; border-top: 2px solid #111; margin-top: 3px; }
    .sum-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 11px; }
    .balance-due { color: #dc2626; font-weight: 600; }
    .balance-ok { color: #059669; font-weight: 600; }
    .footer { margin-top: 14px; text-align: center; font-size: 10px; color: #9ca3af; }
    @media print { html, body { width: 68mm; } }
  </style>
</head>
<body>
  <div style="text-align:center;margin-bottom:16px">
    <img src="${window.location.origin}/gym-logo.jpg" onerror="this.style.display='none'" style="max-height:60px;margin-bottom:10px;object-fit:contain" alt=""/>
    <div class="gym-name">${settings.gymName ?? "Oxygen Fitness Gym"}</div>
    ${settings.address ? `<div class="gym-sub">${settings.address}</div>` : ""}
    ${settings.phone ? `<div class="gym-sub">${settings.phone}</div>` : ""}
  </div>
  <hr class="divider">
  <div class="row"><span class="label">N° Facture</span><span class="val badge">${inv.invoiceNum}</span></div>
  <div class="row"><span class="label">Date</span><span class="val">${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span></div>
  <div class="row"><span class="label">Type</span><span class="val">${inv.isRenewal ? "Renouvellement" : "Nouvelle Inscription"}</span></div>
  <hr class="divider">
  <div class="row"><span class="label">Membre</span><span class="val">${inv.memberName}</span></div>
  ${inv.memberPhone ? `<div class="row"><span class="label">Téléphone</span><span class="val">${inv.memberPhone}</span></div>` : ""}
  <hr class="divider">
  <div class="row"><span class="label">Abonnement</span><span class="val">${inv.planName}</span></div>
  <div class="row"><span class="label">Début</span><span class="val">${fmtD(inv.startDate)}</span></div>
  <div class="row"><span class="label">Expiration</span><span class="val">${fmtD(inv.expiryDate)}</span></div>
  <hr class="divider">
  <div class="sum-row"><span class="label">Prix abonnement</span><span>${fmt(inv.planPrice)}</span></div>
  ${inv.discount > 0 ? `<div class="sum-row"><span class="label">Remise</span><span style="color:#dc2626">-${fmt(inv.discount)}</span></div>` : ""}
  <div class="total-row"><span>TOTAL</span><span>${fmt(inv.planPrice - inv.discount)}</span></div>
  <div class="sum-row"><span class="label">Montant payé</span><span>${fmt(inv.amountPaid)}</span></div>
  <div class="sum-row"><span class="label">Reste à payer</span><span class="${inv.balance > 0 ? "balance-due" : "balance-ok"}">${fmt(inv.balance)}</span></div>
  <hr class="divider-dashed" style="margin-top:20px">
  <div class="footer">${settings.receiptFooter ?? "Merci de votre confiance !"}</div>
</body>
</html>`;

  const existing = document.getElementById("__gym_print_frame__");
  if (existing) existing.remove();
  const iframe = document.createElement("iframe");
  iframe.id = "__gym_print_frame__";
  iframe.style.cssText = "position:fixed;top:0;left:-9999px;width:400px;height:1000px;border:none;";
  document.body.appendChild(iframe);
  const doc = (iframe.contentDocument ?? (iframe.contentWindow as Window).document);
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => {
    (iframe.contentWindow as Window).focus();
    (iframe.contentWindow as Window).print();
    setTimeout(() => iframe.remove(), 2000);
  }, 500);
}
function fmtCurrency(amount: number | null | undefined, currency: string): string {
  if (amount == null) return "—";
  return `${currency} ${amount.toFixed(2)}`;
}
function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  const diff = new Date(d).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ─── Status badge — uses shared utility ───────────────────────────────────────
import { StatusBadge as MemberStatusBadge } from "@/lib/status-badge";
function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  return <MemberStatusBadge status={status} label={t(`members.status.${status}`) ?? status} />;
}

// ─── Form schemas ─────────────────────────────────────────────────────────────
const memberSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().optional(),
  planId: z.string().optional(),
  startDate: z.string().optional(),
  expiryDate: z.string().optional(),
  status: z.string().default("active"),
  amountPaid: z.coerce.number().min(0).default(0),
  discount: z.coerce.number().min(0).default(0),
  currency: z.enum(["USD", "CDF"]).default("USD"),
  cashAccountId: z.string().optional(),
  notes: z.string().optional(),
  fingerprintId: z.string().optional(),
  qrCodeId: z.string().optional(),
  coachId: z.string().optional(),
  commissionAmount: z.coerce.number().min(0).default(0),
});
type MemberFormValues = z.infer<typeof memberSchema>;

const renewSchema = z.object({
  planId: z.string().min(1, "Plan is required"),
  startDate: z.string().min(1, "Start date is required"),
  expiryDate: z.string().min(1, "Expiry date is required"),
  amountPaid: z.coerce.number().min(0).default(0),
  discount: z.coerce.number().min(0).default(0),
  currency: z.enum(["USD", "CDF"]).default("USD"),
  cashAccountId: z.string().optional(),
  notes: z.string().optional(),
});
type RenewFormValues = z.infer<typeof renewSchema>;

const freezeSchema = z.object({
  frozenAt: z.string().min(1),
  frozenUntil: z.string().min(1),
  reason: z.string().optional(),
});
type FreezeFormValues = z.infer<typeof freezeSchema>;

// ─── Main page ────────────────────────────────────────────────────────────────
export default function MembersPage() {
  const { t } = useI18n();
  const { fmtDate } = useFmtDate();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const me = useGetMe();
  const isAdmin = me?.role === "admin";
  const canManage = me?.role === "admin" || me?.role === "manager" || me?.permissions?.manageMembers;
  const canViewAccounting = me?.role === "admin" || me?.permissions?.viewAccounting;

  // ── Filters
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [expiryWindow, setExpiryWindow] = useState("all");
  const [sortBy, setSortBy] = useState("joinDate");
  const [sortOrder, setSortOrder] = useState("desc");
  const [showFilters, setShowFilters] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const LIMIT = 20;
  const [archiveId, setArchiveId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // ── Invoice
  const [invoicePrintData, setInvoicePrintData] = useState<MemberInvoiceData | null>(null);
  const [lastInvoiceData, setLastInvoiceData] = useState<MemberInvoiceData | null>(null);
  const pendingInvoiceRef = useRef<MemberInvoiceData | null>(null);
  const { data: settingsData } = useGetSettings();

  // ── Modals
  const [addOpen, setAddOpen] = useState(false);
  const [editMember, setEditMember] = useState<Member | null>(null);
  const [renewMember, setRenewMember] = useState<Member | null>(null);
  const [freezeMember, setFreezeMember] = useState<Member | null>(null);
  const [checkInMember, setCheckInMember] = useState<Member | null>(null);
  const [checkInForce, setCheckInForce] = useState(false);
  const [reactivateMember, setReactivateMember] = useState<Member | null>(null);

  // ── Staff employees (coaches)
  const { data: staffData } = useListStaffEmployees({ limit: "200", status: "active" } as any, {
    query: { queryKey: getListStaffEmployeesQueryKey({ limit: "200", status: "active" } as any) }
  });
  const coaches = staffData?.items ?? [];

  // ── Chart of accounts (cash accounts for voucher selection)
  const { data: chartAccounts = [] } = useQuery<{ id: number; name: string; type: string; isActive: boolean }[]>({
    queryKey: ["/api/accounts/chart"],
    queryFn: async () => {
      const token = localStorage.getItem("gym_token");
      const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
      const res = await fetch(`${apiBase}/api/accounts/chart`, { headers: { Authorization: `Bearer ${token}` } });
      return res.json();
    },
  });
  const cashAccounts = chartAccounts.filter((a) => a.isActive && a.type !== "expense" && a.type !== "liability");
  const cashAccount  = cashAccounts.find((a) => a.name.toLowerCase() === "cash") ?? cashAccounts[0] ?? null;

  // ── Queries
  const { data: membersData, isLoading } = useListMembers({
    page,
    limit: LIMIT,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(statusFilter !== "all" && { status: statusFilter }),
    ...(planFilter !== "all" && { planId: parseInt(planFilter) }),
    ...(expiryWindow !== "all" && { expiryWindow: parseInt(expiryWindow) }),
    ...(showDeleted && { showDeleted: true }),
    sortBy,
    sortOrder,
  } as any);
  const { data: plans = [] } = useListPlans();
  // Fetch count of active members expiring within 7 days
  const { data: expiringData } = useListMembers({ page: 1, limit: 1, status: "active", expiryWindow: 7 } as any, {
    query: { queryKey: ["members-expiring-7", "active", 7], refetchInterval: 60000 }
  });
  const expiringCount = expiringData?.total ?? 0;

  const items = membersData?.items ?? [];
  const total = membersData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const invalidateMembers = () => queryClient.invalidateQueries({ queryKey: ["/api/members"] });

  // ── Mutations
  const createMutation = useCreateMember({ mutation: { onSuccess: (data) => {
    invalidateMembers(); setAddOpen(false); toast({ title: t("common.success") });
    if (pendingInvoiceRef.current) {
      const inv = { ...pendingInvoiceRef.current, invoiceNum: `INV-${(data as any).id ?? Date.now()}` };
      setInvoicePrintData(inv);
      setLastInvoiceData(inv);
      pendingInvoiceRef.current = null;
    }
  }}});
  const updateMutation = useUpdateMember({ mutation: { onSuccess: () => { invalidateMembers(); setEditMember(null); toast({ title: t("common.success") }); } } });
  const deleteMutation = useDeleteMember({ mutation: { onSuccess: () => { invalidateMembers(); toast({ title: t("common.success") }); } } });
  const sendWhatsappMutation = useSendMemberWhatsapp({ mutation: {
    onSuccess: () => toast({ title: "WhatsApp envoyé ✓" }),
    onError: () => toast({ title: "Échec WhatsApp", variant: "destructive" }),
  } });
  const checkInMutation = useCheckInMember({ mutation: {
    onSuccess: (data) => {
      if (!data.success && data.alreadyCheckedIn) {
        setCheckInForce(true);
      } else {
        invalidateMembers();
        setCheckInMember(null);
        setCheckInForce(false);
        toast({ title: t("members.checkin.success") });
      }
    }
  }});
  const renewMutation = useRenewMember({ mutation: { onSuccess: () => {
    invalidateMembers(); setRenewMember(null); toast({ title: t("common.success") });
    if (pendingInvoiceRef.current) {
      setInvoicePrintData(pendingInvoiceRef.current);
      setLastInvoiceData(pendingInvoiceRef.current);
      pendingInvoiceRef.current = null;
    }
  }}});
  const freezeMutation = useFreezeMember({ mutation: { onSuccess: () => { invalidateMembers(); setFreezeMember(null); toast({ title: t("common.success") }); } } });
  const reactivateMutation = useReactivateMember({ mutation: { onSuccess: () => { invalidateMembers(); setReactivateMember(null); toast({ title: t("common.success") }); } } });
  const statusMutation = useSetMemberStatus({ mutation: { onSuccess: () => { invalidateMembers(); toast({ title: t("common.success") }); } } });

  const exchangeRate = (settingsData?.usdToCdfRate as number | undefined) ?? 1;

  function convertPrice(basePrice: number, baseCur: string, targetCur: string) {
    if (baseCur === targetCur) return basePrice;
    if (targetCur === "CDF" && baseCur === "USD") return basePrice * exchangeRate;
    if (targetCur === "USD" && baseCur === "CDF") return basePrice / exchangeRate;
    return basePrice;
  }

  // ── Add/Edit form
  const form = useForm<MemberFormValues>({ resolver: zodResolver(memberSchema) });
  const [planPrice, setPlanPrice] = useState(0);
  const [planBasePrice, setPlanBasePrice] = useState(0);
  const [planBaseCurrency, setPlanBaseCurrency] = useState<string>("USD");

  function openAdd() {
    const today = new Date().toISOString().split("T")[0];
    const defaultAccount = cashAccount ? String(cashAccount.id) : "";
    form.reset({ status: "active", currency: "USD", amountPaid: 0, discount: 0, startDate: today, cashAccountId: defaultAccount });
    setPlanPrice(0); setPlanBasePrice(0); setPlanBaseCurrency("USD");
    setAddOpen(true);
  }
  function openEdit(m: Member) {
    form.reset({
      name: m.name, phone: m.phone ?? "",
      planId: m.planId ? String(m.planId) : "",
      startDate: toDateInput(m.startDate), expiryDate: toDateInput(m.expiryDate),
      status: m.status, amountPaid: m.amountPaid ?? 0, discount: m.discount ?? 0,
      currency: (m.currency as "USD" | "CDF") ?? "USD",
      cashAccountId: m.cashAccountId ? String(m.cashAccountId) : (cashAccount ? String(cashAccount.id) : ""),
      notes: m.notes ?? "", fingerprintId: m.fingerprintId ?? "", qrCodeId: m.qrCodeId ?? "",
      coachId: m.coachId ? String(m.coachId) : "",
      commissionAmount: (m as any).commissionAmount ?? 0,
    });
    // Use the plan's authoritative price/currency as the base, then convert to the
    // member's payment currency so the displayed price is always correct.
    const plan = m.planId ? plans.find((p: Plan) => String(p.id) === String(m.planId)) : null;
    if (plan) {
      const baseCur = (plan.currency as string) ?? "USD";
      const formCur = (m.currency as string) ?? "USD";
      setPlanBasePrice(plan.price);
      setPlanBaseCurrency(baseCur);
      setPlanPrice(convertPrice(plan.price, baseCur, formCur));
    } else {
      setPlanBasePrice(m.planPrice ?? 0);
      setPlanBaseCurrency((m.currency as string) ?? "USD");
      setPlanPrice(m.planPrice ?? 0);
    }
    setEditMember(m);
  }

  function watchedPlanId(value: string) {
    const plan = plans.find((p: Plan) => String(p.id) === value);
    if (plan) {
      const baseCur = (plan.currency as string) ?? "USD";
      const formCur = form.getValues("currency") || "USD";
      setPlanBasePrice(plan.price);
      setPlanBaseCurrency(baseCur);
      setPlanPrice(convertPrice(plan.price, baseCur, formCur));
      const start = form.getValues("startDate");
      if (start) form.setValue("expiryDate", addDays(start, plan.durationDays));
    }
  }

  const amountPaid = form.watch("amountPaid") ?? 0;
  const discount = form.watch("discount") ?? 0;
  const balance = planPrice - discount - amountPaid;

  // Always pin to the Cash account
  useEffect(() => {
    if (cashAccount) form.setValue("cashAccountId", String(cashAccount.id));
  }, [cashAccount?.id]);

  useEffect(() => {
    if (cashAccount) form.setValue("cashAccountId", String(cashAccount.id));
  }, [amountPaid]);

  async function onSubmit(values: MemberFormValues) {
    const payload = {
      ...values,
      planId: values.planId ? parseInt(values.planId) : undefined,
      startDate: values.startDate || undefined,
      expiryDate: values.expiryDate || undefined,
      cashAccountId: values.cashAccountId ? parseInt(values.cashAccountId) : undefined,
      coachId: values.coachId ? parseInt(values.coachId) : undefined,
      commissionAmount: values.commissionAmount ?? 0,
    };
    if (editMember) {
      updateMutation.mutate({ id: editMember.id, data: { ...payload, planPrice } });
    } else {
      const selectedPlan = plans.find((p: Plan) => String(p.id) === values.planId);
      const price = planPrice;
      const disc = Number(values.discount ?? 0);
      const paid = Number(values.amountPaid ?? 0);
      pendingInvoiceRef.current = {
        invoiceNum: `INV-0`,
        memberName: values.name,
        memberPhone: values.phone ?? undefined,
        planName: selectedPlan?.name ?? "",
        planPrice: price,
        startDate: values.startDate ?? "",
        expiryDate: values.expiryDate ?? "",
        amountPaid: paid,
        discount: disc,
        balance: price - disc - paid,
        currency: values.currency ?? "USD",
        isRenewal: false,
      };
      createMutation.mutate({ data: payload });
    }
  }

  // ── Renew form
  const renewForm = useForm<RenewFormValues>({ resolver: zodResolver(renewSchema) });
  const [renewPlanPrice, setRenewPlanPrice] = useState(0);
  const [renewPlanBasePrice, setRenewPlanBasePrice] = useState(0);
  const [renewPlanBaseCurrency, setRenewPlanBaseCurrency] = useState<string>("USD");
  const renewAmountPaid = renewForm.watch("amountPaid") ?? 0;
  const renewDiscount = renewForm.watch("discount") ?? 0;
  const renewBalance = renewPlanPrice - renewDiscount - renewAmountPaid;

  // Always pin renew form to the Cash account
  useEffect(() => {
    if (cashAccount) renewForm.setValue("cashAccountId", String(cashAccount.id));
  }, [cashAccount?.id]);

  useEffect(() => {
    if (cashAccount) renewForm.setValue("cashAccountId", String(cashAccount.id));
  }, [renewAmountPaid]);

  function openRenew(m: Member) {
    const today = new Date().toISOString().split("T")[0];
    const defaultAccount = cashAccount ? String(cashAccount.id) : "";
    renewForm.reset({ startDate: today, currency: (m.currency as "USD" | "CDF") ?? "USD", amountPaid: 0, discount: 0, cashAccountId: defaultAccount });
    setRenewPlanPrice(0); setRenewPlanBasePrice(0); setRenewPlanBaseCurrency("USD");
    setRenewMember(m);
  }

  function watchRenewPlan(value: string) {
    const plan = plans.find((p: Plan) => String(p.id) === value);
    if (plan) {
      const baseCur = (plan.currency as string) ?? "USD";
      const formCur = renewForm.getValues("currency") || "USD";
      setRenewPlanBasePrice(plan.price);
      setRenewPlanBaseCurrency(baseCur);
      setRenewPlanPrice(convertPrice(plan.price, baseCur, formCur));
      const start = renewForm.getValues("startDate");
      if (start) renewForm.setValue("expiryDate", addDays(start, plan.durationDays));
    }
  }

  async function onRenewSubmit(values: RenewFormValues) {
    if (!renewMember) return;
    const selectedPlan = plans.find((p: Plan) => String(p.id) === values.planId);
    const price = renewPlanPrice;
    const disc = Number(values.discount ?? 0);
    const paid = Number(values.amountPaid ?? 0);
    pendingInvoiceRef.current = {
      invoiceNum: `INV-R-${renewMember.id}-${Date.now()}`,
      memberName: renewMember.name,
      memberPhone: renewMember.phone ?? undefined,
      planName: selectedPlan?.name ?? "",
      planPrice: price,
      startDate: values.startDate,
      expiryDate: values.expiryDate ?? "",
      amountPaid: paid,
      discount: disc,
      balance: price - disc - paid,
      currency: values.currency ?? "USD",
      isRenewal: true,
    };
    renewMutation.mutate({ id: renewMember.id, data: {
      ...values,
      planId: parseInt(values.planId),
      cashAccountId: values.cashAccountId ? parseInt(values.cashAccountId) : undefined,
    }});
  }

  // ── Freeze form
  const freezeForm = useForm<FreezeFormValues>({ resolver: zodResolver(freezeSchema) });
  const frozenAt = freezeForm.watch("frozenAt") ?? "";
  const frozenUntil = freezeForm.watch("frozenUntil") ?? "";
  const frozenDays = frozenAt && frozenUntil
    ? Math.max(0, Math.round((new Date(frozenUntil).getTime() - new Date(frozenAt).getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  function openFreeze(m: Member) {
    const today = new Date().toISOString().split("T")[0];
    freezeForm.reset({ frozenAt: today });
    setFreezeMember(m);
  }

  async function onFreezeSubmit(values: FreezeFormValues) {
    if (!freezeMember) return;
    freezeMutation.mutate({ id: freezeMember.id, data: values });
  }

  function openReprintInvoice(m: Member) {
    const inv: MemberInvoiceData = {
      invoiceNum: m.memberNumber ? `INV-${m.memberNumber}` : `INV-${m.id}`,
      memberName: m.name,
      memberPhone: m.phone ?? undefined,
      planName: m.planName ?? "",
      planPrice: m.planPrice ?? 0,
      startDate: m.startDate ?? m.joinDate,
      expiryDate: m.expiryDate ?? "",
      amountPaid: m.amountPaid ?? 0,
      discount: m.discount ?? 0,
      balance: m.balance ?? 0,
      currency: m.currency,
      isRenewal: false,
    };
    setInvoicePrintData(inv);
    setLastInvoiceData(inv);
  }

  // avatar color based on name
  function avatarColor(name: string) {
    const colors = [
      "bg-violet-500","bg-blue-500","bg-emerald-500",
      "bg-orange-500","bg-rose-500","bg-indigo-500","bg-teal-500","bg-amber-500",
    ];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xfffff;
    return colors[h % colors.length];
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Users}
        iconClass="bg-blue-500/10 text-blue-500"
        title={t("members.title")}
        subtitle={`${total} ${t("members.total")}`}
        actions={
          <>
            {lastInvoiceData && (
              <Button variant="outline" size="sm" onClick={() => setInvoicePrintData(lastInvoiceData)} className="gap-1.5">
                <Printer className="h-4 w-4" />
                {t("members.invoice.reprint")}
              </Button>
            )}
            {canManage && (
              <Button onClick={openAdd}>
                <Plus className="h-4 w-4 mr-1.5" />
                {t("members.addMember")}
              </Button>
            )}
          </>
        }
      />

      {/* Expiry alert banner */}
      {expiringCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
          <Clock className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">
            {expiringCount} member{expiringCount > 1 ? "s" : ""} expiring within 7 days
          </span>
          <button
            className="ml-auto text-xs underline underline-offset-2 opacity-70 hover:opacity-100"
            onClick={() => { setExpiryWindow("7"); setStatusFilter("active"); setPage(1); }}
          >
            View
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9 h-9"
              placeholder={t("members.searchPlaceholder")}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="md:hidden h-9 gap-1.5 shrink-0"
            onClick={() => setShowFilters(v => !v)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t("common.filters") || "Filters"}
            {(statusFilter !== "all" || planFilter !== "all" || expiryWindow !== "all" || showDeleted) && (
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            )}
          </Button>
        </div>
        <div className={`flex flex-wrap items-center gap-2 ${showFilters ? "flex" : "hidden md:flex"}`}>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-36 h-9 text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {["active","expired","frozen","inactive","archived"].map(s => (
                <SelectItem key={s} value={s}>{t(`members.status.${s}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={planFilter} onValueChange={(v) => { setPlanFilter(v); setPage(1); }}>
            <SelectTrigger className="w-36 h-9 text-sm">
              <SelectValue placeholder="Plan" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Plans</SelectItem>
              {plans.map((p: Plan) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={expiryWindow} onValueChange={(v) => { setExpiryWindow(v); setPage(1); }}>
            <SelectTrigger className="w-40 h-9 text-sm">
              <SelectValue placeholder="Expiry" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Expiry</SelectItem>
              <SelectItem value="7">Expires in 7 days</SelectItem>
              <SelectItem value="14">Expires in 14 days</SelectItem>
              <SelectItem value="30">Expires in 30 days</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-36 h-9 text-sm">
              <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">{t("members.sort.name")}</SelectItem>
              <SelectItem value="joinDate">{t("members.sort.joinDate")}</SelectItem>
              <SelectItem value="expiryDate">{t("members.sort.expiryDate")}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-9 p-0 shrink-0"
            onClick={() => setSortOrder(o => o === "asc" ? "desc" : "asc")}
            title={sortOrder === "desc" ? "Newest first" : "Oldest first"}
          >
            {sortOrder === "desc" ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
          <Button
            variant={showDeleted ? "default" : "outline"}
            size="sm"
            className="h-9 gap-1.5 shrink-0"
            onClick={() => { setShowDeleted(v => !v); setPage(1); }}
            title="Show deleted members"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="text-xs">Deleted</span>
          </Button>
        </div>
      </div>

      {/* Mobile card list — shown below md */}
      <div className="md:hidden rounded-xl border border-border overflow-hidden bg-card">
        {isLoading ? (
          <div className="p-6 text-center text-muted-foreground text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center">
            <Users className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{t("members.empty")}</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {items.map((m) => {
              const initials = m.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
              const days = daysUntil(m.expiryDate);
              const isExpired = m.status === "expired" || (days !== null && days < 0);
              const isUrgent = !isExpired && days !== null && days <= 5;
              const isWarning = !isExpired && !isUrgent && days !== null && days <= 14;
              const mobileRowClass = isExpired
                ? "flex items-center gap-2 px-3 py-3 bg-red-50/70 dark:bg-red-950/20 border-l-2 border-red-500"
                : isUrgent
                ? "flex items-center gap-2 px-3 py-3 bg-orange-50/60 dark:bg-orange-950/20 border-l-2 border-orange-400"
                : isWarning
                ? "flex items-center gap-2 px-3 py-3 bg-yellow-50/40 dark:bg-yellow-950/10 border-l-2 border-yellow-400"
                : "flex items-center gap-2 px-3 py-3";
              return (
                <div key={m.id} className={mobileRowClass}>
                  <button onClick={() => navigate(`/members/${m.id}`)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0 ${avatarColor(m.name)}`}>
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate">{m.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {m.planName ?? "—"} · {fmtDate(m.expiryDate)}
                        {isExpired && <span className="text-red-600 font-semibold"> · Expiré</span>}
                        {isUrgent && days !== null && <span className="text-orange-500 font-semibold"> · {days}j</span>}
                      </p>
                      {m.phone && <p className="text-xs text-muted-foreground/70 truncate">{m.phone}</p>}
                    </div>
                  </button>
                  <StatusBadge status={m.status} t={t} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => navigate(`/members/${m.id}`)}>
                        <Eye className="h-4 w-4 mr-2" />{t("members.actions.view")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openReprintInvoice(m)}>
                        <Printer className="h-4 w-4 mr-2" />{t("members.actions.reprintInvoice")}
                      </DropdownMenuItem>
                      {canManage && (
                        <>
                          <DropdownMenuItem onClick={() => openEdit(m)}>
                            <Edit className="h-4 w-4 mr-2" />{t("members.actions.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => { setCheckInMember(m); setCheckInForce(false); }}>
                            <LogIn className="h-4 w-4 mr-2" />{t("members.actions.checkin")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openRenew(m)}>
                            <RefreshCw className="h-4 w-4 mr-2" />{t("members.actions.renew")}
                          </DropdownMenuItem>
                          {m.status !== "frozen" ? (
                            <DropdownMenuItem onClick={() => openFreeze(m)}>
                              <Snowflake className="h-4 w-4 mr-2" />{t("members.actions.freeze")}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => setReactivateMember(m)}>
                              <Play className="h-4 w-4 mr-2" />{t("members.actions.reactivate")}
                            </DropdownMenuItem>
                          )}
                          {isAdmin && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => sendWhatsappMutation.mutate({ id: m.id })}>
                                <MessageCircle className="h-4 w-4 mr-2 text-green-600" />Envoyer WhatsApp
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600 focus:text-red-600"
                            onClick={() => setArchiveId(m.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />{t("members.actions.delete") || "Delete"}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Desktop table — hidden on mobile */}
      <div className="hidden md:block rounded-xl border border-border overflow-hidden bg-card">
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="font-medium text-xs uppercase tracking-wider text-muted-foreground py-3">{t("members.table.name")}</TableHead>
              <TableHead className="font-medium text-xs uppercase tracking-wider text-muted-foreground py-3">{t("members.table.phone")}</TableHead>
              <TableHead className="font-medium text-xs uppercase tracking-wider text-muted-foreground py-3">{t("members.table.plan")}</TableHead>
              <TableHead className="font-medium text-xs uppercase tracking-wider text-muted-foreground py-3">{t("members.table.status")}</TableHead>
              <TableHead className="font-medium text-xs uppercase tracking-wider text-muted-foreground py-3">{t("members.table.start")}</TableHead>
              <TableHead className="font-medium text-xs uppercase tracking-wider text-muted-foreground py-3">{t("members.table.expiry")}</TableHead>
              {canViewAccounting && <TableHead className="font-medium text-xs uppercase tracking-wider text-muted-foreground py-3">{t("members.table.balance")}</TableHead>}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i} className="border-border/50">
                  {Array.from({ length: canViewAccounting ? 8 : 7 }).map((_, j) => (
                    <TableCell key={j} className="py-3.5">
                      <div className="h-4 bg-muted rounded animate-pulse" style={{ width: `${60 + (j * 17) % 40}%` }} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canViewAccounting ? 8 : 7} className="text-center py-20">
                  <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-3">
                    <Users className="h-6 w-6 text-muted-foreground/40" />
                  </div>
                  <p className="font-semibold text-foreground">{t("members.empty")}</p>
                  <p className="text-sm text-muted-foreground mt-1">{t("members.emptyHint")}</p>
                </TableCell>
              </TableRow>
            ) : items.map((m) => {
              const days = daysUntil(m.expiryDate);
              const isExpired = m.status === "expired" || (days !== null && days < 0);
              const isUrgent = !isExpired && days !== null && days <= 5;
              const isWarning = !isExpired && !isUrgent && days !== null && days <= 14;
              const expiryClass = isExpired
                ? "text-red-600 font-semibold"
                : isUrgent
                ? "text-orange-500 font-semibold"
                : isWarning
                ? "text-yellow-600 font-medium"
                : "text-foreground";
              const tableRowClass = isExpired
                ? "border-border/50 bg-red-50/60 dark:bg-red-950/20 hover:bg-red-50/80 dark:hover:bg-red-950/30 transition-colors group border-l-2 border-l-red-500"
                : isUrgent
                ? "border-border/50 bg-orange-50/50 dark:bg-orange-950/20 hover:bg-orange-50/80 dark:hover:bg-orange-950/30 transition-colors group border-l-2 border-l-orange-400"
                : isWarning
                ? "border-border/50 bg-yellow-50/30 dark:bg-yellow-950/10 hover:bg-yellow-50/60 dark:hover:bg-yellow-950/20 transition-colors group"
                : "border-border/50 hover:bg-muted/30 transition-colors group";
              const initials = m.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
              return (
                <TableRow key={m.id} className={tableRowClass}>
                  <TableCell className="py-3">
                    <button
                      onClick={() => navigate(`/members/${m.id}`)}
                      className="flex items-center gap-3 text-left group/btn"
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0 ${avatarColor(m.name)}`}>
                        {initials}
                      </div>
                      <div>
                        <p className="font-medium text-foreground group-hover/btn:text-primary transition-colors leading-tight">
                          {m.name}
                        </p>
                        {m.email && <p className="text-xs text-muted-foreground mt-0.5">{m.email}</p>}
                      </div>
                    </button>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground py-3">{m.phone ?? "—"}</TableCell>
                  <TableCell className="py-3">
                    {m.planName ? (
                      <span className="text-sm font-medium text-foreground">{m.planName}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-3"><StatusBadge status={m.status} t={t} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground py-3">{fmtDate(m.startDate)}</TableCell>
                  <TableCell className={`text-sm py-3 ${expiryClass}`}>{fmtDate(m.expiryDate)}</TableCell>
                  {canViewAccounting && (() => {
                    // Compute balance live from plan's authoritative price so stale DB values
                    // never show a wrong number (e.g. USD plan price vs CDF amountPaid).
                    const plan = m.planId ? plans.find((p: Plan) => String(p.id) === String(m.planId)) : null;
                    const convertedPlanPrice = plan
                      ? convertPrice(plan.price, (plan.currency as string) ?? "USD", (m.currency as string) ?? "USD")
                      : (m.planPrice ?? 0);
                    const liveBalance = convertedPlanPrice - (m.discount ?? 0) - (m.amountPaid ?? 0);
                    return (
                      <TableCell className={`text-sm font-semibold py-3 ${liveBalance > 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {liveBalance !== 0 ? fmtCurrency(liveBalance, m.currency) : "—"}
                      </TableCell>
                    );
                  })()}
                  <TableCell className="py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/members/${m.id}`)}>
                          <Eye className="h-4 w-4 mr-2" />{t("members.actions.view")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openReprintInvoice(m)}>
                          <Printer className="h-4 w-4 mr-2" />{t("members.actions.reprintInvoice")}
                        </DropdownMenuItem>
                        {canManage && (
                          <>
                            <DropdownMenuItem onClick={() => openEdit(m)}>
                              <Edit className="h-4 w-4 mr-2" />{t("members.actions.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => { setCheckInMember(m); setCheckInForce(false); }}>
                              <LogIn className="h-4 w-4 mr-2" />{t("members.actions.checkin")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openRenew(m)}>
                              <RefreshCw className="h-4 w-4 mr-2" />{t("members.actions.renew")}
                            </DropdownMenuItem>
                            {m.status !== "frozen" ? (
                              <DropdownMenuItem onClick={() => openFreeze(m)}>
                                <Snowflake className="h-4 w-4 mr-2" />{t("members.actions.freeze")}
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => setReactivateMember(m)}>
                                <Play className="h-4 w-4 mr-2" />{t("members.actions.reactivate")}
                              </DropdownMenuItem>
                            )}
                            {m.status === "inactive" && (
                              <DropdownMenuItem onClick={() => setReactivateMember(m)}>
                                <Play className="h-4 w-4 mr-2" />{t("members.actions.reactivate")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            {m.status !== "inactive" && (
                              <DropdownMenuItem onClick={() => statusMutation.mutate({ id: m.id, data: { status: "inactive" } })}>
                                <UserMinus className="h-4 w-4 mr-2" />{t("members.actions.markInactive")}
                              </DropdownMenuItem>
                            )}
                            {isAdmin && (
                              <DropdownMenuItem onClick={() => sendWhatsappMutation.mutate({ id: m.id })}>
                                <MessageCircle className="h-4 w-4 mr-2 text-green-600" />Envoyer WhatsApp
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              onClick={() => setArchiveId(m.id)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />{t("members.actions.delete") || "Delete"}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} · {total} members
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" />{t("common.previous")}
            </Button>
            <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
              {t("common.next")}<ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Add/Edit Modal ─────────────────────────────────────────────────── */}
      <Dialog open={addOpen || !!editMember} onOpenChange={(o) => { if (!o) { setAddOpen(false); setEditMember(null); } }}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editMember ? t("members.editMember") : t("members.addMember")}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-6"
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
                e.preventDefault();
                const focusable = Array.from(
                  e.currentTarget.querySelectorAll<HTMLElement>(
                    'input:not([disabled]), textarea:not([disabled]), button[type="submit"]'
                  )
                );
                const idx = focusable.indexOf(e.target as HTMLElement);
                if (idx > -1 && idx < focusable.length - 1) focusable[idx + 1].focus();
              }
            }}
          >
            {/* Personal Info */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 pb-2 border-b dark:border-slate-700">{t("members.form.personalInfo")}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="col-span-2 border-l-4 border-primary pl-3 py-0.5 rounded-r-md">
                  <Label className="text-primary font-semibold">{t("members.form.name")} *</Label>
                  <Input {...form.register("name")} className="mt-1" />
                  {form.formState.errors.name && <p className="text-xs text-red-500 mt-1">{form.formState.errors.name.message}</p>}
                </div>
                <div>
                  <Label>{t("members.form.phone")}</Label>
                  <div className="relative mt-1">
                    <Input {...form.register("phone")} className="mt-0 pr-8" />
                    {editMember?.waChatId ? (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2" title="WhatsApp verified">
                        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-green-500" xmlns="http://www.w3.org/2000/svg">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                          <path d="M12 0C5.373 0 0 5.373 0 12c0 2.136.562 4.14 1.541 5.875L.057 23.476a.5.5 0 0 0 .612.612l5.476-1.484A11.944 11.944 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818c-1.961 0-3.79-.54-5.354-1.478l-.383-.228-3.972 1.077 1.077-3.972-.228-.383A9.821 9.821 0 0 1 2.182 12C2.182 6.578 6.578 2.182 12 2.182S21.818 6.578 21.818 12 17.422 21.818 12 21.818z"/>
                        </svg>
                      </span>
                    ) : editMember && editMember.phone && !editMember.waChatId ? (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2" title="WhatsApp not found for this number">
                        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-muted-foreground/30" xmlns="http://www.w3.org/2000/svg">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                          <path d="M12 0C5.373 0 0 5.373 0 12c0 2.136.562 4.14 1.541 5.875L.057 23.476a.5.5 0 0 0 .612.612l5.476-1.484A11.944 11.944 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818c-1.961 0-3.79-.54-5.354-1.478l-.383-.228-3.972 1.077 1.077-3.972-.228-.383A9.821 9.821 0 0 1 2.182 12C2.182 6.578 6.578 2.182 12 2.182S21.818 6.578 21.818 12 17.422 21.818 12 21.818z"/>
                        </svg>
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            {/* Membership */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 pb-2 border-b dark:border-slate-700">{t("members.form.membershipInfo")}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="border-l-4 border-primary pl-3 py-0.5 rounded-r-md">
                  <Label className="text-primary font-semibold">{t("members.form.plan")}</Label>
                  <Select value={form.watch("planId") || "none"} onValueChange={(v) => { const val = v === "none" ? "" : v; form.setValue("planId", val); watchedPlanId(val); }}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder={t("members.form.selectPlan")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("members.form.noPlan")}</SelectItem>
                      {plans.map((p: Plan) => <SelectItem key={p.id} value={String(p.id)}>{p.name} — {p.currency} {p.price}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {isAdmin && (
                  <div>
                    <Label>{t("members.form.status")}</Label>
                    <Select value={form.watch("status")} onValueChange={(v) => form.setValue("status", v)}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["active","expired","frozen","inactive","archived"].map(s => (
                          <SelectItem key={s} value={s}>{t(`members.status.${s}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="border-l-4 border-primary pl-3 py-0.5 rounded-r-md">
                  <Label className="text-primary font-semibold">{t("members.form.startDate")}</Label>
                  <Input type="date" {...form.register("startDate")} className="mt-1"
                    onChange={(e) => {
                      form.setValue("startDate", e.target.value);
                      const pid = form.getValues("planId");
                      if (pid) {
                        const plan = plans.find((p: Plan) => String(p.id) === pid);
                        if (plan && e.target.value) form.setValue("expiryDate", addDays(e.target.value, plan.durationDays));
                      }
                    }}
                  />
                </div>
                {isAdmin && (
                  <div className="border-l-4 border-primary pl-3 py-0.5 rounded-r-md">
                    <Label className="text-primary font-semibold">{t("members.form.expiryDate")}</Label>
                    <Input type="date" {...form.register("expiryDate")} className="mt-1" />
                  </div>
                )}
              </div>
            </div>

            {/* Payment */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 pb-2 border-b dark:border-slate-700">{t("members.form.paymentInfo")}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {planPrice > 0 && (
                  <div>
                    <Label>{t("members.form.planPrice")}</Label>
                    <Input value={planPrice} readOnly className="mt-1 bg-slate-50 dark:bg-slate-800" />
                  </div>
                )}
                <div className="border-l-4 border-primary pl-3 py-0.5 rounded-r-md">
                  <Label className="text-primary font-semibold">{t("members.form.amountPaid")}</Label>
                  <Input type="number" step="0.01" min="0" {...form.register("amountPaid")} className="mt-1" />
                </div>
                {isAdmin && (
                  <div>
                    <Label>{t("members.form.discount")}</Label>
                    <Input type="number" step="0.01" min="0" {...form.register("discount")} className="mt-1" />
                  </div>
                )}
                <div>
                  <Label>{t("members.form.currency")}</Label>
                  <Select
                    value={form.watch("currency")}
                    onValueChange={(v) => {
                      form.setValue("currency", v as "USD" | "CDF");
                      if (planBasePrice > 0) setPlanPrice(convertPrice(planBasePrice, planBaseCurrency, v));
                    }}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="CDF">CDF</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 border-l-4 border-primary pl-3 py-0.5 rounded-r-md">
                  <Label className="text-primary font-semibold">{t("members.form.cashAccount")}</Label>
                  <div className="mt-1 h-9 flex items-center px-3 rounded-md border border-input bg-muted/40 text-sm text-muted-foreground cursor-not-allowed select-none">
                    {cashAccount?.name ?? "Cash"}
                  </div>
                </div>
                {planPrice > 0 && (
                  <div>
                    <Label>{t("members.form.balance")}</Label>
                    <div className={`mt-1 h-9 flex items-center px-3 rounded-md border text-sm font-medium ${balance > 0 ? "border-red-300 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800" : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800"}`}>
                      {balance.toFixed(2)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Coach & Commission — admin only */}
            {isAdmin && coaches.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 pb-2 border-b dark:border-slate-700">Coach & Commission</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Assigned Coach</Label>
                    <Select value={form.watch("coachId") || "none"} onValueChange={(v) => form.setValue("coachId", v === "none" ? "" : v)}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="No coach assigned" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No coach</SelectItem>
                        {coaches.map((e) => (
                          <SelectItem key={e.id} value={String(e.id)}>{e.name}{e.jobTitle ? ` — ${e.jobTitle}` : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Commission per Payment</Label>
                    <Input type="number" step="0.01" min="0" {...form.register("commissionAmount")} className="mt-1" placeholder="0" />
                    <p className="text-xs text-muted-foreground mt-1">Fixed amount credited to coach on each payment</p>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setAddOpen(false); setEditMember(null); }}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {(createMutation.isPending || updateMutation.isPending) ? t("common.loading") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Renew Modal ────────────────────────────────────────────────────── */}
      <Dialog open={!!renewMember} onOpenChange={(o) => { if (!o) setRenewMember(null); }}>
        <DialogContent className="w-[95vw] max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("members.renew.title")} — {renewMember?.name}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={renewForm.handleSubmit(onRenewSubmit)}
            className="space-y-4"
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
                e.preventDefault();
                const focusable = Array.from(
                  e.currentTarget.querySelectorAll<HTMLElement>(
                    'input:not([disabled]), textarea:not([disabled]), button[type="submit"]'
                  )
                );
                const idx = focusable.indexOf(e.target as HTMLElement);
                if (idx > -1 && idx < focusable.length - 1) focusable[idx + 1].focus();
              }
            }}
          >
            <div>
              <Label>{t("members.renew.plan")} *</Label>
              <Select value={renewForm.watch("planId") ?? ""} onValueChange={(v) => { renewForm.setValue("planId", v); watchRenewPlan(v); }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder={t("members.form.selectPlan")} /></SelectTrigger>
                <SelectContent>
                  {plans.map((p: Plan) => <SelectItem key={p.id} value={String(p.id)}>{p.name} — {p.currency} {p.price}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>{t("members.renew.startDate")}</Label>
                <Input type="date" {...renewForm.register("startDate")} className="mt-1"
                  onChange={(e) => {
                    renewForm.setValue("startDate", e.target.value);
                    const pid = renewForm.getValues("planId");
                    if (pid) {
                      const plan = plans.find((p: Plan) => String(p.id) === pid);
                      if (plan && e.target.value) renewForm.setValue("expiryDate", addDays(e.target.value, plan.durationDays));
                    }
                  }}
                />
              </div>
              <div>
                <Label>{t("members.renew.expiryDate")}</Label>
                <Input type="date" {...renewForm.register("expiryDate")} className="mt-1" />
              </div>
              <div>
                <Label>{t("members.renew.amountPaid")}</Label>
                <Input type="number" step="0.01" min="0" {...renewForm.register("amountPaid")} className="mt-1" />
              </div>
              <div>
                <Label>{t("members.renew.discount")}</Label>
                <Input type="number" step="0.01" min="0" {...renewForm.register("discount")} className="mt-1" />
              </div>
              <div>
                <Label>{t("members.renew.currency")}</Label>
                <Select
                  value={renewForm.watch("currency")}
                  onValueChange={(v) => {
                    renewForm.setValue("currency", v as "USD" | "CDF");
                    if (renewPlanBasePrice > 0) setRenewPlanPrice(convertPrice(renewPlanBasePrice, renewPlanBaseCurrency, v));
                  }}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="CDF">CDF</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(renewAmountPaid > 0) && (
                <div className="col-span-2">
                  <Label>{t("members.form.cashAccount")}</Label>
                  <div className="mt-1 h-9 flex items-center px-3 rounded-md border border-input bg-muted/40 text-sm text-muted-foreground cursor-not-allowed select-none">
                    {cashAccount?.name ?? "Cash"}
                  </div>
                </div>
              )}
              {renewPlanPrice > 0 && (
                <div>
                  <Label>{t("members.renew.balance")}</Label>
                  <div className={`mt-1 h-9 flex items-center px-3 rounded-md border text-sm font-medium ${renewBalance > 0 ? "border-red-300 bg-red-50 text-red-700" : "border-emerald-300 bg-emerald-50 text-emerald-700"}`}>
                    {renewBalance.toFixed(2)}
                  </div>
                </div>
              )}
            </div>
            <div>
              <Label>{t("members.renew.notes")}</Label>
              <Textarea {...renewForm.register("notes")} className="mt-1" rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenewMember(null)}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={renewMutation.isPending}>
                {renewMutation.isPending ? t("common.loading") : t("members.actions.renew")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Freeze Modal ───────────────────────────────────────────────────── */}
      <Dialog open={!!freezeMember} onOpenChange={(o) => { if (!o) setFreezeMember(null); }}>
        <DialogContent className="w-[95vw] max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("members.freeze.title")} — {freezeMember?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={freezeForm.handleSubmit(onFreezeSubmit)} className="space-y-4">
            <div>
              <Label>{t("members.freeze.from")}</Label>
              <Input type="date" {...freezeForm.register("frozenAt")} className="mt-1" />
            </div>
            <div>
              <Label>{t("members.freeze.until")}</Label>
              <Input type="date" {...freezeForm.register("frozenUntil")} className="mt-1" />
            </div>
            {frozenDays > 0 && (
              <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                {frozenDays} {t("members.freeze.days_count")}
              </p>
            )}
            <div>
              <Label>{t("members.freeze.reason")}</Label>
              <Textarea {...freezeForm.register("reason")} className="mt-1" rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFreezeMember(null)}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={freezeMutation.isPending}>
                {freezeMutation.isPending ? t("common.loading") : t("members.actions.freeze")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Check-in Dialog ────────────────────────────────────────────────── */}
      <Dialog open={!!checkInMember} onOpenChange={(o) => { if (!o) { setCheckInMember(null); setCheckInForce(false); } }}>
        <DialogContent className="w-[95vw] max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("members.checkin.title")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            {checkInForce ? (
              <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{checkInMember?.name}</p>
                  <p className="text-sm text-amber-700 dark:text-amber-300">{t("members.checkin.alreadyDone")}</p>
                </div>
              </div>
            ) : (
              <p className="text-slate-700 dark:text-slate-300">
                {t("members.checkin.confirm")} <strong>{checkInMember?.name}</strong>?
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCheckInMember(null); setCheckInForce(false); }}>{t("common.cancel")}</Button>
            <Button
              onClick={() => {
                if (checkInMember) {
                  checkInMutation.mutate({ id: checkInMember.id, data: { force: checkInForce } });
                }
              }}
              disabled={checkInMutation.isPending}
            >
              {checkInForce ? t("members.checkin.override") : t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reactivate Dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!reactivateMember} onOpenChange={(o) => { if (!o) setReactivateMember(null); }}>
        <DialogContent className="w-[95vw] max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("members.reactivate.title")}</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <p className="text-slate-700 dark:text-slate-300">
              {t("members.reactivate.confirm")} <strong>{reactivateMember?.name}</strong>?
            </p>
            {(reactivateMember?.frozenDays ?? 0) > 0 && (
              <p className="text-sm text-blue-600 dark:text-blue-400">
                +{reactivateMember?.frozenDays} {t("members.reactivate.frozenDays")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReactivateMember(null)}>{t("common.cancel")}</Button>
            <Button
              onClick={() => { if (reactivateMember) reactivateMutation.mutate({ id: reactivateMember.id }); }}
              disabled={reactivateMutation.isPending}
            >
              {reactivateMutation.isPending ? t("common.loading") : t("members.actions.reactivate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Invoice Print Dialog ────────────────────────────────────────────── */}
      <Dialog open={!!invoicePrintData} onOpenChange={(o) => { if (!o) setInvoicePrintData(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-4 w-4" />
              {invoicePrintData?.isRenewal ? t("members.invoice.title_renewal") : t("members.invoice.title_new")}
            </DialogTitle>
          </DialogHeader>
          {invoicePrintData && (
            <div className="space-y-3 text-sm">
              <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("members.invoice.member")}</span>
                  <span className="font-medium">{invoicePrintData.memberName}</span>
                </div>
                {invoicePrintData.memberPhone && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("members.invoice.phone")}</span>
                    <span>{invoicePrintData.memberPhone}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("members.invoice.plan")}</span>
                  <span className="font-medium">{invoicePrintData.planName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("members.invoice.start")}</span>
                  <span>{fmtDate(invoicePrintData.startDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("members.invoice.expiry")}</span>
                  <span>{fmtDate(invoicePrintData.expiryDate)}</span>
                </div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("members.invoice.price")}</span>
                  <span>{invoicePrintData.currency === "CDF" ? `FC ${invoicePrintData.planPrice}` : `$${invoicePrintData.planPrice}`}</span>
                </div>
                {invoicePrintData.discount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("members.invoice.discount")}</span>
                    <span className="text-red-500">-{invoicePrintData.currency === "CDF" ? `FC ${invoicePrintData.discount}` : `$${invoicePrintData.discount}`}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold border-t pt-1.5 mt-1">
                  <span>{t("members.invoice.paid")}</span>
                  <span>{invoicePrintData.currency === "CDF" ? `FC ${invoicePrintData.amountPaid}` : `$${invoicePrintData.amountPaid}`}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("members.invoice.balance")}</span>
                  <span className={invoicePrintData.balance > 0 ? "text-red-600 font-medium" : "text-green-600 font-medium"}>
                    {invoicePrintData.currency === "CDF" ? `FC ${invoicePrintData.balance}` : `$${invoicePrintData.balance}`}
                  </span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setInvoicePrintData(null)}>{t("common.close")}</Button>
            <Button
              onClick={() => {
                if (invoicePrintData) printMemberInvoice(invoicePrintData, (settingsData ?? {}) as Record<string, unknown>);
              }}
              className="gap-2"
            >
              <Printer className="h-4 w-4" />
              {t("members.invoice.print")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Archive Confirmation ─────────────────────────────────────────────── */}
      <AlertDialog open={!!archiveId} onOpenChange={(o) => { if (!o) setArchiveId(null); }}>
        <AlertDialogContent className="w-[95vw] max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("members.actions.delete") || "Delete Member"}?</AlertDialogTitle>
            <AlertDialogDescription>{t("members.delete.confirm") || "This member will be removed from active lists. This action cannot be undone."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (archiveId) deleteMutation.mutate({ id: archiveId }); setArchiveId(null); }}
            >
              {t("members.actions.delete") || "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
