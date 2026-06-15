import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  icon?: React.ElementType;
  iconClass?: string;
  title: ReactNode;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
  noBorder?: boolean;
}

export function PageHeader({
  icon: Icon,
  iconClass = "bg-primary/10 text-primary",
  title,
  subtitle,
  actions,
  className,
  noBorder = false,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4",
        !noBorder && "pb-5 border-b border-border/60",
        className,
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className={cn("p-2 rounded-xl shrink-0", iconClass)}>
            <Icon className="w-5 h-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-0.5 truncate">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
}
