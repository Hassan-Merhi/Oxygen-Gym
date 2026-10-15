import type { CurrentUser } from "@workspace/api-client-react";

/**
 * Permission flags are read as a plain record so new backend keys (for example
 * `approveCorrections`) work before the generated API types know about them.
 */
export function permissionFlags(me: CurrentUser | undefined | null): Record<string, boolean> {
  return ((me?.permissions ?? {}) as unknown as Record<string, boolean>) ?? {};
}

export function hasPermission(me: CurrentUser | undefined | null, key: string): boolean {
  if (!me) return false;
  if (me.role === "admin") return true;
  return permissionFlags(me)[key] === true;
}

/**
 * Separation of duties: reversing posted records (edit/cancel posted payments,
 * voiding sales, cancelling paid payroll, reversing supplier records) needs the
 * `approveCorrections` permission. Admins always have it.
 */
export function canApproveCorrections(me: CurrentUser | undefined | null): boolean {
  return hasPermission(me, "approveCorrections");
}
