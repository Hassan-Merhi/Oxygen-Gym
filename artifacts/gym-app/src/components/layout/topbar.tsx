import { useState, useRef, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { useClerk, useUser } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { LogOut, Bell, Check, CheckCheck, AlertCircle, Package, DollarSign, UserX, Snowflake } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  useGetNotificationCount,
  useListNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  getListNotificationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<string, React.ElementType> = {
  member_expiring: AlertCircle,
  stock_low: Package,
  stock_out: Package,
  payroll_due: DollarSign,
  member_frozen: Snowflake,
  member_inactive: UserX,
};

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-400",
  low: "bg-slate-400",
};

function NotificationBell() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: countData } = useGetNotificationCount({
    query: { queryKey: ["getNotificationCount"], refetchInterval: 30000 }
  });
  const unread = countData?.unread ?? 0;

  const { data } = useListNotifications({ read: "unread" } as any, {
    query: {
      queryKey: getListNotificationsQueryKey({ read: "unread" } as any),
      enabled: open,
      refetchInterval: open ? 30000 : false,
    }
  });
  const recent = (data?.items ?? []).slice(0, 8);

  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["listNotifications"] });
    queryClient.invalidateQueries({ queryKey: ["getNotificationCount"] });
  };

  const handleMarkRead = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    markRead.mutate({ key }, { onSuccess: invalidate });
  };

  const handleMarkAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    markAllRead.mutate(undefined, { onSuccess: invalidate });
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="ghost"
        size="icon"
        className="relative h-9 w-9"
        onClick={() => setOpen(v => !v)}
        aria-label={t("notif.bell")}
        data-testid="btn-notifications"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute end-0 mt-2 w-80 rounded-xl border border-border bg-popover shadow-lg z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{t("notif.title")}</span>
              {unread > 0 && <Badge className="bg-red-500 text-white text-xs px-1.5 py-0 border-0">{unread}</Badge>}
            </div>
            {unread > 0 && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleMarkAll}>
                <CheckCheck className="w-3 h-3 mr-1" />
                {t("notif.markAllRead")}
              </Button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {recent.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                <Bell className="w-6 h-6 opacity-30" />
                <p className="text-xs">{t("notif.empty")}</p>
              </div>
            ) : (
              recent.map((n) => {
                const Icon = TYPE_ICONS[n.type] ?? Bell;
                return (
                  <div key={n.key} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 border-b border-border/50 last:border-0">
                    <div className={cn("mt-0.5 w-2 h-2 rounded-full shrink-0", PRIORITY_DOT[n.priority] ?? "bg-slate-400")} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Icon className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-xs font-medium text-muted-foreground truncate">
                          {t(`notif.type.${n.type}`)}
                        </span>
                      </div>
                      <p className="text-xs text-foreground leading-snug">{n.message}</p>
                    </div>
                    <button
                      className="shrink-0 text-muted-foreground hover:text-green-500 mt-0.5"
                      onClick={(e) => handleMarkRead(n.key, e)}
                      title={t("notif.markRead")}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-border">
            <a
              href="/notifications"
              className="block w-full text-center text-xs text-primary hover:underline font-medium"
              onClick={() => setOpen(false)}
            >
              {t("notif.viewAll")}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export function Topbar() {
  const { t, language, setLanguage } = useI18n();
  const { signOut } = useClerk();
  const { user } = useUser();

  const handleLogout = () => {
    signOut({ redirectUrl: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" });
  };

  return (
    <header className="h-16 bg-background border-b border-border flex items-center justify-between px-6 sticky top-0 z-10 w-full">
      <div className="flex-1">
        {/* Breadcrumb placeholder */}
      </div>

      <div className="flex items-center gap-3">
        <Select value={language} onValueChange={(val: any) => setLanguage(val)}>
          <SelectTrigger className="w-32 bg-card border-border h-9" data-testid="select-language">
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="fr">Français</SelectItem>
            <SelectItem value="ar">العربية</SelectItem>
          </SelectContent>
        </Select>

        <div className="h-8 w-px bg-border" />

        <NotificationBell />

        <div className="h-8 w-px bg-border" />

        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8 rounded-md border border-border">
            <AvatarImage src={user?.imageUrl} />
            <AvatarFallback className="rounded-md">
              {user?.firstName?.charAt(0) || "U"}
            </AvatarFallback>
          </Avatar>

          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 mr-2" />
            {t("nav.logout")}
          </Button>
        </div>
      </div>
    </header>
  );
}
