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
        "flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
        !noBorder && "pb-5 border-b border-border/60",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3 sm:items-center">
        {Icon && (
          <div className={cn("p-2 rounded-xl shrink-0", iconClass)}>
            <Icon className="w-5 h-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground leading-tight break-words">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-0.5 break-words sm:truncate">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}
