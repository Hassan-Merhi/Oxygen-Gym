import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useRunAudit } from "@workspace/api-client-react";
import { useApi } from "@/lib/accounting-client";
import type { AuditReport, AuditSection } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ShieldCheck, ShieldAlert, PlayCircle, Printer, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, AlertTriangle, DollarSign, TrendingUp,
  TrendingDown, Package, Banknote, Activity, Database,
  Users, Receipt, Wallet, Clock, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useFmtDate } from "@/lib/useFmtDate";

function fmt$(n: number) {
  return `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SummaryCard({ icon: Icon, label, value, color = "text-primary", highlight }: {
  icon: React.ElementType; label: string; value: string; color?: string; highlight?: "good" | "bad" | "neutral";
}) {
  const bg = highlight === "good" ? "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800"
    : highlight === "bad" ? "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800"
    : "bg-card border-border/60";
  return (
    <Card className={cn("shadow-sm", bg)}>
      <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={cn("w-4 h-4 opacity-70", color)} />
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="text-xl font-bold font-mono">{value}</div>
      </CardContent>
    </Card>
  );
}

function SectionStatusBadge({ section, t }: { section: AuditSection; t: (k: string) => string }) {
  if (section.pass) {
    return <Badge className="bg-emerald-500 text-white border-0 text-xs">{t("audit.pass")}</Badge>;
  }
  const hasErrors = section.issues.some(i => i.severity === "error");
  if (hasErrors) {
    return <Badge className="bg-red-500 text-white border-0 text-xs">{t("audit.fail")}</Badge>;
  }
  return <Badge className="bg-amber-400 text-white border-0 text-xs">{t("audit.warning")}</Badge>;
}

function SectionCard({ section, t }: { section: AuditSection; t: (k: string) => string }) {
  const [open, setOpen] = useState(!section.pass);

  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <button
        className={cn(
          "w-full flex items-center justify-between px-4 py-3 text-left transition-colors",
          section.pass ? "bg-card hover:bg-muted/30" : "bg-red-50/50 dark:bg-red-900/10 hover:bg-red-50 dark:hover:bg-red-900/20"
        )}
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-3">
          {section.pass
            ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            : section.issues.every(i => i.severity === "warning")
              ? <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              : <XCircle className="w-4 h-4 text-red-500 shrink-0" />
          }
          <span className="font-medium text-sm">{section.name}</span>
          <SectionStatusBadge section={section} t={t} />
          {!section.pass && (
            <span className="text-xs text-muted-foreground">{section.issueCount} {t("audit.issues")}</span>
          )}
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && section.issues.length > 0 && (
        <div className="divide-y divide-border/50 bg-card">
          {section.issues.map((issue, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-2.5">
              {issue.severity === "error"
                ? <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                : <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
              }
              <span className="text-xs text-foreground">{issue.description}</span>
            </div>
          ))}
        </div>
      )}
      {open && section.issues.length === 0 && (
        <div className="px-4 py-3 text-xs text-muted-foreground bg-card flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> No issues found
        </div>
      )}
    </div>
  );
}

interface ChecklistItem {
  label: string;
  pass: boolean;
}

type LedgerHealth = { ok: boolean; checks: Array<{ key: string; ok: boolean; message: string; expected: number; actual: number; difference: number }> };

/** The ledger's own reconciliation: trial balance, journals, cash, inventory and supplier balances. */
function LedgerHealthCard({ t }: { t: (k: string) => string }) {
  const health = useApi<LedgerHealth>("/api/ledger/health");
  return (
    <section aria-labelledby="ledger-health">
      <h2 id="ledger-health" className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("audit.ledgerHealth")}</h2>
      <Card className="shadow-sm">
        <CardContent className="divide-y divide-border/40 px-4 py-2">
          {(health.data?.checks ?? []).map((check) => {
            const label = t(`health.${check.key}`);
            return (
              <div key={check.key} className="flex items-start gap-3 py-2.5 text-sm">
                {check.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{label === `health.${check.key}` ? check.key : label}</p>
                  <p className="text-xs text-muted-foreground">{check.message}</p>
                </div>
                {!check.ok && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmt$(check.expected)} / {check.actual < 0 ? "-" : ""}{fmt$(check.actual)}</span>}
              </div>
            );
          })}
          {health.isLoading && <Skeleton className="my-2 h-10" />}
        </CardContent>
      </Card>
    </section>
  );
}

function GoLiveChecklist({ items, t }: { items: ChecklistItem[]; t: (k: string) => string }) {
  const allPass = items.every(i => i.pass);
  return (
    <Card className={cn("shadow-sm border-2", allPass ? "border-emerald-400 dark:border-emerald-600" : "border-red-400 dark:border-red-600")}>
      <CardHeader className="px-4 pt-4 pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-indigo-500" />
          {t("audit.checklist.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-3">
            {item.pass
              ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              : <XCircle className="w-4 h-4 text-red-500 shrink-0" />
            }
            <span className={cn("text-sm", item.pass ? "text-foreground" : "text-red-600 dark:text-red-400 font-medium")}>{item.label}</span>
          </div>
        ))}
        <div className={cn(
          "mt-4 rounded-lg px-4 py-3 text-center font-bold text-sm",
          allPass ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
        )}>
          {allPass ? <>{t("audit.checklist.ready")} ✓</> : t("audit.checklist.issues")}
        </div>
      </CardContent>
    </Card>
  );
}


export default function AuditPage() {
  const { t } = useI18n();
  const { fmtDateTime } = useFmtDate();

  const { data, isLoading, isFetching, refetch } = useRunAudit({
    query: { enabled: false, staleTime: Infinity } as any,
  });


  const report = data as AuditReport | undefined;

  const sectionMap = report
    ? Object.fromEntries(report.sections.map(s => [s.name, s]))
    : {};

  const checklistItems: ChecklistItem[] = report
    ? [
        { label: t("audit.check.members"), pass: sectionMap["Membership Audit"]?.pass ?? false },
        { label: t("audit.check.payments"), pass: sectionMap["Sales Audit"]?.pass ?? false },
        { label: t("audit.check.vouchers"), pass: sectionMap["Data Integrity"]?.pass ?? false },
        { label: t("audit.check.inventory"), pass: sectionMap["Inventory Audit"]?.pass ?? false },
        { label: t("audit.check.sales"), pass: (sectionMap["Sales Audit"]?.pass ?? false) && (sectionMap["Void Sales Audit"]?.pass ?? false) },
        { label: t("audit.check.payroll"), pass: sectionMap["Payroll Audit"]?.pass ?? false },
        { label: t("audit.check.accounting"), pass: (sectionMap["Ledger Reconciliation"]?.pass ?? false) && (sectionMap["Accounting Entries Audit"]?.pass ?? false) },
        { label: t("audit.check.permissions"), pass: sectionMap["Permission Audit"]?.pass ?? false },
        { label: t("audit.check.currency"), pass: sectionMap["Multi-Currency Audit"]?.pass ?? false },
      ]
    : [];

  return (
    <div className="space-y-8 max-w-5xl print:space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-indigo-500" />
            {t("audit.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("audit.subtitle")}</p>
          {report && (
            <p className="text-xs text-muted-foreground mt-1">
              {t("audit.lastRun")}: {fmtDateTime(report.generatedAt)}
            </p>
          )}
        </div>
        <div className="flex gap-2 print:hidden">
          {report && (
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="w-4 h-4 me-2" />
              {t("audit.print")}
            </Button>
          )}
          <Button onClick={() => refetch()} disabled={isLoading || isFetching} size="sm">
            <PlayCircle className="w-4 h-4 me-2" />
            {(isLoading || isFetching) ? t("audit.running") : t("audit.runAudit")}
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {!report && !isLoading && !isFetching && (
        <Card className="border-dashed border-2 shadow-none">
          <CardContent className="flex flex-col items-center justify-center py-20 gap-4">
            <ShieldCheck className="w-14 h-14 text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm text-center max-w-sm">{t("audit.empty")}</p>
            <Button onClick={() => refetch()}>
              <PlayCircle className="w-4 h-4 me-2" />
              {t("audit.runAudit")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {(isLoading || isFetching) && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
          </div>
          <div className="space-y-2">
            {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
          </div>
        </div>
      )}

      {/* Results */}
      {report && !isFetching && (
        <>
          {/* Issues summary banner */}
          <div className={cn(
            "rounded-xl px-5 py-4 flex items-center gap-4 border",
            report.totalIssues === 0
              ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"
              : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
          )}>
            {report.totalIssues === 0
              ? <ShieldCheck className="w-8 h-8 text-emerald-500 shrink-0" />
              : <ShieldAlert className="w-8 h-8 text-red-500 shrink-0" />
            }
            <div>
              <p className={cn("font-bold text-base", report.totalIssues === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
                {report.totalIssues === 0 ? t("audit.checklist.ready") : `${report.totalIssues} ${t("audit.totalIssues")}`}
              </p>
              <p className="text-xs text-muted-foreground">{report.sections.filter(s => s.pass).length}/{report.sections.length} {t("audit.sectionsPassing")}</p>
            </div>
          </div>

          {/* ── Accounting Summary ── */}
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("audit.accounting.title")}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <SummaryCard icon={DollarSign} label={t("audit.accounting.revenue")} value={fmt$(report.accounting.totalRevenue)} color="text-indigo-500" highlight="neutral" />
              <SummaryCard icon={TrendingDown} label={t("audit.accounting.expenses")} value={fmt$(report.accounting.totalExpenses)} color="text-rose-500" highlight="neutral" />
              <SummaryCard icon={Banknote} label={t("audit.accounting.payroll")} value={fmt$(report.accounting.totalPayroll)} color="text-violet-500" highlight="neutral" />
              <SummaryCard icon={Package} label={t("audit.accounting.inventoryCost")} value={fmt$(report.accounting.totalInventoryCost)} color="text-orange-500" highlight="neutral" />
              <SummaryCard icon={TrendingUp} label={t("audit.accounting.profit")}
                value={(report.accounting.totalProfit < 0 ? "-" : "") + fmt$(report.accounting.totalProfit)}
                color={report.accounting.totalProfit >= 0 ? "text-emerald-500" : "text-red-500"}
                highlight={report.accounting.totalProfit >= 0 ? "good" : "bad"}
              />
              <SummaryCard icon={Wallet} label={t("audit.accounting.cashUsd")} value={fmt$(report.accounting.cashBalanceUsd)} color="text-cyan-500" highlight={report.accounting.cashBalanceUsd >= 0 ? "good" : "bad"} />
              <SummaryCard icon={Wallet} label={t("audit.accounting.cashCdf")}
                value={`FC ${Math.abs(report.accounting.cashBalanceCdf).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
                color="text-teal-500" highlight={report.accounting.cashBalanceCdf >= 0 ? "good" : "bad"}
              />
              <SummaryCard icon={report.totalIssues === 0 ? ShieldCheck : ShieldAlert}
                label={t("audit.totalIssues")} value={String(report.totalIssues)}
                color={report.totalIssues === 0 ? "text-emerald-500" : "text-red-500"}
                highlight={report.totalIssues === 0 ? "good" : "bad"}
              />
            </div>
          </section>

          {/* ── Audit Sections ── */}
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Audit Sections</h2>
            <div className="space-y-2">
              {report.sections.map((section) => (
                <SectionCard key={section.name} section={section} t={t} />
              ))}
            </div>
          </section>

          {/* ── Inventory Table ── */}
          {report.inventoryRows.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("audit.inventory.title")}</h2>
              <Card className="shadow-sm overflow-hidden">
                <div className="max-h-80 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-xs">{t("audit.inventory.product")}</TableHead>
                        <TableHead className="text-xs text-right">{t("audit.inventory.expected")}</TableHead>
                        <TableHead className="text-xs text-right">{t("audit.inventory.actual")}</TableHead>
                        <TableHead className="text-xs text-right">{t("audit.inventory.diff")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(report.inventoryRows as any[]).map((row) => {
                        const diff = Number(row.diff);
                        return (
                          <TableRow key={row.id} className={diff !== 0 ? "bg-red-50/50 dark:bg-red-900/10" : ""}>
                            <TableCell className="text-sm">
                              <div className="font-medium">{row.name}</div>
                              {row.productNumber && <div className="text-xs text-muted-foreground font-mono">{row.productNumber}</div>}
                            </TableCell>
                            <TableCell className="text-sm text-right font-mono">{row.expected}</TableCell>
                            <TableCell className="text-sm text-right font-mono">{row.actual}</TableCell>
                            <TableCell className={cn("text-sm text-right font-mono font-bold", diff > 0 ? "text-amber-600" : diff < 0 ? "text-red-600" : "text-emerald-600")}>
                              {diff > 0 ? `+${diff}` : diff}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </section>
          )}

          {/* ── System Health ── */}
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("audit.health.title")}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <SummaryCard icon={Users} label={t("audit.records.members")} value={String(report.systemHealth.records.members)} color="text-blue-500" />
              <SummaryCard icon={Users} label={t("audit.records.staff")} value={String(report.systemHealth.records.staff)} color="text-indigo-500" />
              <SummaryCard icon={Package} label={t("audit.records.products")} value={String(report.systemHealth.records.products)} color="text-orange-500" />
              <SummaryCard icon={Receipt} label={t("audit.records.sales")} value={String(report.systemHealth.records.sales)} color="text-cyan-500" />
              <SummaryCard icon={DollarSign} label={t("audit.records.payments")} value={String(report.systemHealth.records.payments)} color="text-emerald-500" />
              <SummaryCard icon={Banknote} label={t("audit.records.payroll")} value={String(report.systemHealth.records.payroll)} color="text-violet-500" />
              <SummaryCard icon={Activity} label={t("audit.records.checkIns")} value={String(report.systemHealth.records.checkIns)} color="text-rose-500" />
              <SummaryCard icon={Database} label={t("audit.health.dbSize")} value={report.systemHealth.dbSize} color="text-slate-500" />
            </div>

            {/* DB response */}
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4" />
              {t("audit.health.dbResponse")}: <span className={cn("font-medium", report.systemHealth.dbResponseMs < 100 ? "text-emerald-500" : report.systemHealth.dbResponseMs < 500 ? "text-amber-500" : "text-red-500")}>
                {report.systemHealth.dbResponseMs}ms
              </span>
            </div>

            {/* Table sizes */}
            {report.systemHealth.tableSizes.length > 0 && (
              <Card className="mt-4 shadow-sm overflow-hidden">
                <CardHeader className="px-4 py-3 border-b border-border">
                  <CardTitle className="text-xs font-medium text-muted-foreground">{t("audit.health.tableSizes")}</CardTitle>
                </CardHeader>
                <div className="divide-y divide-border/40">
                  {(report.systemHealth.tableSizes as any[]).map((t) => (
                    <div key={t.name} className="flex items-center justify-between px-4 py-2 text-sm">
                      <span className="font-mono text-xs text-muted-foreground">{t.name}</span>
                      <span className="font-medium text-xs">{t.size}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </section>

          {/* ── Go-Live Checklist ── */}
          <GoLiveChecklist items={checklistItems} t={t} />

          {/* ── Ledger health ── */}
          <LedgerHealthCard t={t} />
        </>
      )}
    </div>
  );
}
