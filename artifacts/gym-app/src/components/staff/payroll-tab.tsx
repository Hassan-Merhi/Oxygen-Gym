import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListStaffEmployees, getListStaffEmployeesQueryKey,
  useListPayroll, useCreatePayroll, useMarkPayrollPaid, useCancelPayroll, getListPayrollQueryKey,
  useGetCommissionSummary, getGetCommissionSummaryQueryKey,
} from "@workspace/api-client-react";
import { CheckCircle, Loader2, Play, ReceiptText, Search, XCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fmt as format } from "@/lib/i18n-format";
import { useGetMe } from "@/hooks/use-me";
import { useToast } from "@/hooks/use-toast";
import { canApproveCorrections } from "@/lib/permissions";
import { PayrollStatusBadge } from "@/lib/status-badge";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Avatar, fmtMoney, fmtNumber, fmtPDate } from "./staff-utils";

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

type AmountField = "salary" | "bonus" | "advance" | "extraDeduction";

export function PayrollTab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const me = useGetMe();
  const canManage = me?.role === "admin" || me?.permissions?.managePayroll;
  // Cancelling a payroll that was already paid reverses a posted cash payment.
  const canReversePaid = canApproveCorrections(me);

  const [runPeriodStart, setRunPeriodStart] = useState("");
  const [runPeriodEnd, setRunPeriodEnd] = useState("");
  const [runRows, setRunRows] = useState<RunRow[]>([]);
  const [runLoading, setRunLoading] = useState(false);
  const [notes, setNotes] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [payId, setPayId] = useState<number | null>(null);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const { data: empData, isLoading: empLoading } = useListStaffEmployees({ limit: "200", status: "active" } as any, {
    query: { queryKey: getListStaffEmployeesQueryKey({ limit: "200", status: "active" } as any) }
  });
  const employees = empData?.items ?? [];

  const { data: commissionSummary = [] } = useGetCommissionSummary({
    query: { queryKey: getGetCommissionSummaryQueryKey() }
  });
  const commissionByEmpId = Object.fromEntries(
    commissionSummary.map(c => [c.staffEmployeeId, c])
  );

  const historyParams = { search: search || undefined, status: statusFilter !== "all" ? statusFilter : undefined, limit: "50" } as any;
  const { data: histData, isLoading: histLoading } = useListPayroll(historyParams, {
    query: { queryKey: getListPayrollQueryKey(historyParams) }
  });
  const records = histData?.items ?? [];

  const createPayroll = useCreatePayroll();
  const markPaid = useMarkPayrollPaid();
  const cancelPayroll = useCancelPayroll();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/payroll"] });

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      toast({ title: t("payroll.run.needDates"), variant: "destructive" });
      return;
    }
    const selected = runRows.filter(r => r.checked);
    if (selected.length === 0) {
      toast({ title: t("payroll.run.needSelection"), variant: "destructive" });
      return;
    }
    setRunLoading(true);
    let ok = 0;
    let fail = 0;
    for (const row of selected) {
      try {
        await new Promise<void>((resolve) => {
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
      title: t("payroll.run.done"),
      description: fail > 0 ? format(t("payroll.run.resultWithFailures"), { ok, fail }) : format(t("payroll.run.result"), { ok }),
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
    cancelPayroll.mutate({ id: cancelId, data: { reason: cancelReason || t("payroll.status.cancelled") } }, {
      onSuccess: () => { invalidate(); setCancelId(null); setCancelReason(""); toast({ title: t("payroll.cancelled") }); },
      onError: () => toast({ title: t("common.error"), variant: "destructive" }),
    });
  };

  const amountInput = (row: RunRow, field: AmountField, label: string, tone?: string) => (
    <Input
      type="number" inputMode="decimal" min="0" step="0.01"
      value={row[field]}
      onChange={e => updateRow(row.empId, field, parseFloat(e.target.value) || 0)}
      className={cn("text-end text-sm tabular-nums xl:h-8", tone)}
      aria-label={`${label} — ${row.name}`}
    />
  );

  const currencySelect = (row: RunRow) => (
    <Select value={row.currency} onValueChange={v => updateRow(row.empId, "currency", v)}>
      <SelectTrigger className="text-xs xl:h-8 xl:w-20" aria-label={`${t("payroll.currency")} — ${row.name}`}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="USD">USD</SelectItem>
        <SelectItem value="CDF">CDF</SelectItem>
      </SelectContent>
    </Select>
  );

  const commissionCell = (empId: number) => {
    const empCommission = commissionByEmpId[empId];
    return empCommission && empCommission.pendingCount > 0 ? (
      <div className="text-end">
        <p className="text-sm font-semibold tabular-nums text-violet-700 dark:text-violet-400">+{fmtNumber(empCommission.pendingAmount)}</p>
        <p className="text-xs text-muted-foreground">{format(t("payroll.commissionPending"), { count: empCommission.pendingCount })}</p>
      </div>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    );
  };

  const recordActions = (r: any) => (
    <div className="flex justify-end gap-1">
      {r.status === "draft" && (
        <>
          <Button variant="ghost" size="icon" title={t("payroll.markPaid")} aria-label={`${t("payroll.markPaid")} — ${r.staffName}`} onClick={() => setPayId(r.id)}>
            <CheckCircle className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" title={t("payroll.cancel")} aria-label={`${t("payroll.cancelTitle")} — ${r.staffName}`} onClick={() => { setCancelId(r.id); setCancelReason(""); }}>
            <XCircle className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
          </Button>
        </>
      )}
      {r.status === "paid" && canReversePaid && (
        <Button variant="ghost" size="icon" title={t("payroll.cancel")} aria-label={`${t("payroll.cancelTitle")} — ${r.staffName}`} onClick={() => { setCancelId(r.id); setCancelReason(""); }}>
          <XCircle className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-8">
      {/* ── Payroll Run ──────────────────────────────────────────────────────── */}
      {canManage && (
        <section className="overflow-hidden rounded-xl border bg-card shadow-sm" aria-labelledby="payroll-run-title">
          <div className="flex items-center gap-3 border-b bg-gradient-to-r from-violet-500/5 to-blue-500/5 px-4 py-4 sm:px-6 rtl:bg-gradient-to-l">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10">
              <Play className="h-4 w-4 text-violet-700 dark:text-violet-400 rtl:-scale-x-100" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id="payroll-run-title" className="text-base font-semibold">{t("payroll.run.title")}</h2>
              <p className="text-xs text-muted-foreground">{t("payroll.run.subtitle")}</p>
            </div>
          </div>

          <div className="space-y-5 p-4 sm:p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="payroll-start">{t("payroll.periodStart")}</Label>
                <Input id="payroll-start" type="date" value={runPeriodStart} onChange={e => setRunPeriodStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payroll-end">{t("payroll.periodEnd")}</Label>
                <Input id="payroll-end" type="date" value={runPeriodEnd} onChange={e => setRunPeriodEnd(e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="payroll-notes">{t("payroll.notes")} <span className="font-normal text-muted-foreground">({t("common.optional")})</span></Label>
                <Input id="payroll-notes" placeholder={t("payroll.run.notesPlaceholder")} value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </div>

            {empLoading ? (
              <div className="space-y-2" aria-busy="true">{[0, 1].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
            ) : employees.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("payroll.run.noEmployees")}</p>
            ) : (
              <>
                {/* Cards below xl: the run grid has 9 columns of inputs. */}
                <div className="space-y-3 xl:hidden">
                  <label className="flex min-h-11 w-fit items-center gap-3 text-sm font-medium">
                    <Checkbox checked={allChecked} onCheckedChange={toggleAll} />
                    {t("payroll.run.selectAll")}
                  </label>
                  <ul className="grid gap-3 md:grid-cols-2">
                    {runRows.map(row => {
                      const net = netPay(row);
                      return (
                        <li key={row.empId} className={cn("rounded-xl border p-3", !row.checked && "opacity-50")}>
                          <label className="flex min-h-11 items-center gap-3">
                            <Checkbox checked={row.checked} onCheckedChange={() => toggleRow(row.empId)} aria-label={format(t("payroll.run.include"), { name: row.name })} />
                            <Avatar name={row.name} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{row.name}</span>
                              {row.jobTitle && <span className="block truncate text-xs text-muted-foreground">{row.jobTitle}</span>}
                            </span>
                          </label>
                          <div className="mt-3 grid grid-cols-2 gap-3">
                            <div className="space-y-1"><p className="text-xs text-muted-foreground">{t("payroll.baseSalary")}</p>{amountInput(row, "salary", t("payroll.baseSalary"))}</div>
                            <div className="space-y-1"><p className="text-xs text-muted-foreground">{t("payroll.bonus")}</p>{amountInput(row, "bonus", t("payroll.bonus"), "text-emerald-700 dark:text-emerald-400")}</div>
                            <div className="space-y-1"><p className="text-xs text-muted-foreground">{t("payroll.run.advance")}</p>{amountInput(row, "advance", t("payroll.run.advance"), "text-amber-700 dark:text-amber-400")}</div>
                            <div className="space-y-1"><p className="text-xs text-muted-foreground">{t("payroll.run.extraDeduction")}</p>{amountInput(row, "extraDeduction", t("payroll.run.extraDeduction"), "text-red-700 dark:text-red-400")}</div>
                            <div className="space-y-1"><p className="text-xs text-muted-foreground">{t("payroll.currency")}</p>{currencySelect(row)}</div>
                            <div className="space-y-1 text-end"><p className="text-xs text-muted-foreground">{t("payroll.run.commissions")}</p>{commissionCell(row.empId)}</div>
                          </div>
                          <div className="mt-3 flex items-center justify-between border-t pt-2 text-sm">
                            <span className="text-muted-foreground">{t("payroll.netPay")}</span>
                            <span className={cn("font-semibold tabular-nums", net < 0 && "text-red-700 dark:text-red-400")}>{fmtNumber(net)} {row.currency}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="hidden overflow-hidden rounded-lg border xl:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="w-10">
                          <Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label={t("payroll.run.selectAll")} />
                        </TableHead>
                        <TableHead>{t("payroll.employee")}</TableHead>
                        <TableHead className="text-end">{t("payroll.baseSalary")}</TableHead>
                        <TableHead className="text-end">{t("payroll.bonus")}</TableHead>
                        <TableHead className="text-end text-violet-700 dark:text-violet-400">
                          {t("payroll.run.commissions")}
                          <span className="block text-xs font-normal normal-case text-muted-foreground">({t("payroll.run.pendingHint")})</span>
                        </TableHead>
                        <TableHead className="text-end">
                          <span className="text-amber-700 dark:text-amber-400">{t("payroll.run.advance")}</span>
                          <span className="block text-xs font-normal normal-case text-muted-foreground">({t("payroll.run.advanceHint")})</span>
                        </TableHead>
                        <TableHead className="text-end">
                          <span className="text-red-700 dark:text-red-400">{t("payroll.deduction")}</span>
                          <span className="block text-xs font-normal normal-case text-muted-foreground">({t("payroll.run.extraHint")})</span>
                        </TableHead>
                        <TableHead className="text-end">{t("payroll.netPay")}</TableHead>
                        <TableHead className="w-24">{t("payroll.currency")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runRows.map(row => {
                        const net = netPay(row);
                        return (
                          <TableRow key={row.empId} className={cn("hover:bg-muted/20", !row.checked && "opacity-40")}>
                            <TableCell>
                              <Checkbox checked={row.checked} onCheckedChange={() => toggleRow(row.empId)} aria-label={format(t("payroll.run.include"), { name: row.name })} />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2.5">
                                <Avatar name={row.name} />
                                <div>
                                  <p className="text-sm font-medium">{row.name}</p>
                                  {row.jobTitle && <p className="text-xs text-muted-foreground">{row.jobTitle}</p>}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell><div className="ms-auto w-28">{amountInput(row, "salary", t("payroll.baseSalary"))}</div></TableCell>
                            <TableCell><div className="ms-auto w-24">{amountInput(row, "bonus", t("payroll.bonus"), "text-emerald-700 dark:text-emerald-400")}</div></TableCell>
                            <TableCell>{commissionCell(row.empId)}</TableCell>
                            <TableCell><div className="ms-auto w-24">{amountInput(row, "advance", t("payroll.run.advance"), "text-amber-700 dark:text-amber-400")}</div></TableCell>
                            <TableCell><div className="ms-auto w-24">{amountInput(row, "extraDeduction", t("payroll.run.extraDeduction"), "text-red-700 dark:text-red-400")}</div></TableCell>
                            <TableCell className={cn("text-end text-sm font-semibold tabular-nums", net < 0 && "text-red-700 dark:text-red-400")}>{fmtNumber(net)}</TableCell>
                            <TableCell>{currencySelect(row)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
                  <p className="text-sm text-muted-foreground">
                    {format(t("payroll.run.selected"), { count: selectedCount, total: runRows.length })}
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
                    <p className="text-sm">
                      <span className="me-1.5 text-muted-foreground">{t("payroll.run.totalPayout")}</span>
                      <span className="text-base font-bold tabular-nums">{fmtNumber(totalNet)}</span>
                      <span className="ms-1 text-xs text-muted-foreground">({t("payroll.run.mixedCurrencies")})</span>
                    </p>
                    <Button
                      onClick={handleRunPayroll}
                      disabled={runLoading || !someChecked}
                      className="gap-2 bg-violet-600 text-white hover:bg-violet-700"
                    >
                      {runLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />}
                      {format(t("payroll.run.button"), { count: selectedCount })}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* ── Payroll History ───────────────────────────────────────────────────── */}
      <section className="space-y-4" aria-labelledby="payroll-history-title">
        <h2 id="payroll-history-title" className="text-base font-semibold">{t("payroll.history")}</h2>
        <div className="grid grid-cols-1 gap-3 sm:flex sm:items-center">
          <div className="relative w-full sm:max-w-xs">
            <Label htmlFor="payroll-search" className="sr-only">{t("payroll.search")}</Label>
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="payroll-search" type="search" placeholder={t("common.search")} value={search} onChange={e => setSearch(e.target.value)} className="ps-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-44" aria-label={t("payroll.filterStatus")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("payroll.allStatuses")}</SelectItem>
              <SelectItem value="draft">{t("payroll.status.draft")}</SelectItem>
              <SelectItem value="paid">{t("payroll.status.paid")}</SelectItem>
              <SelectItem value="cancelled">{t("payroll.status.cancelled")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {histLoading ? (
          <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <ReceiptText className="h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium">{t("payroll.empty")}</p>
          </div>
        ) : (
          <>
            {/* Cards below xl */}
            <ul className="grid gap-3 md:grid-cols-2 xl:hidden">
              {records.map(r => (
                <li key={r.id} className="rounded-xl border bg-card p-3 shadow-sm">
                  <div className="flex items-center gap-3">
                    <Avatar name={r.staffName as string} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.staffName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        <span className="font-mono">{r.payrollNumber ?? "-"}</span> · {r.periodStart ? `${fmtPDate(r.periodStart)} – ${fmtPDate(r.periodEnd)}` : "-"}
                      </p>
                    </div>
                    <PayrollStatusBadge status={r.status} label={t(`payroll.status.${r.status}`)} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">{t("payroll.table.base")}</dt><dd className="text-end tabular-nums">{fmtMoney(r.baseSalary, r.currency)}</dd>
                    <dt className="text-muted-foreground">{t("payroll.bonus")}</dt><dd className="text-end tabular-nums text-emerald-700 dark:text-emerald-400">+{fmtMoney(r.bonus, r.currency)}</dd>
                    {(r as any).commissionBonus > 0 && <><dt className="text-muted-foreground">{t("payroll.commission")}</dt><dd className="text-end tabular-nums text-violet-700 dark:text-violet-400">+{fmtMoney((r as any).commissionBonus, r.currency)}</dd></>}
                    <dt className="text-muted-foreground">{t("payroll.deduction")}</dt><dd className="text-end tabular-nums text-red-700 dark:text-red-400">-{fmtMoney(r.deduction, r.currency)}</dd>
                  </dl>
                  <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
                    <p className="text-sm"><span className="text-muted-foreground">{t("payroll.netPay")}: </span><span className="font-semibold tabular-nums">{fmtMoney(r.netPay, r.currency)}</span></p>
                    {canManage && recordActions(r)}
                  </div>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-hidden rounded-xl border bg-card shadow-sm xl:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>{t("payroll.table.number")}</TableHead>
                    <TableHead>{t("payroll.table.employee")}</TableHead>
                    <TableHead>{t("payroll.table.period")}</TableHead>
                    <TableHead className="text-end">{t("payroll.table.base")}</TableHead>
                    <TableHead className="text-end">{t("payroll.table.bonus")}</TableHead>
                    <TableHead className="text-end text-violet-700 dark:text-violet-400">{t("payroll.commission")}</TableHead>
                    <TableHead className="text-end">{t("payroll.table.deduction")}</TableHead>
                    <TableHead className="text-end">{t("payroll.table.net")}</TableHead>
                    <TableHead>{t("payroll.table.status")}</TableHead>
                    {canManage && <TableHead className="text-end">{t("payroll.table.actions")}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map(r => (
                    <TableRow key={r.id} className="hover:bg-muted/20">
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.payrollNumber ?? "-"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={r.staffName as string} size="sm" />
                          <span className="text-sm font-medium">{r.staffName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {r.periodStart ? `${fmtPDate(r.periodStart)} – ${fmtPDate(r.periodEnd)}` : "-"}
                      </TableCell>
                      <TableCell className="text-end text-sm tabular-nums">{fmtMoney(r.baseSalary, r.currency)}</TableCell>
                      <TableCell className="text-end text-sm tabular-nums text-emerald-700 dark:text-emerald-400">+{fmtMoney(r.bonus, r.currency)}</TableCell>
                      <TableCell className="text-end text-sm tabular-nums text-violet-700 dark:text-violet-400">
                        {(r as any).commissionBonus > 0 ? `+${fmtMoney((r as any).commissionBonus, r.currency)}` : "—"}
                      </TableCell>
                      <TableCell className="text-end text-sm tabular-nums text-red-700 dark:text-red-400">-{fmtMoney(r.deduction, r.currency)}</TableCell>
                      <TableCell className="text-end font-semibold tabular-nums">{fmtMoney(r.netPay, r.currency)}</TableCell>
                      <TableCell><PayrollStatusBadge status={r.status} label={t(`payroll.status.${r.status}`)} /></TableCell>
                      {canManage && <TableCell>{recordActions(r)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>

      <AlertDialog open={!!payId} onOpenChange={o => !o && setPayId(null)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("payroll.markPaid")}</AlertDialogTitle>
            <AlertDialogDescription>{t("payroll.confirmPay")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleMarkPaid} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {markPaid.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-label={t("common.loading")} /> : t("payroll.markPaid")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!cancelId} onOpenChange={o => !o && setCancelId(null)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("payroll.cancelTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("payroll.confirmCancel")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="payroll-cancel-reason" className="sr-only">{t("payroll.cancelReason")}</Label>
            <Input id="payroll-cancel-reason" placeholder={t("payroll.cancelReason")} value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} className="bg-destructive text-destructive-foreground">
              {cancelPayroll.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-label={t("common.loading")} /> : t("payroll.cancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
