import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  useListPayroll, useCreatePayroll, useMarkPayrollPaid, useCancelPayroll,
  useListStaffEmployees, getListPayrollQueryKey, getListStaffEmployeesQueryKey,
} from "@workspace/api-client-react";
import { useGetMe } from "@/hooks/use-me";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { PayrollStatusBadge } from "@/lib/status-badge";
import { EmptyTableState } from "@/components/ui/empty-table-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Plus, Loader2, CheckCircle, XCircle, DollarSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { format } from "date-fns";


function fmtDate(d: string | null | undefined) {
  if (!d) return "-";
  try { return format(new Date(d), "dd/MM/yyyy"); } catch { return d; }
}

function fmtMoney(n: number, currency: string) {
  const v = n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return currency === "CDF" ? `FC ${v}` : `$${v}`;
}

export default function Payroll() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const me = useGetMe();

  const canView = me?.role === "admin" || me?.permissions?.payroll;
  const canManage = me?.role === "admin" || me?.permissions?.managePayroll;

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [payId, setPayId] = useState<number | null>(null);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const queryParams = {
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    limit: "50",
  } as any;

  const { data, isLoading } = useListPayroll(queryParams, {
    query: { queryKey: getListPayrollQueryKey(queryParams), enabled: canView }
  });
  const records = data?.items ?? [];

  const { data: empData } = useListStaffEmployees({ limit: "200", status: "active" } as any, {
    query: { queryKey: getListStaffEmployeesQueryKey({ limit: "200", status: "active" } as any) }
  });
  const employees = empData?.items ?? [];

  const createPayroll = useCreatePayroll();
  const markPaid = useMarkPayrollPaid();
  const cancelPayroll = useCancelPayroll();

  const generateSchema = z.object({
    staffEmployeeId: z.coerce.number().min(1, "Required"),
    periodStart: z.string().min(1, "Required"),
    periodEnd: z.string().min(1, "Required"),
    baseSalary: z.coerce.number().min(0),
    bonus: z.coerce.number().min(0),
    deduction: z.coerce.number().min(0),
    currency: z.enum(["USD", "CDF"]),
    notes: z.string().optional(),
  });

  const form = useForm<z.infer<typeof generateSchema>>({
    resolver: zodResolver(generateSchema),
    defaultValues: { staffEmployeeId: 0, periodStart: "", periodEnd: "", baseSalary: 0, bonus: 0, deduction: 0, currency: "USD", notes: "" },
  });

  const watchEmpId = form.watch("staffEmployeeId");
  const selectedEmployee = employees.find(e => e.id === Number(watchEmpId));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/payroll"] });

  const onEmployeeSelect = (empId: string) => {
    form.setValue("staffEmployeeId", Number(empId));
    const emp = employees.find(e => e.id === Number(empId));
    if (emp) {
      form.setValue("baseSalary", emp.salary);
      form.setValue("currency", emp.salaryCurrency as "USD" | "CDF");
    }
  };

  const onGenerateSubmit = (data: z.infer<typeof generateSchema>) => {
    createPayroll.mutate({ data: { ...data, notes: data.notes || undefined } as any }, {
      onSuccess: () => {
        invalidate();
        setIsGenerateOpen(false);
        form.reset();
        toast({ title: t("payroll.generated") });
      },
      onError: () => toast({ title: t("common.error"), variant: "destructive" }),
    });
  };

  const handleMarkPaid = () => {
    if (!payId) return;
    markPaid.mutate({ id: payId }, {
      onSuccess: () => { invalidate(); setPayId(null); toast({ title: t("payroll.paid") }); },
      onError: () => toast({ title: t("common.error"), variant: "destructive" }),
    });
  };

  const handleCancel = () => {
    if (!cancelId) return;
    cancelPayroll.mutate({ id: cancelId, data: { reason: cancelReason || "Cancelled" } }, {
      onSuccess: () => { invalidate(); setCancelId(null); setCancelReason(""); toast({ title: t("payroll.cancelled") }); },
      onError: () => toast({ title: t("common.error"), variant: "destructive" }),
    });
  };

  if (!canView) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">{t("common.accessRestricted")}</p>
      </div>
    );
  }

  const netPay = (form.watch("baseSalary") || 0) + (form.watch("bonus") || 0) - (form.watch("deduction") || 0);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={DollarSign}
        iconClass="bg-emerald-500/10 text-emerald-600"
        title={t("payroll.title")}
        actions={canManage ? (
          <Button onClick={() => { form.reset({ staffEmployeeId: 0, periodStart: "", periodEnd: "", baseSalary: 0, bonus: 0, deduction: 0, currency: "USD", notes: "" }); setIsGenerateOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" />{t("payroll.generate")}
          </Button>
        ) : undefined}
      />

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Input placeholder={t("common.search")} value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t("payroll.filterStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.filter")}</SelectItem>
            <SelectItem value="draft">{t("payroll.status.draft")}</SelectItem>
            <SelectItem value="paid">{t("payroll.status.paid")}</SelectItem>
            <SelectItem value="cancelled">{t("payroll.status.cancelled")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("payroll.table.number")}</TableHead>
              <TableHead>{t("payroll.table.employee")}</TableHead>
              <TableHead>{t("payroll.table.period")}</TableHead>
              <TableHead>{t("payroll.table.base")}</TableHead>
              <TableHead>{t("payroll.table.bonus")}</TableHead>
              <TableHead>{t("payroll.table.deduction")}</TableHead>
              <TableHead>{t("payroll.table.net")}</TableHead>
              <TableHead>{t("payroll.table.status")}</TableHead>
              {canManage && <TableHead className="text-right">{t("payroll.table.actions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={canManage ? 9 : 8} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
            ) : records.length === 0 ? (
              <TableRow><TableCell colSpan={canManage ? 9 : 8} className="text-center py-8 text-muted-foreground">{t("payroll.empty")}</TableCell></TableRow>
            ) : records.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.payrollNumber ?? "-"}</TableCell>
                <TableCell className="font-medium">{r.staffName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {r.periodStart ? `${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}` : "-"}
                </TableCell>
                <TableCell>{fmtMoney(r.baseSalary, r.currency)}</TableCell>
                <TableCell className="text-green-600">+{fmtMoney(r.bonus, r.currency)}</TableCell>
                <TableCell className="text-red-600">-{fmtMoney(r.deduction, r.currency)}</TableCell>
                <TableCell className="font-semibold">{fmtMoney(r.netPay, r.currency)}</TableCell>
                <TableCell>
                  <PayrollStatusBadge status={r.status} label={t(`payroll.status.${r.status}`)} />
                </TableCell>
                {canManage && (
                  <TableCell className="text-right space-x-1 rtl:space-x-reverse">
                    {r.status === "draft" && (
                      <>
                        <Button variant="ghost" size="icon" title={t("payroll.markPaid")} onClick={() => setPayId(r.id)}>
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        </Button>
                        <Button variant="ghost" size="icon" title={t("payroll.cancel")} onClick={() => { setCancelId(r.id); setCancelReason(""); }}>
                          <XCircle className="w-4 h-4 text-red-500" />
                        </Button>
                      </>
                    )}
                    {r.status === "paid" && (
                      <Button variant="ghost" size="icon" title={t("payroll.cancel")} onClick={() => { setCancelId(r.id); setCancelReason(""); }}>
                        <XCircle className="w-4 h-4 text-red-500" />
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Generate Payroll Dialog */}
      <Dialog open={isGenerateOpen} onOpenChange={setIsGenerateOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader><DialogTitle>{t("payroll.generate")}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onGenerateSubmit)} className="space-y-4">
              <FormField control={form.control} name="staffEmployeeId" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("payroll.employee")}</FormLabel>
                  <Select onValueChange={onEmployeeSelect} value={field.value ? String(field.value) : ""}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select employee…" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {employees.map(e => (
                        <SelectItem key={e.id} value={String(e.id)}>
                          {e.name} {e.staffNumber ? `(${e.staffNumber})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {selectedEmployee && (
                <p className="text-xs text-muted-foreground -mt-2">
                  Standard: {fmtMoney(selectedEmployee.salary, selectedEmployee.salaryCurrency)} / {t(`emp.frequency.${selectedEmployee.paymentFrequency}`)}
                </p>
              )}

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="periodStart" render={({ field }) => (
                  <FormItem><FormLabel>{t("payroll.periodStart")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="periodEnd" render={({ field }) => (
                  <FormItem><FormLabel>{t("payroll.periodEnd")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="baseSalary" render={({ field }) => (
                  <FormItem><FormLabel>{t("payroll.baseSalary")}</FormLabel><FormControl><Input type="number" min="0" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="currency" render={({ field }) => (
                  <FormItem><FormLabel>{t("payroll.currency")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="CDF">CDF</SelectItem></SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="bonus" render={({ field }) => (
                  <FormItem><FormLabel>{t("payroll.bonus")}</FormLabel><FormControl><Input type="number" min="0" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="deduction" render={({ field }) => (
                  <FormItem><FormLabel>{t("payroll.deduction")}</FormLabel><FormControl><Input type="number" min="0" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>

              <div className="rounded-md bg-muted p-3 text-sm">
                <span className="text-muted-foreground">{t("payroll.netPay")}:</span>
                <span className="font-bold ml-2">{fmtMoney(netPay, form.watch("currency"))}</span>
              </div>

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem><FormLabel>{t("payroll.notes")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />

              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => setIsGenerateOpen(false)}>{t("payroll.cancel")}</Button>
                <Button type="submit" disabled={createPayroll.isPending}>
                  {createPayroll.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t("payroll.generate")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Mark Paid Confirm */}
      <AlertDialog open={!!payId} onOpenChange={o => !o && setPayId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("payroll.markPaid")}</AlertDialogTitle>
            <AlertDialogDescription>{t("payroll.confirmPay")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("payroll.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleMarkPaid} className="bg-green-600 hover:bg-green-700 text-white">
              {markPaid.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("payroll.markPaid")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Confirm */}
      <AlertDialog open={!!cancelId} onOpenChange={o => !o && setCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("payroll.cancelTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("payroll.confirmCancel")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 py-2">
            <Input
              placeholder={t("payroll.cancelReason")}
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} className="bg-destructive text-destructive-foreground">
              {cancelPayroll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("payroll.cancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
