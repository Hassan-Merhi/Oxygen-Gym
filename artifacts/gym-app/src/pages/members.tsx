import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useI18n } from "@/lib/i18n";
import { fmt as format } from "@/lib/i18n-format";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Users,
  SlidersHorizontal,
  Printer,
  ArrowUp,
  ArrowDown,
  Clock,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MemberList } from "@/components/members/member-list";
import { MemberInvoiceDialog } from "@/components/members/member-invoice-dialog";
import { WhatsappStatusIcon } from "@/components/members/whatsapp-status-icon";
import { addDays, toDateInput, type MemberInvoiceData } from "@/components/members/member-utils";

/** Moves focus to the next field on Enter instead of submitting half-filled forms. */
function focusNextOnEnter(e: React.KeyboardEvent<HTMLFormElement>) {
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
  const { fmtDate, locale } = useFmtDate();
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
    onSuccess: () => toast({ title: t("members.whatsapp.sent") }),
    onError: () => toast({ title: t("members.whatsapp.failed"), variant: "destructive" }),
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

  // Compute balance live from the plan's authoritative price so stale DB values
  // never show a wrong number (e.g. USD plan price vs CDF amountPaid).
  function balanceOf(m: Member) {
    const plan = m.planId ? plans.find((p: Plan) => String(p.id) === String(m.planId)) : null;
    const convertedPlanPrice = plan
      ? convertPrice(plan.price, (plan.currency as string) ?? "USD", (m.currency as string) ?? "USD")
      : (m.planPrice ?? 0);
    return convertedPlanPrice - (m.discount ?? 0) - (m.amountPaid ?? 0);
  }

  const filtersActive = statusFilter !== "all" || planFilter !== "all" || expiryWindow !== "all" || showDeleted;
  const sectionTitle = "mb-3 border-b border-border pb-2 text-sm font-semibold text-foreground/80";
  const keyField = "border-s-4 border-primary ps-3 py-0.5 rounded-e-md";
  const balanceBox = (value: number) => cn(
    "mt-1 flex min-h-11 items-center rounded-md border px-3 text-sm font-medium tabular-nums md:min-h-9",
    value > 0
      ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
      : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400",
  );
  const lockedBox = "mt-1 flex min-h-11 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground cursor-not-allowed select-none md:min-h-9";

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Users}
        iconClass="bg-blue-500/10 text-blue-700 dark:text-blue-400"
        title={t("members.title")}
        subtitle={`${total} ${t("members.total")}`}
        actions={
          <>
            {lastInvoiceData && (
              <Button variant="outline" size="sm" onClick={() => setInvoicePrintData(lastInvoiceData)} className="gap-1.5">
                <Printer className="h-4 w-4" aria-hidden="true" />
                {t("members.invoice.reprint")}
              </Button>
            )}
            {canManage && (
              <Button onClick={openAdd}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("members.addMember")}
              </Button>
            )}
          </>
        }
      />

      {/* Expiry alert banner */}
      {expiringCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300" role="status">
          <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-sm font-medium">
            {format(t(expiringCount === 1 ? "members.expiringOne" : "members.expiringMany"), { count: expiringCount })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="text-amber-900 underline underline-offset-2 hover:text-amber-950 dark:text-amber-200"
            onClick={() => { setExpiryWindow("7"); setStatusFilter("active"); setPage(1); }}
          >
            {t("members.expiringView")}
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Label htmlFor="members-search" className="sr-only">{t("common.search")}</Label>
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="members-search"
              type="search"
              className="ps-9"
              placeholder={t("members.searchPlaceholder")}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <Button
            variant="outline"
            className="shrink-0 gap-1.5 lg:hidden"
            onClick={() => setShowFilters(v => !v)}
            aria-expanded={showFilters}
            aria-controls="members-filters"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            {t("common.filters")}
            {filtersActive && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label={t("members.filtersActive")} role="img" />}
          </Button>
        </div>
        <div
          id="members-filters"
          className={cn(
            "grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center",
            showFilters ? "" : "max-lg:hidden",
          )}
        >
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="text-sm sm:w-40" aria-label={t("members.table.status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("members.filter.status")}</SelectItem>
              {["active","expired","frozen","inactive","archived"].map(s => (
                <SelectItem key={s} value={s}>{t(`members.status.${s}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={planFilter} onValueChange={(v) => { setPlanFilter(v); setPage(1); }}>
            <SelectTrigger className="text-sm sm:w-40" aria-label={t("members.table.plan")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("members.filter.plan")}</SelectItem>
              {plans.map((p: Plan) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={expiryWindow} onValueChange={(v) => { setExpiryWindow(v); setPage(1); }}>
            <SelectTrigger className="text-sm sm:w-48" aria-label={t("members.filter.expiry")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("members.filter.expiryAll")}</SelectItem>
              <SelectItem value="7">{t("members.filter.expiry7")}</SelectItem>
              <SelectItem value="14">{t("members.filter.expiry14")}</SelectItem>
              <SelectItem value="30">{t("members.filter.expiry30")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="min-w-0 flex-1 text-sm sm:w-40 sm:flex-none" aria-label={t("members.filter.sortBy")}>
                <SlidersHorizontal className="me-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
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
              size="icon"
              className="shrink-0"
              onClick={() => setSortOrder(o => o === "asc" ? "desc" : "asc")}
              title={sortOrder === "desc" ? t("members.sort.desc") : t("members.sort.asc")}
              aria-label={sortOrder === "desc" ? t("members.sort.desc") : t("members.sort.asc")}
            >
              {sortOrder === "desc" ? <ArrowDown className="h-4 w-4" aria-hidden="true" /> : <ArrowUp className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>
          <Button
            variant={showDeleted ? "default" : "outline"}
            className="shrink-0 gap-1.5"
            onClick={() => { setShowDeleted(v => !v); setPage(1); }}
            aria-pressed={showDeleted}
            title={t("members.showDeletedHint")}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-sm">{t("members.showDeleted")}</span>
          </Button>
        </div>
      </div>

      <MemberList
        t={t}
        fmtDate={fmtDate}
        items={items}
        isLoading={isLoading}
        canManage={Boolean(canManage)}
        isAdmin={isAdmin}
        canViewAccounting={Boolean(canViewAccounting)}
        balanceOf={balanceOf}
        actions={{
          onView: (m) => navigate(`/members/${m.id}`),
          onReprint: openReprintInvoice,
          onEdit: openEdit,
          onCheckIn: (m) => { setCheckInMember(m); setCheckInForce(false); },
          onRenew: openRenew,
          onFreeze: openFreeze,
          onReactivate: setReactivateMember,
          onMarkInactive: (m) => statusMutation.mutate({ id: m.id, data: { status: "inactive" } }),
          onWhatsapp: (m) => sendWhatsappMutation.mutate({ id: m.id }),
          onDelete: (m) => setArchiveId(m.id),
        }}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <nav className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground" aria-label={t("common.pagination")}>
          <span>
            {format(t("common.pageOf"), { page, total: totalPages })} · {total} {t("members.total")}
          </span>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t("common.previous")}
            </Button>
            <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
              {t("common.next")}<ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      )}

      {/* ── Add/Edit Modal ─────────────────────────────────────────────────── */}
      <Dialog open={addOpen || !!editMember} onOpenChange={(o) => { if (!o) { setAddOpen(false); setEditMember(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editMember ? t("members.editMember") : t("members.addMember")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" onKeyDown={focusNextOnEnter}>
            {/* Personal Info */}
            <fieldset>
              <legend className={cn(sectionTitle, "w-full")}>{t("members.form.personalInfo")}</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className={cn("sm:col-span-2", keyField)}>
                  <Label htmlFor="member-name" className="font-semibold text-primary">{t("members.form.name")} *</Label>
                  <Input id="member-name" {...form.register("name")} className="mt-1" aria-invalid={!!form.formState.errors.name} />
                  {form.formState.errors.name && <p className="mt-1 text-xs text-red-700 dark:text-red-400" role="alert">{t("members.form.nameRequired")}</p>}
                </div>
                <div>
                  <Label htmlFor="member-phone">{t("members.form.phone")}</Label>
                  <div className="relative mt-1">
                    <Input id="member-phone" type="tel" dir="ltr" {...form.register("phone")} className="pe-8" />
                    {editMember?.waChatId ? (
                      <WhatsappStatusIcon verified label={t("members.whatsapp.verified")} />
                    ) : editMember && editMember.phone && !editMember.waChatId ? (
                      <WhatsappStatusIcon verified={false} label={t("members.whatsapp.notFound")} />
                    ) : null}
                  </div>
                </div>
              </div>
            </fieldset>

            {/* Membership */}
            <fieldset>
              <legend className={cn(sectionTitle, "w-full")}>{t("members.form.membershipInfo")}</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className={keyField}>
                  <Label htmlFor="member-plan" className="font-semibold text-primary">{t("members.form.plan")}</Label>
                  <Select value={form.watch("planId") || "none"} onValueChange={(v) => { const val = v === "none" ? "" : v; form.setValue("planId", val); watchedPlanId(val); }}>
                    <SelectTrigger id="member-plan" className="mt-1"><SelectValue placeholder={t("members.form.selectPlan")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("members.form.noPlan")}</SelectItem>
                      {plans.map((p: Plan) => <SelectItem key={p.id} value={String(p.id)}>{p.name} — {p.currency} {p.price}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {isAdmin && (
                  <div>
                    <Label htmlFor="member-status">{t("members.form.status")}</Label>
                    <Select value={form.watch("status")} onValueChange={(v) => form.setValue("status", v)}>
                      <SelectTrigger id="member-status" className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["active","expired","frozen","inactive","archived"].map(s => (
                          <SelectItem key={s} value={s}>{t(`members.status.${s}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className={keyField}>
                  <Label htmlFor="member-start" className="font-semibold text-primary">{t("members.form.startDate")}</Label>
                  <Input id="member-start" type="date" {...form.register("startDate")} className="mt-1"
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
                  <div className={keyField}>
                    <Label htmlFor="member-expiry" className="font-semibold text-primary">{t("members.form.expiryDate")}</Label>
                    <Input id="member-expiry" type="date" {...form.register("expiryDate")} className="mt-1" />
                  </div>
                )}
              </div>
            </fieldset>

            {/* Payment */}
            <fieldset>
              <legend className={cn(sectionTitle, "w-full")}>{t("members.form.paymentInfo")}</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {planPrice > 0 && (
                  <div>
                    <Label htmlFor="member-plan-price">{t("members.form.planPrice")}</Label>
                    <Input id="member-plan-price" value={planPrice} readOnly className="mt-1 bg-muted/50" />
                  </div>
                )}
                <div className={keyField}>
                  <Label htmlFor="member-paid" className="font-semibold text-primary">{t("members.form.amountPaid")}</Label>
                  <Input id="member-paid" type="number" inputMode="decimal" step="0.01" min="0" {...form.register("amountPaid")} className="mt-1" />
                </div>
                {isAdmin && (
                  <div>
                    <Label htmlFor="member-discount">{t("members.form.discount")}</Label>
                    <Input id="member-discount" type="number" inputMode="decimal" step="0.01" min="0" {...form.register("discount")} className="mt-1" />
                  </div>
                )}
                <div>
                  <Label htmlFor="member-currency">{t("members.form.currency")}</Label>
                  <Select
                    value={form.watch("currency")}
                    onValueChange={(v) => {
                      form.setValue("currency", v as "USD" | "CDF");
                      if (planBasePrice > 0) setPlanPrice(convertPrice(planBasePrice, planBaseCurrency, v));
                    }}
                  >
                    <SelectTrigger id="member-currency" className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="CDF">CDF</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className={cn("sm:col-span-2", keyField)}>
                  <p className="text-sm font-semibold text-primary">{t("members.form.cashAccount")}</p>
                  <div className={lockedBox}>{cashAccount?.name ?? t("members.form.cashDefault")}</div>
                </div>
                {planPrice > 0 && (
                  <div>
                    <p className="text-sm font-medium">{t("members.form.balance")}</p>
                    <div className={balanceBox(balance)} aria-live="polite">{balance.toFixed(2)}</div>
                  </div>
                )}
              </div>
            </fieldset>

            {/* Coach & Commission — admin only */}
            {isAdmin && coaches.length > 0 && (
              <fieldset>
                <legend className={cn(sectionTitle, "w-full")}>{t("members.coach.section")}</legend>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="member-coach">{t("members.coach.assigned")}</Label>
                    <Select value={form.watch("coachId") || "none"} onValueChange={(v) => form.setValue("coachId", v === "none" ? "" : v)}>
                      <SelectTrigger id="member-coach" className="mt-1"><SelectValue placeholder={t("members.coach.none")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("members.coach.none")}</SelectItem>
                        {coaches.map((e) => (
                          <SelectItem key={e.id} value={String(e.id)}>{e.name}{e.jobTitle ? ` — ${e.jobTitle}` : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="member-commission">{t("members.coach.commission")}</Label>
                    <Input id="member-commission" type="number" inputMode="decimal" step="0.01" min="0" {...form.register("commissionAmount")} className="mt-1" placeholder="0" aria-describedby="member-commission-hint" />
                    <p id="member-commission-hint" className="mt-1 text-xs text-muted-foreground">{t("members.coach.commissionHint")}</p>
                  </div>
                </div>
              </fieldset>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setAddOpen(false); setEditMember(null); }}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {(createMutation.isPending || updateMutation.isPending) ? t("common.saving") : t("common.save")}
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
          <form onSubmit={renewForm.handleSubmit(onRenewSubmit)} className="space-y-4" onKeyDown={focusNextOnEnter}>
            <div>
              <Label htmlFor="renew-plan">{t("members.renew.plan")} *</Label>
              <Select value={renewForm.watch("planId") ?? ""} onValueChange={(v) => { renewForm.setValue("planId", v); watchRenewPlan(v); }}>
                <SelectTrigger id="renew-plan" className="mt-1"><SelectValue placeholder={t("members.form.selectPlan")} /></SelectTrigger>
                <SelectContent>
                  {plans.map((p: Plan) => <SelectItem key={p.id} value={String(p.id)}>{p.name} — {p.currency} {p.price}</SelectItem>)}
                </SelectContent>
              </Select>
              {renewForm.formState.errors.planId && <p className="mt-1 text-xs text-red-700 dark:text-red-400" role="alert">{t("members.renew.planRequired")}</p>}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="renew-start">{t("members.renew.startDate")}</Label>
                <Input id="renew-start" type="date" {...renewForm.register("startDate")} className="mt-1"
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
                <Label htmlFor="renew-expiry">{t("members.renew.expiryDate")}</Label>
                <Input id="renew-expiry" type="date" {...renewForm.register("expiryDate")} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="renew-paid">{t("members.renew.amountPaid")}</Label>
                <Input id="renew-paid" type="number" inputMode="decimal" step="0.01" min="0" {...renewForm.register("amountPaid")} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="renew-discount">{t("members.renew.discount")}</Label>
                <Input id="renew-discount" type="number" inputMode="decimal" step="0.01" min="0" {...renewForm.register("discount")} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="renew-currency">{t("members.renew.currency")}</Label>
                <Select
                  value={renewForm.watch("currency")}
                  onValueChange={(v) => {
                    renewForm.setValue("currency", v as "USD" | "CDF");
                    if (renewPlanBasePrice > 0) setRenewPlanPrice(convertPrice(renewPlanBasePrice, renewPlanBaseCurrency, v));
                  }}
                >
                  <SelectTrigger id="renew-currency" className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="CDF">CDF</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(renewAmountPaid > 0) && (
                <div className="sm:col-span-2">
                  <p className="text-sm font-medium">{t("members.form.cashAccount")}</p>
                  <div className={lockedBox}>{cashAccount?.name ?? t("members.form.cashDefault")}</div>
                </div>
              )}
              {renewPlanPrice > 0 && (
                <div>
                  <p className="text-sm font-medium">{t("members.renew.balance")}</p>
                  <div className={balanceBox(renewBalance)} aria-live="polite">{renewBalance.toFixed(2)}</div>
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="renew-notes">{t("members.renew.notes")}</Label>
              <Textarea id="renew-notes" {...renewForm.register("notes")} className="mt-1" rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenewMember(null)}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={renewMutation.isPending}>
                {renewMutation.isPending ? t("common.saving") : t("members.actions.renew")}
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
              <Label htmlFor="freeze-from">{t("members.freeze.from")}</Label>
              <Input id="freeze-from" type="date" {...freezeForm.register("frozenAt")} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="freeze-until">{t("members.freeze.until")}</Label>
              <Input id="freeze-until" type="date" {...freezeForm.register("frozenUntil")} className="mt-1" />
            </div>
            {frozenDays > 0 && (
              <p className="text-sm font-medium text-blue-700 dark:text-blue-400" aria-live="polite">
                {frozenDays} {t("members.freeze.days_count")}
              </p>
            )}
            <div>
              <Label htmlFor="freeze-reason">{t("members.freeze.reason")}</Label>
              <Textarea id="freeze-reason" {...freezeForm.register("reason")} className="mt-1" rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFreezeMember(null)}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={freezeMutation.isPending}>
                {freezeMutation.isPending ? t("common.saving") : t("members.actions.freeze")}
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
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20" role="alert">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">{checkInMember?.name}</p>
                  <p className="text-sm text-amber-800 dark:text-amber-300">{t("members.checkin.alreadyDone")}</p>
                </div>
              </div>
            ) : (
              <p className="text-foreground/80">
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
          <div className="space-y-2 py-2">
            <p className="text-foreground/80">
              {t("members.reactivate.confirm")} <strong>{reactivateMember?.name}</strong>?
            </p>
            {(reactivateMember?.frozenDays ?? 0) > 0 && (
              <p className="text-sm text-blue-700 dark:text-blue-400">
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
              {reactivateMutation.isPending ? t("common.saving") : t("members.actions.reactivate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MemberInvoiceDialog
        data={invoicePrintData}
        onClose={() => setInvoicePrintData(null)}
        settings={(settingsData ?? {}) as Record<string, unknown>}
        t={t}
        fmtDate={fmtDate}
        locale={locale}
      />

      {/* ── Archive Confirmation ─────────────────────────────────────────────── */}
      <AlertDialog open={!!archiveId} onOpenChange={(o) => { if (!o) setArchiveId(null); }}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("members.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("members.delete.confirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (archiveId) deleteMutation.mutate({ id: archiveId }); setArchiveId(null); }}
            >
              {t("members.actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
