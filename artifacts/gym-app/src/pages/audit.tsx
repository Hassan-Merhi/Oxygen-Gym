import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useGetMe } from "@/hooks/use-me";
import {
  useRunAudit,
  useFixAuditInventory,
  useFixAuditDashboard,
  useFixAuditAccounts,
  useGetOperationalRollout,
  useAcknowledgeOperationalRolloutWarnings,
  useAdvanceOperationalRollout,
  useRollbackOperationalRollout,
} from "@workspace/api-client-react";
import type { AuditReport, AuditSection, OperationalRollout } from "@workspace/api-client-react";
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
  Users, Receipt, Wallet, Wrench, Clock, AlertCircle,
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

function OperationalRolloutPanel({
  status,
  loading,
  statusError,
  onRefresh,
}: {
  status?: OperationalRollout;
  loading: boolean;
  statusError: boolean;
  onRefresh: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const acknowledge = useAcknowledgeOperationalRolloutWarnings();
  const advance = useAdvanceOperationalRollout();
  const rollback = useRollbackOperationalRollout();

  const busy = acknowledge.isPending || advance.isPending || rollback.isPending;
  const unacknowledged = status?.readiness.unacknowledgedWarningKeys ?? [];
  const nextStage = status?.nextStage;

  const runAction = (action: () => void) => {
    setError(null);
    action();
  };

  const acknowledgeWarnings = () =>
    runAction(() => {
      acknowledge.mutate(
        { data: { warningKeys: unacknowledged } },
        {
          onSuccess: onRefresh,
          onError: () =>
            setError(
              "Warnings could not be acknowledged. Refresh the readiness report and try again.",
            ),
        },
      );
    });

  const advanceRollout = () => {
    if (nextStage !== "canary" && nextStage !== "general") return;
    runAction(() => {
      advance.mutate(
        { data: { targetStage: nextStage } },
        {
          onSuccess: onRefresh,
          onError: () =>
            setError(
              "The rollout is still gated. Resolve blockers and acknowledge warnings before promoting.",
            ),
        },
      );
    });
  };

  const rollbackRollout = () => {
    if (!status || status.stage === "internal") return;
    const targetStage = status.stage === "general" ? "canary" : "internal";
    const reason = window
      .prompt(`Why are you rolling back to ${targetStage}?`)
      ?.trim();
    if (!reason) return;
    runAction(() => {
      rollback.mutate(
        { data: { targetStage, reason } },
        {
          onSuccess: onRefresh,
          onError: () =>
            setError(
              "Rollback failed. Refresh the rollout status and try again.",
            ),
        },
      );
    });
  };

  return (
    <Card className="shadow-sm border-indigo-200 dark:border-indigo-900/60">
      <CardHeader className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-500" />
              Operational rollout
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Promote internal → canary → general only after the readiness gates
              pass.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={onRefresh}
            disabled={loading || busy}
          >
            <Activity className="w-3 h-3 mr-1" /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {statusError ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            Rollout status is unavailable. Access remains fail-closed until the server can read the control-plane state.
          </p>
        ) : loading || !status ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {["internal", "canary", "general"].map((stage) => {
                const active = stage === status.stage;
                const reached =
                  ["internal", "canary", "general"].indexOf(stage) <=
                  ["internal", "canary", "general"].indexOf(status.stage);
                return (
                  <div
                    key={stage}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-center text-xs capitalize",
                      active
                        ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                        : reached
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
                          : "border-border/60 text-muted-foreground",
                    )}
                  >
                    <div className="font-semibold">{stage}</div>
                    <div className="mt-0.5 text-[10px]">
                      {active ? "current" : reached ? "passed" : "pending"}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs",
                  status.readiness.blockerCount === 0
                    ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-800"
                    : "border-red-200 bg-red-50/70 dark:border-red-800",
                )}
              >
                <div className="flex items-center gap-2 font-semibold">
                  {status.readiness.blockerCount === 0 ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-red-500" />
                  )}
                  {status.readiness.blockerCount} readiness blockers
                </div>
                {status.readiness.blockers.length > 0 && (
                  <ul className="mt-2 space-y-1 text-red-700 dark:text-red-300">
                    {status.readiness.blockers.map((issue) => (
                      <li key={issue.key}>• {issue.description}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs",
                  unacknowledged.length === 0
                    ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-800"
                    : "border-amber-200 bg-amber-50/70 dark:border-amber-800",
                )}
              >
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle
                    className={cn(
                      "w-3.5 h-3.5",
                      unacknowledged.length === 0
                        ? "text-emerald-500"
                        : "text-amber-500",
                    )}
                  />
                  {status.readiness.warningCount} readiness warnings
                </div>
                {unacknowledged.length > 0 && (
                  <ul className="mt-2 space-y-1 text-amber-700 dark:text-amber-300">
                    {status.readiness.warnings
                      .filter((issue) => unacknowledged.includes(issue.key))
                      .map((issue) => (
                        <li key={issue.key}>• {issue.description}</li>
                      ))}
                  </ul>
                )}
              </div>
            </div>

            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {unacknowledged.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={acknowledgeWarnings}
                  disabled={busy}
                >
                  <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Acknowledge
                  warnings
                </Button>
              )}
              {nextStage && (
                <Button
                  size="sm"
                  onClick={advanceRollout}
                  disabled={busy || !status.canAdvance}
                >
                  <TrendingUp className="w-3.5 h-3.5 mr-1" /> Promote to{" "}
                  {nextStage}
                </Button>
              )}
              {status.stage !== "internal" && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={rollbackRollout}
                  disabled={busy}
                >
                  <TrendingDown className="w-3.5 h-3.5 mr-1" /> Roll back
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {status.stage === "general"
                ? "General access is enabled. Use rollback if monitoring identifies a regression."
                : status.canAdvance
                  ? `Ready to promote to ${nextStage}.`
                  : "Promotion is disabled until the listed readiness gates are satisfied."}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FixTool({ label, running, done, onRun, warning }: {
  label: string; running: boolean; done: boolean; onRun: () => void; warning: string;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border/40 last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {confirm && <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{warning}</p>}
      </div>
      <div className="flex gap-2 shrink-0">
        {done ? (
          <Badge className="bg-emerald-500 text-white border-0 text-xs">Done ✓</Badge>
        ) : confirm ? (
          <>
            <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={running}
              onClick={() => { onRun(); setConfirm(false); }}>
              {running ? "Running…" : "Confirm"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirm(false)}>Cancel</Button>
          </>
        ) : (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirm(true)}>
            <Wrench className="w-3 h-3 mr-1" /> Run
          </Button>
        )}
      </div>
    </div>
  );
}

export default function AuditPage() {
  const { t } = useI18n();
  const { fmtDateTime } = useFmtDate();
  const me = useGetMe();
  const isAdmin = me?.role === "admin";

  const { data, isLoading, isFetching, refetch } = useRunAudit({
    query: { enabled: false, staleTime: Infinity } as any,
  });
  const rollout = useGetOperationalRollout({
    query: { queryKey: ["getOperationalRollout"], enabled: isAdmin, staleTime: 0 },
  });

  const refreshRollout = () => {
    void rollout.refetch();
    void refetch();
  };

  const fixInventory = useFixAuditInventory();
  const fixDashboard = useFixAuditDashboard();
  const fixAccounts = useFixAuditAccounts();

  const report = data as AuditReport | undefined;

  const sectionMap = report
    ? Object.fromEntries(report.sections.map(s => [s.name, s]))
    : {};

  const checklistItems: ChecklistItem[] = report
    ? [
        { label: "Members module validated", pass: sectionMap["Membership Audit"]?.pass ?? false },
        { label: "Payments validated", pass: sectionMap["Sales Audit"]?.pass ?? false },
        { label: "Vouchers validated", pass: sectionMap["Data Integrity"]?.pass ?? false },
        { label: "Inventory validated", pass: sectionMap["Inventory Audit"]?.pass ?? false },
        { label: "Sales validated", pass: (sectionMap["Sales Audit"]?.pass ?? false) && (sectionMap["Void Sales Audit"]?.pass ?? false) },
        { label: "Payroll validated", pass: sectionMap["Payroll Audit"]?.pass ?? false },
        { label: "Accounting reconciled", pass: sectionMap["Cash Reconciliation"]?.pass ?? false },
        { label: "Permissions validated", pass: sectionMap["Permission Audit"]?.pass ?? false },
        { label: "Multi-currency validated", pass: sectionMap["Multi-Currency Audit"]?.pass ?? false },
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
              <Printer className="w-4 h-4 mr-2" />
              {t("audit.print")}
            </Button>
          )}
          <Button onClick={() => refetch()} disabled={isLoading || isFetching} size="sm">
            <PlayCircle className="w-4 h-4 mr-2" />
            {(isLoading || isFetching) ? t("audit.running") : t("audit.runAudit")}
          </Button>
        </div>
      </div>

      {isAdmin && (
        <OperationalRolloutPanel
          status={rollout.data}
          loading={rollout.isLoading || rollout.isFetching}
          statusError={rollout.isError}
          onRefresh={refreshRollout}
        />
      )}

      {/* Empty state */}
      {!report && !isLoading && !isFetching && (
        <Card className="border-dashed border-2 shadow-none">
          <CardContent className="flex flex-col items-center justify-center py-20 gap-4">
            <ShieldCheck className="w-14 h-14 text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm text-center max-w-sm">{t("audit.empty")}</p>
            <Button onClick={() => refetch()}>
              <PlayCircle className="w-4 h-4 mr-2" />
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
              <p className="text-xs text-muted-foreground">{report.sections.filter(s => s.pass).length}/{report.sections.length} sections passing</p>
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
              <SummaryCard icon={Users} label="Members" value={String(report.systemHealth.records.members)} color="text-blue-500" />
              <SummaryCard icon={Users} label="Staff" value={String(report.systemHealth.records.staff)} color="text-indigo-500" />
              <SummaryCard icon={Package} label="Products" value={String(report.systemHealth.records.products)} color="text-orange-500" />
              <SummaryCard icon={Receipt} label="Sales" value={String(report.systemHealth.records.sales)} color="text-cyan-500" />
              <SummaryCard icon={DollarSign} label="Payments" value={String(report.systemHealth.records.payments)} color="text-emerald-500" />
              <SummaryCard icon={Banknote} label="Payroll" value={String(report.systemHealth.records.payroll)} color="text-violet-500" />
              <SummaryCard icon={Activity} label="Check-ins" value={String(report.systemHealth.records.checkIns)} color="text-rose-500" />
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

          {/* ── Auto-Fix Tools (admin only) ── */}
          {isAdmin && (
            <section className="print:hidden">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                {t("audit.fixes.title")}
                <Badge variant="outline" className="text-xs">{t("audit.fixes.adminOnly")}</Badge>
              </h2>
              <Card className="shadow-sm border-amber-200 dark:border-amber-800">
                <CardContent className="px-4 py-4">
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {t("audit.fixes.warning")}
                  </p>
                  <FixTool
                    label={t("audit.fixes.inventory")}
                    running={fixInventory.isPending}
                    done={fixInventory.isSuccess}
                    onRun={() => fixInventory.mutate(undefined)}
                    warning={t("audit.fixes.warning")}
                  />
                  <FixTool
                    label={t("audit.fixes.dashboard")}
                    running={fixDashboard.isPending}
                    done={fixDashboard.isSuccess}
                    onRun={() => fixDashboard.mutate(undefined)}
                    warning={t("audit.fixes.warning")}
                  />
                  <FixTool
                    label={t("audit.fixes.accounts")}
                    running={fixAccounts.isPending}
                    done={fixAccounts.isSuccess}
                    onRun={() => fixAccounts.mutate(undefined)}
                    warning={t("audit.fixes.warning")}
                  />
                </CardContent>
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
}
