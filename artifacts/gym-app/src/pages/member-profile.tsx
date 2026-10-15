import { Link } from "wouter";
import { useI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n-format";
import { useGetMe } from "@/hooks/use-me";
import {
  useGetMember,
  useGetMemberPayments,
  useGetMemberCheckins,
  useGetMemberAttendanceStats,
  useGetSettings,
} from "@workspace/api-client-react";
import type { MemberPayment, CheckInRecord } from "@workspace/api-client-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/pager";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  ArrowLeft, User, Phone, Mail, MapPin, AlertCircle, Calendar, Snowflake,
  CreditCard, Clock, Hash, CalendarCheck, TrendingUp, Activity, Lock, Printer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge as MemberStatusBadge } from "@/lib/status-badge";
import { useFmtDate } from "@/lib/useFmtDate";
import { printMemberInvoice } from "@/components/members/member-utils";

function fmtCurrency(amount: number | null | undefined, currency: string): string {
  if (amount == null) return "—";
  return currency === "CDF" ? `FC ${Math.round(amount).toLocaleString("en-US")}` : `$${amount.toFixed(2)}`;
}

function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value?: string | number; color?: string;
}) {
  return (
    <Card className="min-w-0 border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pb-2 pt-4">
        <CardTitle className="truncate text-xs font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={cn("h-4 w-4 shrink-0", color ?? "text-primary")} aria-hidden="true" />
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="truncate text-xl font-bold tabular-nums">{value ?? "—"}</div>
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium text-foreground">{children}</dd>
    </div>
  );
}

