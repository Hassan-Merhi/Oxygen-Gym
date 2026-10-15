import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  useListNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  getListNotificationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, Check, CheckCheck, AlertCircle, Package, DollarSign, UserX, Snowflake, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const TYPE_ICONS: Record<string, React.ElementType> = {
  member_expiring: AlertCircle,
  stock_low: Package,
  stock_out: Package,
  payroll_due: DollarSign,
  member_frozen: Snowflake,
  member_inactive: UserX,
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30",
  medium: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  low: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30",
};

export default function Notifications() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [readFilter, setReadFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const queryParams = {
    read: readFilter !== "all" ? readFilter : undefined,
    type: typeFilter !== "all" ? typeFilter : undefined,
  } as any;

  const { data, isLoading } = useListNotifications(queryParams, {
    query: { queryKey: getListNotificationsQueryKey(queryParams), refetchInterval: 60000 }
  });
  const notifications = data?.items ?? [];

  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["listNotifications"] });

  const handleMarkRead = (key: string) => {
    markRead.mutate({ key }, {
      onSuccess: () => invalidate(),
      onError: () => toast({ title: t("common.error"), variant: "destructive" }),
    });
  };

  const handleMarkAllRead = () => {
    markAllRead.mutate(undefined, {
      onSuccess: () => { invalidate(); toast({ title: t("notif.markAllRead") }); },
      onError: () => toast({ title: t("common.error"), variant: "destructive" }),
    });
  };

  const typeOptions = [
    "member_expiring", "stock_low", "stock_out", "payroll_due", "member_frozen", "member_inactive"
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Bell}
        iconClass="bg-amber-500/10 text-amber-700 dark:text-amber-400"
        title={t("notif.title")}
        actions={
          <>
            {(data?.unreadCount ?? 0) > 0 && (
              <Badge className="bg-rose-600 text-white border-0 rounded-full">{data!.unreadCount}</Badge>
            )}
            <Button variant="outline" size="sm" onClick={handleMarkAllRead} disabled={markAllRead.isPending || (data?.unreadCount ?? 0) === 0}>
              {markAllRead.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCheck className="h-4 w-4" aria-hidden="true" />}
              {t("notif.markAllRead")}
            </Button>
          </>
        }
      />

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-center">
        <Select value={readFilter} onValueChange={setReadFilter}>
          <SelectTrigger className="w-full sm:w-40" aria-label={t("notif.filter.readLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("notif.filter.all")}</SelectItem>
            <SelectItem value="unread">{t("notif.filter.unread")}</SelectItem>
            <SelectItem value="read">{t("notif.filter.read")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-56" aria-label={t("notif.filter.typeLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("notif.filter.allTypes")}</SelectItem>
            {typeOptions.map(type => (
              <SelectItem key={type} value={type}>{t(`notif.type.${type}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-muted-foreground">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Bell className="h-6 w-6 opacity-60" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-foreground">{t("notif.empty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const Icon = TYPE_ICONS[n.type] ?? Bell;
            return (
              <div
                key={n.key}
                className={cn(
                  "flex items-start gap-3 p-3 sm:gap-4 sm:p-4 rounded-lg border transition-colors",
                  n.isRead
                    ? "bg-card border-border opacity-70"
                    : "bg-card border-border shadow-sm"
                )}
              >
                <div className={cn("p-2 rounded-full shrink-0", PRIORITY_COLORS[n.priority])}>
                  <Icon className="w-4 h-4" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {t(`notif.type.${n.type}`)}
                    </span>
                    <Badge variant="outline" className={cn("text-xs", PRIORITY_COLORS[n.priority])}>
                      {t(`notif.priority.${n.priority}`)}
                    </Badge>
                    {!n.isRead && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" aria-label={t("notif.unread")} role="img" />}
                  </div>
                  <p className="text-sm text-foreground">{n.message}</p>
                </div>
                {!n.isRead && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => handleMarkRead(n.key)}
                    title={t("notif.markRead")}
                    aria-label={t("notif.markRead")}
                  >
                    <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
