import { useI18n } from "@/lib/i18n";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  Dumbbell,
  UserCog,
  CreditCard,
  Ticket,
  Briefcase,
  Package,
  TrendingUp,
  Settings,
  BookOpen,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { id: "dashboard", href: "/dashboard", icon: LayoutDashboard, labelKey: "nav.dashboard" },
  { id: "members", href: "/members", icon: Users, labelKey: "nav.members" },
  { id: "plans", href: "/plans", icon: Dumbbell, labelKey: "nav.plans" },
  { id: "staff", href: "/staff", icon: UserCog, labelKey: "nav.staff" },
  { id: "payments", href: "/payments", icon: CreditCard, labelKey: "nav.payments" },
  { id: "vouchers", href: "/vouchers", icon: Ticket, labelKey: "nav.vouchers" },
  { id: "accounts", href: "/accounts", icon: BookOpen, labelKey: "nav.accounts" },
  { id: "financials", href: "/financials", icon: BarChart3, labelKey: "nav.financials" },
  { id: "stock", href: "/stock", icon: Package, labelKey: "nav.stock" },
  { id: "sales", href: "/sales", icon: TrendingUp, labelKey: "nav.sales" },
  { id: "settings", href: "/settings", icon: Settings, labelKey: "nav.settings" },
];

export function Sidebar() {
  const { t } = useI18n();
  const [location] = useLocation();

  return (
    <aside className="w-64 bg-sidebar border-r border-sidebar-border h-full flex flex-col fixed left-0 top-0 z-10">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
        <img src="/gym-logo.jpg" alt="Oxygen Fitness Gym" className="h-8 w-8 mr-3 rounded object-cover" />
        <span className="font-bold text-lg text-sidebar-foreground tracking-tight">OXYGEN GYM</span>
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        <nav className="space-y-1 px-3">
          {NAV_ITEMS.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link
                key={item.id}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                )}
                data-testid={`nav-${item.id}`}
              >
                <item.icon className="w-4 h-4" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
