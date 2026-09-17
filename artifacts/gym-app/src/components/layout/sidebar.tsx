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
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetMe } from "@/hooks/use-me";
import { useSidebarStore } from "@/lib/sidebar-store";

const NAV_ITEMS = [
  { id: "dashboard",        href: "/dashboard",        icon: LayoutDashboard, labelKey: "nav.dashboard",  allOf: ["dashboard", "viewProfit"] },
  { id: "members",          href: "/members",          icon: Users,           labelKey: "nav.members",    allOf: ["members"] },
  { id: "members-overview", href: "/members-overview", icon: BarChart3,       labelOverride: "Member Overview", allOf: ["members"] },
  { id: "plans",            href: "/plans",            icon: Dumbbell,        labelKey: "nav.plans",      allOf: ["plans"] },
  { id: "payments",         href: "/payments",         icon: CreditCard,      labelKey: "nav.cashbook",   allOf: ["payments"] },
  { id: "accounts",         href: "/accounts",         icon: BookOpen,        labelKey: "nav.accounts",   allOf: ["accounts", "viewAccounting"] },
  { id: "financials",       href: "/financials",       icon: BarChart3,       labelKey: "nav.financials", allOf: ["viewAccounting", "viewProfit", "viewCost"] },
  { id: "stock",            href: "/stock",            icon: Package,         labelKey: "nav.stock",      allOf: ["stock"] },
  { id: "supplements",      href: "/supplements",      icon: FlaskConical,    labelKey: "nav.supplements",allOf: ["stock", "viewCost", "viewProfit"] },
  { id: "sales",            href: "/sales",            icon: TrendingUp,      labelKey: "nav.sales",      allOf: ["sales"] },
  { id: "settings",         href: "/settings",         icon: Settings,        labelKey: "nav.settings",   allOf: ["manageSettings"] },
  { id: "period-reset",     href: "/period-reset",     icon: RefreshCcw,      labelOverride: "New Period / Reset", allOf: ["manageSettings"], adminOnly: true },
] as const;

export function Sidebar() {
  const { t } = useI18n();
  const [location] = useLocation();
  const me = useGetMe();
  const { collapsed, toggle, mobileOpen, closeMobile } = useSidebarStore();

  const isAdmin = me?.role === "admin";
  const perms = me?.permissions as Record<string, boolean> | undefined;

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!me) return false;
    if ("adminOnly" in item && item.adminOnly) return isAdmin;
    if (isAdmin) return true;
    return item.allOf.every((permission) => perms?.[permission] === true);
  });

  const getLabel = (item: (typeof NAV_ITEMS)[number]) =>
    "labelOverride" in item ? item.labelOverride : t(item.labelKey);

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden"
          onClick={closeMobile}
        />
      )}

      <aside
        className={cn(
          "bg-sidebar border-r border-sidebar-border h-full flex flex-col fixed left-0 top-0 z-40 transition-all duration-300",
          "w-64",
          collapsed && "md:w-16",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        {/* Logo header */}
        <div className="h-16 flex items-center border-b border-sidebar-border overflow-hidden px-3 gap-3">
          <div className="shrink-0 h-8 w-8 rounded-lg bg-primary flex items-center justify-center shadow-sm">
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
            "font-bold text-base text-white tracking-tight truncate flex-1",
            collapsed && "md:hidden"
          )}>
            OXYGEN GYM
          </span>
          <button
            onClick={closeMobile}
            className="md:hidden shrink-0 text-sidebar-foreground/60 hover:text-white transition-colors"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-3">
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
                    "relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group",
                    collapsed && "md:justify-center md:px-2",
                    isActive
                      ? "bg-primary/20 text-white"
                      : "text-sidebar-foreground hover:bg-white/5 hover:text-white"
                  )}
                  data-testid={`nav-${item.id}`}
                >
                  {/* Left accent bar for active item */}
                  {isActive && (
                    <span className={cn(
                      "absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-primary",
                      collapsed && "md:hidden"
                    )} />
                  )}
                  <item.icon className={cn(
                    "w-4 h-4 shrink-0 transition-colors",
                    isActive ? "text-primary" : "text-sidebar-foreground group-hover:text-white"
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
        <div className="border-t border-sidebar-border p-2 hidden md:block">
          <button
            onClick={toggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-sidebar-foreground hover:bg-white/5 hover:text-white transition-all",
              collapsed && "justify-center px-2"
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4 shrink-0" />
            ) : (
              <>
                <PanelLeftClose className="w-4 h-4 shrink-0" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}