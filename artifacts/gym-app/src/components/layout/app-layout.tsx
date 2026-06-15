import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { useSidebarStore } from "@/lib/sidebar-store";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const collapsed = useSidebarStore((s) => s.collapsed);
  return (
    <div className="min-h-[100dvh] flex w-full bg-muted/20">
      <Sidebar />
      <div
        className={`flex-1 flex flex-col transition-all duration-300 ${
          collapsed ? "md:ltr:ml-16 md:rtl:mr-16" : "md:ltr:ml-64 md:rtl:mr-64"
        }`}
      >
        <Topbar />
        <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
