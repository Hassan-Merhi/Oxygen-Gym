import { useLocation } from "wouter";
import { useI18n } from "@/lib/i18n";
import { useGetMe } from "@/hooks/use-me";
import {
  useGetMember,
  useGetMemberPayments,
  useGetMemberCheckins,
  useGetMemberAttendanceStats,
} from "@workspace/api-client-react";
import type { MemberPayment, CheckInRecord } from "@workspace/api-client-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  ArrowLeft, User, Phone, Mail, MapPin, AlertCircle, Calendar,
  CreditCard, Clock, Hash, CalendarCheck, TrendingUp, Activity, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { fmtDate, fmtDateTime } from "@/lib/date";
function fmtCurrency(amount: number | null | undefined, currency: string): string {
  if (amount == null) return "—";
  return `${currency} ${amount.toFixed(2)}`;
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const map: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    expired: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    frozen: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    inactive: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    archived: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${map[status] ?? map.inactive}`}>
      {t(`members.status.${status}`) ?? status}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value?: string | number; color?: string;
}) {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={cn("w-4 h-4 opacity-70", color ?? "text-primary")} />
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="text-xl font-bold">{value ?? "—"}</div>
      </CardContent>
    </Card>
  );
}

export default function MemberProfile({ id }: { id: number }) {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const me = useGetMe();
  const canViewAccounting = me?.role === "admin" || me?.permissions?.viewAccounting;

  const { data: member, isLoading } = useGetMember(id);
  const { data: payments = [] } = useGetMemberPayments(id);
  const { data: checkins = [] } = useGetMemberCheckins(id);
  const { data: attStats } = useGetMemberAttendanceStats(id);

  // Build 30-day calendar data
  const last30Days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    return d.toISOString().slice(0, 10);
  });
  const attendedSet = new Set<string>(attStats?.calendarDays ?? []);

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-48" />
        <div className="h-40 bg-slate-200 dark:bg-slate-700 rounded" />
      </div>
    );
  }

  if (!member) {
    return (
      <div className="text-center py-20">
        <AlertCircle className="h-10 w-10 text-slate-400 mx-auto mb-3" />
        <p className="text-slate-600 dark:text-slate-400">Member not found</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/members")}>
          {t("members.profile.back")}
        </Button>
      </div>
    );
  }

  const daysLeft = member.expiryDate
    ? Math.ceil((new Date(member.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Back */}
      <Button variant="ghost" className="gap-2 -ml-2 text-slate-600 dark:text-slate-400" onClick={() => navigate("/members")}>
        <ArrowLeft className="h-4 w-4" />
        {t("members.profile.back")}
      </Button>

      {/* Hero card */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 h-24" />
        <div className="px-6 pb-6">
          <div className="flex items-end gap-4 -mt-10 mb-4">
            <div className="h-20 w-20 rounded-full bg-white dark:bg-slate-800 border-4 border-white dark:border-slate-900 flex items-center justify-center shadow-lg">
              <User className="h-9 w-9 text-indigo-400" />
            </div>
            <div className="mb-1 flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">{member.name}</h1>
                <StatusBadge status={member.status} t={t} />
                {member.memberNumber && (
                  <span className="text-xs font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                    {member.memberNumber}
                  </span>
                )}
              </div>
              {member.phone && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{member.phone}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {member.phone && (
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <Phone className="h-4 w-4 text-slate-400 shrink-0" />{member.phone}
              </div>
            )}
            {member.email && (
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <Mail className="h-4 w-4 text-slate-400 shrink-0" />{member.email}
              </div>
            )}
            {member.address && (
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <MapPin className="h-4 w-4 text-slate-400 shrink-0" />{member.address}
              </div>
            )}
            {member.emergencyContact && (
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <AlertCircle className="h-4 w-4 text-slate-400 shrink-0" />{member.emergencyContact}
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
              {t("members.form.joinDate")}: {fmtDate(member.joinDate)}
            </div>
            {member.gender && (
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <User className="h-4 w-4 text-slate-400 shrink-0" />
                {t(`members.form.gender.${member.gender}`) ?? member.gender}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">{t("members.profile.tabOverview")}</TabsTrigger>
          <TabsTrigger value="attendance">{t("members.profile.tabAttendance")}</TabsTrigger>
          <TabsTrigger value="payments">{t("members.profile.tabPayments")}</TabsTrigger>
          <TabsTrigger value="checkins">{t("members.profile.tabCheckins")}</TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Current Plan */}
            <div className="md:col-span-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-indigo-500" />
                {t("members.profile.currentPlan")}
              </h2>
              {member.planName ? (
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">{t("members.form.plan")}</p>
                    <p className="font-medium text-slate-900 dark:text-white mt-0.5">{member.planName}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">{t("members.form.startDate")}</p>
                    <p className="font-medium text-slate-900 dark:text-white mt-0.5">{fmtDate(member.startDate)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">{t("members.form.expiryDate")}</p>
                    <p className={`font-medium mt-0.5 ${daysLeft !== null && daysLeft < 0 ? "text-red-600 dark:text-red-400" : daysLeft !== null && daysLeft <= 7 ? "text-orange-600 dark:text-orange-400" : "text-slate-900 dark:text-white"}`}>
                      {fmtDate(member.expiryDate)}
                      {daysLeft !== null && daysLeft >= 0 && <span className="text-slate-400 dark:text-slate-500 font-normal ml-1">({daysLeft}d)</span>}
                    </p>
                  </div>
                  {canViewAccounting && member.planPrice != null && (
                    <div>
                      <p className="text-slate-500 dark:text-slate-400">{t("members.form.planPrice")}</p>
                      <p className="font-medium text-slate-900 dark:text-white mt-0.5">{fmtCurrency(member.planPrice, member.currency)}</p>
                    </div>
                  )}
                  {canViewAccounting && (
                    <>
                      {member.amountPaid != null && (
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">{t("members.form.amountPaid")}</p>
                          <p className="font-medium text-emerald-600 dark:text-emerald-400 mt-0.5">{fmtCurrency(member.amountPaid, member.currency)}</p>
                        </div>
                      )}
                      {member.discount != null && member.discount > 0 && (
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">{t("members.form.discount")}</p>
                          <p className="font-medium text-slate-900 dark:text-white mt-0.5">{fmtCurrency(member.discount, member.currency)}</p>
                        </div>
                      )}
                      {member.balance != null && member.balance !== 0 && (
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">{t("members.form.balance")}</p>
                          <p className={`font-medium mt-0.5 ${(member.balance ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                            {fmtCurrency(member.balance, member.currency)}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                  {member.frozenAt && (
                    <div className="col-span-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                      <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                        🧊 Frozen: {fmtDate(member.frozenAt)} → {fmtDate(member.frozenUntil)} ({member.frozenDays ?? 0} days)
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-slate-500 dark:text-slate-400 text-sm">{t("members.form.noPlan")}</p>
              )}
            </div>

            {/* Quick stats */}
            <div className="space-y-4">
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                  <Hash className="h-4 w-4 text-indigo-500" />
                  {t("members.form.membershipInfo")}
                </h2>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">{t("members.table.lastCheckin")}</span>
                    <span className="font-medium text-slate-900 dark:text-white">{fmtDate(attStats?.lastCheckIn ?? member.lastCheckIn)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">{t("att.totalCheckins")}</span>
                    <span className="font-medium text-slate-900 dark:text-white">{attStats?.totalCheckins ?? checkins.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">{t("att.thisMonth")}</span>
                    <span className="font-medium text-slate-900 dark:text-white">{attStats?.thisMonthCheckins ?? "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">{t("att.avgMonth")}</span>
                    <span className="font-medium text-slate-900 dark:text-white">{attStats?.avgPerMonth ?? "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Payments</span>
                    <span className="font-medium text-slate-900 dark:text-white">{payments.length}</span>
                  </div>
                  {member.fingerprintId && (
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">{t("members.form.fingerprint")}</span>
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{member.fingerprintId}</span>
                    </div>
                  )}
                  {member.qrCodeId && (
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">{t("members.form.qrCode")}</span>
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{member.qrCodeId}</span>
                    </div>
                  )}
                </div>
              </div>
              {member.notes && (
                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 p-4">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">{t("members.form.notes")}</p>
                  <p className="text-sm text-amber-800 dark:text-amber-300">{member.notes}</p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Attendance ── */}
        <TabsContent value="attendance" className="mt-4 space-y-6">
          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard icon={CalendarCheck} label={t("att.totalCheckins")} value={attStats?.totalCheckins} color="text-indigo-500" />
            <StatCard icon={Clock} label={t("att.lastCheckin")} value={fmtDate(attStats?.lastCheckIn)} color="text-cyan-500" />
            <StatCard icon={Activity} label={t("att.thisMonth")} value={attStats?.thisMonthCheckins} color="text-violet-500" />
            <StatCard icon={TrendingUp} label={t("att.avgMonth")} value={attStats?.avgPerMonth ? `${attStats.avgPerMonth}/mo` : "—"} color="text-emerald-500" />
          </div>

          {/* Monthly history chart */}
          <Card className="shadow-sm">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t("att.monthlyHistory")}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {!attStats ? <Skeleton className="h-40 w-full" /> : (
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={attStats.monthlyHistory as any[]} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="count" stroke="#6366f1" fill="#6366f130" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* 30-day attendance calendar */}
          <Card className="shadow-sm">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t("att.calendarTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex flex-wrap gap-1.5">
                {last30Days.map((day) => {
                  const attended = attendedSet.has(day);
                  const label = new Date(day + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                  return (
                    <div
                      key={day}
                      title={`${label}${attended ? " ✓" : ""}`}
                      className={cn(
                        "w-8 h-8 rounded-md flex items-center justify-center text-[10px] font-medium cursor-default",
                        attended
                          ? "bg-indigo-500 text-white"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {new Date(day + "T12:00:00").getDate()}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                <span className="inline-block w-3 h-3 rounded bg-indigo-500 mr-1" />attended
                <span className="inline-block w-3 h-3 rounded bg-muted ml-3 mr-1" />not attended
              </p>
            </CardContent>
          </Card>

          {/* Check-in list */}
          <Card className="shadow-sm">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="w-4 h-4" />
                {t("members.profile.checkins")} ({(checkins as CheckInRecord[]).length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(checkins as CheckInRecord[]).length === 0 ? (
                <p className="text-center py-8 text-sm text-muted-foreground">{t("members.profile.noCheckins")}</p>
              ) : (
                <div className="divide-y divide-border max-h-72 overflow-y-auto">
                  {(checkins as CheckInRecord[]).slice(0, 100).map((c) => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
                      <CalendarCheck className="h-4 w-4 text-indigo-400 shrink-0" />
                      <span className="text-sm">{fmtDateTime(c.checkedInAt)}</span>
                    </div>
                  ))}
                  {(checkins as CheckInRecord[]).length > 100 && (
                    <p className="text-center text-xs text-muted-foreground py-2">Showing 100 of {checkins.length}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Payments ── */}
        <TabsContent value="payments" className="mt-4">
          {!canViewAccounting ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <Lock className="w-8 h-8 opacity-40" />
              <p className="text-sm">Access Restricted</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              {(payments as MemberPayment[]).length === 0 ? (
                <div className="text-center py-10 text-slate-500 dark:text-slate-400 text-sm">{t("members.profile.noPayments")}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 dark:bg-slate-800/50">
                      <TableHead className="text-xs uppercase text-slate-500">#</TableHead>
                      <TableHead className="text-xs uppercase text-slate-500">Plan</TableHead>
                      <TableHead className="text-xs uppercase text-slate-500">{t("members.form.amountPaid")}</TableHead>
                      <TableHead className="text-xs uppercase text-slate-500">{t("members.form.discount")}</TableHead>
                      <TableHead className="text-xs uppercase text-slate-500">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(payments as MemberPayment[]).map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs text-slate-500">{p.paymentNumber ?? `#${p.id}`}</TableCell>
                        <TableCell className="text-sm">{p.planName ?? "—"}</TableCell>
                        <TableCell className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{fmtCurrency(p.amount, p.currency)}</TableCell>
                        <TableCell className="text-sm text-slate-500">{p.discount ? fmtCurrency(p.discount, p.currency) : "—"}</TableCell>
                        <TableCell className="text-sm text-slate-500">{fmtDate(p.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── Check-ins ── */}
        <TabsContent value="checkins" className="mt-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <Clock className="h-4 w-4 text-indigo-500" />
                {t("members.profile.checkins")}
              </h2>
              <span className="text-xs text-muted-foreground">{(checkins as CheckInRecord[]).length} total</span>
            </div>
            {(checkins as CheckInRecord[]).length === 0 ? (
              <div className="text-center py-10 text-slate-500 dark:text-slate-400 text-sm">{t("members.profile.noCheckins")}</div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[500px] overflow-y-auto">
                {(checkins as CheckInRecord[]).map((c) => (
                  <div key={c.id} className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <Clock className="h-4 w-4 text-indigo-400 shrink-0" />
                    <span className="text-sm text-slate-700 dark:text-slate-300">{fmtDateTime(c.checkedInAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
