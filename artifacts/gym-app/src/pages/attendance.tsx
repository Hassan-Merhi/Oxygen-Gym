import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  useGetAttendanceSummary,
  useGetAttendanceDaily,
  useGetAttendanceMonthly,
  useGetAttendanceHourly,
  useGetAttendanceTopMembers,
  useGetAttendanceToday,
  useGetAttendanceWeek,
  useListAttendance,
  useListAttendancePlans,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  LineChart, Line, CartesianGrid, AreaChart, Area,
} from "recharts";
import {
  CalendarCheck, Users, TrendingUp, Activity, Clock,
  Trophy, Filter, X, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useFmtDate } from "@/lib/useFmtDate";
import { fmt } from "@/lib/i18n-format";
import { Pager } from "@/components/ui/pager";

function StatCard({ icon: Icon, label, value, color, loading }: {
  icon: React.ElementType; label: string; value?: string | number;
  color?: string; loading?: boolean;
}) {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={cn("w-4 h-4", color ?? "text-primary")} aria-hidden="true" />
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading ? <Skeleton className="h-8 w-20" /> : (
          <div className="text-2xl font-bold tabular-nums">{value ?? "—"}</div>
        )}
      </CardContent>
    </Card>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold mb-3">{children}</h2>;
}

const CHART_COLOR = "#6366f1";

