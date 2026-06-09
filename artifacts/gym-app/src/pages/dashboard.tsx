import { useI18n } from "@/lib/i18n";
import { useGetMe } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, CreditCard, Receipt, CalendarCheck, Clock, PackageX, TrendingUp } from "lucide-react";

export default function Dashboard() {
  const { t } = useI18n();
  const { data: me, isLoading } = useGetMe();

  const kpis = [
    { id: "active-members", icon: Users, labelKey: "dashboard.activeMembers" },
    { id: "monthly-revenue", icon: CreditCard, labelKey: "dashboard.monthlyRevenue" },
    { id: "monthly-expenses", icon: Receipt, labelKey: "dashboard.monthlyExpenses" },
    { id: "today-checkins", icon: CalendarCheck, labelKey: "dashboard.todayCheckins" },
    { id: "expiring-soon", icon: Clock, labelKey: "dashboard.expiringSoon" },
    { id: "low-stock", icon: PackageX, labelKey: "dashboard.lowStock" },
    { id: "total-profit", icon: TrendingUp, labelKey: "dashboard.totalProfit" },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{t("dashboard.title")}</h1>
        <p className="text-muted-foreground mt-1">
          {isLoading ? <Skeleton className="h-5 w-48" /> : `${t("dashboard.welcome")}, ${me?.name}`}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.id} className="overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm shadow-sm transition-all hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t(kpi.labelKey)}
              </CardTitle>
              <kpi.icon className="w-4 h-4 text-primary opacity-70" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground mb-2">
                <Skeleton className="h-8 w-24" />
              </div>
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}