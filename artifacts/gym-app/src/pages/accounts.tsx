import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useFmtDate } from "@/lib/useFmtDate";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  accountLabel,
  apiRequest,
  businessDateKey,
  errorMessage,
  formatAmount,
  qs,
  rangeForPreset,
  useApi,
  type DatePreset,
  type Money,
} from "@/lib/accounting-client";
import { BookOpen, CheckCircle2, Loader2, Plus, Power, Scale, ShieldAlert } from "lucide-react";

type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
const ACCOUNT_TYPES: AccountType[] = ["asset", "liability", "equity", "income", "expense"];
const MONEY_ACCOUNTS = new Set(["Cash", "Bank", "Mobile Money"]);
const PRESETS: DatePreset[] = ["today", "month", "last_month", "year", "all", "custom"];

type ChartAccount = {
  id: number;
  name: string;
  type: AccountType;
  description: string | null;
  isActive: boolean;
  isSystem: boolean;
  balanceUsd: number;
  balanceCdf: number;
  entryCount: number;
};

type StatementRow = {
  id: number;
  date: string;
  description: string;
  party: string;
  counterAccount: string;
  sourceNumber: string | null;
  amount: number;
  currency: string;
  debitUsd: number;
  creditUsd: number;
  runningBalance: number;
  runningBalanceCdf: number;
  nativeBalanceUsd?: number;
  nativeBalanceCdf?: number;
};

type Statement = {
  account: ChartAccount;
  openingBalance: number;
  openingBalanceCdf: number;
  closingBalance: number;
  closingBalanceCdf: number;
  openingNative?: Money;
  rows: StatementRow[];
};

type TrialBalance = {
  asOf: string;
  rows: Array<{ accountId: number; name: string; type: AccountType; normal: "debit" | "credit"; debitUsd: number; creditUsd: number; balanceUsd: number; balanceCdf: number }>;
  totals: { debitUsd: number; creditUsd: number };
  balanced: boolean;
};

type SheetLine = { accountId: number; name: string; usd: number; cdf: number };
type BalanceSheet = {
  asOf: string;
  assets: SheetLine[];
  liabilities: SheetLine[];
  equity: SheetLine[];
  currentEarnings: Money;
  totals: { assets: Money; liabilities: Money; equity: Money; liabilitiesAndEquity: Money };
  balanced: boolean;
};

type TrialRow = TrialBalance["rows"][number];

/** Which column a balance sits in: its normal side, or the other one when it has gone negative. */
function trialSide(row: TrialRow) {
  const positive = row.balanceUsd >= 0;
  return (row.normal === "debit") === positive ? "debit" : "credit";
}

function BalancedBadge({ balanced, t }: { balanced: boolean; t: (key: string) => string }) {
  return balanced ? (
    <Badge variant="outline" className="gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />{t("ab.balanced")}</Badge>
  ) : (
    <Badge variant="destructive" className="gap-1"><ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />{t("ab.unbalanced")}</Badge>
  );
}

