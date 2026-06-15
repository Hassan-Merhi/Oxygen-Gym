import { cn } from "@/lib/utils";

const STATUS_CLASSES: Record<string, string> = {
  active:   "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  expired:  "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  frozen:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  inactive: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  archived: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500",
};

interface StatusBadgeProps {
  status: string;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        STATUS_CLASSES[status] ?? STATUS_CLASSES.inactive,
        className,
      )}
    >
      {label ?? status}
    </span>
  );
}
