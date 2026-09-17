import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetSettings } from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCcw, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useGetMe } from "@/hooks/use-me";

const CONFIRMATION = "RESET OXYGEN GYM";

function apiBaseUrl() {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
}

function firstDayOfCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function gymPeriodStartIso(date: string): string {
  // Oxygen Gym operates on Central Africa Time (UTC+02:00). Using an explicit
  // offset keeps a date such as September 1 from shifting to the prior UTC day.
  return `${date}T00:00:00+02:00`;
}

type ResetResult = {
  ok: boolean;
  resetNumber: string;
  resetDate: string;
  openingCashUsd: number;
  exchangeRate: number;
  balance: { balanceUsd: number; balanceCdf: number };
  cleared: {
    payments: number;
    vouchers: number;
    sales: number;
    payroll: number;
    commissions: number;
    checkIns: number;
    accountingEntries: number;
    cashLedger: number;
  };
};

const preserved = [
  "Current stock quantities, costs, products, and stock purchase history",
  "Active members and member records used for retention/history",
  "Membership/subscription revenue on or after the selected period start date",
  "Expense payments, outgoing expense vouchers, and expense records",
  "Plans, users, staff, gym settings, and system numbering",
  "Supplier / inventory master data",
];

const cleared = [
  "Membership/subscription revenue before the selected period start date",
  "Other incoming/receipt vouchers (outgoing expense vouchers are preserved)",
  "Sales transaction history for the current operating period",
  "Payroll runs and commissions",
  "Attendance / check-in history",
  "Non-preserved accounting entries and the current cash-ledger event stream",
];

