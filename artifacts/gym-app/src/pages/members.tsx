import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useI18n } from "@/lib/i18n";
import { useGetMe } from "@/hooks/use-me";
import { useQuery } from "@tanstack/react-query";
import { fmtDate } from "@/lib/date";
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
} from "@workspace/api-client-react";
import type { Member, Plan } from "@workspace/api-client-react";
import { useListStaffEmployees, getListStaffEmployeesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Users,
  SlidersHorizontal,
  Printer,
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
  const fmtD = (d: string) => { try { return new Date(d).toLocaleDateString("fr-FR"); } catch { return d; } };

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
  <div class="row"><span class="label">Date</span><span class="val">${new Date().toLocaleDateString("fr-FR")}</span></div>
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

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const map: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    expired: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    frozen: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    inactive: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    archived: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? map.inactive}`}>
      {t(`members.status.${status}`) ?? status}
    </span>
  );
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
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const me = useGetMe();
  const canManage = me?.role === "admin" || me?.role === "manager" || me?.permissions?.manageMembers;
  const canViewAccounting = me?.role === "admin" || me?.permissions?.viewAccounting;

  // ── Filters
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [expiryWindow, setExpiryWindow] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder] = useState("asc");
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // ── Invoice
  const [invoicePrintData, setInvoicePrintData] = useState<MemberInvoiceData | null>(null);
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
  const cashAccounts = chartAccounts.filter((a) => a.type === "asset" && a.isActive);

  // ── Queries
  const { data: membersData, isLoading } = useListMembers({
    page,
    limit: LIMIT,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(statusFilter !== "all" && { status: statusFilter }),
    ...(planFilter !== "all" && { planId: parseInt(planFilter) }),
    ...(expiryWindow !== "all" && { expiryWindow: parseInt(expiryWindow) }),
    sortBy,
    sortOrder,
  });
  const { data: plans = [] } = useListPlans();

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
      pendingInvoiceRef.current = null;
    }
  }}});
  const updateMutation = useUpdateMember({ mutation: { onSuccess: () => { invalidateMembers(); setEditMember(null); toast({ title: t("common.success") }); } } });
  const deleteMutation = useDeleteMember({ mutation: { onSuccess: () => { invalidateMembers(); toast({ title: t("common.success") }); } } });
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
    if (pendingInvoiceRef.current) { setInvoicePrintData(pendingInvoiceRef.current); pendingInvoiceRef.current = null; }
  }}});
  const freezeMutation = useFreezeMember({ mutation: { onSuccess: () => { invalidateMembers(); setFreezeMember(null); toast({ title: t("common.success") }); } } });
  const reactivateMutation = useReactivateMember({ mutation: { onSuccess: () => { invalidateMembers(); setReactivateMember(null); toast({ title: t("common.success") }); } } });
  const statusMutation = useSetMemberStatus({ mutation: { onSuccess: () => { invalidateMembers(); toast({ title: t("common.success") }); } } });

  // ── Add/Edit form
  const form = useForm<MemberFormValues>({ resolver: zodResolver(memberSchema) });
  const [planPrice, setPlanPrice] = useState(0);

  function openAdd() {
    const today = new Date().toISOString().split("T")[0];
    form.reset({ status: "active", currency: "USD", amountPaid: 0, discount: 0, startDate: today, cashAccountId: "" });
    setPlanPrice(0);
    setAddOpen(true);
  }
  function openEdit(m: Member) {
    form.reset({
      name: m.name, phone: m.phone ?? "",
      planId: m.planId ? String(m.planId) : "",
      startDate: toDateInput(m.startDate), expiryDate: toDateInput(m.expiryDate),
      status: m.status, amountPaid: m.amountPaid ?? 0, discount: m.discount ?? 0,
      currency: (m.currency as "USD" | "CDF") ?? "USD",
      cashAccountId: "",
      notes: m.notes ?? "", fingerprintId: m.fingerprintId ?? "", qrCodeId: m.qrCodeId ?? "",
      coachId: m.coachId ? String(m.coachId) : "",
      commissionAmount: (m as any).commissionAmount ?? 0,
    });
    setPlanPrice(m.planPrice ?? 0);
    setEditMember(m);
  }

  function watchedPlanId(value: string) {
    const plan = plans.find((p: Plan) => String(p.id) === value);
    if (plan) {
      setPlanPrice(plan.price);
      const start = form.getValues("startDate");
      if (start) form.setValue("expiryDate", addDays(start, plan.durationDays));
    }
  }

  const amountPaid = form.watch("amountPaid") ?? 0;
  const discount = form.watch("discount") ?? 0;
  const balance = planPrice - discount - amountPaid;

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
      updateMutation.mutate({ id: editMember.id, data: payload });
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
  const renewAmountPaid = renewForm.watch("amountPaid") ?? 0;
  const renewDiscount = renewForm.watch("discount") ?? 0;
  const renewBalance = renewPlanPrice - renewDiscount - renewAmountPaid;

  function openRenew(m: Member) {
    const today = new Date().toISOString().split("T")[0];
    renewForm.reset({ startDate: today, currency: (m.currency as "USD" | "CDF") ?? "USD", amountPaid: 0, discount: 0 });
    setRenewPlanPrice(0);
    setRenewMember(m);
  }

  function watchRenewPlan(value: string) {
    const plan = plans.find((p: Plan) => String(p.id) === value);
    if (plan) {
      setRenewPlanPrice(plan.price);
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
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("members.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total} {t("members.total")}</p>
        </div>
        {canManage && (
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4 mr-1.5" />
            {t("members.addMember")}
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9 h-9"
            placeholder={t("members.searchPlaceholder")}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
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
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
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
              const expiryClass =
                m.status === "expired" || (days !== null && days < 0)
                  ? "text-red-600 font-medium"
                  : days !== null && days <= 7
                  ? "text-orange-500 font-medium"
                  : days !== null && days <= 14
                  ? "text-yellow-600 font-medium"
                  : "text-foreground";
              const initials = m.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
              return (
                <TableRow key={m.id} className="border-border/50 hover:bg-muted/30 transition-colors group">
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
                  {canViewAccounting && (
                    <TableCell className={`text-sm font-semibold py-3 ${(m.balance ?? 0) > 0 ? "text-red-600" : "text-emerald-600"}`}>
                      {(m.balance ?? 0) !== 0 ? fmtCurrency(m.balance, m.currency) : "—"}
                    </TableCell>
                  )}
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
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              onClick={() => deleteMutation.mutate({ id: m.id })}
                            >
                              <Archive className="h-4 w-4 mr-2" />{t("members.actions.archive")}
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editMember ? t("members.editMember") : t("members.addMember")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Personal Info */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 pb-2 border-b dark:border-slate-700">{t("members.form.personalInfo")}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>{t("members.form.name")} *</Label>
                  <Input {...form.register("name")} className="mt-1" />
                  {form.formState.errors.name && <p className="text-xs text-red-500 mt-1">{form.formState.errors.name.message}</p>}
                </div>
                <div>
                  <Label>{t("members.form.phone")}</Label>
                  <Input {...form.register("phone")} className="mt-1" />
                </div>
              </div>
            </div>

            {/* Membership */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 pb-2 border-b dark:border-slate-700">{t("members.form.membershipInfo")}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t("members.form.plan")}</Label>
                  <Select value={form.watch("planId") || "none"} onValueChange={(v) => { const val = v === "none" ? "" : v; form.setValue("planId", val); watchedPlanId(val); }}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder={t("members.form.selectPlan")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("members.form.noPlan")}</SelectItem>
                      {plans.map((p: Plan) => <SelectItem key={p.id} value={String(p.id)}>{p.name} — {p.currency} {p.price}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
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
                <div>
                  <Label>{t("members.form.startDate")}</Label>
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
                <div>
                  <Label>{t("members.form.expiryDate")}</Label>
                  <Input type="date" {...form.register("expiryDate")} className="mt-1" />
                </div>
              </div>
            </div>

            {/* Payment */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 pb-2 border-b dark:border-slate-700">{t("members.form.paymentInfo")}</h3>
              <div className="grid grid-cols-2 gap-4">
                {planPrice > 0 && (
                  <div>
                    <Label>{t("members.form.planPrice")}</Label>
                    <Input value={planPrice} readOnly className="mt-1 bg-slate-50 dark:bg-slate-800" />
                  </div>
                )}
                <div>
                  <Label>{t("members.form.amountPaid")}</Label>
                  <Input type="number" step="0.01" min="0" {...form.register("amountPaid")} className="mt-1" />
                </div>
                <div>
                  <Label>{t("members.form.discount")}</Label>
                  <Input type="number" step="0.01" min="0" {...form.register("discount")} className="mt-1" />
                </div>
                <div>
                  <Label>{t("members.form.currency")}</Label>
                  <Select value={form.watch("currency")} onValueChange={(v) => form.setValue("currency", v as "USD" | "CDF")}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="CDF">CDF</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(amountPaid > 0) && (
                  <div className="col-span-2">
                    <Label>{t("members.form.cashAccount")}</Label>
                    <Select value={form.watch("cashAccountId") ?? ""} onValueChange={(v) => form.setValue("cashAccountId", v)}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder={t("members.form.selectCashAccount")} /></SelectTrigger>
                      <SelectContent>
                        {cashAccounts.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">{t("members.form.cashAccountHint")}</p>
                  </div>
                )}
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

            {/* Coach & Commission */}
            {coaches.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 pb-2 border-b dark:border-slate-700">Coach & Commission</h3>
                <div className="grid grid-cols-2 gap-4">
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

            {/* Notes */}
            <div>
              <Label>{t("members.form.notes")}</Label>
              <Textarea {...form.register("notes")} className="mt-1" rows={2} />
            </div>

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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("members.renew.title")} — {renewMember?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={renewForm.handleSubmit(onRenewSubmit)} className="space-y-4">
            <div>
              <Label>{t("members.renew.plan")} *</Label>
              <Select value={renewForm.watch("planId") ?? ""} onValueChange={(v) => { renewForm.setValue("planId", v); watchRenewPlan(v); }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder={t("members.form.selectPlan")} /></SelectTrigger>
                <SelectContent>
                  {plans.map((p: Plan) => <SelectItem key={p.id} value={String(p.id)}>{p.name} — {p.currency} {p.price}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
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
                <Select value={renewForm.watch("currency")} onValueChange={(v) => renewForm.setValue("currency", v as "USD" | "CDF")}>
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
                  <Select value={renewForm.watch("cashAccountId") ?? ""} onValueChange={(v) => renewForm.setValue("cashAccountId", v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder={t("members.form.selectCashAccount")} /></SelectTrigger>
                    <SelectContent>
                      {cashAccounts.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
        <DialogContent className="max-w-sm">
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
        <DialogContent className="max-w-sm">
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
        <DialogContent className="max-w-sm">
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
    </div>
  );
}
