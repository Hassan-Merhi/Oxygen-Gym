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
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/date";

function StatCard({ icon: Icon, label, value, color, loading }: {
  icon: React.ElementType; label: string; value?: string | number;
  color?: string; loading?: boolean;
}) {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={cn("w-4 h-4 opacity-70", color ?? "text-primary")} />
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading ? <Skeleton className="h-8 w-20" /> : (
          <div className="text-2xl font-bold">{value ?? "—"}</div>
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
  const { t } = useI18n();

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
      <h1 className="text-2xl font-bold tracking-tight">{t("att.title")}</h1>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={CalendarCheck} label={t("att.today")} value={summary?.today} loading={sumLoading} color="text-cyan-500" />
        <StatCard icon={Activity} label={t("att.week")} value={summary?.thisWeek} loading={sumLoading} color="text-indigo-500" />
        <StatCard icon={TrendingUp} label={t("att.month")} value={summary?.thisMonth} loading={sumLoading} color="text-violet-500" />
        <StatCard icon={Users} label={t("att.activeToday")} value={summary?.activeToday} loading={sumLoading} color="text-emerald-500" />
        <StatCard icon={Clock} label={t("att.avgDaily")} value={summary?.avgDaily} loading={sumLoading} color="text-amber-500" />
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
                <BarChart data={dailyChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
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
                <AreaChart data={monthlyChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
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
                <BarChart data={hourlyChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={1} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
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
              <Trophy className="w-4 h-4 text-amber-500" />
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
                    <div key={m.memberId} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className={cn("w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold",
                          i === 0 ? "bg-amber-100 text-amber-700" :
                          i === 1 ? "bg-slate-100 text-slate-600" :
                          i === 2 ? "bg-orange-100 text-orange-600" :
                          "bg-muted text-muted-foreground"
                        )}>{i + 1}</span>
                        <span className="font-medium truncate max-w-[150px]">{m.memberName}</span>
                      </div>
                      <span className="text-muted-foreground font-mono">{m.count} {t("att.visits")}</span>
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
                    <CalendarCheck className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span className="flex-1 text-sm font-medium">{c.memberName}</span>
                    <span className="text-xs text-muted-foreground">{fmtTime(c.checkedInAt)}</span>
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
                    <Clock className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="flex-1 text-sm font-medium">{c.memberName}</span>
                    <span className="text-xs text-muted-foreground">
                      {fmtDateTime(c.checkedInAt)}
                    </span>
                  </div>
                ))}
                {(weekList as any[]).length > 100 && (
                  <p className="text-center text-xs text-muted-foreground py-2">Showing 100 of {(weekList as any[]).length}</p>
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
          <Filter className="w-4 h-4 text-primary" />
          {t("att.reportsTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pt-4 pb-4 space-y-4">
        {/* Filter bar */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 min-w-[130px]">
            <label className="text-xs text-muted-foreground">{t("att.dateFrom")}</label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="flex flex-col gap-1 min-w-[130px]">
            <label className="text-xs text-muted-foreground">{t("att.dateTo")}</label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-xs text-muted-foreground">{t("att.memberSearch")}</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input value={memberSearch} onChange={e => setMemberSearch(e.target.value)} placeholder="Name…" className="h-8 text-sm pl-7" />
            </div>
          </div>
          <div className="flex flex-col gap-1 min-w-[150px]">
            <label className="text-xs text-muted-foreground">{t("att.planFilter")}</label>
            <Select value={planName || "_all"} onValueChange={v => setPlanName(v === "_all" ? "" : v)}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="All plans" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All plans</SelectItem>
                {(plansData as string[]).map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 pb-0.5">
            <Button size="sm" className="h-8" onClick={handleApply}>{t("att.applyFilters")}</Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={handleClear}>
              <X className="w-3.5 h-3.5 mr-1" />{t("att.clearFilters")}
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
            <div className="text-xs text-muted-foreground">{total} result{total !== 1 ? "s" : ""}</div>
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs">{t("members.table.name")}</TableHead>
                    <TableHead className="text-xs">{t("att.plan")}</TableHead>
                    <TableHead className="text-xs">Date / Time</TableHead>
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
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
                  <Button size="sm" variant="outline" className="h-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
