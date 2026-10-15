import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n-format";
import { useGetMe } from "@/hooks/use-me";
import {
  useListPlans,
  useCreatePlan,
  useUpdatePlan,
  useDeletePlan,
  getListPlansQueryKey,
  useGetSettings,
} from "@workspace/api-client-react";
import type { Plan } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/pager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, MoreHorizontal, Edit, Trash2, Dumbbell, Search, RefreshCw } from "lucide-react";

type T = (key: string) => string;

function makePlanSchema(t: T) {
  return z.object({
    name: z.string().trim().min(1, t("plans.validation.name")),
    description: z.string().optional(),
    durationDays: z.coerce.number().int().min(1, t("plans.validation.duration")),
    price: z.coerce.number().min(0, t("plans.validation.price")),
    currency: z.enum(["USD", "CDF"]).default("USD"),
  });
}
type PlanFormValues = z.infer<ReturnType<typeof makePlanSchema>>;

function fmtPrice(price: number, currency: string) {
  if (currency === "CDF") return `FC ${price.toLocaleString("en-US")}`;
  return price % 1 === 0
    ? `$${price.toLocaleString("en-US")}`
    : `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDuration(days: number, t: T): { label: string; detail: string } {
  const detail = fmt(t("plans.duration.daysShort"), { n: days });
  const unit = (n: number, one: string, many: string) => fmt(t(n > 1 ? many : one), { n });
  if (days % 365 === 0) return { label: unit(days / 365, "plans.duration.year", "plans.duration.years"), detail };
  if (days % 30 === 0) return { label: unit(days / 30, "plans.duration.month", "plans.duration.months"), detail };
  if (days % 7 === 0) return { label: unit(days / 7, "plans.duration.week", "plans.duration.weeks"), detail };
  return { label: unit(days, "plans.duration.day", "plans.duration.days"), detail };
}

function PlanModal({
  open,
  onClose,
  plan,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  plan?: Plan | null;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();
  const schema = useMemo(() => makePlanSchema(t), [t]);

  const defaults = (p?: Plan | null): Partial<PlanFormValues> => p
    ? {
        name: p.name,
        description: p.description ?? "",
        durationDays: p.durationDays,
        price: p.price,
        currency: (p.currency as "USD" | "CDF") ?? "USD",
      }
    : { currency: "USD", durationDays: 30, price: 0 };

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PlanFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults(plan),
  });

  const currency = watch("currency");

  useEffect(() => {
    if (!open) return;
    reset(defaults(plan));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan, reset]);

  const onSubmit = handleSubmit(async (data) => {
    try {
      const payload = {
        ...data,
        name: data.name.trim(),
        description: data.description?.trim() || undefined,
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

  const errorText = (msg?: string) => msg ? <p role="alert" className="text-xs text-red-700 dark:text-red-400">{msg}</p> : null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{plan ? t("plans.editPlan") : t("plans.addPlan")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="plan-name">{t("plans.form.name")} *</Label>
            <Input id="plan-name" {...register("name")} placeholder={t("plans.form.namePlaceholder")} autoFocus aria-invalid={!!errors.name} />
            {errorText(errors.name?.message)}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan-description">{t("plans.form.description")}</Label>
            <Textarea id="plan-description" {...register("description")} rows={2} placeholder={t("plans.form.descriptionPlaceholder")} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="plan-duration">{t("plans.form.durationDays")} *</Label>
              <Input id="plan-duration" type="number" inputMode="numeric" min={1} step={1} {...register("durationDays")} placeholder="30" aria-invalid={!!errors.durationDays} />
              {errorText(errors.durationDays?.message)}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-currency">{t("plans.form.currency")}</Label>
              <Select value={currency} onValueChange={(value) => setValue("currency", value as "USD" | "CDF", { shouldDirty: true })}>
                <SelectTrigger id="plan-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">$ USD</SelectItem>
                  <SelectItem value="CDF">FC CDF</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan-price">{t("plans.form.price")} *</Label>
            <div className="relative">
              <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground" aria-hidden="true">
                {currency === "CDF" ? "FC" : "$"}
              </span>
              <Input id="plan-price" type="number" inputMode="decimal" step="0.01" min="0" className="ps-9" {...register("price")} placeholder="0" aria-invalid={!!errors.price} />
            </div>
            {errorText(errors.price?.message)}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>
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
  const [deleteTarget, setDeleteTarget] = useState<Plan | null>(null);
  const [search, setSearch] = useState("");

  const { data: plans = [], isLoading, isError, refetch } = useListPlans();
  const { data: settings } = useGetSettings();
  const exchangeRate = Number(settings?.usdToCdfRate) > 0 ? Number(settings?.usdToCdfRate) : 2800;
  const deletePlan = useDeletePlan();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getListPlansQueryKey() });
  };

  const activePlans = useMemo(() => plans.filter((plan) => plan.status !== "archived"), [plans]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return activePlans;
    return activePlans.filter((plan) => {
      const searchable = [plan.name, plan.planNumber, plan.description, String(plan.durationDays), plan.currency]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return searchable.includes(needle);
    });
  }, [activePlans, search]);

  const confirmDelete = async () => {
    const plan = deleteTarget;
    setDeleteTarget(null);
    if (!plan) return;
    try {
      await deletePlan.mutateAsync({ id: plan.id });
      toast({ title: t("plans.deleted") });
      invalidate();
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    }
  };

  const openAdd = () => { setEditPlan(null); setShowModal(true); };
  const convertedPrice = (plan: Plan) => plan.currency === "USD"
    ? `≈ FC ${Math.round(plan.price * exchangeRate).toLocaleString("en-US")}`
    : `≈ $${Math.round(plan.price / exchangeRate).toLocaleString("en-US")}`;

  const planActions = (plan: Plan) => canManage ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={fmt(t("plans.actionsFor"), { name: plan.name })}>
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={() => { setEditPlan(plan); setShowModal(true); }}>
          <Edit className="h-4 w-4" aria-hidden="true" />
          {t("common.edit")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setDeleteTarget(plan)}
          className="text-red-700 focus:text-red-700 dark:text-red-400 dark:focus:text-red-400"
          disabled={deletePlan.isPending}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {t("common.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  const planIdentity = (plan: Plan) => (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-700 dark:text-indigo-400">
        <Dumbbell className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate font-semibold text-foreground">{plan.name}</p>
          {plan.planNumber && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{plan.planNumber}</span>
          )}
        </div>
        {plan.description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{plan.description}</p>}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Dumbbell}
        iconClass="bg-indigo-500/10 text-indigo-700 dark:text-indigo-400"
        title={t("plans.title")}
        subtitle={t("plans.subtitle")}
        actions={canManage ? (
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("plans.addPlan")}
          </Button>
        ) : undefined}
      />

      <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 px-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Dumbbell className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold">{t("plans.activePlans")}</p>
            <p className="text-xs text-muted-foreground">{fmt(t("plans.availableCount"), { count: activePlans.length })}</p>
          </div>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            className="h-9 ps-9"
            placeholder={t("plans.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={t("plans.search")}
          />
        </div>
      </div>

      {isError ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-card/40">
          <EmptyState
            icon={RefreshCw}
            title={t("plans.loadError")}
            hint={t("plans.loadErrorHint")}
            action={
              <Button variant="outline" size="sm" onClick={() => { void refetch(); }}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      ) : isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label={t("common.loading")}>
          {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-card/40">
          <EmptyState
            icon={Dumbbell}
            title={search ? t("plans.noMatch") : t("plans.noPlans")}
            hint={search ? t("plans.noMatchHint") : canManage ? t("plans.noPlansHint") : undefined}
            action={!search && canManage ? (
              <Button onClick={openAdd}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("plans.addPlan")}
              </Button>
            ) : undefined}
          />
        </div>
      ) : (
        <>
          {/* Cards below lg */}
          <ul className="grid gap-3 md:grid-cols-2 lg:hidden">
            {filtered.map((plan) => {
              const duration = fmtDuration(plan.durationDays, t);
              return (
                <li key={plan.id} className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    {planIdentity(plan)}
                    {planActions(plan)}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 border-t pt-3">
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("plans.col.duration")}</dt>
                      <dd className="font-medium tabular-nums">{duration.label}</dd>
                      <dd className="text-xs text-muted-foreground">{duration.detail}</dd>
                    </div>
                    <div className="text-end">
                      <dt className="text-xs text-muted-foreground">{t("plans.col.price")}</dt>
                      <dd className="font-semibold tabular-nums">{fmtPrice(plan.price, plan.currency)}</dd>
                      <dd className="text-xs tabular-nums text-muted-foreground">{convertedPrice(plan)}</dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-hidden rounded-xl border border-border/60 bg-card lg:block">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[48%] px-4">{t("plans.col.plan")}</TableHead>
                  <TableHead className="w-[22%] px-4">{t("plans.col.duration")}</TableHead>
                  <TableHead className="w-[22%] px-4">{t("plans.col.price")}</TableHead>
                  <TableHead className="w-16 px-3 text-end"><span className="sr-only">{t("common.actions")}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((plan) => {
                  const duration = fmtDuration(plan.durationDays, t);
                  return (
                    <TableRow key={plan.id}>
                      <TableCell className="px-4 py-3.5">{planIdentity(plan)}</TableCell>
                      <TableCell className="px-4 py-3.5">
                        <p className="font-medium tabular-nums text-foreground">{duration.label}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{duration.detail}</p>
                      </TableCell>
                      <TableCell className="px-4 py-3.5">
                        <p className="font-semibold tabular-nums text-foreground">{fmtPrice(plan.price, plan.currency)}</p>
                        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{convertedPrice(plan)}</p>
                      </TableCell>
                      <TableCell className="px-3 py-2 text-end">
                        {planActions(plan) ?? <span className="text-muted-foreground" aria-hidden="true">—</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
          <span>{fmt(t("plans.shownCount"), { shown: filtered.length, total: activePlans.length })}</span>
          {search && <span>{fmt(t("plans.filteredBy"), { query: search.trim() })}</span>}
        </div>
      )}

      <PlanModal
        open={showModal}
        onClose={() => { setShowModal(false); setEditPlan(null); }}
        plan={editPlan}
        onSaved={invalidate}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.delete")} — {deleteTarget?.name}</AlertDialogTitle>
            <AlertDialogDescription>{t("plans.deleteConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { void confirmDelete(); }}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
