import { CreditCard, UserCog, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmployeeRecordsTab } from "@/components/staff/employee-records";
import { PayrollTab } from "@/components/staff/payroll-tab";

export { EmployeeRecordsTab } from "@/components/staff/employee-records";
export { LoginUsersTab } from "@/components/staff/login-users";

export default function StaffPage() {
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      <PageHeader
        icon={UserCog}
        iconClass="bg-violet-500/10 text-violet-700 dark:text-violet-400"
        title={t("staff.title")}
        subtitle={t("staff.subtitle")}
      />

      <Tabs defaultValue="staff">
        <TabsList className="h-auto min-h-10 flex-wrap">
          <TabsTrigger value="staff" className="gap-2 pointer-coarse:min-h-11">
            <Users className="h-4 w-4" aria-hidden="true" />
            {t("staff.tabEmployees")}
          </TabsTrigger>
          <TabsTrigger value="payroll" className="gap-2 pointer-coarse:min-h-11">
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            {t("nav.payroll")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="staff" className="mt-6">
          <EmployeeRecordsTab />
        </TabsContent>

        <TabsContent value="payroll" className="mt-6">
          <PayrollTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
