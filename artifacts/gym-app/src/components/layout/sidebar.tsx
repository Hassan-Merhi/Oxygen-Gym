import { useI18n } from "@/lib/i18n";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  Dumbbell,
  UserCog,
  CreditCard,
  Package,
  TrendingUp,
  Settings,
  BookOpen,
  BarChart3,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetMe } from "@/hooks/use-me";
import { useSidebarStore } from "@/lib/sidebar-store";

const NAV_ITEMS = [
  { id: "dashboard",  href: "/dashboard",  icon: LayoutDashboard, labelKey: "nav.dashboard",  permKey: "dashboard"      },
  { id: "members",    href: "/members",    icon: Users,           labelKey: "nav.members",    permKey: "members"        },
  { id: "plans",      href: "/plans",      icon: Dumbbell,        labelKey: "nav.plans",      permKey: "plans"          },
  { id: "staff",      href: "/staff",      icon: UserCog,         labelKey: "nav.staff",      permKey: "staff"          },
  { id: "payments",   href: "/payments",   icon: CreditCard,      labelKey: "nav.cashbook",   permKey: "payments"       },
  { id: "accounts",   href: "/accounts",   icon: BookOpen,        labelKey: "nav.accounts",   permKey: "accounts"       },
  { id: "financials", href: "/financials", icon: BarChart3,       labelKey: "nav.financials", permKey: "viewAccounting" },
  { id: "stock",      href: "/stock",      icon: Package,         labelKey: "nav.stock",      permKey: "stock"          },
  { id: "sales",      href: "/sales",      icon: TrendingUp,      labelKey: "nav.sales",      permKey: "sales"          },
  { id: "settings",   href: "/settings",   icon: Settings,        labelKey: "nav.settings",   permKey: "settings"       },
] as const;

export function Sidebar() {
  const { t } = useI18n();
  const [location] = useLocation();
  const me = useGetMe();
  const { collapsed, toggle, mobileOpen, closeMobile } = useSidebarStore();

  const isAdmin = me?.role === "admin" || me?.role === "manager";
  const perms = me?.permissions as Record<string, boolean> | undefined;

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!me) return false;
    if (isAdmin) return true;
    return !!perms?.[item.permKey];
  });

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={closeMobile}
        />
      )}

      <aside
        className={cn(
          "bg-sidebar border-r border-sidebar-border h-full flex flex-col fixed left-0 top-0 z-40 transition-all duration-300",
          collapsed ? "w-16" : "w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        {/* Logo header */}
        <div className="h-16 flex items-center border-b border-sidebar-border overflow-hidden px-3 gap-3">
          <img
            src="/gym-logo.jpg"
            alt="Oxygen Fitness Gym"
            className="h-8 w-8 shrink-0 rounded object-cover"
          />
          {!collapsed && (
            <span className="font-bold text-lg text-sidebar-foreground tracking-tight truncate flex-1">
              OXYGEN GYM
            </span>
          )}
          {/* Mobile close button */}
          {!collapsed && (
            <button
              onClick={closeMobile}
              className="md:hidden shrink-0 text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-4">
          <nav className="space-y-1 px-2">
            {visibleItems.map((item) => {
              const isActive = location.startsWith(item.href);
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  title={collapsed ? t(item.labelKey) : undefined}
                  onClick={closeMobile}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                    collapsed && "justify-center px-2",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                  )}
                  data-testid={`nav-${item.id}`}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  {!collapsed && t(item.labelKey)}
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
              "flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors",
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
