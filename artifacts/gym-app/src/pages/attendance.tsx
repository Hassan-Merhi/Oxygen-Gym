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
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  LineChart, Line, CartesianGrid, AreaChart, Area,
} from "recharts";
import {
  CalendarCheck, Users, TrendingUp, Activity, Clock,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
                    <span className="text-xs text-muted-foreground">{new Date(c.checkedInAt).toLocaleTimeString()}</span>
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
                      {new Date(c.checkedInAt).toLocaleDateString()} {new Date(c.checkedInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
    </div>
  );
}
