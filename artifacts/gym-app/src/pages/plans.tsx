import { useEffect, useMemo, useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  MoreHorizontal,
  Edit,
  Trash2,
  Dumbbell,
  Search,
  UserCheck,
  RefreshCw,
} from "lucide-react";

const planSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().optional(),
  durationDays: z.coerce.number().int().min(1, "Duration must be at least 1 day"),
  price: z.coerce.number().min(0, "Price must be ≥ 0"),
  currency: z.enum(["USD", "CDF"]).default("USD"),
  coachId: z.coerce.number().nullable().optional(),
  coachFee: z.coerce.number().min(0).default(0),
  coachName: z.string().nullable().optional(),
});
type PlanFormValues = z.infer<typeof planSchema>;

function fmtPrice(price: number, currency: string) {
  if (currency === "CDF") return `FC ${price.toLocaleString()}`;
  return price % 1 === 0 ? `$${price.toLocaleString()}` : `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDuration(days: number): { label: string; detail: string } {
  if (days % 365 === 0) {
    const n = days / 365;
    return { label: `${n} year${n > 1 ? "s" : ""}`, detail: `${days}d` };
  }
  if (days % 30 === 0) {
    const n = days / 30;
    return { label: `${n} month${n > 1 ? "s" : ""}`, detail: `${days}d` };
  }
  if (days % 7 === 0) {
    const n = days / 7;
    return { label: `${n} week${n > 1 ? "s" : ""}`, detail: `${days}d` };
  }
  return { label: `${days} day${days !== 1 ? "s" : ""}`, detail: `${days}d` };
}

function PlanModal({
  open,
  onClose,
  plan,
  onSaved,
  employees,
}: {
  open: boolean;
  onClose: () => void;
  plan?: Plan | null;
  onSaved: () => void;
  employees: { id: number; name: string }[];
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();

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

  useEffect(() => {
    if (!open) return;
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
  }, [open, plan, reset]);

  const onSubmit = handleSubmit(async (data) => {
    try {
      const selectedCoach = employees.find((employee) => employee.id === Number(data.coachId));
      const payload = {
        ...data,
        name: data.name.trim(),
        description: data.description?.trim() || undefined,
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

      onSaved();
      reset();
      onClose();
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    }
  });

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) { reset(); onClose(); } }}>
      <DialogContent className="w-[95vw] max-w-md">
        <DialogHeader>
          <DialogTitle>{plan ? t("plans.editPlan") : t("plans.addPlan")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t("plans.form.name")} *</Label>
            <Input id="name" {...register("name")} placeholder={t("plans.form.namePlaceholder")} autoFocus />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">{t("plans.form.description")}</Label>
            <Textarea id="description" {...register("description")} rows={2} placeholder={t("plans.form.descriptionPlaceholder")} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="durationDays">{t("plans.form.duration")} (days) *</Label>
              <Input id="durationDays" type="number" min={1} step={1} {...register("durationDays")} placeholder="30" />
              {errors.durationDays && <p className="text-xs text-red-500">{errors.durationDays.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>{t("plans.form.currency")}</Label>
              <Select value={currency} onValueChange={(value) => setValue("currency", value as "USD" | "CDF", { shouldDirty: true })}>
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
              <span className="absolute left-3 top-2.5 text-sm font-medium text-muted-foreground">
                {currency === "CDF" ? "FC" : "$"}
              </span>
              <Input id="price" type="number" step="0.01" min="0" className="pl-9" {...register("price")} placeholder="0" />
            </div>
            {errors.price && <p className="text-xs text-red-500">{errors.price.message}</p>}
          </div>

          <div className="space-y-3 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-600 dark:text-violet-300">
              <UserCheck className="h-3.5 w-3.5" />
              Coach Commission <span className="font-normal text-muted-foreground">(optional)</span>
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Default Coach</Label>
                <Select
                  value={coachId ? String(coachId) : "none"}
                  onValueChange={(value) => {
                    setValue("coachId", value === "none" ? null : Number(value), { shouldDirty: true });
                    if (value === "none") setValue("coachFee", 0, { shouldDirty: true });
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="No coach" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No coach</SelectItem>
                    {employees.map((employee) => (
                      <SelectItem key={employee.id} value={String(employee.id)}>{employee.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Commission Fee ({currency === "CDF" ? "FC" : "$"})</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  className="h-8 text-xs"
                  {...register("coachFee")}
                  placeholder="0"
                  disabled={!coachId}
                />
              </div>
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              When a payment is recorded for a member on this plan, a commission is automatically created for the assigned coach.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => { reset(); onClose(); }}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting || createPlan.isPending || updatePlan.isPending}>
              {plan ? t("common.save") : t("plans.addPlan")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function PlansPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const me = useGetMe();
  const queryClient = useQueryClient();
  const canManage = me?.role === "admin" || me?.permissions?.managePlans;

  const [showModal, setShowModal] = useState(false);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [search, setSearch] = useState("");

  const {
    data: plans = [],
    isLoading,
    isError,
    refetch,
  } = useListPlans();
  const { data: employeeData } = useListStaffEmployees({ limit: "200" });
  const employees = employeeData?.items ?? [];
  const { data: settings } = useGetSettings();
  const exchangeRate = Number(settings?.usdToCdfRate) > 0 ? Number(settings?.usdToCdfRate) : 2800;
  const deletePlan = useDeletePlan();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getListPlansQueryKey() });
  };

  const activePlans = useMemo(
    () => plans.filter((plan) => plan.status !== "archived"),
    [plans],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return activePlans;

    return activePlans.filter((plan) => {
      const searchable = [
        plan.name,
        plan.planNumber,
        plan.description,
        plan.coachName,
        String(plan.durationDays),
        plan.currency,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return searchable.includes(needle);
    });
  }, [activePlans, search]);

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
    <div className="space-y-5">
      <PageHeader
        icon={Dumbbell}
        iconClass="bg-indigo-500/10 text-indigo-500"
        title="Plans"
        subtitle={t("plans.subtitle")}
        actions={canManage ? (
          <Button onClick={() => { setEditPlan(null); setShowModal(true); }}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t("plans.addPlan")}
          </Button>
        ) : undefined}
      />

      <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 px-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Dumbbell className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">Active plans</p>
            <p className="text-xs text-muted-foreground">
              {activePlans.length} plan{activePlans.length !== 1 ? "s" : ""} available
            </p>
          </div>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-9"
            placeholder="Search plans…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search plans"
          />
        </div>
      </div>

      {isError ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-card/40 px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <RefreshCw className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold">Couldn’t load plans</p>
            <p className="mt-1 text-sm text-muted-foreground">Please retry. Your plans were not changed.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { void refetch(); }}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      ) : isLoading ? (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
          <div className="grid grid-cols-[minmax(240px,2fr)_1fr_1fr_1fr_48px] gap-4 border-b bg-muted/40 px-4 py-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-20" />
            ))}
          </div>
          <div className="divide-y divide-border/50">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="grid grid-cols-[minmax(240px,2fr)_1fr_1fr_1fr_48px] items-center gap-4 px-4 py-4">
                <Skeleton className="h-9 w-48" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-8 w-8" />
              </div>
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/70 bg-card/40 px-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <Dumbbell className="h-6 w-6 text-muted-foreground/50" />
          </div>
          <div>
            <p className="font-semibold text-foreground">
              {search ? "No plans match your search" : t("plans.noPlans")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {search ? "Try a different plan name, number, coach, or duration." : canManage ? t("plans.noPlansHint") : ""}
            </p>
          </div>
          {!search && canManage && (
            <Button onClick={() => { setEditPlan(null); setShowModal(true); }}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t("plans.addPlan")}
            </Button>
          )}
        </div>
      ) : (
        <Table className="min-w-[760px] bg-card">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[36%] px-4">Plan</TableHead>
              <TableHead className="w-[18%] px-4">Duration</TableHead>
              <TableHead className="w-[18%] px-4">Price</TableHead>
              <TableHead className="w-[22%] px-4">Coach</TableHead>
              <TableHead className="w-14 px-3 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((plan) => {
              const duration = fmtDuration(plan.durationDays);
              const convertedPrice = plan.currency === "USD"
                ? `FC ${Math.round(plan.price * exchangeRate).toLocaleString()}`
                : `$${Math.round(plan.price / exchangeRate).toLocaleString()}`;

              return (
                <TableRow key={plan.id} className="group">
                  <TableCell className="px-4 py-3.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                        <Dumbbell className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-foreground">{plan.name}</p>
                          {plan.planNumber && (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                              {plan.planNumber}
                            </span>
                          )}
                        </div>
                        {plan.description ? (
                          <p className="mt-0.5 max-w-md truncate text-xs text-muted-foreground">{plan.description}</p>
                        ) : (
                          <p className="mt-0.5 text-xs text-muted-foreground/60">No description</p>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="px-4 py-3.5">
                    <p className="font-medium tabular-nums text-foreground">{duration.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{duration.detail}</p>
                  </TableCell>

                  <TableCell className="px-4 py-3.5">
                    <p className="font-semibold tabular-nums text-foreground">{fmtPrice(plan.price, plan.currency)}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{convertedPrice}</p>
                  </TableCell>

                  <TableCell className="px-4 py-3.5">
                    {plan.coachId && plan.coachName ? (
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-500">
                          <UserCheck className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{plan.coachName}</p>
                          <p className="text-xs text-muted-foreground">
                            {(plan.coachFee ?? 0) > 0 ? `${fmtPrice(plan.coachFee ?? 0, plan.currency)} commission` : "No commission fee"}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  <TableCell className="px-3 py-3.5 text-right">
                    {canManage ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${plan.name}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          <DropdownMenuItem onClick={() => { setEditPlan(plan); setShowModal(true); }}>
                            <Edit className="mr-2 h-3.5 w-3.5" />
                            {t("common.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => { void handleDelete(plan); }}
                            className="text-red-600 focus:text-red-600"
                            disabled={deletePlan.isPending}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span>{filtered.length} of {activePlans.length} active plan{activePlans.length !== 1 ? "s" : ""}</span>
          {search && <span>Filtered by “{search.trim()}”</span>}
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