function StatementPanel({ account, initialPreset }: { account: ChartAccount; initialPreset: DatePreset }) {
  const { t, language } = useI18n();
  const { fmtDate } = useFmtDate();
  const [preset, setPreset] = useState<DatePreset>(initialPreset);
  const [from, setFrom] = useState(businessDateKey());
  const [to, setTo] = useState(businessDateKey());
  const range = rangeForPreset(preset, from, to);
  const statementQ = useApi<Statement>(`/api/accounts/chart/${account.id}/statement${qs({ dateFrom: range.from, dateTo: range.to })}`, { refetchInterval: 30_000 });
  const statement = statementQ.data;
  const native = MONEY_ACCOUNTS.has(account.name);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
        <div className="col-span-2 space-y-1 sm:col-span-1">
          <Label htmlFor="st-period" className="text-xs text-muted-foreground">{t("acc.period")}</Label>
          <Select value={preset} onValueChange={(value) => setPreset(value as DatePreset)}>
            <SelectTrigger id="st-period" className="h-10 max-md:h-11 pointer-coarse:h-11 sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{PRESETS.map((value) => <SelectItem key={value} value={value}>{t(`cb.preset.${value}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {preset === "custom" && <>
          <div className="space-y-1"><Label htmlFor="st-from" className="text-xs text-muted-foreground">{t("acc.dateFrom")}</Label><Input id="st-from" type="date" className="h-10 max-md:h-11 pointer-coarse:h-11" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="st-to" className="text-xs text-muted-foreground">{t("acc.dateTo")}</Label><Input id="st-to" type="date" className="h-10 max-md:h-11 pointer-coarse:h-11" value={to} onChange={(event) => setTo(event.target.value)} /></div>
        </>}
      </div>

      {statementQ.isError && <p className="text-sm text-destructive">{errorMessage(statementQ.error, t)}</p>}
      {statement && (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border border-border/70 p-3">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("cb.opening")}</dt>
            <dd className="mt-1 font-semibold tabular-nums">{native && statement.openingNative ? formatAmount(statement.openingNative.usd, "USD", language) : formatAmount(statement.openingBalance, "USD", language)}</dd>
            {native && statement.openingNative && <dd className="text-xs tabular-nums text-muted-foreground">{formatAmount(statement.openingNative.cdf, "CDF", language)}</dd>}
          </div>
          <div className="rounded-xl border border-border/70 p-3">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("cb.closing")}</dt>
            <dd className="mt-1 font-semibold tabular-nums">{formatAmount(native ? statement.rows.at(-1)?.nativeBalanceUsd ?? statement.openingNative?.usd : statement.closingBalance, "USD", language)}</dd>
            {native && <dd className="text-xs tabular-nums text-muted-foreground">{formatAmount(statement.rows.at(-1)?.nativeBalanceCdf ?? statement.openingNative?.cdf, "CDF", language)}</dd>}
          </div>
        </dl>
      )}

      {statementQ.isLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : (
        <ul className="divide-y divide-border/50 rounded-xl border border-border/70">
          {(statement?.rows ?? []).length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">{t("acc.empty")}</li>}
          {(statement?.rows ?? []).slice().reverse().map((row) => {
            const debit = row.debitUsd > 0;
            return (
              <li key={row.id} className="px-3 py-2.5 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.description || accountLabel(row.counterAccount, t)}</p>
                    <p className="truncate text-xs text-muted-foreground">{fmtDate(row.date)} · {accountLabel(row.counterAccount, t)}{row.sourceNumber ? ` · ${row.sourceNumber}` : ""}</p>
                  </div>
                  <div className="shrink-0 text-end tabular-nums">
                    <p className={cn("font-semibold", debit ? "text-foreground" : "text-muted-foreground")}>
                      <span className="text-xs font-normal uppercase text-muted-foreground">{debit ? t("ab.debit") : t("ab.credit")} </span>
                      {native ? formatAmount(row.amount, row.currency, language) : formatAmount(debit ? row.debitUsd : row.creditUsd, "USD", language)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {native ? `${formatAmount(row.nativeBalanceUsd, "USD", language)} · ${formatAmount(row.nativeBalanceCdf, "CDF", language)}` : formatAmount(row.runningBalance, "USD", language)}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function AccountsPage() {
  const { t, language } = useI18n();
  const me = useGetMe();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = me?.role === "admin";
  const params = new URLSearchParams(window.location.search);
  const [typeFilter, setTypeFilter] = useState<AccountType | "all">((ACCOUNT_TYPES as string[]).includes(params.get("type") ?? "") ? params.get("type") as AccountType : "all");
  const initialPreset = (PRESETS as string[]).includes(params.get("period") ?? "") ? params.get("period") as DatePreset : "month";
  const [selected, setSelected] = useState<ChartAccount | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [asOf, setAsOf] = useState(businessDateKey());
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "expense" as AccountType, description: "" });
  const [saving, setSaving] = useState(false);

  const chartQ = useApi<ChartAccount[]>("/api/accounts/chart", { refetchInterval: 60_000 });
  const trialQ = useApi<TrialBalance>(`/api/accounts/trial-balance${qs({ asOf })}`);
  const sheetQ = useApi<BalanceSheet>(`/api/accounts/balance-sheet${qs({ asOf })}`);

  const trialTotals = useMemo(() => (trialQ.data?.rows ?? []).reduce((totals, row) => {
    totals[trialSide(row)] += Math.abs(row.balanceUsd);
    return totals;
  }, { debit: 0, credit: 0 }), [trialQ.data]);

  const grouped = useMemo(() => {
    const accounts = (chartQ.data ?? []).filter((account) => (showInactive || account.isActive) && (typeFilter === "all" || account.type === typeFilter));
    return ACCOUNT_TYPES.map((type) => ({ type, accounts: accounts.filter((account) => account.type === type) })).filter((group) => group.accounts.length > 0);
  }, [chartQ.data, showInactive, typeFilter]);

  useEffect(() => {
    if (selected && chartQ.data) setSelected(chartQ.data.find((account) => account.id === selected.id) ?? null);
  }, [chartQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await apiRequest("/api/accounts/chart", { method: "POST", body: JSON.stringify({ name: form.name.trim(), type: form.type, description: form.description.trim() || undefined }) });
      toast({ title: t("ab.toast.created") });
      setCreateOpen(false);
      setForm({ name: "", type: "expense", description: "" });
      await queryClient.invalidateQueries();
    } catch (error) {
      toast({ title: errorMessage(error, t), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(account: ChartAccount) {
    try {
      if (account.isActive) await apiRequest(`/api/accounts/chart/${account.id}`, { method: "DELETE" });
      else await apiRequest(`/api/accounts/chart/${account.id}`, { method: "PUT", body: JSON.stringify({ isActive: true }) });
      toast({ title: account.isActive ? t("ab.toast.deactivated") : t("ab.toast.activated") });
      await queryClient.invalidateQueries();
    } catch (error) {
      toast({ title: errorMessage(error, t), variant: "destructive" });
    }
  }

  const sheetSection = (title: string, lines: SheetLine[], totalValue: Money, extra?: SheetLine) => (
    <section className="rounded-2xl border border-border/70 bg-card">
      <h3 className="border-b border-border/60 px-4 py-3 text-sm font-semibold">{title}</h3>
      <dl className="divide-y divide-border/40 text-sm">
        {[...lines, ...(extra ? [extra] : [])].map((line) => (
          <div key={`${line.accountId}-${line.name}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <dt className="min-w-0 truncate">{accountLabel(line.name, t)}</dt>
            <dd className={cn("shrink-0 tabular-nums", line.usd < 0 && "text-destructive")}>{formatAmount(line.usd, "USD", language)}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 bg-muted/20 px-4 py-2.5 font-semibold">
          <dt>{t("ab.total")}</dt>
          <dd className="tabular-nums">{formatAmount(totalValue.usd, "USD", language)}</dd>
        </div>
      </dl>
    </section>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        icon={BookOpen}
        title={t("ab.title")}
        subtitle={t("ab.subtitle")}
        actions={isAdmin ? <Button className="h-10 max-md:h-11 pointer-coarse:h-11 gap-2" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> {t("ab.newAccount")}</Button> : undefined}
      />

      <Tabs defaultValue="chart" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 sm:inline-flex sm:w-auto">
          <TabsTrigger value="chart">{t("ab.tab.chart")}</TabsTrigger>
          <TabsTrigger value="trial">{t("ab.tab.trial")}</TabsTrigger>
          <TabsTrigger value="sheet">{t("ab.tab.sheet")}</TabsTrigger>
        </TabsList>

        <TabsContent value="chart" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as AccountType | "all")}>
              <SelectTrigger className="h-10 max-md:h-11 pointer-coarse:h-11 w-full sm:w-48" aria-label={t("ab.type")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("ab.allTypes")}</SelectItem>
                {ACCOUNT_TYPES.map((type) => <SelectItem key={type} value={type}>{t(`ab.type.${type}`)}</SelectItem>)}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
              {t("ab.showInactive")}
            </label>
          </div>
          {chartQ.isLoading && <Loader2 className="mx-auto h-5 w-5 animate-spin" />}
          {chartQ.isError && <p className="text-sm text-destructive">{errorMessage(chartQ.error, t)}</p>}
          <div className="grid gap-4 lg:grid-cols-2">
            {grouped.map((group) => (
              <section key={group.type} className="overflow-hidden rounded-2xl border border-border/70 bg-card" aria-labelledby={`grp-${group.type}`}>
                <h2 id={`grp-${group.type}`} className="border-b border-border/60 bg-muted/20 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`ab.type.${group.type}`)}</h2>
                <ul className="divide-y divide-border/40">
                  {group.accounts.map((account) => (
                    <li key={account.id} className="flex items-center gap-2 pe-2">
                      <button type="button" onClick={() => setSelected(account)} className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 text-start transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none">
                        <span className="min-w-0">
                          <span className={cn("block truncate font-medium", !account.isActive && "text-muted-foreground line-through")}>{accountLabel(account.name, t)}</span>
                          <span className="block truncate text-xs text-muted-foreground">{account.isSystem ? t("ab.system") : t("ab.custom")} · {t("ab.entries").replace("{count}", String(account.entryCount))}</span>
                        </span>
                        <span className="shrink-0 text-end tabular-nums">
                          <span className={cn("block font-semibold", account.balanceUsd < 0 && "text-destructive")}>{formatAmount(account.balanceUsd, "USD", language)}</span>
                          <span className="block text-xs text-muted-foreground">{formatAmount(account.balanceCdf, "CDF", language)}</span>
                        </span>
                      </button>
                      {isAdmin && !account.isSystem && (
                        <Button variant="ghost" size="icon" className="h-9 w-9 max-md:h-11 max-md:w-11 pointer-coarse:h-11 pointer-coarse:w-11 shrink-0" onClick={() => void toggleActive(account)} aria-label={account.isActive ? t("ab.deactivate") : t("ab.activate")} title={account.isActive ? t("ab.deactivate") : t("ab.activate")}>
                          <Power className={cn("h-4 w-4", account.isActive ? "text-muted-foreground" : "text-emerald-500")} />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("ab.balanceNote")}</p>
        </TabsContent>

        <TabsContent value="trial" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1"><Label htmlFor="tb-asof" className="text-xs text-muted-foreground">{t("ab.asOf")}</Label><Input id="tb-asof" type="date" className="h-10 max-md:h-11 pointer-coarse:h-11 w-44" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></div>
            {trialQ.data && <BalancedBadge balanced={trialQ.data.balanced} t={t} />}
          </div>
          <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border/60 bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 text-start">{t("ab.account")}</th>
                <th scope="col" className="hidden px-4 py-2.5 text-start sm:table-cell">{t("ab.type")}</th>
                <th scope="col" className="px-4 py-2.5 text-end">{t("ab.debit")}</th>
                <th scope="col" className="px-4 py-2.5 text-end">{t("ab.credit")}</th>
              </tr></thead>
              <tbody className="divide-y divide-border/40">
                {trialQ.isLoading && <tr><td colSpan={4} className="py-10"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
                {(trialQ.data?.rows ?? []).filter((row) => Math.abs(row.balanceUsd) > 0.000001).map((row) => (
                  <tr key={row.accountId}>
                    <td className="px-4 py-2.5">{accountLabel(row.name, t)}</td>
                    <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">{t(`ab.type.${row.type}`)}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{trialSide(row) === "debit" ? formatAmount(Math.abs(row.balanceUsd), "USD", language) : ""}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{trialSide(row) === "credit" ? formatAmount(Math.abs(row.balanceUsd), "USD", language) : ""}</td>
                  </tr>
                ))}
              </tbody>
              {trialQ.data && (
                <tfoot><tr className="border-t border-border/60 bg-muted/20 font-semibold">
                  <th scope="row" className="px-4 py-2.5 text-start" colSpan={2}>{t("ab.total")}</th>
                  <td className="px-4 py-2.5 text-end tabular-nums">{formatAmount(trialTotals.debit, "USD", language)}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{formatAmount(trialTotals.credit, "USD", language)}</td>
                </tr></tfoot>
              )}
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{t("ab.trialNote")}</p>
        </TabsContent>

        <TabsContent value="sheet" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1"><Label htmlFor="bs-asof" className="text-xs text-muted-foreground">{t("ab.asOf")}</Label><Input id="bs-asof" type="date" className="h-10 max-md:h-11 pointer-coarse:h-11 w-44" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></div>
            {sheetQ.data && <BalancedBadge balanced={sheetQ.data.balanced} t={t} />}
          </div>
          {sheetQ.isLoading && <Loader2 className="mx-auto h-5 w-5 animate-spin" />}
          {sheetQ.data && (
            <div className="grid gap-4 lg:grid-cols-2">
              {sheetSection(t("ab.type.asset"), sheetQ.data.assets, sheetQ.data.totals.assets)}
              <div className="space-y-4">
                {sheetSection(t("ab.type.liability"), sheetQ.data.liabilities, sheetQ.data.totals.liabilities)}
                {sheetSection(t("ab.type.equity"), sheetQ.data.equity, sheetQ.data.totals.equity, { accountId: -1, name: t("ab.currentEarnings"), ...sheetQ.data.currentEarnings })}
                <p className="flex items-center justify-between rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 text-sm font-semibold">
                  <span>{t("ab.liabilitiesAndEquity")}</span>
                  <span className="tabular-nums">{formatAmount(sheetQ.data.totals.liabilitiesAndEquity.usd, "USD", language)}</span>
                </p>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side={language === "ar" ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-xl">
          {selected && <>
            <SheetHeader className="mb-4">
              <SheetTitle className="flex items-center gap-2"><Scale className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{accountLabel(selected.name, t)}</SheetTitle>
              <SheetDescription>{t(`ab.type.${selected.type}`)}{selected.description ? ` · ${selected.description}` : ""}</SheetDescription>
            </SheetHeader>
            <StatementPanel key={selected.id} account={selected} initialPreset={initialPreset} />
          </>}
        </SheetContent>
      </Sheet>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <form onSubmit={(event) => void createAccount(event)}>
            <DialogHeader><DialogTitle>{t("ab.newAccount")}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-1.5"><Label htmlFor="acct-name">{t("ab.account")}</Label><Input id="acct-name" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></div>
              <div className="space-y-1.5">
                <Label htmlFor="acct-type">{t("ab.type")}</Label>
                <Select value={form.type} onValueChange={(value) => setForm((current) => ({ ...current, type: value as AccountType }))}>
                  <SelectTrigger id="acct-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{ACCOUNT_TYPES.map((type) => <SelectItem key={type} value={type}>{t(`ab.type.${type}`)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="acct-desc">{t("acc.col.description")}</Label><Input id="acct-desc" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{t("cb.close")}</Button>
              <Button type="submit" disabled={saving || !form.name.trim()}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t("cb.save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
