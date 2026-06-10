import { useState, useRef, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import {
  useListUsers, useCreateUser, useUpdateUser, useDeleteUser, useUpdateUserPermissions, getListUsersQueryKey,
  useListStaffEmployees, useCreateStaffEmployee, useUpdateStaffEmployee, useArchiveStaffEmployee,
  getListStaffEmployeesQueryKey,
  useListPayroll, useCreatePayroll, useMarkPayrollPaid, useCancelPayroll, getListPayrollQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Edit2, Trash2, ShieldAlert, Plus, Loader2, Archive,
  CheckCircle, XCircle, Play, Users, CreditCard, UserCog,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";

// ─── Constants ─────────────────────────────────────────────────────────────────

const PAGE_PERMISSIONS = [
  "dashboard", "members", "plans", "staff", "payroll",
  "payments", "vouchers", "accounts", "stock", "sales", "settings",
] as const;

const FEATURE_PERMISSIONS = [
  "viewCost", "viewProfit", "viewAccounting",
  "manageStaff", "manageSettings", "managePayroll",
  "manageInventory", "manageMembers", "managePlans",
] as const;

const ROLE_COLORS: Record<string, "default" | "secondary" | "outline"> = {
  admin: "default",
  manager: "outline",
  staff: "secondary",
};

const PAYROLL_STATUS_COLORS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  paid: "default",
  cancelled: "destructive",
};

function fmtPDate(d: string | null | undefined) {
  if (!d) return "-";
  try { return format(new Date(d), "dd/MM/yyyy"); } catch { return d; }
}

function fmtMoney(n: number, currency: string) {
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency}`;
}

function avatarInitials(name: string) {
  const parts = name.trim().split(" ");
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  "bg-violet-500", "bg-blue-500", "bg-emerald-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-pink-500", "bg-indigo-500",
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

// ─── Employee Records Tab ──────────────────────────────────────────────────────
function EmployeeRecordsTab() {
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
    name: z.string().min(1, "Required"),
    phone: z.string().optional(),
    email: z.string().email("Invalid email").optional().or(z.literal("")),
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
      onSuccess: () => { invalidate(); setIsAddOpen(false); form.reset(); toast({ title: "Employee added" }); },
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

  const EmpForm = ({ onSubmit, isPending }: { onSubmit: (d: any) => void; isPending: boolean }) => (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem><FormLabel>{t("emp.table.name")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="jobTitle" render={({ field }) => (
            <FormItem><FormLabel>{t("emp.table.jobTitle")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="phone" render={({ field }) => (
            <FormItem><FormLabel>{t("emp.table.phone")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem><FormLabel>{t("emp.table.email")}</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="salary" render={({ field }) => (
            <FormItem><FormLabel>{t("emp.table.salary")}</FormLabel><FormControl><Input type="number" min="0" {...field} /></FormControl><FormMessage /></FormItem>
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
            <FormItem><FormLabel>Hire Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
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
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input placeholder={t("common.search")} value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
        <Button className="ml-auto" onClick={() => { form.reset(); setIsAddOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" />{t("emp.addEmployee")}
        </Button>
      </div>

      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="font-semibold">#</TableHead>
              <TableHead className="font-semibold">{t("emp.table.name")}</TableHead>
              <TableHead className="font-semibold">{t("emp.table.jobTitle")}</TableHead>
              <TableHead className="font-semibold">{t("emp.table.phone")}</TableHead>
              <TableHead className="font-semibold">{t("emp.table.salary")}</TableHead>
              <TableHead className="font-semibold">{t("emp.table.frequency")}</TableHead>
              <TableHead className="font-semibold">{t("emp.table.status")}</TableHead>
              <TableHead className="text-right font-semibold">{t("emp.table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-12"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : employees.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">{t("emp.empty")}</TableCell></TableRow>
            ) : employees.map(emp => (
              <TableRow key={emp.id} className="hover:bg-muted/20">
                <TableCell className="font-mono text-xs text-muted-foreground">{emp.staffNumber ?? "-"}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${avatarColor(emp.name)}`}>
                      {avatarInitials(emp.name)}
                    </div>
                    <span className="font-medium">{emp.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{emp.jobTitle ?? "-"}</TableCell>
                <TableCell className="text-muted-foreground">{emp.phone ?? "-"}</TableCell>
                <TableCell className="font-medium tabular-nums">{emp.salary.toLocaleString()} {emp.salaryCurrency}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{t(`emp.frequency.${emp.paymentFrequency}`)}</Badge></TableCell>
                <TableCell>
                  <Badge variant={emp.status === "active" ? "default" : "secondary"} className={emp.status === "active" ? "bg-emerald-500/10 text-emerald-600 border-emerald-200" : ""}>
                    {t(`emp.status.${emp.status}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right space-x-1 rtl:space-x-reverse">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(emp)} title={t("common.edit")}>
                    <Edit2 className="w-4 h-4 text-blue-500" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setArchiveId(emp.id)} title={t("emp.archiveEmployee")}>
                    <Archive className="w-4 h-4 text-amber-500" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[580px]">
          <DialogHeader><DialogTitle>{t("emp.addEmployee")}</DialogTitle></DialogHeader>
          <EmpForm onSubmit={onAddSubmit} isPending={createEmp.isPending} />
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[580px]">
          <DialogHeader><DialogTitle>{t("emp.editEmployee")}</DialogTitle></DialogHeader>
          <EmpForm onSubmit={onEditSubmit} isPending={updateEmp.isPending} />
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
            <AlertDialogAction onClick={handleArchive} className="bg-amber-500 hover:bg-amber-600 text-white">
              {archiveEmp.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("emp.archiveEmployee")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Payroll Tab ───────────────────────────────────────────────────────────────
interface RunRow {
  empId: number;
  name: string;
  jobTitle: string;
  salary: number;
  bonus: number;
  advance: number;
  extraDeduction: number;
  currency: "USD" | "CDF";
  checked: boolean;
}

function PayrollTab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const me = useGetMe();
  const canManage = me?.role === "admin" || me?.permissions?.managePayroll;

  // ── Payroll Run state ──────────────────────────────────────────────────────
  const [runPeriodStart, setRunPeriodStart] = useState("");
  const [runPeriodEnd, setRunPeriodEnd] = useState("");
  const [runRows, setRunRows] = useState<RunRow[]>([]);
  const [runLoading, setRunLoading] = useState(false);
  const [notes, setNotes] = useState("");

  // ── History state ──────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [payId, setPayId] = useState<number | null>(null);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const { data: empData, isLoading: empLoading } = useListStaffEmployees({ limit: "200", status: "active" } as any, {
    query: { queryKey: getListStaffEmployeesQueryKey({ limit: "200", status: "active" } as any) }
  });
  const employees = empData?.items ?? [];

  const historyParams = { search: search || undefined, status: statusFilter !== "all" ? statusFilter : undefined, limit: "50" } as any;
  const { data: histData, isLoading: histLoading } = useListPayroll(historyParams, {
    query: { queryKey: getListPayrollQueryKey(historyParams) }
  });
  const records = histData?.items ?? [];

  const createPayroll = useCreatePayroll();
  const markPaid = useMarkPayrollPaid();
  const cancelPayroll = useCancelPayroll();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/payroll"] });

  // Load employees into run rows when employees load
  useEffect(() => {
    if (employees.length > 0 && runRows.length === 0) {
      setRunRows(employees.map(e => ({
        empId: e.id,
        name: e.name,
        jobTitle: e.jobTitle ?? "",
        salary: e.salary,
        bonus: 0,
        advance: 0,
        extraDeduction: 0,
        currency: e.salaryCurrency as "USD" | "CDF",
        checked: true,
      })));
    }
  }, [employees]);

  const allChecked = runRows.length > 0 && runRows.every(r => r.checked);
  const someChecked = runRows.some(r => r.checked);
  const selectedCount = runRows.filter(r => r.checked).length;

  const toggleAll = () => setRunRows(rows => rows.map(r => ({ ...r, checked: !allChecked })));
  const toggleRow = (empId: number) => setRunRows(rows => rows.map(r => r.empId === empId ? { ...r, checked: !r.checked } : r));
  const updateRow = (empId: number, field: keyof RunRow, value: any) => {
    setRunRows(rows => rows.map(r => r.empId === empId ? { ...r, [field]: value } : r));
  };

  const netPay = (row: RunRow) => row.salary + row.bonus - row.advance - row.extraDeduction;

  const totalNet = runRows.filter(r => r.checked).reduce((sum, r) => sum + netPay(r), 0);

  const handleRunPayroll = async () => {
    if (!runPeriodStart || !runPeriodEnd) {
      toast({ title: "Please set pay period dates", variant: "destructive" });
      return;
    }
    const selected = runRows.filter(r => r.checked);
    if (selected.length === 0) {
      toast({ title: "Select at least one employee", variant: "destructive" });
      return;
    }
    setRunLoading(true);
    let ok = 0;
    let fail = 0;
    for (const row of selected) {
      try {
        await new Promise<void>((resolve, reject) => {
          createPayroll.mutate({
            data: {
              staffEmployeeId: row.empId,
              periodStart: runPeriodStart,
              periodEnd: runPeriodEnd,
              baseSalary: row.salary,
              bonus: row.bonus,
              deduction: row.advance + row.extraDeduction,
              currency: row.currency,
              notes: notes || undefined,
            } as any,
          }, { onSuccess: () => { ok++; resolve(); }, onError: () => { fail++; resolve(); } });
        });
      } catch { fail++; }
    }
    setRunLoading(false);
    invalidate();
    toast({
      title: `Payroll run complete`,
      description: `${ok} generated${fail > 0 ? `, ${fail} failed` : ""}`,
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

  return (
    <div className="space-y-8">
      {/* ── Payroll Run ──────────────────────────────────────────────────────── */}
      {canManage && (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b bg-gradient-to-r from-violet-500/5 to-blue-500/5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <Play className="w-4 h-4 text-violet-600" />
            </div>
            <div>
              <h2 className="font-semibold text-base">Run Payroll</h2>
              <p className="text-xs text-muted-foreground">Generate pay for all or selected staff in one click</p>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {/* Period + notes row */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Period Start</label>
                <Input type="date" value={runPeriodStart} onChange={e => setRunPeriodStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Period End</label>
                <Input type="date" value={runPeriodEnd} onChange={e => setRunPeriodEnd(e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-sm font-medium">Notes <span className="text-muted-foreground font-normal">(optional)</span></label>
                <Input placeholder="e.g. June payroll" value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </div>

            {/* Employee table */}
            {empLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : employees.length === 0 ? (
              <p className="text-center text-muted-foreground py-8 text-sm">No active employees found. Add employees in the Employee Records tab.</p>
            ) : (
              <>
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="w-10">
                          <Checkbox
                            checked={allChecked}
                            onCheckedChange={toggleAll}
                            aria-label="Select all"
                          />
                        </TableHead>
                        <TableHead className="font-semibold">Employee</TableHead>
                        <TableHead className="font-semibold text-right">Base Salary</TableHead>
                        <TableHead className="font-semibold text-right">Bonus</TableHead>
                        <TableHead className="font-semibold text-right">
                          <span className="text-amber-600">Advance</span>
                          <span className="block text-[10px] font-normal text-muted-foreground">(already taken)</span>
                        </TableHead>
                        <TableHead className="font-semibold text-right">
                          <span className="text-red-500">Deduction</span>
                          <span className="block text-[10px] font-normal text-muted-foreground">(extra)</span>
                        </TableHead>
                        <TableHead className="font-semibold text-right">Net Pay</TableHead>
                        <TableHead className="font-semibold w-20">Cur.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runRows.map(row => {
                        const net = netPay(row);
                        return (
                          <TableRow key={row.empId} className={`hover:bg-muted/20 ${!row.checked ? "opacity-40" : ""}`}>
                            <TableCell>
                              <Checkbox checked={row.checked} onCheckedChange={() => toggleRow(row.empId)} />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2.5">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${avatarColor(row.name)}`}>
                                  {avatarInitials(row.name)}
                                </div>
                                <div>
                                  <p className="font-medium text-sm">{row.name}</p>
                                  {row.jobTitle && <p className="text-xs text-muted-foreground">{row.jobTitle}</p>}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number" min="0" step="0.01"
                                value={row.salary}
                                onChange={e => updateRow(row.empId, "salary", parseFloat(e.target.value) || 0)}
                                className="w-28 text-right tabular-nums ml-auto h-8 text-sm"
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number" min="0" step="0.01"
                                value={row.bonus}
                                onChange={e => updateRow(row.empId, "bonus", parseFloat(e.target.value) || 0)}
                                className="w-24 text-right tabular-nums ml-auto h-8 text-sm text-emerald-700"
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number" min="0" step="0.01"
                                value={row.advance}
                                onChange={e => updateRow(row.empId, "advance", parseFloat(e.target.value) || 0)}
                                className="w-24 text-right tabular-nums ml-auto h-8 text-sm text-amber-700"
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number" min="0" step="0.01"
                                value={row.extraDeduction}
                                onChange={e => updateRow(row.empId, "extraDeduction", parseFloat(e.target.value) || 0)}
                                className="w-24 text-right tabular-nums ml-auto h-8 text-sm text-red-600"
                              />
                            </TableCell>
                            <TableCell className={`text-right font-semibold tabular-nums text-sm ${net < 0 ? "text-red-600" : ""}`}>
                              {net.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell>
                              <Select value={row.currency} onValueChange={v => updateRow(row.empId, "currency", v)}>
                                <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="USD">USD</SelectItem>
                                  <SelectItem value="CDF">CDF</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Summary bar */}
                <div className="flex items-center justify-between rounded-lg bg-muted/40 px-5 py-3 border">
                  <div className="text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">{selectedCount}</span> of {runRows.length} employees selected
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-sm">
                      <span className="text-muted-foreground mr-1.5">Total payout:</span>
                      <span className="font-bold text-base tabular-nums">{totalNet.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                      <span className="text-muted-foreground ml-1 text-xs">(mixed currencies)</span>
                    </div>
                    <Button
                      onClick={handleRunPayroll}
                      disabled={runLoading || !someChecked}
                      className="bg-violet-600 hover:bg-violet-700 text-white gap-2"
                    >
                      {runLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      Run Payroll ({selectedCount})
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Payroll History ───────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="font-semibold text-base">Payroll History</h2>
        <div className="flex items-center gap-3">
          <Input placeholder={t("common.search")} value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="draft">{t("payroll.status.draft")}</SelectItem>
              <SelectItem value="paid">{t("payroll.status.paid")}</SelectItem>
              <SelectItem value="cancelled">{t("payroll.status.cancelled")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="font-semibold">#</TableHead>
                <TableHead className="font-semibold">Employee</TableHead>
                <TableHead className="font-semibold">Period</TableHead>
                <TableHead className="font-semibold text-right">Base</TableHead>
                <TableHead className="font-semibold text-right">Bonus</TableHead>
                <TableHead className="font-semibold text-right text-violet-600">Commission</TableHead>
                <TableHead className="font-semibold text-right">Deduction</TableHead>
                <TableHead className="font-semibold text-right">Net Pay</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                {canManage && <TableHead className="text-right font-semibold">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {histLoading ? (
                <TableRow><TableCell colSpan={canManage ? 10 : 9} className="text-center py-12"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
              ) : records.length === 0 ? (
                <TableRow><TableCell colSpan={canManage ? 10 : 9} className="text-center py-12 text-muted-foreground">{t("payroll.empty")}</TableCell></TableRow>
              ) : records.map(r => (
                <TableRow key={r.id} className="hover:bg-muted/20">
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.payrollNumber ?? "-"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${avatarColor(r.staffName as string)}`}>
                        {avatarInitials(r.staffName as string)}
                      </div>
                      <span className="font-medium text-sm">{r.staffName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground tabular-nums">
                    {r.periodStart ? `${fmtPDate(r.periodStart)} – ${fmtPDate(r.periodEnd)}` : "-"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{fmtMoney(r.baseSalary, r.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-emerald-600">+{fmtMoney(r.bonus, r.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-violet-600">
                    {(r as any).commissionBonus > 0 ? `+${fmtMoney((r as any).commissionBonus, r.currency)}` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-red-500">-{fmtMoney(r.deduction, r.currency)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{fmtMoney(r.netPay, r.currency)}</TableCell>
                  <TableCell>
                    <Badge variant={PAYROLL_STATUS_COLORS[r.status] ?? "secondary"} className={
                      r.status === "paid" ? "bg-emerald-500/10 text-emerald-600 border-emerald-200" :
                      r.status === "cancelled" ? "" : "bg-amber-500/10 text-amber-600 border-amber-200"
                    }>
                      {t(`payroll.status.${r.status}`)}
                    </Badge>
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right space-x-1 rtl:space-x-reverse">
                      {r.status === "draft" && (
                        <>
                          <Button variant="ghost" size="icon" title={t("payroll.markPaid")} onClick={() => setPayId(r.id)}>
                            <CheckCircle className="w-4 h-4 text-emerald-500" />
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
      </div>

      {/* Confirm dialogs */}
      <AlertDialog open={!!payId} onOpenChange={o => !o && setPayId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("payroll.markPaid")}</AlertDialogTitle>
            <AlertDialogDescription>{t("payroll.confirmPay")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleMarkPaid} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {markPaid.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("payroll.markPaid")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!cancelId} onOpenChange={o => !o && setCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("payroll.cancelTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("payroll.confirmCancel")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 py-2">
            <Input placeholder={t("payroll.cancelReason")} value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
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

// ─── Login Users Tab ───────────────────────────────────────────────────────────
export function LoginUsersTab() {
  const { t } = useI18n();
  const { data: users = [], isLoading } = useListUsers();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const updatePermissions = useUpdateUserPermissions();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isPermsOpen, setIsPermsOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [selectedUser, setSelectedUser] = useState<any>(null);

  const formSchema = z.object({
    username: z.string().min(2, "Username required").regex(/^[a-z0-9_.-]+$/, "Lowercase letters, numbers, _ . - only"),
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email").optional().or(z.literal("")),
    phone: z.string().optional(),
    password: z.string().min(6, "Min 6 characters").optional().or(z.literal("")),
    role: z.enum(["admin", "manager", "staff"]),
    status: z.enum(["active", "inactive"]),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { username: "", name: "", email: "", phone: "", password: "", role: "staff", status: "active" },
  });

  const watchedName = form.watch("name");
  const prevUsernameRef = useRef("");
  useEffect(() => {
    if (!form.getValues("username") || form.getValues("username") === prevUsernameRef.current) {
      const generated = watchedName.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
      if (generated) { form.setValue("username", generated); prevUsernameRef.current = generated; }
    }
  }, [watchedName]);

  const onAddSubmit = (data: z.infer<typeof formSchema>) => {
    createUser.mutate({ data: { username: data.username, name: data.name, email: data.email || undefined, phone: data.phone || undefined, role: data.role, status: data.status, password: data.password || undefined } as any }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); setIsAddOpen(false); form.reset(); prevUsernameRef.current = ""; toast({ title: t("common.success") }); },
      onError: (err: any) => toast({ title: err?.data?.error ?? t("common.error"), variant: "destructive" })
    });
  };

  const onEditSubmit = (data: z.infer<typeof formSchema>) => {
    if (!selectedUser) return;
    updateUser.mutate({ id: selectedUser.id, data: { username: data.username, name: data.name, email: data.email || undefined, phone: data.phone || undefined, role: data.role, status: data.status } as any }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); setIsEditOpen(false); toast({ title: t("common.success") }); },
      onError: (err: any) => toast({ title: err?.data?.error ?? t("common.error"), variant: "destructive" })
    });
  };

  const handleDelete = () => {
    if (!deleteId) return;
    deleteUser.mutate({ id: deleteId }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); setDeleteId(null); toast({ title: t("common.success") }); },
      onError: () => toast({ title: t("common.error"), variant: "destructive" })
    });
  };

  const handlePermissionsChange = (key: string, checked: boolean) => {
    if (!selectedUser) return;
    setSelectedUser({ ...selectedUser, permissions: { ...selectedUser.permissions, [key]: checked } });
  };

  const savePermissions = () => {
    if (!selectedUser) return;
    updatePermissions.mutate({ id: selectedUser.id, data: { permissions: selectedUser.permissions } }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); setIsPermsOpen(false); toast({ title: t("common.success") }); },
      onError: () => toast({ title: t("common.error"), variant: "destructive" })
    });
  };

  const openEdit = (user: any) => {
    setSelectedUser(user);
    prevUsernameRef.current = user.username ?? "";
    form.reset({ username: user.username ?? "", name: user.name, email: user.email ?? "", phone: user.phone || "", password: "", role: user.role, status: user.status });
    setIsEditOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button data-testid="button-add-staff" onClick={() => { form.reset(); prevUsernameRef.current = ""; setIsAddOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" />{t("staff.addStaff")}
        </Button>
      </div>

      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="font-semibold">{t("staff.table.name")}</TableHead>
              <TableHead className="font-semibold">{t("staff.table.email")}</TableHead>
              <TableHead className="font-semibold">{t("staff.table.phone")}</TableHead>
              <TableHead className="font-semibold">{t("staff.table.role")}</TableHead>
              <TableHead className="font-semibold">{t("staff.table.status")}</TableHead>
              <TableHead className="text-right font-semibold">{t("staff.table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : users.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">{t("common.noData")}</TableCell></TableRow>
            ) : users.map(user => (
              <TableRow key={user.id} className="hover:bg-muted/20" data-testid={`row-user-${user.id}`}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${avatarColor(user.name)}`}>
                      {avatarInitials(user.name)}
                    </div>
                    <div>
                      <p className="font-medium">{user.name}</p>
                      <p className="text-xs text-muted-foreground">{user.username ?? ""}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{user.email || "-"}</TableCell>
                <TableCell className="text-muted-foreground">{user.phone || "-"}</TableCell>
                <TableCell>
                  <Badge variant={ROLE_COLORS[user.role] ?? "secondary"}>{t(`staff.role.${user.role}`)}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={user.status === "active" ? "outline" : "destructive"} className={user.status === "active" ? "bg-emerald-500/10 text-emerald-600 border-emerald-200" : ""}>
                    {user.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right space-x-1 rtl:space-x-reverse">
                  <Button variant="ghost" size="icon" onClick={() => { setSelectedUser({ ...user }); setIsPermsOpen(true); }} title={t("staff.permissions")} data-testid={`btn-perms-${user.id}`}>
                    <ShieldAlert className="w-4 h-4 text-amber-500" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(user)} title={t("staff.edit")} data-testid={`btn-edit-${user.id}`}>
                    <Edit2 className="w-4 h-4 text-blue-500" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteId(user.id)} title={t("staff.delete")} data-testid={`btn-delete-${user.id}`}>
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Add Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("staff.addStaff")}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onAddSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>{t("staff.table.name")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="username" render={({ field }) => (
                <FormItem><FormLabel>{t("auth.username")}</FormLabel><FormControl><Input {...field} placeholder="e.g. john_smith" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem><FormLabel>{t("auth.password")} <span className="text-muted-foreground text-xs">({t("common.optional")})</span></FormLabel><FormControl><Input type="password" {...field} placeholder="••••••••" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>{t("staff.table.email")} <span className="text-muted-foreground text-xs">({t("common.optional")})</span></FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel>{t("staff.table.phone")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="role" render={({ field }) => (
                  <FormItem><FormLabel>{t("staff.table.role")}</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="admin">{t("staff.role.admin")}</SelectItem>
                        <SelectItem value="manager">{t("staff.role.manager")}</SelectItem>
                        <SelectItem value="staff">{t("staff.role.staff")}</SelectItem>
                      </SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem><FormLabel>{t("staff.table.status")}</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createUser.isPending}>
                  {createUser.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t("staff.save")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("staff.edit")}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onEditSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>{t("staff.table.name")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="username" render={({ field }) => (
                <FormItem><FormLabel>{t("auth.username")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>{t("staff.table.email")}</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel>{t("staff.table.phone")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="role" render={({ field }) => (
                  <FormItem><FormLabel>{t("staff.table.role")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="admin">{t("staff.role.admin")}</SelectItem>
                        <SelectItem value="manager">{t("staff.role.manager")}</SelectItem>
                        <SelectItem value="staff">{t("staff.role.staff")}</SelectItem>
                      </SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem><FormLabel>{t("staff.table.status")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={updateUser.isPending}>
                  {updateUser.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t("staff.save")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Permissions Dialog */}
      <Dialog open={isPermsOpen} onOpenChange={setIsPermsOpen}>
        <DialogContent className="sm:max-w-[580px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("staff.permissions")}: {selectedUser?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div>
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("perm.pageAccess")}</p>
              <div className="grid grid-cols-2 gap-y-3 gap-x-6">
                {PAGE_PERMISSIONS.map((key) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-sm">{t(`perm.${key}`)}</span>
                    <Switch checked={!!selectedUser?.permissions?.[key]} onCheckedChange={(v) => handlePermissionsChange(key, v)} />
                  </div>
                ))}
              </div>
            </div>
            <Separator />
            <div>
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("perm.featureAccess")}</p>
              <div className="grid grid-cols-2 gap-y-3 gap-x-6">
                {FEATURE_PERMISSIONS.map((key) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-sm">{t(`perm.${key}`)}</span>
                    <Switch checked={!!selectedUser?.permissions?.[key]} onCheckedChange={(v) => handlePermissionsChange(key, v)} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPermsOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={savePermissions} disabled={updatePermissions.isPending}>
              {updatePermissions.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("staff.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("staff.deleteConfirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              {deleteUser.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("staff.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function StaffPage() {
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center">
          <UserCog className="w-5 h-5 text-violet-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("staff.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("staff.subtitle")}</p>
        </div>
      </div>

      <Tabs defaultValue="staff">
        <TabsList className="h-10">
          <TabsTrigger value="staff" className="gap-2">
            <Users className="w-3.5 h-3.5" />
            {t("staff.tabUsers")}
          </TabsTrigger>
          <TabsTrigger value="payroll" className="gap-2">
            <CreditCard className="w-3.5 h-3.5" />
            {t("nav.payroll")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="staff" className="mt-6 space-y-8">
          {/* Login users section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-violet-500" />
              <h2 className="text-base font-semibold">{t("staff.tabUsers")}</h2>
            </div>
            <LoginUsersTab />
          </div>

          <div className="border-t dark:border-slate-700" />

          {/* Employee records section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-500" />
              <h2 className="text-base font-semibold">{t("staff.tabEmployees")}</h2>
            </div>
            <EmployeeRecordsTab />
          </div>
        </TabsContent>

        <TabsContent value="payroll" className="mt-6">
          <PayrollTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
