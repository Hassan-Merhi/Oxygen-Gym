import { useState, useRef, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LogOut, Bell, Check, CheckCheck, AlertCircle, Package, DollarSign, UserX, Snowflake, Sun, Moon, Menu, MoreVertical, Languages } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  NAVIGATION_LANGUAGE_OPTIONS,
  navigationCopy,
  type NavigationLanguage,
} from "@/lib/mobile-navigation";

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
    const handlePointerDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    if (open) {
      document.addEventListener("mousedown", handlePointerDown);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="ghost"
        size="icon"
        className="relative h-11 w-11 text-muted-foreground hover:text-foreground md:h-9 md:w-9"
        onClick={() => setOpen(v => !v)}
        aria-label={t("notif.bell")}
        aria-expanded={open}
        data-testid="btn-notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 end-[-2px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute end-0 z-50 mt-2 w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border bg-popover shadow-xl sm:w-80">
          <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold">{t("notif.title")}</span>
              {unread > 0 && (
                <Badge className="rounded-full border-0 bg-rose-500 px-1.5 py-0 text-xs text-white">
                  {unread}
                </Badge>
              )}
            </div>
            {unread > 0 && (
              <Button variant="ghost" size="sm" className="h-11 shrink-0 px-2 text-xs text-primary hover:text-primary md:h-7" onClick={handleMarkAll}>
                <CheckCheck className="me-1 h-3 w-3" />
                {t("notif.markAllRead")}
              </Button>
            )}
          </div>

          <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto overscroll-contain sm:max-h-80">
            {recent.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
                <Bell className="h-7 w-7 opacity-20" />
                <p className="text-xs">{t("notif.empty")}</p>
              </div>
            ) : (
              recent.map((n) => {
                const Icon = TYPE_ICONS[n.type] ?? Bell;
                return (
                  <div key={n.key} className="flex items-start gap-3 border-b border-border/40 px-4 py-3 transition-colors last:border-0 hover:bg-muted/40 focus-within:bg-muted/40">
                    <div className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", PRIORITY_DOT[n.priority] ?? "bg-slate-400")} />
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center gap-1.5">
                        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate text-xs font-medium text-muted-foreground">
                          {t(`notif.type.${n.type}`)}
                        </span>
                      </div>
                      <p className="text-xs leading-snug text-foreground">{n.message}</p>
                    </div>
                    <button
                      type="button"
                      className="-my-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      onClick={(e) => handleMarkRead(n.key, e)}
                      title={t("notif.markRead")}
                      aria-label={t("notif.markRead")}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-border bg-muted/20 px-4 py-2.5">
            <a
              href="/notifications"
              className="block min-h-11 w-full rounded-md py-3 text-center text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-h-0 sm:py-2"
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
  const navLanguage = language as NavigationLanguage;
  const copy = navigationCopy(navLanguage);

  const handleLogout = () => {
    logout();
    setLocation("/login");
  };

  const initials = user?.name
    ? user.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()
    : user?.username?.charAt(0).toUpperCase() ?? "U";

  const nextThemeLabel = theme === "dark" ? copy.lightMode : copy.darkMode;

  return (
    <header className="mobile-safe-topbar sticky top-0 z-20 flex h-16 w-full items-center justify-between border-b border-border/60 bg-background px-3 shadow-sm md:px-6">
      {/* Mobile primary navigation */}
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 text-muted-foreground hover:text-foreground md:hidden"
          onClick={openMobile}
          aria-label={copy.openMenu}
          data-testid="button-mobile-menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <span className="truncate text-sm font-semibold tracking-wide text-foreground md:hidden">OXYGEN GYM</span>
      </div>

      <div className="flex min-w-0 items-center gap-0.5 sm:gap-1.5 md:gap-2">
        {/* Desktop language selector */}
        <div className="hidden md:block">
          <Select value={language} onValueChange={(val) => setLanguage(val as NavigationLanguage)}>
            <SelectTrigger className="h-8 w-28 border-border/60 bg-muted/50 text-xs" data-testid="select-language">
              <SelectValue placeholder={copy.languageLabel} />
            </SelectTrigger>
            <SelectContent>
              {NAVIGATION_LANGUAGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="hidden h-8 w-8 text-muted-foreground hover:text-foreground md:inline-flex"
          onClick={toggle}
          aria-label={nextThemeLabel}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <div className="mx-1 hidden h-6 w-px bg-border md:block" />

        <NotificationBell />

        <div className="mx-1 hidden h-6 w-px bg-border md:block" />

        {/* Desktop user area */}
        <div className="hidden min-w-0 items-center gap-2.5 md:flex">
          <Avatar className="h-8 w-8 rounded-lg border border-primary/20 shadow-sm">
            <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-bold text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="flex min-w-0 flex-col leading-tight">
            <span className="max-w-32 truncate text-sm font-semibold text-foreground">{user?.name ?? user?.username}</span>
            <span className="text-[11px] capitalize text-muted-foreground">{user?.role}</span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2.5 text-muted-foreground hover:text-foreground"
            onClick={handleLogout}
            data-testid="button-logout"
            aria-label={t("nav.logout")}
          >
            <LogOut className="me-1.5 h-4 w-4" />
            <span className="text-sm">{t("nav.logout")}</span>
          </Button>
        </div>

        {/* Mobile secondary actions keep the 320px topbar uncluttered. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 text-muted-foreground hover:text-foreground md:hidden"
              aria-label={copy.moreActions}
              data-testid="button-mobile-actions"
            >
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <div className="px-2 py-2">
              <p className="truncate text-sm font-semibold text-foreground">{user?.name ?? user?.username}</p>
              <p className="text-xs capitalize text-muted-foreground">{user?.role}</p>
            </div>
            <DropdownMenuSeparator />
            <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Languages className="h-3.5 w-3.5" />{copy.languageLabel}</span>
            </div>
            {NAVIGATION_LANGUAGE_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                className="min-h-11 cursor-pointer"
                onSelect={() => setLanguage(option.value)}
              >
                <span className="flex-1">{option.label}</span>
                {language === option.value && <Check className="h-4 w-4 text-primary" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11 cursor-pointer" onSelect={toggle}>
              {theme === "dark" ? <Sun className="me-2 h-4 w-4" /> : <Moon className="me-2 h-4 w-4" />}
              {nextThemeLabel}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 cursor-pointer text-destructive focus:text-destructive"
              onSelect={handleLogout}
              data-testid="button-mobile-logout"
            >
              <LogOut className="me-2 h-4 w-4" />
              {t("nav.logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
