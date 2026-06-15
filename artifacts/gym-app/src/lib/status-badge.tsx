import { cn } from "@/lib/utils";

const MEMBER_STATUS_CLASSES: Record<string, string> = {
  active:   "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  expired:  "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  frozen:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  inactive: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  archived: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500",
};

const PAYROLL_STATUS_CLASSES: Record<string, string> = {
  draft:     "bg-amber-100 text-amber-700 border border-amber-200/60 dark:bg-amber-900/20 dark:text-amber-400",
  paid:      "bg-emerald-100 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-900/20 dark:text-emerald-400",
  cancelled: "bg-slate-100 text-slate-500 border border-slate-200/60 dark:bg-slate-800 dark:text-slate-400",
};

const STAFF_STATUS_CLASSES: Record<string, string> = {
  active:   "bg-emerald-500/10 text-emerald-600 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400",
  inactive: "bg-slate-100 text-slate-500 border border-slate-200 dark:bg-slate-800 dark:text-slate-400",
};

const PRODUCT_STATUS_CLASSES: Record<string, string> = {
  active:   "bg-emerald-100 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-900/20 dark:text-emerald-400",
  archived: "bg-amber-100 text-amber-700 border border-amber-200/60 dark:bg-amber-900/20 dark:text-amber-400",
  deleted:  "bg-rose-100 text-rose-700 border border-rose-200/60 dark:bg-rose-900/20 dark:text-rose-400",
};

interface BadgeProps {
  status: string;
  label?: string;
  className?: string;
}

function BaseBadge({
  statusClass,
  label,
  className,
}: {
  statusClass: string;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        statusClass,
        className,
      )}
    >
      {label}
    </span>
  );
}

export function StatusBadge({ status, label, className }: BadgeProps) {
  return (
    <BaseBadge
      statusClass={MEMBER_STATUS_CLASSES[status] ?? MEMBER_STATUS_CLASSES.inactive}
      label={label ?? status}
      className={className}
    />
  );
}

export function PayrollStatusBadge({ status, label, className }: BadgeProps) {
  return (
    <BaseBadge
      statusClass={PAYROLL_STATUS_CLASSES[status] ?? PAYROLL_STATUS_CLASSES.draft}
      label={label ?? status}
      className={className}
    />
  );
}

export function StaffStatusBadge({ status, label, className }: BadgeProps) {
  return (
    <BaseBadge
      statusClass={STAFF_STATUS_CLASSES[status] ?? STAFF_STATUS_CLASSES.inactive}
      label={label ?? status}
      className={className}
    />
  );
}

export function ProductStatusBadge({ status, label, className }: BadgeProps) {
  return (
    <BaseBadge
      statusClass={PRODUCT_STATUS_CLASSES[status] ?? PRODUCT_STATUS_CLASSES.active}
      label={label ?? status}
      className={className}
    />
  );
}
