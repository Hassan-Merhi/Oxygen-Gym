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
  high: "bg-red-100 text-red-700 border-red-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-slate-100 text-slate-600 border-slate-200",
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{t("notif.title")}</h1>
          {(data?.unreadCount ?? 0) > 0 && (
            <Badge className="bg-red-500 text-white border-0">{data!.unreadCount}</Badge>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={handleMarkAllRead} disabled={markAllRead.isPending || (data?.unreadCount ?? 0) === 0}>
          {markAllRead.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCheck className="h-4 w-4 mr-2" />}
          {t("notif.markAllRead")}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={readFilter} onValueChange={setReadFilter}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("notif.filter.all")}</SelectItem>
            <SelectItem value="unread">{t("notif.filter.unread")}</SelectItem>
            <SelectItem value="read">{t("notif.filter.read")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("notif.filter.all")}</SelectItem>
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
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <Bell className="w-10 h-10 opacity-30" />
          <p>{t("notif.empty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const Icon = TYPE_ICONS[n.type] ?? Bell;
            return (
              <div
                key={n.key}
                className={cn(
                  "flex items-start gap-4 p-4 rounded-lg border transition-colors",
                  n.isRead
                    ? "bg-card border-border opacity-70"
                    : "bg-card border-border shadow-sm"
                )}
              >
                <div className={cn("p-2 rounded-full shrink-0", PRIORITY_COLORS[n.priority])}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {t(`notif.type.${n.type}`)}
                    </span>
                    <Badge variant="outline" className={cn("text-xs", PRIORITY_COLORS[n.priority])}>
                      {t(`notif.priority.${n.priority}`)}
                    </Badge>
                    {!n.isRead && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                  </div>
                  <p className="text-sm text-foreground">{n.message}</p>
                </div>
                {!n.isRead && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 h-8 w-8"
                    onClick={() => handleMarkRead(n.key)}
                    title={t("notif.markRead")}
                  >
                    <Check className="w-4 h-4 text-green-500" />
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
