import { useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, Dumbbell, CreditCard, Package, FlaskConical,
  TrendingUp, Settings, BookOpen, BarChart3, BookLock,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetMe } from "@/hooks/use-me";
import { useSidebarStore } from "@/lib/sidebar-store";
import { directionForNavigationLanguage, navigationCopy, type NavigationLanguage } from "@/lib/mobile-navigation";
import {
  SIDEBAR_MOBILE_CLOSED_TRANSFORM,
  SIDEBAR_MOBILE_OPEN_TRANSFORM,
} from "./sidebar-visibility";

const NAV_ITEMS = [
  { id: "dashboard", href: "/dashboard", icon: LayoutDashboard, labelKey: "nav.dashboard", allOf: ["dashboard", "viewProfit"] },
  { id: "members", href: "/members", icon: Users, labelKey: "nav.members", allOf: ["members"] },
  { id: "members-overview", href: "/members-overview", icon: BarChart3, labelOverride: "memberOverview", allOf: ["members"] },
  { id: "plans", href: "/plans", icon: Dumbbell, labelKey: "nav.plans", allOf: ["plans"] },
  { id: "payments", href: "/payments", icon: CreditCard, labelKey: "nav.cashbook", allOf: ["payments"] },
  { id: "accounts", href: "/accounts", icon: BookOpen, labelKey: "nav.accounts", allOf: ["accounts", "viewAccounting"] },
  { id: "financials", href: "/financials", icon: BarChart3, labelKey: "nav.financials", allOf: ["viewAccounting", "viewProfit", "viewCost"] },
  { id: "stock", href: "/stock", icon: Package, labelKey: "nav.stock", allOf: ["stock"] },
  { id: "supplements", href: "/supplements", icon: FlaskConical, labelKey: "nav.supplements", allOf: ["stock", "viewCost", "viewProfit"] },
  { id: "sales", href: "/sales", icon: TrendingUp, labelKey: "nav.sales", allOf: ["sales"] },
  { id: "settings", href: "/settings", icon: Settings, labelKey: "nav.settings", allOf: ["manageSettings"] },
  { id: "period-reset", href: "/period-reset", icon: BookLock, labelOverride: "periodReset", allOf: ["manageSettings"], adminOnly: true },
] as const;

export function Sidebar() {
  const { t, language } = useI18n();
  const [location] = useLocation();
  const me = useGetMe();
  const { collapsed, toggle, mobileOpen, openMobile, closeMobile } = useSidebarStore();
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

  useEffect(() => { closeMobile(); }, [location, closeMobile]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const lockBody = window.matchMedia("(max-width: 1023px)").matches;
    if (lockBody) document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeMobile(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (lockBody) document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen, closeMobile]);

  // Tailwind breakpoints: < md = phone drawer, md..lg = tablet icon rail that
  // expands as an overlay, >= lg = docked sidebar the user can collapse.
  const railLabel = cn(!mobileOpen && "md:max-lg:sr-only", collapsed && "lg:sr-only");
  const railHidden = cn(!mobileOpen && "md:max-lg:hidden", collapsed && "lg:hidden");
  const railCentered = cn(!mobileOpen && "md:max-lg:justify-center md:max-lg:px-2", collapsed && "lg:justify-center lg:px-2");
  const ToggleOpenIcon = isRtl ? PanelRightOpen : PanelLeftOpen;
  const ToggleCloseIcon = isRtl ? PanelRightClose : PanelLeftClose;

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden" onClick={closeMobile} aria-hidden="true" />}
      <aside
        id="app-sidebar"
        className={cn(
          "mobile-safe-sidebar fixed top-0 start-0 z-40 flex h-full w-64 flex-col border-e border-sidebar-border bg-sidebar transition-[transform,width] duration-300",
          !mobileOpen && "md:max-lg:w-16",
          mobileOpen && "md:max-lg:shadow-2xl",
          collapsed && "lg:w-16",
          mobileOpen ? SIDEBAR_MOBILE_OPEN_TRANSFORM : SIDEBAR_MOBILE_CLOSED_TRANSFORM
        )}
        aria-label={t("nav.mainNavigation")}
      >
        <div className="flex h-16 items-center gap-3 overflow-hidden border-b border-sidebar-border px-3">
          <div className={cn("h-8 w-8 shrink-0 rounded-lg bg-primary flex items-center justify-center shadow-sm")}>
            <img src={`${import.meta.env.BASE_URL}gym-logo.jpg`} alt="" className="h-8 w-8 rounded-lg object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          </div>
          <span className={cn("flex-1 truncate text-start text-base font-bold tracking-tight text-white", railHidden)}>OXYGEN GYM</span>
          <button type="button" onClick={closeMobile} className={cn("flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", mobileOpen ? "lg:hidden" : "md:hidden")} aria-label={copy.closeMenu}><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain py-3">
          <nav className="space-y-0.5 px-2">
            {visibleItems.map((item) => {
              const isActive = item.href === "/members" ? location === "/members" || location.startsWith("/members/") : location.startsWith(item.href);
              const label = getLabel(item);
              return (
                <Link key={item.id} href={item.href} title={label} onClick={closeMobile}
                  aria-current={isActive ? "page" : undefined}
                  className={cn("group relative flex min-h-11 touch-manipulation items-center gap-3 rounded-lg px-3 py-2 text-start text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:min-h-10 pointer-coarse:min-h-11", railCentered, isActive ? "bg-primary/20 text-white" : "text-sidebar-foreground hover:bg-white/5 hover:text-white focus-visible:bg-white/5 focus-visible:text-white")}
                  data-testid={`nav-${item.id}`}>
                  {isActive && <span className={cn("absolute top-1/2 start-0 h-6 w-[3px] -translate-y-1/2 rounded-e-full bg-primary", railHidden)} />}
                  <item.icon className={cn("h-4 w-4 shrink-0 transition-colors", isActive ? "text-primary" : "text-sidebar-foreground group-hover:text-white group-focus-visible:text-white")} aria-hidden="true" />
                  <span className={cn("truncate transition-colors", railLabel)}>{label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        {/* Tablet: the rail expands as an overlay instead of squeezing the page. */}
        <div className="hidden border-t border-sidebar-border p-2 md:block lg:hidden">
          <button type="button" onClick={mobileOpen ? closeMobile : openMobile} aria-expanded={mobileOpen} aria-controls="app-sidebar"
            title={mobileOpen ? copy.collapse : copy.expand} aria-label={mobileOpen ? copy.collapse : copy.expand}
            className={cn("flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-foreground transition-all hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", !mobileOpen && "justify-center px-2")}>
            {mobileOpen ? <><ToggleCloseIcon className="h-4 w-4 shrink-0" /><span>{copy.collapse}</span></> : <ToggleOpenIcon className="h-4 w-4 shrink-0" />}
          </button>
        </div>
        {/* Desktop: persistent collapse preference. */}
        <div className="hidden border-t border-sidebar-border p-2 lg:block">
          <button type="button" onClick={toggle} title={collapsed ? copy.expand : copy.collapse} aria-label={collapsed ? copy.expand : copy.collapse} aria-expanded={!collapsed} aria-controls="app-sidebar"
            className={cn("flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-foreground transition-all hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary pointer-coarse:min-h-11", collapsed && "justify-center px-2")}>
            {collapsed ? <ToggleOpenIcon className="h-4 w-4 shrink-0" /> : <><ToggleCloseIcon className="h-4 w-4 shrink-0" /><span>{copy.collapse}</span></>}
          </button>
        </div>
      </aside>
    </>
  );
}
