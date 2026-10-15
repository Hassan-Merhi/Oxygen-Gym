import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useListStaffEmployees, useCreateStaffEmployee, useUpdateStaffEmployee, useArchiveStaffEmployee,
  getListStaffEmployeesQueryKey,
} from "@workspace/api-client-react";
import { Archive, Edit2, Loader2, Plus, Search, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fmt as format } from "@/lib/i18n-format";
import { useToast } from "@/hooks/use-toast";
import { StaffStatusBadge } from "@/lib/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Avatar } from "./staff-utils";

function EmptyEmployees({ t }: { t: (k: string) => string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Users className="h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-foreground">{t("emp.empty")}</p>
    </div>
  );
}

export function EmployeeRecordsTab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [archiveId, setArchiveId] = useState<number | null>(null);
  const [selectedEmp, setSelectedEmp] = useState<any>(null);

  const { data, isLoading } = useListStaffEmployees({ search: search || undefined, limit: "50" } as any, {
    query: { queryKey: getListStaffEmployeesQueryKey({ search: search || undefined, limit: "50" } as any) }
  });
  const employees = data?.items ?? [];

  const createEmp = useCreateStaffEmployee();
  const updateEmp = useUpdateStaffEmployee();
  const archiveEmp = useArchiveStaffEmployee();

  const empSchema = z.object({
    name: z.string().min(1, t("validation.required")),
    phone: z.string().optional(),
    email: z.string().email(t("validation.invalidEmail")).optional().or(z.literal("")),
    jobTitle: z.string().optional(),
    hireDate: z.string().optional(),
    salary: z.coerce.number().min(0),
    salaryCurrency: z.enum(["USD", "CDF"]),
    paymentFrequency: z.enum(["monthly", "weekly", "daily"]),
    status: z.enum(["active", "inactive"]),
    notes: z.string().optional(),
  });

  const form = useForm<z.infer<typeof empSchema>>({
    resolver: zodResolver(empSchema),
    defaultValues: { name: "", phone: "", email: "", jobTitle: "", hireDate: "", salary: 0, salaryCurrency: "USD", paymentFrequency: "monthly", status: "active", notes: "" },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/staff-employees"] });

  const onAddSubmit = (data: z.infer<typeof empSchema>) => {
    createEmp.mutate({ data: { ...data, email: data.email || undefined, hireDate: data.hireDate || undefined } as any }, {
      onSuccess: () => { invalidate(); setIsAddOpen(false); form.reset(); toast({ title: t("emp.added") }); },
      onError: () => toast({ title: t("common.error"), variant: "destructive" }),
    });
  };

  const onEditSubmit = (data: z.infer<typeof empSchema>) => {
    if (!selectedEmp) return;
    updateEmp.mutate({ id: selectedEmp.id, data: { ...data, email: data.email || undefined } as any }, {
      onSuccess: () => { invalidate(); setIsEditOpen(false); toast({ title: t("common.success") }); },
      onError: () => toast({ title: t("common.error"), variant: "destructive" }),
    });
  };

  const handleArchive = () => {
    if (!archiveId) return;
    archiveEmp.mutate({ id: archiveId }, {
      onSuccess: () => { invalidate(); setArchiveId(null); toast({ title: t("common.success") }); },
      onError: () => toast({ title: t("common.error"), variant: "destructive" }),
    });
  };

  const openEdit = (emp: any) => {
    setSelectedEmp(emp);
    form.reset({
      name: emp.name, phone: emp.phone ?? "", email: emp.email ?? "",
      jobTitle: emp.jobTitle ?? "", hireDate: emp.hireDate ? emp.hireDate.slice(0, 10) : "",
      salary: emp.salary, salaryCurrency: emp.salaryCurrency as "USD" | "CDF",
      paymentFrequency: emp.paymentFrequency as "monthly" | "weekly" | "daily",
      status: emp.status as "active" | "inactive", notes: emp.notes ?? "",
    });
    setIsEditOpen(true);
  };

  // Rendered as a plain function (not a nested component) so inputs keep focus between renders.
  const renderEmpForm = (onSubmit: (d: any) => void, isPending: boolean) => (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem><FormLabel>{t("emp.table.name")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="jobTitle" render={({ field }) => (
            <FormItem><FormLabel>{t("emp.table.jobTitle")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="phone" render={({ field }) => (
            <FormItem><FormLabel>{t("emp.table.phone")}</FormLabel><FormControl><Input type="tel" dir="ltr" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem><FormLabel>{t("emp.table.email")}</FormLabel><FormControl><Input type="email" dir="ltr" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="salary" render={({ field }) => (
            <FormItem><FormLabel>{t("emp.table.salary")}</FormLabel><FormControl><Input type="number" inputMode="decimal" min="0" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="salaryCurrency" render={({ field }) => (
            <FormItem><FormLabel>{t("emp.table.currency")}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="CDF">CDF</SelectItem></SelectContent>
              </Select><FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="paymentFrequency" render={({ field }) => (
            <FormItem><FormLabel>{t("emp.table.frequency")}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="monthly">{t("emp.frequency.monthly")}</SelectItem>
                  <SelectItem value="weekly">{t("emp.frequency.weekly")}</SelectItem>
                  <SelectItem value="daily">{t("emp.frequency.daily")}</SelectItem>
                </SelectContent>
              </Select><FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="hireDate" render={({ field }) => (
            <FormItem><FormLabel>{t("emp.hireDate")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="status" render={({ field }) => (
            <FormItem><FormLabel>{t("emp.table.status")}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="active">{t("emp.status.active")}</SelectItem>
                  <SelectItem value="inactive">{t("emp.status.inactive")}</SelectItem>
                </SelectContent>
              </Select><FormMessage />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="notes" render={({ field }) => (
          <FormItem><FormLabel>{t("payroll.notes")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <DialogFooter>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );

  const rowActions = (emp: any) => (
    <div className="flex shrink-0 justify-end gap-1">
      <Button variant="ghost" size="icon" onClick={() => openEdit(emp)} title={t("common.edit")} aria-label={format(t("emp.aria.edit"), { name: emp.name })}>
        <Edit2 className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => setArchiveId(emp.id)} title={t("emp.archiveEmployee")} aria-label={format(t("emp.aria.archive"), { name: emp.name })}>
        <Archive className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Label htmlFor="employee-search" className="sr-only">{t("emp.search")}</Label>
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="employee-search" type="search" placeholder={t("common.search")} value={search} onChange={e => setSearch(e.target.value)} className="ps-9" />
        </div>
        <Button className="w-full sm:ms-auto sm:w-auto" onClick={() => { form.reset(); setIsAddOpen(true); }}>
          <Plus className="h-4 w-4" aria-hidden="true" />{t("emp.addEmployee")}
        </Button>
      </div>

      {/* Cards below lg */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm lg:hidden">
        {isLoading ? (
          <ul className="divide-y divide-border/50" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-3"><Skeleton className="h-10 w-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-1/3" /></div></li>
            ))}
          </ul>
        ) : employees.length === 0 ? (
          <EmptyEmployees t={t} />
        ) : (
          <ul className="divide-y divide-border/50">
            {employees.map(emp => (
              <li key={emp.id} className="flex items-center gap-3 px-3 py-3 md:px-4">
                <Avatar name={emp.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{emp.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {emp.jobTitle || "—"} · <span className="tabular-nums">{emp.salary.toLocaleString()} {emp.salaryCurrency}</span> · {t(`emp.frequency.${emp.paymentFrequency}`)}
                  </p>
                  {emp.phone && <p className="truncate text-xs text-muted-foreground" dir="ltr">{emp.phone}</p>}
                </div>
                <StaffStatusBadge status={emp.status} label={t(`emp.status.${emp.status}`)} />
                {rowActions(emp)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Table from lg */}
      <div className="hidden overflow-hidden rounded-xl border bg-card shadow-sm lg:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead>{t("emp.table.staffNumber")}</TableHead>
              <TableHead>{t("emp.table.name")}</TableHead>
              <TableHead>{t("emp.table.jobTitle")}</TableHead>
              <TableHead>{t("emp.table.phone")}</TableHead>
              <TableHead className="text-end">{t("emp.table.salary")}</TableHead>
              <TableHead>{t("emp.table.frequency")}</TableHead>
              <TableHead>{t("emp.table.status")}</TableHead>
              <TableHead className="text-end">{t("emp.table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [0, 1, 2].map((i) => (
                <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-3/4" /></TableCell>)}</TableRow>
              ))
            ) : employees.length === 0 ? (
              <TableRow><TableCell colSpan={8}><EmptyEmployees t={t} /></TableCell></TableRow>
            ) : employees.map(emp => (
              <TableRow key={emp.id} className="hover:bg-muted/20">
                <TableCell className="font-mono text-xs text-muted-foreground">{emp.staffNumber ?? "-"}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar name={emp.name} />
                    <span className="font-medium">{emp.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{emp.jobTitle || "-"}</TableCell>
                <TableCell className="text-muted-foreground"><span dir="ltr">{emp.phone ?? "-"}</span></TableCell>
                <TableCell className="text-end font-medium tabular-nums">{emp.salary.toLocaleString()} {emp.salaryCurrency}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{t(`emp.frequency.${emp.paymentFrequency}`)}</Badge></TableCell>
                <TableCell><StaffStatusBadge status={emp.status} label={t(`emp.status.${emp.status}`)} /></TableCell>
                <TableCell>{rowActions(emp)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[580px]">
          <DialogHeader><DialogTitle>{t("emp.addEmployee")}</DialogTitle></DialogHeader>
          {renderEmpForm(onAddSubmit, createEmp.isPending)}
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[580px]">
          <DialogHeader><DialogTitle>{t("emp.editEmployee")}</DialogTitle></DialogHeader>
          {renderEmpForm(onEditSubmit, updateEmp.isPending)}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!archiveId} onOpenChange={o => !o && setArchiveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("emp.archiveEmployee")}</AlertDialogTitle>
            <AlertDialogDescription>{t("emp.confirmArchive")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive} className="bg-amber-600 text-white hover:bg-amber-700">
              {archiveEmp.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-label={t("common.loading")} /> : t("emp.archiveEmployee")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
