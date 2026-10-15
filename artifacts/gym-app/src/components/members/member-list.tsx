import type { Member } from "@workspace/api-client-react";
import { Edit, Eye, LogIn, MessageCircle, MoreHorizontal, Play, Printer, RefreshCw, Snowflake, Trash2, UserMinus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/lib/status-badge";
import { fmt as format } from "@/lib/i18n-format";
import { cn } from "@/lib/utils";
import { avatarColor, expiryState, fmtCurrency, initialsOf, type ExpiryState } from "./member-utils";

export interface MemberRowActions {
  onView: (m: Member) => void;
  onReprint: (m: Member) => void;
  onEdit: (m: Member) => void;
  onCheckIn: (m: Member) => void;
  onRenew: (m: Member) => void;
  onFreeze: (m: Member) => void;
  onReactivate: (m: Member) => void;
  onMarkInactive: (m: Member) => void;
  onWhatsapp: (m: Member) => void;
  onDelete: (m: Member) => void;
}

interface MemberListProps {
  t: (k: string) => string;
  fmtDate: (d: string | null | undefined) => string;
  items: Member[];
  isLoading: boolean;
  canManage: boolean;
  isAdmin: boolean;
  canViewAccounting: boolean;
  /** Live balance (plan price converted to the member's currency minus discount and payments). */
  balanceOf: (m: Member) => number;
  actions: MemberRowActions;
}

const EXPIRY_TEXT: Record<ExpiryState, string> = {
  expired: "text-red-700 font-semibold dark:text-red-400",
  urgent: "text-orange-700 font-semibold dark:text-orange-400",
  warning: "text-amber-700 font-medium dark:text-amber-400",
  ok: "text-foreground",
};

const EXPIRY_ROW: Record<ExpiryState, string> = {
  expired: "bg-red-50/60 dark:bg-red-950/20 border-s-2 border-s-red-500",
  urgent: "bg-orange-50/50 dark:bg-orange-950/20 border-s-2 border-s-orange-400",
  warning: "bg-yellow-50/40 dark:bg-yellow-950/10 border-s-2 border-s-yellow-400",
  ok: "",
};

function MemberActionsMenu({ m, t, canManage, isAdmin, actions }: { m: Member; t: (k: string) => string; canManage: boolean; isAdmin: boolean; actions: MemberRowActions }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-foreground md:h-8 md:w-8" aria-label={format(t("members.actionsFor"), { name: m.name })}>
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => actions.onView(m)}>
          <Eye className="me-2 h-4 w-4" aria-hidden="true" />{t("members.actions.view")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.onReprint(m)}>
          <Printer className="me-2 h-4 w-4" aria-hidden="true" />{t("members.actions.reprintInvoice")}
        </DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuItem onClick={() => actions.onEdit(m)}>
              <Edit className="me-2 h-4 w-4" aria-hidden="true" />{t("members.actions.edit")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => actions.onCheckIn(m)}>
              <LogIn className="me-2 h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />{t("members.actions.checkin")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.onRenew(m)}>
              <RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />{t("members.actions.renew")}
            </DropdownMenuItem>
            {m.status !== "frozen" ? (
              <DropdownMenuItem onClick={() => actions.onFreeze(m)}>
                <Snowflake className="me-2 h-4 w-4" aria-hidden="true" />{t("members.actions.freeze")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => actions.onReactivate(m)}>
                <Play className="me-2 h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />{t("members.actions.reactivate")}
              </DropdownMenuItem>
            )}
            {m.status === "inactive" && (
              <DropdownMenuItem onClick={() => actions.onReactivate(m)}>
                <Play className="me-2 h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />{t("members.actions.reactivate")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {m.status !== "inactive" && (
              <DropdownMenuItem onClick={() => actions.onMarkInactive(m)}>
                <UserMinus className="me-2 h-4 w-4" aria-hidden="true" />{t("members.actions.markInactive")}
              </DropdownMenuItem>
            )}
            {isAdmin && (
              <DropdownMenuItem onClick={() => actions.onWhatsapp(m)}>
                <MessageCircle className="me-2 h-4 w-4 text-green-700 dark:text-green-400" aria-hidden="true" />{t("members.whatsapp.send")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-red-700 focus:text-red-700 dark:text-red-400 dark:focus:text-red-400" onClick={() => actions.onDelete(m)}>
              <Trash2 className="me-2 h-4 w-4" aria-hidden="true" />{t("members.actions.delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EmptyMembers({ t }: { t: (k: string) => string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
        <Users className="h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
      </div>
      <p className="font-semibold text-foreground">{t("members.empty")}</p>
      <p className="text-sm text-muted-foreground">{t("members.emptyHint")}</p>
    </div>
  );
}

/**
 * Phones and tablets (< lg) get a card list; the wide 8-column table only appears
 * from lg (1024px) where it fits without horizontal scrolling.
 */
export function MemberList({ t, fmtDate, items, isLoading, canManage, isAdmin, canViewAccounting, balanceOf, actions }: MemberListProps) {
  const statusLabel = (status: string) => t(`members.status.${status}`);

  return (
    <>
      {/* Cards: phones and tablets */}
      <div className="overflow-hidden rounded-xl border border-border bg-card lg:hidden">
        {isLoading ? (
          <ul className="divide-y divide-border/50" aria-busy="true" aria-label={t("common.loading")}>
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-3">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
              </li>
            ))}
          </ul>
        ) : items.length === 0 ? (
          <EmptyMembers t={t} />
        ) : (
          <ul className="divide-y divide-border/50">
            {items.map((m) => {
              const { state, days } = expiryState(m.status, m.expiryDate);
              const balance = canViewAccounting ? balanceOf(m) : 0;
              return (
                <li key={m.id} className={cn("flex items-center gap-2 px-3 py-3 md:gap-3 md:px-4", EXPIRY_ROW[state])}>
                  <button
                    type="button"
                    onClick={() => actions.onView(m)}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white", avatarColor(m.name))} aria-hidden="true">
                      {initialsOf(m.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{m.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {m.planName ?? "—"} · <span className={EXPIRY_TEXT[state]}>{fmtDate(m.expiryDate)}</span>
                        {state === "expired" && <span className="font-semibold text-red-700 dark:text-red-400"> · {t("members.expiredShort")}</span>}
                        {state === "urgent" && days !== null && <span className="font-semibold text-orange-700 dark:text-orange-400"> · {format(t("members.daysLeftShort"), { days })}</span>}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        {m.phone && <span className="truncate" dir="ltr">{m.phone}</span>}
                        {canViewAccounting && balance !== 0 && (
                          <span className={cn("font-medium", balance > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                            {t("members.table.balance")}: {fmtCurrency(balance, m.currency)}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                  <StatusBadge status={m.status} label={statusLabel(m.status)} />
                  <MemberActionsMenu m={m} t={t} canManage={canManage} isAdmin={isAdmin} actions={actions} />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Table: desktop */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="py-3">{t("members.table.name")}</TableHead>
              <TableHead className="py-3">{t("members.table.phone")}</TableHead>
              <TableHead className="py-3">{t("members.table.plan")}</TableHead>
              <TableHead className="py-3">{t("members.table.status")}</TableHead>
              <TableHead className="py-3">{t("members.table.start")}</TableHead>
              <TableHead className="py-3">{t("members.table.expiry")}</TableHead>
              {canViewAccounting && <TableHead className="py-3 text-end">{t("members.table.balance")}</TableHead>}
              <TableHead className="w-12"><span className="sr-only">{t("members.table.actions")}</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i} className="border-border/50">
                  {Array.from({ length: canViewAccounting ? 8 : 7 }).map((_, j) => (
                    <TableCell key={j} className="py-3.5">
                      <Skeleton className="h-4" style={{ width: `${60 + (j * 17) % 40}%` }} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canViewAccounting ? 8 : 7}><EmptyMembers t={t} /></TableCell>
              </TableRow>
            ) : items.map((m) => {
              const { state } = expiryState(m.status, m.expiryDate);
              const balance = canViewAccounting ? balanceOf(m) : 0;
              return (
                <TableRow key={m.id} className={cn("group border-border/50 transition-colors", EXPIRY_ROW[state])}>
                  <TableCell className="py-3">
                    <button
                      type="button"
                      onClick={() => actions.onView(m)}
                      className="group/btn flex items-center gap-3 rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white", avatarColor(m.name))} aria-hidden="true">
                        {initialsOf(m.name)}
                      </span>
                      <span>
                        <span className="block font-medium leading-tight text-foreground transition-colors group-hover/btn:text-primary">{m.name}</span>
                        {m.email && <span className="mt-0.5 block text-xs text-muted-foreground">{m.email}</span>}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell className="py-3 text-sm text-muted-foreground"><span dir="ltr">{m.phone ?? "—"}</span></TableCell>
                  <TableCell className="py-3">
                    {m.planName ? <span className="text-sm font-medium text-foreground">{m.planName}</span> : <span className="text-sm text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="py-3"><StatusBadge status={m.status} label={statusLabel(m.status)} /></TableCell>
                  <TableCell className="py-3 text-sm text-muted-foreground">{fmtDate(m.startDate)}</TableCell>
                  <TableCell className={cn("py-3 text-sm", EXPIRY_TEXT[state])}>{fmtDate(m.expiryDate)}</TableCell>
                  {canViewAccounting && (
                    <TableCell className={cn("py-3 text-end text-sm font-semibold tabular-nums", balance > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                      {balance !== 0 ? fmtCurrency(balance, m.currency) : "—"}
                    </TableCell>
                  )}
                  <TableCell className="py-3">
                    <MemberActionsMenu m={m} t={t} canManage={canManage} isAdmin={isAdmin} actions={actions} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
