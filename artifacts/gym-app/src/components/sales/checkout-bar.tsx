import { useId } from "react";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { profitTone } from "./sales-utils";

interface CheckoutBarProps {
  t: (k: string) => string;
  fmt: (n: number) => string;
  total: number;
  discount: number;
  cost: number;
  profit: number;
  canViewCost: boolean;
  canViewProfit: boolean;
  paymentAmount: number;
  onPaymentAmountChange: (value: number) => void;
  changeDue: number;
  notes: string;
  onNotesChange: (value: string) => void;
  completing: boolean;
  onComplete: () => void;
}

/** Totals, notes and the pay button. Sticky to the bottom of the viewport on phones and tablets. */
export function CheckoutBar({
  t,
  fmt,
  total,
  discount,
  cost,
  profit,
  canViewCost,
  canViewProfit,
  paymentAmount,
  onPaymentAmountChange,
  changeDue,
  notes,
  onNotesChange,
  completing,
  onComplete,
}: CheckoutBarProps) {
  const paymentId = useId();
  const notesId = useId();
  const short = paymentAmount < total;

  return (
    <>
      {/* Notes and breakdown scroll with the page; only the pay controls stick. */}
      <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor={notesId} className="text-xs text-muted-foreground">{t("sales.notes")}</Label>
            <Input id={notesId} value={notes} onChange={(event) => onNotesChange(event.target.value)} placeholder={t("sales.notesPlaceholder")} />
          </div>
          {(discount > 0 || canViewCost || canViewProfit) && (
            <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:text-end">
              {discount > 0 && <><dt>{t("sales.receipt.discount")}</dt><dd className="text-end font-medium tabular-nums text-destructive">-{fmt(discount)}</dd></>}
              {canViewCost && <><dt>{t("sales.col.cost")}</dt><dd className="text-end font-medium tabular-nums text-foreground">{fmt(cost)}</dd></>}
              {canViewProfit && <><dt>{t("sales.col.profit")}</dt><dd className={cn("text-end font-medium tabular-nums", profitTone(profit))}>{fmt(profit)}</dd></>}
            </dl>
          )}
        </div>
      </div>

      <div
        className={cn(
          "sticky bottom-0 z-20 -mx-4 border-t border-border/60 bg-card/95 px-4 pt-3 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.25)] backdrop-blur",
          "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
          "md:mx-0 md:rounded-2xl md:border md:pb-[max(1rem,env(safe-area-inset-bottom))] md:pt-4 md:px-4 md:bottom-2",
          "lg:static lg:bg-card lg:shadow-sm lg:backdrop-blur-none",
        )}
        aria-label={t("sales.checkout")}
        role="region"
      >
        <div className="@container">
        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] @2xl:items-end">
          <div className="space-y-1">
            <Label htmlFor={paymentId} className="block text-xs leading-4 text-muted-foreground">{t("sales.paymentAmount")}</Label>
            <div className="relative">
              <CreditCard className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id={paymentId}
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                value={paymentAmount || ""}
                onChange={(event) => onPaymentAmountChange(parseFloat(event.target.value) || 0)}
                className="ps-9 text-end font-semibold"
                aria-describedby={short ? `${paymentId}-short` : undefined}
              />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium leading-4 text-muted-foreground">{t("sales.changeDue")}</p>
            <p className="flex min-h-11 items-center justify-end rounded-md border bg-muted/40 px-3 text-sm font-semibold tabular-nums md:min-h-9" aria-live="polite">
              {fmt(changeDue)}
            </p>
          </div>

          <div className="col-span-2 flex items-center justify-between gap-3 @2xl:col-span-1 @2xl:min-w-[260px] @2xl:flex-col @2xl:items-stretch @2xl:gap-2">
            <div className="@2xl:flex @2xl:items-baseline @2xl:justify-between @2xl:gap-3">
              <p className="text-xs text-muted-foreground">{t("sales.grandTotal")}</p>
              <p className="text-xl font-bold tracking-tight tabular-nums @md:text-2xl">{fmt(total)}</p>
            </div>
            <Button
              className="h-11 min-w-[9rem] flex-1 font-semibold @2xl:flex-none"
              onClick={onComplete}
              disabled={completing || short}
            >
              {completing ? t("common.loading") : t("sales.completeSale")}
            </Button>
          </div>
        </div>
        </div>
        {short && paymentAmount > 0 && (
          <p id={`${paymentId}-short`} className="mt-2 text-xs text-destructive dark:text-red-400">{t("sales.toast.paymentShort")}</p>
        )}
      </div>
    </>
  );
}
