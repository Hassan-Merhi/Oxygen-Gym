import { useState, useRef, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LogOut, Bell, Check, CheckCheck, AlertCircle, Package, DollarSign, UserX, Snowflake, Sun, Moon, Menu } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { useTheme } from "@/lib/theme";
import { useSidebarStore } from "@/lib/sidebar-store";

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

const NOTIFICATION_COUNT_REFRESH_MS = 2 * 60 * 1000;
const NOTIFICATION_COUNT_STALE_MS = 60 * 1000;

function NotificationBell() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const unreadQueryKey = getListNotificationsQueryKey({ read: "unread" } as any);

  // Notifications are useful, but they do not need to create a database-backed
  // request every 30 seconds on every open browser tab. Keep the badge fresh
  // enough for the UI while relying on explicit mutation invalidation for
  // immediate updates after the user marks notifications read.
  const { data: countData } = useGetNotificationCount({
    query: {
      queryKey: ["getNotificationCount"],
      staleTime: NOTIFICATION_COUNT_STALE_MS,
      refetchInterval: NOTIFICATION_COUNT_REFRESH_MS,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
    }
  });
  const unread = countData?.unread ?? 0;

  const { data } = useListNotifications({ read: "unread" } as any, {
    query: {
      queryKey: unreadQueryKey,
      enabled: open,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    }
  });
  const recent = (data?.items ?? []).slice(0, 8);

  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: unreadQueryKey });
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
        className="relative h-11 w-11 text-muted-foreground hover:text-foreground md:h-9 md:w-9"
        onClick={() => setOpen(v => !v)}
        aria-label={t("notif.bell")}
        data-testid="btn-notifications"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold px-1 leading-none ring-2 ring-background">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute end-0 mt-2 w-72 sm:w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-popover shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{t("notif.title")}</span>
              {unread > 0 && (
                <Badge className="bg-rose-500 text-white text-xs px-1.5 py-0 border-0 rounded-full">
                  {unread}
                </Badge>
              )}
            </div>
            {unread > 0 && (
              <Button variant="ghost" size="sm" className="h-11 px-2 text-xs text-primary hover:text-primary md:h-7" onClick={handleMarkAll}>
                <CheckCheck className="w-3 h-3 mr-1" />
                {t("notif.markAllRead")}
              </Button>
            )}
          </div>

          <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto overscroll-contain sm:max-h-80">
            {recent.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                <Bell className="w-7 h-7 opacity-20" />
                <p className="text-xs">{t("notif.empty")}</p>
              </div>
            ) : (
              recent.map((n) => {
                const Icon = TYPE_ICONS[n.type] ?? Bell;
                return (
                  <div key={n.key} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40 border-b border-border/40 last:border-0 transition-colors">
                    <div className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", PRIORITY_DOT[n.priority] ?? "bg-slate-400")} />
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
                      className="-my-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-emerald-500"
                      onClick={(e) => handleMarkRead(n.key, e)}
                      title={t("notif.markRead")}
                      aria-label={t("notif.markRead")}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="px-4 py-2.5 border-t border-border bg-muted/20">
            <a
              href="/notifications"
              className="block w-full py-2 text-center text-xs text-primary hover:underline font-medium"
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
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { theme, toggle } = useTheme();
  const { openMobile } = useSidebarStore();

  const handleLogout = () => {
    logout();
    setLocation("/login");
  };

  const initials = user?.name
    ? user.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()
    : user?.username?.charAt(0).toUpperCase() ?? "U";

  return (
    <header className="mobile-safe-topbar h-16 bg-background border-b border-border/60 flex items-center justify-between px-3 md:px-6 sticky top-0 z-20 w-full shadow-sm">
      {/* Left: hamburger on mobile */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden h-11 w-11 text-muted-foreground hover:text-foreground"
          onClick={openMobile}
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex min-w-0 items-center gap-0.5 sm:gap-1.5 md:gap-2">
        {/* Language selector */}
        <div className="hidden md:block">
          <Select value={language} onValueChange={(val: any) => setLanguage(val)}>
            <SelectTrigger className="w-28 h-8 text-xs bg-muted/50 border-border/60" data-testid="select-language">
              <SelectValue placeholder="Language" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="fr">Français</SelectItem>
              <SelectItem value="ar">العربية</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="md:hidden h-11 min-w-11 px-2 text-xs font-bold tracking-wide text-muted-foreground hover:text-foreground"
          onClick={() => {
            const langs = ["en", "fr", "ar"] as const;
            const next = langs[(langs.indexOf(language as typeof langs[number]) + 1) % langs.length];
            setLanguage(next);
          }}
          aria-label="Change language"
          data-testid="select-language"
        >
          {language.toUpperCase()}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 text-muted-foreground hover:text-foreground md:h-8 md:w-8"
          onClick={toggle}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>

        <div className="hidden md:block h-6 w-px bg-border mx-1" />

        <NotificationBell />

        <div className="hidden md:block h-6 w-px bg-border mx-1" />

        {/* User area */}
        <div className="flex min-w-0 items-center gap-0.5 sm:gap-2 md:gap-2.5">
          <Avatar className="hidden h-8 w-8 rounded-lg border border-primary/20 shadow-sm sm:block">
            <AvatarFallback className="rounded-lg text-xs font-bold bg-primary/10 text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="hidden sm:flex flex-col leading-tight min-w-0">
            <span className="max-w-32 truncate text-sm font-semibold text-foreground">{user?.name ?? user?.username}</span>
            <span className="text-[11px] text-muted-foreground capitalize">{user?.role}</span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-11 min-w-11 px-2 text-muted-foreground hover:text-foreground md:h-8 md:px-2.5"
            onClick={handleLogout}
            data-testid="button-logout"
            aria-label={t("nav.logout")}
          >
            <LogOut className="w-4 h-4 md:me-1.5" />
            <span className="hidden md:inline text-sm">{t("nav.logout")}</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
