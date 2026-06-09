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
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  User,
  Phone,
  Mail,
  MapPin,
  AlertCircle,
  Calendar,
  CreditCard,
  Clock,
  Hash,
} from "lucide-react";

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}
function fmtDateTime(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}
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

export default function MemberProfile({ id }: { id: number }) {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const me = useGetMe();
  const canViewAccounting = me?.role === "admin" || me?.permissions?.viewAccounting;

  const { data: member, isLoading } = useGetMember(id);
  const { data: payments = [] } = useGetMemberPayments(id);
  const { data: checkins = [] } = useGetMemberCheckins(id);
  const { data: attStats } = useGetMemberAttendanceStats(id);

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

          {/* Info grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {member.phone && (
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <Phone className="h-4 w-4 text-slate-400 shrink-0" />
                {member.phone}
              </div>
            )}
            {member.email && (
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <Mail className="h-4 w-4 text-slate-400 shrink-0" />
                {member.email}
              </div>
            )}
            {member.address && (
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
                {member.address}
              </div>
            )}
            {member.emergencyContact && (
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <AlertCircle className="h-4 w-4 text-slate-400 shrink-0" />
                {member.emergencyContact}
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
                  {(member.amountPaid != null) && (
                    <div>
                      <p className="text-slate-500 dark:text-slate-400">{t("members.form.amountPaid")}</p>
                      <p className="font-medium text-emerald-600 dark:text-emerald-400 mt-0.5">{fmtCurrency(member.amountPaid, member.currency)}</p>
                    </div>
                  )}
                  {(member.discount != null && member.discount > 0) && (
                    <div>
                      <p className="text-slate-500 dark:text-slate-400">{t("members.form.discount")}</p>
                      <p className="font-medium text-slate-900 dark:text-white mt-0.5">{fmtCurrency(member.discount, member.currency)}</p>
                    </div>
                  )}
                  {(member.balance != null && member.balance !== 0) && (
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

      {/* Payment History */}
      {canViewAccounting && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-indigo-500" />
              {t("members.profile.payments")}
            </h2>
          </div>
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

      {/* Check-in History */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
            <Clock className="h-4 w-4 text-indigo-500" />
            {t("members.profile.checkins")}
          </h2>
        </div>
        {(checkins as CheckInRecord[]).length === 0 ? (
          <div className="text-center py-10 text-slate-500 dark:text-slate-400 text-sm">{t("members.profile.noCheckins")}</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {(checkins as CheckInRecord[]).slice(0, 50).map((c) => (
              <div key={c.id} className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <Clock className="h-4 w-4 text-indigo-400 shrink-0" />
                <span className="text-sm text-slate-700 dark:text-slate-300">{fmtDateTime(c.checkedInAt)}</span>
              </div>
            ))}
            {(checkins as CheckInRecord[]).length > 50 && (
              <p className="text-center text-xs text-slate-400 py-3">Showing 50 of {checkins.length}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