export default function PeriodReset() {
  const me = useGetMe();
  const { data: settings } = useGetSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [periodStartDate, setPeriodStartDate] = useState(firstDayOfCurrentMonth);
  const [openingCashUsd, setOpeningCashUsd] = useState("0");
  const [openingCashCdf, setOpeningCashCdf] = useState("0");
  const [notes, setNotes] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ResetResult | null>(null);

  const isAdmin = me?.role === "admin";
  const usdAmount = Number(openingCashUsd);
  const cdfAmount = Number(openingCashCdf);
  const exchangeRate = Number(settings?.usdToCdfRate ?? 0);
  const rateValid = Number.isFinite(exchangeRate) && exchangeRate > 0;
  const usdValid = Number.isFinite(usdAmount) && usdAmount >= 0;
  const cdfValid = Number.isFinite(cdfAmount) && cdfAmount >= 0;
  const amountValid = usdValid && cdfValid && (cdfAmount === 0 || rateValid);
  const totalOpeningUsd = amountValid
    ? usdAmount + (cdfAmount > 0 ? cdfAmount / exchangeRate : 0)
    : 0;
  const totalOpeningCdf = rateValid ? totalOpeningUsd * exchangeRate : 0;

  const periodStartInstant = new Date(gymPeriodStartIso(periodStartDate));
  const periodStartValid = /^\d{4}-\d{2}-\d{2}$/.test(periodStartDate)
    && !Number.isNaN(periodStartInstant.getTime())
    && periodStartInstant.getTime() <= Date.now();

  const canReset = isAdmin
    && amountValid
    && periodStartValid
    && confirmation === CONFIRMATION
    && !submitting;

  const resetPeriod = async () => {
    if (!canReset) return;
    setSubmitting(true);
    setResult(null);
    try {
      const token = localStorage.getItem("gym_token");
      const openingBreakdown = rateValid
        ? `Opening cash input: USD ${usdAmount.toFixed(2)} + CDF ${cdfAmount.toFixed(2)} at ${exchangeRate} CDF/USD`
        : `Opening cash input: USD ${usdAmount.toFixed(2)}`;
      const resetNotes = [notes.trim(), openingBreakdown].filter(Boolean).join(" | ");

      const response = await fetch(`${apiBaseUrl()}/api/ledger/opening-balance`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Reset-Confirmation": confirmation,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          targetAmountUsd: Number(totalOpeningUsd.toFixed(6)),
          date: gymPeriodStartIso(periodStartDate),
          notes: resetNotes || "New operating period opening balance",
        }),
      });

      const data = await response.json().catch(() => ({})) as ResetResult & { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.error || data.message || `Reset failed (${response.status})`);
      }

      setResult(data);
      setConfirmation("");
      await queryClient.invalidateQueries();
      toast({ title: "New operating period started" });
    } catch (error) {
      toast({
        title: "Reset failed",
        description: error instanceof Error ? error.message : "The reset could not be completed.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (me && !isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={RefreshCcw}
          iconClass="bg-amber-500/10 text-amber-600"
          title="New Period / Reset"
          subtitle="Administrative operating-period reset"
        />
        <Card className="border-amber-500/30">
          <CardContent className="flex items-start gap-3 p-6">
            <ShieldAlert className="h-5 w-5 text-amber-600 mt-0.5" />
            <div>
              <p className="font-medium">Administrator access required</p>
              <p className="text-sm text-muted-foreground mt-1">Only an administrator can reset the operating period or set the new opening cash balance.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={RefreshCcw}
        iconClass="bg-amber-500/10 text-amber-600"
        title="New Period / Reset"
        subtitle="Start fresh financial activity while preserving stock, members, expenses, and in-period subscription revenue"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-emerald-500/25">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <CardTitle className="text-base">Always preserved</CardTitle>
            </div>
            <CardDescription>These records are not deleted or recalculated by the reset.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {preserved.map((item) => (
              <div key={item} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-amber-500/25">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <CardTitle className="text-base">Reset for the new period</CardTitle>
            </div>
            <CardDescription>The following non-preserved activity is cleared together in one transaction.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {cleared.map((item) => (
              <div key={item} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Period start & opening balance</CardTitle>
          <CardDescription>
            Choose the date the new reporting period begins, then enter the physical USD and/or CDF cash on hand at that starting point. CDF is converted using the gym's configured exchange rate.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="period-start">Subscription revenue start date</Label>
              <Input
                id="period-start"
                type="date"
                value={periodStartDate}
                onChange={(event) => setPeriodStartDate(event.target.value)}
                className="font-semibold"
              />
              <p className="text-xs text-muted-foreground">
                Membership receipts on or after this date are kept. For the current September period, leave this at 01/09/2026.
              </p>
              {!periodStartValid && <p className="text-xs text-destructive">Choose today or an earlier valid date.</p>}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="opening-cash-usd">Opening cash — USD</Label>
              <Input
                id="opening-cash-usd"
                type="number"
                min="0"
                step="0.01"
                value={openingCashUsd}
                onChange={(event) => setOpeningCashUsd(event.target.value)}
                className="text-lg font-semibold"
              />
              {!usdValid && <p className="text-xs text-destructive">Enter zero or a positive USD amount.</p>}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="opening-cash-cdf">Opening cash — CDF</Label>
              <Input
                id="opening-cash-cdf"
                type="number"
                min="0"
                step="1"
                value={openingCashCdf}
                onChange={(event) => setOpeningCashCdf(event.target.value)}
                className="text-lg font-semibold"
              />
              {!cdfValid && <p className="text-xs text-destructive">Enter zero or a positive CDF amount.</p>}
              {cdfAmount > 0 && !rateValid && <p className="text-xs text-destructive">The USD/CDF exchange rate is not available yet.</p>}
            </div>
          </div>

          <div className="rounded-xl border bg-muted/25 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Gym exchange rate</p>
                <p className="font-semibold">{rateValid ? `1 USD = ${exchangeRate.toLocaleString()} CDF` : "Loading rate…"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Combined opening balance</p>
                <p className="font-semibold">${totalOpeningUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">CDF equivalent</p>
                <p className="font-semibold">{rateValid ? `${totalOpeningCdf.toLocaleString(undefined, { maximumFractionDigits: 0 })} CDF` : "—"}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-2 max-w-2xl">
            <Label htmlFor="reset-notes">Opening notes (optional)</Label>
            <Textarea
              id="reset-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Example: Opening cash counted at start of September period"
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/35">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-destructive">Confirm reset</CardTitle>
              <CardDescription className="mt-1">This action is intentionally restricted to administrators and cannot be partially applied.</CardDescription>
            </div>
            <Badge variant="destructive">Admin only</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm">
            Type <span className="font-mono font-semibold select-all">{CONFIRMATION}</span> exactly to enable the reset button.
          </div>
          <div className="grid gap-2 max-w-md">
            <Label htmlFor="reset-confirmation">Confirmation</Label>
            <Input
              id="reset-confirmation"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={CONFIRMATION}
            />
          </div>
          <Button
            variant="destructive"
            size="lg"
            disabled={!canReset}
            onClick={resetPeriod}
            data-testid="button-reset-operating-period"
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            Reset & start new period
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card className="border-emerald-500/30">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <CardTitle className="text-base">Reset completed</CardTitle>
            </div>
            <CardDescription>{result.resetNumber} · period starts {new Date(result.resetDate).toLocaleDateString()}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Opening cash (USD eq.)</p><p className="font-semibold">${result.balance.balanceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Opening cash (CDF eq.)</p><p className="font-semibold">{result.balance.balanceCdf.toLocaleString(undefined, { maximumFractionDigits: 0 })} CDF</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Old revenue payments cleared</p><p className="font-semibold">{result.cleared.payments}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Sales cleared</p><p className="font-semibold">{result.cleared.sales}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Check-ins cleared</p><p className="font-semibold">{result.cleared.checkIns}</p></div>
            </div>
            <p className="text-sm text-muted-foreground">
              Subscription revenue dated on or after the selected period start was preserved. Stock, stock purchase history, member records, and expenses were also preserved.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
