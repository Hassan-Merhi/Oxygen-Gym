import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { Search } from "lucide-react";

interface EmptyTableStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  colSpan?: number;
  className?: string;
}

export function EmptyTableState({
  icon: Icon = Search,
  title,
  description,
  colSpan = 99,
  className,
}: EmptyTableStateProps) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <div className={cn("flex flex-col items-center justify-center py-14 gap-2 text-center", className)}>
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-1">
            <Icon className="w-6 h-6 text-muted-foreground/60" />
          </div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description && (
            <p className="text-xs text-muted-foreground max-w-[240px]">{description}</p>
          )}
        </div>
      </td>
    </tr>
  );
}
