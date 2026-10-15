import { format } from "date-fns";

export function fmtPDate(d: string | null | undefined) {
  if (!d) return "-";
  try { return format(new Date(d), "dd/MM/yyyy"); } catch { return d; }
}

export function fmtMoney(n: number, currency: string) {
  const v = n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return currency === "CDF" ? `FC ${v}` : `$${v}`;
}

export function fmtNumber(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function avatarInitials(name: string) {
  const parts = name.trim().split(" ");
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  "bg-violet-600", "bg-blue-600", "bg-emerald-600", "bg-amber-600",
  "bg-rose-600", "bg-cyan-700", "bg-pink-600", "bg-indigo-600",
];

export function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const cls = size === "lg" ? "h-10 w-10" : size === "sm" ? "h-7 w-7" : "h-8 w-8";
  return (
    <span className={`${cls} flex shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(name)}`} aria-hidden="true">
      {avatarInitials(name)}
    </span>
  );
}
