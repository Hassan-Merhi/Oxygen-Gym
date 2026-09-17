import { useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  Dumbbell,
  CreditCard,
  Package,
  FlaskConical,
  TrendingUp,
  Settings,
  BookOpen,
  BarChart3,
  RefreshCcw,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetMe } from "@/hooks/use-me";
import { useSidebarStore } from "@/lib/sidebar-store";
import {
  directionForNavigationLanguage,
  navigationCopy,
  type NavigationLanguage,
} from "@/lib/mobile-navigation";

const NAV_ITEMS = [
  { id: "dashboard",        href: "/dashboard",        icon: LayoutDashboard, labelKey: "nav.dashboard",  allOf: ["dashboard", "viewProfit"] },
  { id: "members",          href: "/members",          icon: Users,           labelKey: "nav.members",    allOf: ["members"] },
  { id: "members-overview", href: "/members-overview", icon: BarChart3,       labelOverride: "memberOverview", allOf: ["members"] },
  { id: "plans",            href: "/plans",            icon: Dumbbell,        labelKey: "nav.plans",      allOf: ["plans"] },
  { id: "payments",         href: "/payments",         icon: CreditCard,      labelKey: "nav.cashbook",   allOf: ["payments"] },
  { id: "accounts",         href: "/accounts",         icon: BookOpen,        labelKey: "nav.accounts",   allOf: ["accounts", "viewAccounting"] },
  { id: "financials",       href: "/financials",       icon: BarChart3,       labelKey: "nav.financials", allOf: ["viewAccounting", "viewProfit", "viewCost"] },
  { id: "stock",            href: "/stock",            icon: Package,         labelKey: "nav.stock",      allOf: ["stock"] },
  { id: "supplements",      href: "/supplements",      icon: FlaskConical,    labelKey: "nav.supplements",allOf: ["stock", "viewCost", "viewProfit"] },
  { id: "sales",            href: "/sales",            icon: TrendingUp,      labelKey: "nav.sales",      allOf: ["sales"] },
  { id: "settings",         href: "/settings",         icon: Settings,        labelKey: "nav.settings",   allOf: ["manageSettings"] },
  { id: "period-reset",     href: "/period-reset",     icon: RefreshCcw,      labelOverride: "periodReset", allOf: ["manageSettings"], adminOnly: true },
] as const;

export function Sidebar() {
  const { t, language } = useI18n();
  const [location] = useLocation();
  const me = useGetMe();
  const { collapsed, toggle, mobileOpen, closeMobile } = useSidebarStore();
  const navLanguage = language as NavigationLanguage;
  const copy = navigationCopy(navLanguage);
  const isRtl = directionForNavigationLanguage(navLanguage) === "rtl";

  const isAdmin = me?.role === "admin";
  const perms = me?.permissions as Record<string, boolean> | undefined;

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!me) return false;
    if ("adminOnly" in item && item.adminOnly) return isAdmin;
    if (isAdmin) return true;
    return item.allOf.every((permission) => perms?.[permission] === true);
  });

  const getLabel = (item: (typeof NAV_ITEMS)[number]) =>
    "labelOverride" in item ? copy[item.labelOverride] : t(item.labelKey);

  useEffect(() => {
    closeMobile();
  }, [location, closeMobile]);

  useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    const lockBody = window.matchMedia("(max-width: 767px)").matches;
    if (lockBody) document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobile();
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (lockBody) document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen, closeMobile]);

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "mobile-safe-sidebar fixed top-0 z-40 flex h-full w-64 flex-col bg-sidebar border-sidebar-border transition-transform duration-300 ltr:left-0 ltr:border-r rtl:right-0 rtl:border-l",
          collapsed && "md:w-16",
          mobileOpen
            ? "translate-x-0"
            : "ltr:-translate-x-full rtl:translate-x-full md:translate-x-0"
        )}
        aria-label={copy.openMenu}
      >
        {/* Logo header */}
        <div className="flex h-16 items-center gap-3 overflow-hidden border-b border-sidebar-border px-3">
          <div className="h-8 w-8 shrink-0 rounded-lg bg-primary flex items-center justify-center shadow-sm">
            <img
              src="/gym-logo.jpg"
              alt="Oxygen Fitness Gym"
              className="h-8 w-8 rounded-lg object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
          <span className={cn(
            "flex-1 truncate text-start text-base font-bold tracking-tight text-white",
            collapsed && "md:hidden"
          )}>
            OXYGEN GYM
          </span>
          <button
            type="button"
            onClick={closeMobile}
            className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:hidden"
            aria-label={copy.closeMenu}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto overscroll-contain py-3">
          <nav className="space-y-0.5 px-2">
            {visibleItems.map((item) => {
              const isActive = item.href === "/members"
                ? location === "/members" || location.startsWith("/members/")
                : location.startsWith(item.href);
              const label = getLabel(item);
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  title={collapsed ? label : undefined}
                  onClick={closeMobile}
                  className={cn(
                    "group relative flex min-h-11 touch-manipulation items-center gap-3 rounded-lg px-3 py-2.5 text-start text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:min-h-0",
                    collapsed && "md:justify-center md:px-2",
                    isActive
                      ? "bg-primary/20 text-white"
                      : "text-sidebar-foreground hover:bg-white/5 hover:text-white focus-visible:bg-white/5 focus-visible:text-white"
                  )}
                  data-testid={`nav-${item.id}`}
                >
                  {/* Logical-edge accent bar for the active item */}
                  {isActive && (
                    <span className={cn(
                      "absolute top-1/2 h-6 w-[3px] -translate-y-1/2 bg-primary ltr:left-0 ltr:rounded-r-full rtl:right-0 rtl:rounded-l-full",
                      collapsed && "md:hidden"
                    )} />
                  )}
                  <item.icon className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    isActive ? "text-primary" : "text-sidebar-foreground group-hover:text-white group-focus-visible:text-white"
                  )} />
                  <span className={cn(
                    "transition-colors",
                    collapsed && "md:hidden"
                  )}>
                    {label}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Collapse toggle — desktop only */}
        <div className="hidden border-t border-sidebar-border p-2 md:block">
          <button
            type="button"
            onClick={toggle}
            title={collapsed ? copy.expand : copy.collapse}
            aria-label={collapsed ? copy.expand : copy.collapse}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-foreground transition-all hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              collapsed && "justify-center px-2"
            )}
          >
            {collapsed ? (
              isRtl ? <PanelRightOpen className="h-4 w-4 shrink-0" /> : <PanelLeftOpen className="h-4 w-4 shrink-0" />
            ) : (
              <>
                {isRtl ? <PanelRightClose className="h-4 w-4 shrink-0" /> : <PanelLeftClose className="h-4 w-4 shrink-0" />}
                <span>{copy.collapse}</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