export default function MemberProfile({ id }: { id: number }) {
  const { t, language } = useI18n();
  const { fmtDate, fmtDateTime, locale } = useFmtDate();
  const me = useGetMe();
  const canViewAccounting = me?.role === "admin" || me?.permissions?.viewAccounting;
  const isRtl = language === "ar";

  const { data: member, isLoading } = useGetMember(id);
  const { data: payments = [] } = useGetMemberPayments(id, { query: { enabled: canViewAccounting ?? false, queryKey: ["member-payments", id, canViewAccounting] } });
  const { data: checkins = [] } = useGetMemberCheckins(id);
  const { data: attStats } = useGetMemberAttendanceStats(id);
  const { data: settingsData } = useGetSettings();

  const last30Days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    return d.toISOString().slice(0, 10);
  });
  const attendedSet = new Set<string>(attStats?.calendarDays ?? []);

  const backLink = (
    <Button variant="ghost" asChild className="-ms-2 gap-2 text-muted-foreground">
      <Link href="/members">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        {t("members.profile.back")}
      </Link>
    </Button>
  );

  if (isLoading) {
    return (
      <div className="max-w-5xl space-y-4" aria-busy="true" aria-label={t("common.loading")}>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!member) {
    return (
      <EmptyState icon={AlertCircle} title={t("members.profile.notFound")} action={backLink} className="py-20" />
    );
  }

  const daysLeft = member.expiryDate
    ? Math.ceil((new Date(member.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const checkinList = checkins as CheckInRecord[];
  const paymentList = payments as MemberPayment[];
  const latestPaymentId = paymentList.length ? Math.max(...paymentList.map((x) => x.id)) : -1;
  const statusLabel = (() => {
    const key = `members.status.${member.status}`;
    const label = t(key);
    return label === key ? member.status : label;
  })();
  const genderLabel = member.gender ? (() => {
    const key = `members.form.gender.${member.gender}`;
    const label = t(key);
    return label === key ? member.gender : label;
  })() : null;

  const printPayment = (p: MemberPayment) => {
    const isLatest = p.id === latestPaymentId;
    // For the most recent payment use the stored member plan price & balance;
    // for historical payments reconstruct plan price from what was paid + discount.
    const planPrice = isLatest ? (member.planPrice ?? (p.amount + (p.discount ?? 0))) : (p.amount + (p.discount ?? 0));
    const balance = isLatest ? (member.balance ?? 0) : 0;
    printMemberInvoice({
      invoiceNum: p.paymentNumber ?? `#${p.id}`,
      memberName: member.name,
      memberPhone: member.phone ?? undefined,
      planName: p.planName ?? t("members.invoice.plan"),
      startDate: member.startDate ?? undefined,
      expiryDate: member.expiryDate ?? undefined,
      amountPaid: p.amount,
      discount: p.discount ?? 0,
      planPrice,
      balance,
      currency: p.currency,
      isRenewal: p.type === "renewal",
    }, (settingsData ?? {}) as Record<string, unknown>, t, locale);
  };

  const contactItem = (Icon: React.ElementType, text: React.ReactNode, ltr = false) => (
    <li className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate" dir={ltr ? "ltr" : undefined}>{text}</span>
    </li>
  );

  const checkinRows = (list: CheckInRecord[], Icon: React.ElementType) => (
    <ul className="divide-y divide-border">
      {list.map((c) => (
        <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
          <Icon className="h-4 w-4 shrink-0 text-indigo-500" aria-hidden="true" />
          <span className="text-sm tabular-nums">{fmtDateTime(c.checkedInAt)}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="max-w-5xl space-y-6">
      {backLink}

      {/* Hero card */}
      <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="member-name">
        <div className="h-20 bg-gradient-to-r from-indigo-600 to-indigo-700 sm:h-24 rtl:bg-gradient-to-l" aria-hidden="true" />
        <div className="px-4 pb-5 sm:px-6 sm:pb-6">
          {/* Avatar overlaps the banner; the name always sits below it on the card surface. */}
          <div className="-mt-10 mb-4 flex flex-col gap-3">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 border-card bg-muted shadow-lg">
              <User className="h-9 w-9 text-indigo-500" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 id="member-name" className="min-w-0 break-words text-xl font-bold text-foreground">{member.name}</h1>
                <MemberStatusBadge status={member.status} label={statusLabel} className="px-2.5" />
                {member.memberNumber && (
                  <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">{member.memberNumber}</span>
                )}
              </div>
            </div>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {member.phone && contactItem(Phone, member.phone, true)}
            {member.email && contactItem(Mail, member.email, true)}
            {member.address && contactItem(MapPin, member.address)}
            {member.emergencyContact && contactItem(AlertCircle, member.emergencyContact)}
            {contactItem(Calendar, `${t("members.form.joinDate")}: ${fmtDate(member.joinDate)}`)}
            {genderLabel && contactItem(User, genderLabel)}
          </ul>
        </div>
      </section>

      <Tabs defaultValue="overview">
        <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="overview" className="pointer-coarse:min-h-11">{t("members.profile.tabOverview")}</TabsTrigger>
          <TabsTrigger value="attendance" className="pointer-coarse:min-h-11">{t("members.profile.tabAttendance")}</TabsTrigger>
          <TabsTrigger value="payments" className="pointer-coarse:min-h-11">{t("members.profile.tabPayments")}</TabsTrigger>
          <TabsTrigger value="checkins" className="pointer-coarse:min-h-11">{t("members.profile.tabCheckins")}</TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <section className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                <CreditCard className="h-4 w-4 text-indigo-500" aria-hidden="true" />
                {t("members.profile.currentPlan")}
              </h2>
              {member.planName ? (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">{t("members.form.plan")}</dt>
                    <dd className="mt-0.5 font-medium text-foreground">{member.planName}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("members.form.startDate")}</dt>
                    <dd className="mt-0.5 font-medium text-foreground">{fmtDate(member.startDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("members.form.expiryDate")}</dt>
                    <dd className={cn(
                      "mt-0.5 font-medium",
                      daysLeft !== null && daysLeft < 0 ? "text-red-700 dark:text-red-400"
                        : daysLeft !== null && daysLeft <= 7 ? "text-orange-700 dark:text-orange-400"
                        : "text-foreground",
                    )}>
                      {fmtDate(member.expiryDate)}
                      {daysLeft !== null && daysLeft >= 0 && (
                        <span className="ms-1 font-normal text-muted-foreground">({fmt(t("members.daysLeftShort"), { days: daysLeft })})</span>
                      )}
                    </dd>
                  </div>
                  {canViewAccounting && member.planPrice != null && (
                    <div>
                      <dt className="text-muted-foreground">{t("members.form.planPrice")}</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-foreground">{fmtCurrency(member.planPrice, member.currency)}</dd>
                    </div>
                  )}
                  {canViewAccounting && member.amountPaid != null && (
                    <div>
                      <dt className="text-muted-foreground">{t("members.form.amountPaid")}</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-emerald-700 dark:text-emerald-400">{fmtCurrency(member.amountPaid, member.currency)}</dd>
                    </div>
                  )}
                  {canViewAccounting && member.discount != null && member.discount > 0 && (
                    <div>
                      <dt className="text-muted-foreground">{t("members.form.discount")}</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-foreground">{fmtCurrency(member.discount, member.currency)}</dd>
                    </div>
                  )}
                  {canViewAccounting && member.balance != null && member.balance !== 0 && (
                    <div>
                      <dt className="text-muted-foreground">{t("members.form.balance")}</dt>
                      <dd className={cn("mt-0.5 font-medium tabular-nums", (member.balance ?? 0) > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                        {fmtCurrency(member.balance, member.currency)}
                      </dd>
                    </div>
                  )}
                  {member.frozenAt && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 sm:col-span-2 dark:border-blue-800 dark:bg-blue-900/20">
                      <p className="flex items-center gap-2 text-sm font-medium text-blue-800 dark:text-blue-300">
                        <Snowflake className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {fmt(t("members.profile.frozenRange"), {
                          from: fmtDate(member.frozenAt),
                          to: fmtDate(member.frozenUntil),
                          days: member.frozenDays ?? 0,
                        })}
                      </p>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">{t("members.form.noPlan")}</p>
              )}
            </section>

            <div className="space-y-4">
              <section className="rounded-xl border border-border bg-card p-5">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Hash className="h-4 w-4 text-indigo-500" aria-hidden="true" />
                  {t("members.form.membershipInfo")}
                </h2>
                <dl className="space-y-2 text-sm">
                  <InfoRow label={t("members.table.lastCheckin")}>{fmtDate(attStats?.lastCheckIn ?? member.lastCheckIn)}</InfoRow>
                  <InfoRow label={t("att.totalCheckins")}>{attStats?.totalCheckins ?? checkinList.length}</InfoRow>
                  <InfoRow label={t("att.thisMonth")}>{attStats?.thisMonthCheckins ?? "—"}</InfoRow>
                  <InfoRow label={t("att.avgMonth")}>{attStats?.avgPerMonth ?? "—"}</InfoRow>
                  {canViewAccounting && <InfoRow label={t("members.profile.tabPayments")}>{paymentList.length}</InfoRow>}
                  {member.fingerprintId && <InfoRow label={t("members.form.fingerprint")}><span className="font-mono text-xs">{member.fingerprintId}</span></InfoRow>}
                  {member.qrCodeId && <InfoRow label={t("members.form.qrCode")}><span className="break-all font-mono text-xs">{member.qrCodeId}</span></InfoRow>}
                </dl>
              </section>
              {member.notes && (
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                  <h2 className="mb-1 text-xs font-semibold text-amber-800 dark:text-amber-400">{t("members.form.notes")}</h2>
                  <p className="text-sm text-amber-900 dark:text-amber-200">{member.notes}</p>
                </section>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Attendance ── */}
        <TabsContent value="attendance" className="mt-4 space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            <StatCard icon={CalendarCheck} label={t("att.totalCheckins")} value={attStats?.totalCheckins} color="text-indigo-600 dark:text-indigo-400" />
            <StatCard icon={Clock} label={t("att.lastCheckin")} value={fmtDate(attStats?.lastCheckIn)} color="text-cyan-600 dark:text-cyan-400" />
            <StatCard icon={Activity} label={t("att.thisMonth")} value={attStats?.thisMonthCheckins} color="text-violet-600 dark:text-violet-400" />
            <StatCard
              icon={TrendingUp}
              label={t("att.avgMonth")}
              value={attStats?.avgPerMonth ? fmt(t("members.profile.perMonth"), { n: attStats.avgPerMonth }) : "—"}
              color="text-emerald-600 dark:text-emerald-400"
            />
          </div>

          <Card className="shadow-sm">
            <CardHeader className="px-4 pb-2 pt-4">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t("att.monthlyHistory")}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {!attStats ? <Skeleton className="h-40 w-full" /> : (
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart
                    data={attStats.monthlyHistory as any[]}
                    margin={{ top: 4, right: isRtl ? -12 : 4, left: isRtl ? 4 : -12, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} reversed={isRtl} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} orientation={isRtl ? "right" : "left"} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--popover-foreground))" }} />
                    <Area type="monotone" dataKey="count" stroke="#6366f1" fill="#6366f130" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="px-4 pb-2 pt-4">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t("att.calendarTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ul className="grid grid-cols-7 gap-1.5 sm:flex sm:flex-wrap">
                {last30Days.map((day) => {
                  const attended = attendedSet.has(day);
                  const label = new Date(day + "T12:00:00").toLocaleDateString(locale, { day: "numeric", month: "short" });
                  return (
                    <li
                      key={day}
                      title={label}
                      aria-label={`${label}: ${attended ? t("members.profile.attended") : t("members.profile.notAttended")}`}
                      className={cn(
                        "flex aspect-square items-center justify-center rounded-md text-xs font-medium sm:h-9 sm:w-9",
                        attended ? "bg-indigo-600 text-white" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {new Date(day + "T12:00:00").getDate()}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded bg-indigo-600" aria-hidden="true" />{t("members.profile.attended")}</span>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded border bg-muted" aria-hidden="true" />{t("members.profile.notAttended")}</span>
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="px-4 pb-2 pt-4">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Clock className="h-4 w-4" aria-hidden="true" />
                {t("members.profile.checkins")} ({checkinList.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {checkinList.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{t("members.profile.noCheckins")}</p>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  {checkinRows(checkinList.slice(0, 100), CalendarCheck)}
                  {checkinList.length > 100 && (
                    <p className="py-2 text-center text-xs text-muted-foreground">{fmt(t("att.showingOf"), { shown: 100, total: checkinList.length })}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Payments ── */}
        <TabsContent value="payments" className="mt-4">
          {!canViewAccounting ? (
            <EmptyState icon={Lock} title={t("members.profile.restricted")} />
          ) : paymentList.length === 0 ? (
            <div className="rounded-xl border border-border bg-card">
              <EmptyState icon={CreditCard} title={t("members.profile.noPayments")} />
            </div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              <li className="hidden grid-cols-[8rem_minmax(0,1fr)_7rem_7rem_7rem_3rem] gap-3 bg-muted/50 px-4 py-2.5 text-xs font-medium uppercase text-muted-foreground md:grid" aria-hidden="true">
                <span>{t("members.profile.receiptNo")}</span>
                <span>{t("members.table.plan")}</span>
                <span className="text-end">{t("members.form.amountPaid")}</span>
                <span className="text-end">{t("members.form.discount")}</span>
                <span>{t("members.invoice.date")}</span>
                <span />
              </li>
              {paymentList.map((p) => (
                <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 md:grid-cols-[8rem_minmax(0,1fr)_7rem_7rem_7rem_3rem]">
                  <span className="font-mono text-xs text-muted-foreground md:order-none">{p.paymentNumber ?? `#${p.id}`}</span>
                  <span className="text-end font-medium tabular-nums text-emerald-700 md:hidden dark:text-emerald-400">{fmtCurrency(p.amount, p.currency)}</span>
                  <span className="truncate text-sm">{p.planName ?? "—"}</span>
                  <span className="hidden text-end text-sm font-medium tabular-nums text-emerald-700 md:block dark:text-emerald-400">{fmtCurrency(p.amount, p.currency)}</span>
                  <span className="hidden text-end text-sm tabular-nums text-muted-foreground md:block">{p.discount ? fmtCurrency(p.discount, p.currency) : "—"}</span>
                  <span className="text-end text-sm text-muted-foreground md:text-start">
                    {fmtDate(p.createdAt)}
                    {p.discount ? <span className="ms-2 md:hidden">· {t("members.form.discount")} {fmtCurrency(p.discount, p.currency)}</span> : null}
                  </span>
                  <span className="col-span-2 flex justify-end md:col-span-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-foreground"
                      title={t("members.profile.printReceipt")}
                      aria-label={`${t("members.profile.printReceipt")} ${p.paymentNumber ?? `#${p.id}`}`}
                      onClick={() => printPayment(p)}
                    >
                      <Printer className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* ── Check-ins ── */}
        <TabsContent value="checkins" className="mt-4">
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Clock className="h-4 w-4 text-indigo-500" aria-hidden="true" />
                {t("members.profile.checkins")}
              </h2>
              <span className="text-xs text-muted-foreground">{fmt(t("members.profile.totalCount"), { count: checkinList.length })}</span>
            </div>
            {checkinList.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{t("members.profile.noCheckins")}</p>
            ) : (
              <div className="max-h-[500px] overflow-y-auto">{checkinRows(checkinList, Clock)}</div>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
