import { useState } from "react";
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
  DollarSign,
  Users,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Schemas ────────────────────────────────────────────────────────────────────
const planSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  durationDays: z.coerce.number().int().min(1, "Duration must be at least 1 day"),
  price: z.coerce.number().min(0, "Price must be ≥ 0"),
  currency: z.enum(["USD", "CDF"]).default("USD"),
});
type PlanFormValues = z.infer<typeof planSchema>;

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtPrice(price: number, currency: string) {
  if (currency === "CDF") return `FC ${price.toLocaleString()}`;
  return `$${price.toFixed(2)}`;
}
function fmtDuration(days: number) {
  if (days % 365 === 0) return `${days / 365} yr${days / 365 > 1 ? "s" : ""}`;
  if (days % 30 === 0) return `${days / 30} mo`;
  if (days % 7 === 0) return `${days / 7} wk${days / 7 > 1 ? "s" : ""}`;
  return `${days} days`;
}

// ── Plan Form Modal ────────────────────────────────────────────────────────────
function PlanModal({
  open, onClose, plan, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  plan?: Plan | null;
  onSaved: () => void;
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
        }
      : { currency: "USD", durationDays: 30, price: 0 },
  });

  const currency = watch("currency");

  const onSubmit = handleSubmit(async (data) => {
    try {
      if (plan) {
        await updatePlan.mutateAsync({ id: plan.id, data });
        toast({ title: t("plans.updated") });
      } else {
        await createPlan.mutateAsync({ data });
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
          <div className="space-y-1">
            <Label htmlFor="name">{t("plans.form.name")} *</Label>
            <Input id="name" {...register("name")} placeholder={t("plans.form.namePlaceholder")} />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="description">{t("plans.form.description")}</Label>
            <Textarea id="description" {...register("description")} rows={2} placeholder={t("plans.form.descriptionPlaceholder")} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="durationDays">{t("plans.form.duration")} *</Label>
              <Input id="durationDays" type="number" min={1} {...register("durationDays")} placeholder="30" />
              {errors.durationDays && <p className="text-xs text-red-500">{errors.durationDays.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>{t("plans.form.currency")}</Label>
              <Select value={currency} onValueChange={(v) => setValue("currency", v as "USD" | "CDF")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="CDF">CDF (FC)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="price">{t("plans.form.price")} *</Label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">
                {currency === "CDF" ? "FC" : "$"}
              </span>
              <Input id="price" type="number" step="0.01" min="0" className="pl-8" {...register("price")} placeholder="0.00" />
            </div>
            {errors.price && <p className="text-xs text-red-500">{errors.price.message}</p>}
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

// ── Plan Card ─────────────────────────────────────────────────────────────────
function PlanCard({
  plan, t, onEdit, onArchive, onDelete, onRestore, canManage,
}: {
  plan: Plan;
  t: (k: string) => string;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRestore: () => void;
  canManage: boolean;
}) {
  const isArchived = plan.status === "archived";

  return (
    <div className={cn(
      "rounded-xl border p-5 flex flex-col gap-3 shadow-sm transition-colors",
      isArchived ? "bg-muted/30 border-border/40 opacity-60" : "bg-card border-border/60 hover:border-primary/30"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
            isArchived ? "bg-muted" : "bg-primary/10"
          )}>
            <Dumbbell className={cn("w-4 h-4", isArchived ? "text-muted-foreground" : "text-primary")} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate">{plan.name}</h3>
            <p className="text-xs text-muted-foreground font-mono">{plan.planNumber}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isArchived && (
            <Badge variant="outline" className="text-xs border-amber-300 text-amber-600">{t("plans.archived")}</Badge>
          )}
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
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

      {plan.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{plan.description}</p>
      )}

      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/40">
        <div className="flex items-center gap-1.5 text-xs">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-medium">{fmtDuration(plan.durationDays)}</span>
          <span className="text-muted-foreground">({plan.durationDays}d)</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs justify-end">
          <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-bold text-base text-foreground">{fmtPrice(plan.price, plan.currency)}</span>
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

  const { data: plans = [], isLoading } = useListPlans();
  const updatePlan = useUpdatePlan();
  const deletePlan = useDeletePlan();

  const invalidate = () => qc.invalidateQueries({ queryKey: getListPlansQueryKey() });

  const filtered = plans.filter(p =>
    showArchived ? p.status === "archived" : p.status !== "archived"
  );

  const activeCount = plans.filter(p => p.status !== "archived").length;
  const archivedCount = plans.filter(p => p.status === "archived").length;

  const handleArchive = async (plan: Plan) => {
    try {
      await updatePlan.mutateAsync({ id: plan.id, data: { name: plan.name, description: plan.description, durationDays: plan.durationDays, price: plan.price, currency: plan.currency as "USD" | "CDF", status: "archived" } });
      toast({ title: t("plans.archived") });
      invalidate();
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    }
  };

  const handleRestore = async (plan: Plan) => {
    try {
      await updatePlan.mutateAsync({ id: plan.id, data: { name: plan.name, description: plan.description, durationDays: plan.durationDays, price: plan.price, currency: plan.currency as "USD" | "CDF", status: "active" } });
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Dumbbell className="w-8 h-8 text-primary" />
            {t("nav.plans")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("plans.subtitle")}</p>
        </div>
        {canManage && (
          <Button onClick={() => { setEditPlan(null); setShowModal(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            {t("plans.addPlan")}
          </Button>
        )}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <button
          onClick={() => setShowArchived(false)}
          className={cn(
            "flex items-center gap-1.5 pb-1 border-b-2 transition-colors font-medium",
            !showArchived ? "border-primary text-foreground" : "border-transparent hover:border-border"
          )}
        >
          <Users className="w-4 h-4" />
          {t("plans.active")} ({activeCount})
        </button>
        <button
          onClick={() => setShowArchived(true)}
          className={cn(
            "flex items-center gap-1.5 pb-1 border-b-2 transition-colors font-medium",
            showArchived ? "border-primary text-foreground" : "border-transparent hover:border-border"
          )}
        >
          <Archive className="w-4 h-4" />
          {t("plans.archivedTab")} ({archivedCount})
        </button>
      </div>

      {/* Plan grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 rounded-xl border border-dashed border-border/60">
          <Dumbbell className="w-12 h-12 text-muted-foreground/30" />
          <div className="text-center">
            <p className="font-medium text-muted-foreground">
              {showArchived ? t("plans.noArchived") : t("plans.noPlans")}
            </p>
            {!showArchived && canManage && (
              <p className="text-sm text-muted-foreground mt-1">{t("plans.noPlansHint")}</p>
            )}
          </div>
          {!showArchived && canManage && (
            <Button onClick={() => { setEditPlan(null); setShowModal(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              {t("plans.addPlan")}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(plan => (
            <PlanCard
              key={plan.id}
              plan={plan}
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

      {/* Modal */}
      <PlanModal
        open={showModal}
        onClose={() => { setShowModal(false); setEditPlan(null); }}
        plan={editPlan}
        onSaved={invalidate}
      />
    </div>
  );
}
