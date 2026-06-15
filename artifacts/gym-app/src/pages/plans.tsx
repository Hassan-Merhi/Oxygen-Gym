import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useI18n } from "@/lib/i18n";
import { useGetMe } from "@/hooks/use-me";
import {
  useListPlans,
  useCreatePlan,
  useUpdatePlan,
  useDeletePlan,
  getListPlansQueryKey,
  useGetSettings,
  useListStaffEmployees,
} from "@workspace/api-client-react";
import type { Plan } from "@workspace/api-client-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  MoreHorizontal,
  Edit,
  Archive,
  Trash2,
  Dumbbell,
  Clock,
  RotateCcw,
  Search,
  Layers,
  UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Schemas ────────────────────────────────────────────────────────────────────
const planSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  durationDays: z.coerce.number().int().min(1, "Duration must be at least 1 day"),
  price: z.coerce.number().min(0, "Price must be ≥ 0"),
  currency: z.enum(["USD", "CDF"]).default("USD"),
  coachId: z.coerce.number().nullable().optional(),
  coachFee: z.coerce.number().min(0).default(0),
  coachName: z.string().nullable().optional(),
});
type PlanFormValues = z.infer<typeof planSchema>;

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtPrice(price: number, currency: string) {
  if (currency === "CDF") return `FC ${price.toLocaleString()}`;
  return price % 1 === 0 ? `$${price}` : `$${price.toFixed(2)}`;
}

function fmtDuration(days: number): { label: string; sub: string } {
  if (days % 365 === 0) {
    const n = days / 365;
    return { label: `${n}`, sub: `year${n > 1 ? "s" : ""}` };
  }
  if (days % 30 === 0) {
    const n = days / 30;
    return { label: `${n}`, sub: `month${n > 1 ? "s" : ""}` };
  }
  if (days % 7 === 0) {
    const n = days / 7;
    return { label: `${n}`, sub: `week${n > 1 ? "s" : ""}` };
  }
  return { label: `${days}`, sub: "days" };
}

// cycle through a set of accent colors so cards aren't all the same
const CARD_ACCENTS = [
  "from-violet-500 to-purple-600",
  "from-blue-500 to-cyan-600",
  "from-emerald-500 to-teal-600",
  "from-orange-500 to-amber-600",
  "from-rose-500 to-pink-600",
  "from-indigo-500 to-blue-600",
];