export default function Attendance() {
  const { t, language } = useI18n();
  const { fmtDateTime, fmtTime } = useFmtDate();
  const isRtl = language === "ar";
  const tick = { fontSize: 12 };
  const chartMargin = { top: 4, right: isRtl ? -12 : 4, left: isRtl ? 4 : -12, bottom: 0 };
  const tooltipStyle = { backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--popover-foreground))" };

  const { data: summary, isLoading: sumLoading } = useGetAttendanceSummary();
  const { data: daily = [], isLoading: dailyLoading } = useGetAttendanceDaily();
  const { data: monthly = [], isLoading: monthlyLoading } = useGetAttendanceMonthly();
  const { data: hourly = [], isLoading: hourlyLoading } = useGetAttendanceHourly();
  const { data: topMembers = [], isLoading: topLoading } = useGetAttendanceTopMembers();
  const { data: todayList = [], isLoading: todayLoading } = useGetAttendanceToday();
  const { data: weekList = [], isLoading: weekLoading } = useGetAttendanceWeek();

  // Format daily for chart: show only DD/MM label
  const dailyChartData = (daily as any[]).map(d => ({
    ...d,
    label: d.date ? d.date.slice(5) : d.date, // MM-DD
  }));

  // Format monthly for chart: show MON label
  const monthlyChartData = (monthly as any[]).map(m => ({
    ...m,
    label: m.month ? m.month.slice(0, 7) : m.month,
  }));

  // Format hourly
  const hourlyChartData = (hourly as any[]).map(h => ({
    ...h,
    label: `${String(h.hour).padStart(2, "0")}:00`,
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        icon={CalendarCheck}
        iconClass="bg-cyan-500/10 text-cyan-700 dark:text-cyan-400"
        title={t("att.title")}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={CalendarCheck} label={t("att.today")} value={summary?.today} loading={sumLoading} color="text-cyan-700 dark:text-cyan-400" />
        <StatCard icon={Activity} label={t("att.week")} value={summary?.thisWeek} loading={sumLoading} color="text-indigo-700 dark:text-indigo-400" />
        <StatCard icon={TrendingUp} label={t("att.month")} value={summary?.thisMonth} loading={sumLoading} color="text-violet-700 dark:text-violet-400" />
        <StatCard icon={Users} label={t("att.activeToday")} value={summary?.activeToday} loading={sumLoading} color="text-emerald-700 dark:text-emerald-400" />
        <StatCard icon={Clock} label={t("att.avgDaily")} value={summary?.avgDaily} loading={sumLoading} color="text-amber-700 dark:text-amber-400" />
      </div>

      {/* Charts row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Daily chart */}
        <Card className="shadow-sm">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("att.dailyChart")}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {dailyLoading ? <Skeleton className="h-48 w-full" /> : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={dailyChartData} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" tick={tick} interval="preserveStartEnd" reversed={isRtl} />
                  <YAxis tick={tick} allowDecimals={false} orientation={isRtl ? "right" : "left"} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill={CHART_COLOR} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Monthly chart */}
        <Card className="shadow-sm">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("att.monthlyChart")}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {monthlyLoading ? <Skeleton className="h-48 w-full" /> : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={monthlyChartData} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" tick={tick} reversed={isRtl} />
                  <YAxis tick={tick} allowDecimals={false} orientation={isRtl ? "right" : "left"} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="count" stroke={CHART_COLOR} fill={`${CHART_COLOR}30`} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Hourly chart */}
        <Card className="shadow-sm">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("att.hourlyChart")}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {hourlyLoading ? <Skeleton className="h-48 w-full" /> : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={hourlyChartData} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" tick={tick} interval="preserveStartEnd" minTickGap={8} reversed={isRtl} />
                  <YAxis tick={tick} allowDecimals={false} orientation={isRtl ? "right" : "left"} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill="#10b981" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Top members */}
        <Card className="shadow-sm">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              {t("att.topMembers")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {topLoading ? <Skeleton className="h-48 w-full" /> : (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {(topMembers as any[]).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">{t("att.empty")}</p>
                ) : (
                  (topMembers as any[]).map((m, i) => (
                    <div key={m.memberId} className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={cn("w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold",
                          i === 0 ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" :
                          i === 1 ? "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300" :
                          i === 2 ? "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300" :
                          "bg-muted text-muted-foreground"
                        )}>{i + 1}</span>
                        <span className="min-w-0 truncate font-medium">{m.memberName}</span>
                      </div>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{m.count} {t("att.visits")}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Today's check-ins */}
      <div>
        <SectionTitle>{t("att.todayList")}</SectionTitle>
        <Card className="shadow-sm">
          <CardContent className="p-0">
            {todayLoading ? (
              <div className="p-4"><Skeleton className="h-32 w-full" /></div>
            ) : (todayList as any[]).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t("att.empty")}</p>
            ) : (
              <div className="divide-y divide-border max-h-72 overflow-y-auto">
                {(todayList as any[]).map((c) => (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
                    <CalendarCheck className="w-4 h-4 text-indigo-500 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.memberName}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtTime(c.checkedInAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* This week's check-ins */}
      <div>
        <SectionTitle>{t("att.weekList")}</SectionTitle>
        <Card className="shadow-sm">
          <CardContent className="p-0">
            {weekLoading ? (
              <div className="p-4"><Skeleton className="h-32 w-full" /></div>
            ) : (weekList as any[]).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t("att.empty")}</p>
            ) : (
              <div className="divide-y divide-border max-h-72 overflow-y-auto">
                {(weekList as any[]).slice(0, 100).map((c) => (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
                    <Clock className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.memberName}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {fmtDateTime(c.checkedInAt)}
                    </span>
                  </div>
                ))}
                {(weekList as any[]).length > 100 && (
                  <p className="text-center text-xs text-muted-foreground py-2">{fmt(t("att.showingOf"), { shown: 100, total: (weekList as any[]).length })}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Attendance Reports (filtered) ── */}
      <AttendanceReports />
    </div>
  );
}

function AttendanceReports() {
  const { t } = useI18n();
  const { fmtDateTime } = useFmtDate();
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [from, setFrom] = useState(thirtyDaysAgo);
  const [to, setTo] = useState(today);
  const [memberSearch, setMemberSearch] = useState("");
  const [planName, setPlanName] = useState("");
  const [page, setPage] = useState(1);

  const [applied, setApplied] = useState({ from: thirtyDaysAgo, to: today, memberSearch: "", planName: "" });

  const { data: plansData = [] } = useListAttendancePlans();
  const { data: listData, isLoading } = useListAttendance(
    { from: applied.from, to: applied.to, memberSearch: applied.memberSearch || undefined, planName: applied.planName || undefined, page: String(page), limit: "50" } as any,
  );

  const items = listData?.items ?? [];
  const total = listData?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  const handleApply = () => { setPage(1); setApplied({ from, to, memberSearch, planName }); };
  const handleClear = () => {
    setFrom(thirtyDaysAgo); setTo(today); setMemberSearch(""); setPlanName("");
    setPage(1); setApplied({ from: thirtyDaysAgo, to: today, memberSearch: "", planName: "" });
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="px-4 pt-4 pb-3 border-b border-border">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Filter className="w-4 h-4 text-primary" aria-hidden="true" />
          {t("att.reportsTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pt-4 pb-4 space-y-4">
        {/* Filter bar */}
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap">
          <div className="flex min-w-0 flex-col gap-1 lg:w-40">
            <label htmlFor="att-from" className="text-xs text-muted-foreground">{t("att.dateFrom")}</label>
            <Input id="att-from" type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="flex min-w-0 flex-col gap-1 lg:w-40">
            <label htmlFor="att-to" className="text-xs text-muted-foreground">{t("att.dateTo")}</label>
            <Input id="att-to" type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="flex min-w-0 flex-col gap-1 lg:w-52">
            <label htmlFor="att-member" className="text-xs text-muted-foreground">{t("att.memberSearch")}</label>
            <div className="relative">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input id="att-member" type="search" value={memberSearch} onChange={e => setMemberSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleApply(); }} placeholder={t("att.namePlaceholder")} className="h-9 text-sm ps-8" />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-1 lg:w-48">
            <label htmlFor="att-plan" className="text-xs text-muted-foreground">{t("att.planFilter")}</label>
            <Select value={planName || "_all"} onValueChange={v => setPlanName(v === "_all" ? "" : v)}>
              <SelectTrigger id="att-plan" className="h-9 text-sm">
                <SelectValue placeholder={t("att.allPlans")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">{t("att.allPlans")}</SelectItem>
                {(plansData as string[]).map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" className="h-9 flex-1 lg:flex-none" onClick={handleApply}>{t("att.applyFilters")}</Button>
            <Button size="sm" variant="ghost" className="h-9 flex-1 lg:flex-none" onClick={handleClear}>
              <X className="w-4 h-4" aria-hidden="true" />{t("att.clearFilters")}
            </Button>
          </div>
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">{t("att.noResults")}</div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground" aria-live="polite">{fmt(t("att.resultCount"), { count: total })}</div>
            <ul className="divide-y divide-border rounded-md border border-border md:hidden">
              {(items as any[]).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.memberName}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.planName ?? "—"}</p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtDateTime(r.checkedInAt)}</span>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-hidden rounded-md border border-border md:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs">{t("members.table.name")}</TableHead>
                    <TableHead className="text-xs">{t("att.plan")}</TableHead>
                    <TableHead className="text-xs">{t("att.dateTime")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(items as any[]).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm font-medium">{r.memberName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.planName ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtDateTime(r.checkedInAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pager page={page} totalPages={totalPages} onPageChange={setPage} className="pt-1" />
          </>
        )}
      </CardContent>
    </Card>
  );
}
