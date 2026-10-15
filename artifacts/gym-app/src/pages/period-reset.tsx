import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/hooks/use-toast";
import { useFmtDate } from "@/lib/useFmtDate";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  apiRequest,
  businessDateKey,
  errorMessage,
  formatAmount,
  shiftDateKey,
  useApi,
  type Money,
} from "@/lib/accounting-client";
import { BookLock, CheckCircle2, Loader2, Lock, ShieldAlert } from "lucide-react";

const CONFIRMATION = "CLOSE BOOKS";

type ClosedPeriod = {
  id: number;
  closedThrough: string;
  closedThroughDate: string;
  closedAt: string;
  closedBy: string | null;
  netIncomeUsd: number;
  netIncomeCdf: number;
  notes: string | null;
};

type PeriodList = { lockedThrough: string | null; lockedThroughDate: string | null; items: ClosedPeriod[] };
type Health = { ok: boolean; checks: Array<{ key: string; ok: boolean; message: string; expected: number; actual: number; difference: number }> };
type DrawerBalance = { nativeUsd: number; nativeCdf: number };
type CloseResult = { closedThroughDate: string; netIncome: Money; fxAdjustment: Money };
type ProfitLoss = { revenue: Money; expenses: Money; net: Money };

/** Close the books through a business date: count cash, revalue FX, move profit to equity, lock the period. */
export default function PeriodClosePage() {
  const { t, language } = useI18n();
  const { fmtDate } = useFmtDate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const yesterday = shiftDateKey(businessDateKey(), -1);
  const [closeDate, setCloseDate] = useState(yesterday);
  const [countCash, setCountCash] = useState(true);
  const [countedUsd, setCountedUsd] = useState("");
  const [countedCdf, setCountedCdf] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<CloseResult | null>(null);

  const periodsQ = useApi<PeriodList>("/api/accounts/periods");
  const healthQ = useApi<Health>("/api/ledger/health");
  const balanceQ = useApi<DrawerBalance>("/api/ledger/balance");
  const lockedDate = periodsQ.data?.lockedThroughDate ?? null;
  const fromDate = lockedDate ? shiftDateKey(lockedDate, 1) : "";
  const pnlQ = useApi<ProfitLoss>(closeDate && (!fromDate || closeDate >= fromDate) ? `/api/accounts/profit-loss?period=custom&dateFrom=${fromDate || "2000-01-01"}&dateTo=${closeDate}` : null);

  const dateValid = !!closeDate && closeDate <= yesterday && (!lockedDate || closeDate > lockedDate);
  const amountsValid = !countCash || [countedUsd, countedCdf].every((value) => value !== "" && Number(value) >= 0);
  const canSubmit = dateValid && amountsValid && confirmation.trim().toUpperCase() === CONFIRMATION && !saving;
  const failingChecks = (healthQ.data?.checks ?? []).filter((check) => !check.ok);

  async function submit() {
    setSaving(true);
    try {
      const closed = await apiRequest<CloseResult>("/api/accounts/periods/close", {
        method: "POST",
        body: JSON.stringify({
          closedThroughDate: closeDate,
          confirmation: CONFIRMATION,
          countedUsd: countCash ? Number(countedUsd) : undefined,
          countedCdf: countCash ? Number(countedCdf) : undefined,
          notes: notes.trim() || undefined,
        }),
      });
      setResult(closed);
      setConfirmation("");
      toast({ title: t("pc.toast.closed").replace("{date}", closed.closedThroughDate) });
      await queryClient.invalidateQueries();
    } catch (error) {
      toast({ title: errorMessage(error, t), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader icon={BookLock} title={t("pc.title")} subtitle={t("pc.subtitle")} />

      <section aria-labelledby="pc-status" className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border/70 bg-card p-4">
          <h2 id="pc-status" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("pc.lockedThrough")}</h2>
          <p className="mt-2 flex items-center gap-2 text-lg font-semibold"><Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{lockedDate ? fmtDate(`${lockedDate}T12:00:00Z`) : t("pc.neverClosed")}</p>
        </div>
        <div className={cn("rounded-2xl border p-4", failingChecks.length ? "border-amber-500/40 bg-amber-500/5" : "border-border/70 bg-card")}>
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("pc.health")}</h2>
          {healthQ.isLoading ? <Loader2 className="mt-2 h-4 w-4 animate-spin" /> : failingChecks.length === 0 ? (
            <p className="mt-2 flex items-center gap-2 text-lg font-semibold text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t("pc.healthOk")}</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {failingChecks.map((check) => <li key={check.key} className="flex gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />{t(`health.${check.key}`) !== `health.${check.key}` ? t(`health.${check.key}`) : check.message}</li>)}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="pc-form" className="rounded-2xl border border-border/70 bg-card p-4 sm:p-6">
        <h2 id="pc-form" className="text-base font-semibold">{t("pc.formTitle")}</h2>
        <ol className="mt-2 list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
          <li>{t("pc.step.count")}</li>
          <li>{t("pc.step.fx")}</li>
          <li>{t("pc.step.close")}</li>
          <li>{t("pc.step.lock")}</li>
        </ol>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pc-date">{t("pc.closeThrough")}</Label>
            <Input id="pc-date" type="date" value={closeDate} max={yesterday} min={fromDate || undefined} onChange={(event) => setCloseDate(event.target.value)} aria-invalid={!dateValid} aria-describedby="pc-date-hint" />
            <p id="pc-date-hint" className={cn("text-xs", dateValid ? "text-muted-foreground" : "text-destructive")}>{dateValid ? t("pc.dateHint") : t("pc.dateInvalid")}</p>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/20 p-3 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("pc.preview")}{fromDate ? ` · ${fromDate} → ${closeDate}` : ` → ${closeDate}`}</p>
            {pnlQ.data ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
                <dt className="text-muted-foreground">{t("acc.pl.revenue")}</dt><dd className="text-end">{formatAmount(pnlQ.data.revenue.usd, "USD", language)}</dd>
                <dt className="text-muted-foreground">{t("acc.pl.expenses")}</dt><dd className="text-end">{formatAmount(pnlQ.data.expenses.usd, "USD", language)}</dd>
                <dt className="font-medium">{t("acc.pl.net")}</dt><dd className={cn("text-end font-semibold", pnlQ.data.net.usd < 0 && "text-destructive")}>{formatAmount(pnlQ.data.net.usd, "USD", language)}</dd>
              </dl>
            ) : <Loader2 className="mt-2 h-4 w-4 animate-spin" />}
          </div>
        </div>

        <fieldset className="mt-5 space-y-3">
          <legend className="sr-only">{t("pc.countTitle")}</legend>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={countCash} onChange={(event) => setCountCash(event.target.checked)} />
            {t("pc.countTitle")}
          </label>
          {countCash && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pc-usd">{t("cb.countedUsd")}</Label>
                <Input id="pc-usd" type="number" inputMode="decimal" min="0" step="0.01" value={countedUsd} onChange={(event) => setCountedUsd(event.target.value)} placeholder={balanceQ.data ? String(balanceQ.data.nativeUsd) : ""} />
                <p className="text-xs text-muted-foreground">{t("cb.expectedUsd")}: {formatAmount(balanceQ.data?.nativeUsd, "USD", language)}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pc-cdf">{t("cb.countedCdf")}</Label>
                <Input id="pc-cdf" type="number" inputMode="numeric" min="0" step="1" value={countedCdf} onChange={(event) => setCountedCdf(event.target.value)} placeholder={balanceQ.data ? String(Math.round(balanceQ.data.nativeCdf)) : ""} />
                <p className="text-xs text-muted-foreground">{t("cb.expectedCdf")}: {formatAmount(balanceQ.data?.nativeCdf, "CDF", language)}</p>
              </div>
            </div>
          )}
        </fieldset>

        <div className="mt-5 space-y-1.5">
          <Label htmlFor="pc-notes">{t("cb.notes")}</Label>
          <Textarea id="pc-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>

        <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm">{t("pc.warning")}</p>
          <Label htmlFor="pc-confirm" className="mt-3 block text-sm">{t("pc.typeToConfirm").replace("{phrase}", CONFIRMATION)}</Label>
          <Input id="pc-confirm" className="mt-1.5 font-mono sm:max-w-xs" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
          <Button className="mt-4 w-full gap-2 sm:w-auto" variant="destructive" disabled={!canSubmit} onClick={() => void submit()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} {t("pc.submit")}
          </Button>
        </div>

        {result && (
          <div role="status" className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
            <p className="font-semibold">{t("pc.toast.closed").replace("{date}", result.closedThroughDate)}</p>
            <p className="mt-1 tabular-nums text-muted-foreground">{t("acc.pl.net")}: {formatAmount(result.netIncome.usd, "USD", language)} · {t("pc.fx")}: {formatAmount(result.fxAdjustment.usd, "USD", language)}</p>
          </div>
        )}
      </section>

      <section aria-labelledby="pc-history" className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <h2 id="pc-history" className="border-b border-border/60 px-4 py-3 text-base font-semibold">{t("pc.history")}</h2>
        {(periodsQ.data?.items ?? []).length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("pc.noHistory")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 text-start">{t("pc.closeThrough")}</th>
                <th scope="col" className="px-4 py-2.5 text-end">{t("acc.pl.net")}</th>
                <th scope="col" className="hidden px-4 py-2.5 text-start sm:table-cell">{t("pc.closedBy")}</th>
                <th scope="col" className="hidden px-4 py-2.5 text-start md:table-cell">{t("cb.notes")}</th>
              </tr></thead>
              <tbody className="divide-y divide-border/40">
                {periodsQ.data!.items.map((period) => (
                  <tr key={period.id}>
                    <td className="px-4 py-3 tabular-nums">{fmtDate(`${period.closedThroughDate}T12:00:00Z`)}</td>
                    <td className={cn("px-4 py-3 text-end tabular-nums", period.netIncomeUsd < 0 && "text-destructive")}>{formatAmount(period.netIncomeUsd, "USD", language)}</td>
                    <td className="hidden px-4 py-3 sm:table-cell">{period.closedBy ?? "—"}<span className="block text-xs text-muted-foreground">{fmtDate(period.closedAt)}</span></td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{period.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
