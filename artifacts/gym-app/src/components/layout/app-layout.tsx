import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { useSidebarStore } from "@/lib/sidebar-store";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  children: React.ReactNode;
}

/**
 * Responsive shell:
 * - phone (< md): off-canvas drawer opened from the topbar
 * - tablet (md..lg): 64px icon rail; expanding it overlays the content
 * - desktop (>= lg): docked 256px sidebar, collapsible to the rail
 */
export function AppLayout({ children }: AppLayoutProps) {
  const collapsed = useSidebarStore((s) => s.collapsed);
  return (
    <div className="min-h-[100dvh] flex w-full overflow-x-clip bg-muted/20">
      <Sidebar />
      <div
        className={cn(
          "flex-1 min-w-0 flex flex-col transition-[margin] duration-300 md:ms-16",
          collapsed ? "lg:ms-16" : "lg:ms-64",
        )}
      >
        <Topbar />
        <main id="main-content" className="mobile-safe-x flex-1 p-4 md:p-6 xl:p-8 max-w-7xl mx-auto w-full min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