// ── Plan Form Modal ────────────────────────────────────────────────────────────
function PlanModal({
  open, onClose, plan, onSaved, employees,
}: {
  open: boolean;
  onClose: () => void;
  plan?: Plan | null;
  onSaved: () => void;
  employees: { id: number; name: string }[];
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: getListPlansQueryKey() });
  const createPlan = useCreatePlan({ mutation: { onSuccess: invalidate } });
  const updatePlan = useUpdatePlan({ mutation: { onSuccess: invalidate } });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PlanFormValues>({
    resolver: zodResolver(planSchema),
    defaultValues: plan
      ? {
          name: plan.name,
          description: plan.description ?? "",
          durationDays: plan.durationDays,
          price: plan.price,
          currency: (plan.currency as "USD" | "CDF") ?? "USD",
          coachId: plan.coachId ?? null,
          coachFee: plan.coachFee ?? 0,
        }
      : { currency: "USD", durationDays: 30, price: 0, coachId: null, coachFee: 0 },
  });

  const currency = watch("currency");
  const coachId = watch("coachId");

  // Re-populate form whenever the plan being edited changes
  useEffect(() => {
    if (open) {
      reset(
        plan
          ? {
              name: plan.name,
              description: plan.description ?? "",
              durationDays: plan.durationDays,
              price: plan.price,
              currency: (plan.currency as "USD" | "CDF") ?? "USD",
              coachId: plan.coachId ?? null,
              coachFee: plan.coachFee ?? 0,
            }
          : { currency: "USD", durationDays: 30, price: 0, coachId: null, coachFee: 0 },
      );
    }
  }, [open, plan, reset]);

  const onSubmit = handleSubmit(async (data) => {
    try {
      // Resolve coachName from selected employee
      const selectedCoach = employees.find(e => e.id === Number(data.coachId));
      const payload = {
        ...data,
        coachId: data.coachId ? Number(data.coachId) : null,
        coachName: selectedCoach?.name ?? null,
        coachFee: data.coachId ? (data.coachFee ?? 0) : 0,
      };
      if (plan) {
        await updatePlan.mutateAsync({ id: plan.id, data: payload });
        toast({ title: t("plans.updated") });
      } else {
        await createPlan.mutateAsync({ data: payload });
        toast({ title: t("plans.created") });
      }
      reset();
      onSaved();
      onClose();
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    }
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{plan ? t("plans.editPlan") : t("plans.addPlan")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t("plans.form.name")} *</Label>
            <Input id="name" {...register("name")} placeholder={t("plans.form.namePlaceholder")} />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">{t("plans.form.description")}</Label>
            <Textarea id="description" {...register("description")} rows={2} placeholder={t("plans.form.descriptionPlaceholder")} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="durationDays">{t("plans.form.duration")} (days) *</Label>
              <Input id="durationDays" type="number" min={1} {...register("durationDays")} placeholder="30" />
              {errors.durationDays && <p className="text-xs text-red-500">{errors.durationDays.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>{t("plans.form.currency")}</Label>
              <Select value={currency} onValueChange={(v) => setValue("currency", v as "USD" | "CDF")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">$ USD</SelectItem>
                  <SelectItem value="CDF">FC CDF</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="price">{t("plans.form.price")} *</Label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-muted-foreground text-sm font-medium">
                {currency === "CDF" ? "FC" : "$"}
              </span>
              <Input id="price" type="number" step="0.01" min="0" className="pl-9" {...register("price")} placeholder="0" />
            </div>
            {errors.price && <p className="text-xs text-red-500">{errors.price.message}</p>}
          </div>

          {/* Coach commission section */}
          <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-3">
            <p className="text-xs font-semibold text-violet-700 flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5" />
              Coach Commission <span className="font-normal text-muted-foreground">(optional)</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Default Coach</Label>
                <Select
                  value={coachId ? String(coachId) : "none"}
                  onValueChange={(v) => {
                    setValue("coachId", v === "none" ? null : Number(v));
                    if (v === "none") setValue("coachFee", 0);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="No coach" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No coach</SelectItem>
                    {employees.map(e => (
                      <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Commission Fee ({currency === "CDF" ? "FC" : "$"})</Label>
                <Input
                  type="number" step="0.01" min="0"
                  className="h-8 text-xs"
                  {...register("coachFee")}
                  placeholder="0"
                  disabled={!coachId}
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              When a payment is recorded for a member on this plan, a commission is auto-created for the assigned coach.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => { reset(); onClose(); }}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={isSubmitting || createPlan.isPending || updatePlan.isPending}>
              {plan ? t("common.save") : t("plans.addPlan")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Plan Card ──────────────────────────────────────────────────────────────────
function PlanCard({
  plan, accentIdx, exchangeRate, t, onEdit, onArchive, onDelete, onRestore, canManage,
}: {
  plan: Plan;
  accentIdx: number;
  exchangeRate: number;
  t: (k: string) => string;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRestore: () => void;
  canManage: boolean;
}) {
  const isArchived = plan.status === "archived";
  const accent = CARD_ACCENTS[accentIdx % CARD_ACCENTS.length];
  const dur = fmtDuration(plan.durationDays);

  return (
    <div
      className={cn(
        "group rounded-2xl border overflow-hidden flex flex-col transition-all duration-200",
        isArchived
          ? "bg-muted/20 border-border/30 opacity-60"
          : "bg-card border-border/50 hover:border-border hover:shadow-md hover:-translate-y-0.5",
      )}
    >
      {/* Accent top bar with duration badge */}
      <div className={cn("h-1.5 w-full bg-gradient-to-r", isArchived ? "bg-muted" : accent)} />

      {/* Card body */}
      <div className="p-5 flex flex-col flex-1 gap-4">
        {/* Name row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={cn(
                "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                isArchived ? "bg-muted" : `bg-gradient-to-br ${accent} shadow-sm`,
              )}
            >
              <Dumbbell className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm leading-tight truncate">{plan.name}</h3>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">{plan.planNumber}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isArchived && (
              <Badge variant="outline" className="text-xs border-amber-300 text-amber-600 bg-amber-50">
                Archived
              </Badge>
            )}
            {canManage && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!isArchived && (
                    <DropdownMenuItem onClick={onEdit}>
                      <Edit className="w-3.5 h-3.5 mr-2" />{t("common.edit")}
                    </DropdownMenuItem>
                  )}
                  {isArchived ? (
                    <DropdownMenuItem onClick={onRestore}>
                      <RotateCcw className="w-3.5 h-3.5 mr-2" />{t("plans.restore")}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={onArchive}>
                      <Archive className="w-3.5 h-3.5 mr-2" />{t("plans.archive")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onDelete} className="text-red-600 focus:text-red-600">
                    <Trash2 className="w-3.5 h-3.5 mr-2" />{t("common.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Description */}
        {plan.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 -mt-1">{plan.description}</p>
        )}

        {/* Price + Duration — the hero section */}
        <div className="mt-auto pt-3 border-t border-border/40 space-y-2">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            <span className="text-sm font-semibold text-foreground">{dur.label}</span>
            <span className="text-xs">{dur.sub}</span>
            <span className="text-xs text-muted-foreground/60">({plan.durationDays}d)</span>
          </div>
          <div className="flex items-end justify-between gap-2">
            <div>
              {plan.currency === "USD" ? (
                <>
                  <p className="text-xl font-bold tracking-tight text-foreground">{fmtPrice(plan.price, "USD")}</p>
                  <p className="text-xs text-muted-foreground">FC {Math.round(plan.price * exchangeRate).toLocaleString()}</p>
                </>
              ) : (
                <>
                  <p className="text-xl font-bold tracking-tight text-foreground">{fmtPrice(plan.price, "CDF")}</p>
                  <p className="text-xs text-muted-foreground">${(plan.price / exchangeRate).toFixed(0)}</p>
                </>
              )}
            </div>
          </div>
          {/* Coach commission badge */}
          {plan.coachId && plan.coachName && (
            <div className="flex items-center gap-1.5 pt-1">
              <UserCheck className="w-3 h-3 text-violet-500 shrink-0" />
              <span className="text-xs text-violet-700 font-medium truncate">{plan.coachName}</span>
              {(plan.coachFee ?? 0) > 0 && (
                <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                  +{fmtPrice(plan.coachFee!, plan.currency)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function PlansPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const me = useGetMe();
  const qc = useQueryClient();
  const canManage = me?.role === "admin" || me?.permissions?.managePlans;

  const [showModal, setShowModal] = useState(false);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");

  const { data: plans = [], isLoading } = useListPlans();
  const { data: empData } = useListStaffEmployees({ limit: "200" });
  const employees = empData?.items ?? [];
  const { data: settings } = useGetSettings();
  const exchangeRate = (settings?.usdToCdfRate as number) ?? 2800;
  const updatePlan = useUpdatePlan();
  const deletePlan = useDeletePlan();

  const invalidate = () => qc.invalidateQueries({ queryKey: getListPlansQueryKey() });

  const activeCount = plans.filter((p) => p.status !== "archived").length;
  const archivedCount = plans.filter((p) => p.status === "archived").length;

  const filtered = plans.filter((p) => {
    const matchesTab = showArchived ? p.status === "archived" : p.status !== "archived";
    const matchesSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const handleArchive = async (plan: Plan) => {
    try {
      await updatePlan.mutateAsync({
        id: plan.id,
        data: { name: plan.name, description: plan.description, durationDays: plan.durationDays, price: plan.price, currency: plan.currency as "USD" | "CDF", status: "archived" },
      });
      toast({ title: t("plans.archived") });
      invalidate();
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    }
  };

  const handleRestore = async (plan: Plan) => {
    try {
      await updatePlan.mutateAsync({
        id: plan.id,
        data: { name: plan.name, description: plan.description, durationDays: plan.durationDays, price: plan.price, currency: plan.currency as "USD" | "CDF", status: "active" },
      });
      toast({ title: t("plans.restored") });
      invalidate();
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    }
  };

  const handleDelete = async (plan: Plan) => {
    if (!window.confirm(t("plans.deleteConfirm"))) return;
    try {
      await deletePlan.mutateAsync({ id: plan.id });
      toast({ title: t("plans.deleted") });
      invalidate();
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Plans</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("plans.subtitle")}</p>
        </div>
        {canManage && (
          <Button
            onClick={() => { setEditPlan(null); setShowModal(true); }}
            className="shrink-0"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            {t("plans.addPlan")}
          </Button>
        )}
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Tab pills */}
        <div className="flex items-center bg-muted rounded-lg p-1 gap-0.5">
          <button
            onClick={() => setShowArchived(false)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
              !showArchived
                ? "bg-white text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Layers className="w-3.5 h-3.5" />
            Active
            <span className={cn(
              "text-xs px-1.5 py-0.5 rounded-full font-semibold",
              !showArchived ? "bg-primary/10 text-primary" : "bg-muted-foreground/20 text-muted-foreground",
            )}>
              {activeCount}
            </span>
          </button>
          <button
            onClick={() => setShowArchived(true)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
              showArchived
                ? "bg-white text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Archive className="w-3.5 h-3.5" />
            Archived
            <span className={cn(
              "text-xs px-1.5 py-0.5 rounded-full font-semibold",
              showArchived ? "bg-amber-100 text-amber-700" : "bg-muted-foreground/20 text-muted-foreground",
            )}>
              {archivedCount}
            </span>
          </button>
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search plans…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <p className="text-sm text-muted-foreground ml-auto">
          {filtered.length} plan{filtered.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 rounded-2xl border border-dashed border-border/60 bg-muted/10">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
            <Dumbbell className="w-7 h-7 text-muted-foreground/40" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-foreground">
              {search ? "No plans match your search" : showArchived ? t("plans.noArchived") : t("plans.noPlans")}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {search ? "Try a different name" : !showArchived && canManage ? t("plans.noPlansHint") : ""}
            </p>
          </div>
          {!search && !showArchived && canManage && (
            <Button onClick={() => { setEditPlan(null); setShowModal(true); }}>
              <Plus className="w-4 h-4 mr-1.5" />
              {t("plans.addPlan")}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((plan, i) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              accentIdx={i}
              exchangeRate={exchangeRate}
              t={t}
              canManage={!!canManage}
              onEdit={() => { setEditPlan(plan); setShowModal(true); }}
              onArchive={() => handleArchive(plan)}
              onDelete={() => handleDelete(plan)}
              onRestore={() => handleRestore(plan)}
            />
          ))}
        </div>
      )}

      <PlanModal
        open={showModal}
        onClose={() => { setShowModal(false); setEditPlan(null); }}
        plan={editPlan}
        onSaved={invalidate}
        employees={employees}
      />
    </div>
  );
}
