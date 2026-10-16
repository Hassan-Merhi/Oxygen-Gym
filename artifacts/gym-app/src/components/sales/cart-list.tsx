import type { CSSProperties } from "react";
import { Minus, Plus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fmt as format } from "@/lib/i18n-format";
import { convertToSaleCurrency, profitTone, type CartItem } from "./sales-utils";

interface CartListProps {
  items: CartItem[];
  canViewCost: boolean;
  canViewProfit: boolean;
  saleCurrency: string;
  exchangeRate: number;
  onQtyChange: (id: number, qty: number) => void;
  onDiscountChange: (id: number, discount: number) => void;
  onRemove: (id: number) => void;
  t: (k: string) => string;
}

/**
 * The cart is laid out by the width of its own panel (container queries), not the
 * viewport: a stacked card per line on phones, tablets and the narrow POS column,
 * and an aligned table-like row once the panel is wide enough (>= 42rem).
 */
export function CartList(props: CartListProps) {
  const { items, canViewCost, canViewProfit, t } = props;
  const columns = [
    "minmax(0,2fr)", // product
    "auto", // qty
    "minmax(5rem,1fr)", // unit price
    "7rem", // discount
    "minmax(5rem,1fr)", // line total
    ...(canViewCost ? ["minmax(4.5rem,0.8fr)"] : []),
    ...(canViewProfit ? ["minmax(4.5rem,0.8fr)"] : []),
    "auto", // remove
  ].join(" ");
  const style = { "--cart-cols": columns } as CSSProperties;

  return (
    <div className="@container" style={style}>
      <div
        aria-hidden="true"
        className="hidden border-b border-border/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground @2xl:grid @2xl:grid-cols-[var(--cart-cols)] @2xl:items-center @2xl:gap-3"
      >
        <span>{t("sales.col.product")}</span>
        <span className="text-center">{t("sales.col.qty")}</span>
        <span className="text-end">{t("sales.col.price")}</span>
        <span className="text-end">{t("sales.col.discount")}</span>
        <span className="text-end">{t("sales.col.total")}</span>
        {canViewCost && <span className="text-end">{t("sales.col.cost")}</span>}
        {canViewProfit && <span className="text-end">{t("sales.col.profit")}</span>}
        <span className="sr-only">{t("sales.col.actions")}</span>
      </div>
      <ul className="space-y-3 p-3 @2xl:space-y-0 @2xl:divide-y @2xl:divide-border/50 @2xl:p-0" aria-label={t("sales.cart")}>
        {items.map((item) => (
          <CartLine key={item.productId} item={item} {...props} />
        ))}
      </ul>
    </div>
  );
}

function CartLine({
  item,
  canViewCost,
  canViewProfit,
  saleCurrency,
  exchangeRate,
  onQtyChange,
  onDiscountChange,
  onRemove,
  t,
}: CartListProps & { item: CartItem }) {
  const unitInSale = convertToSaleCurrency(item.unitPrice, item.currency, saleCurrency, exchangeRate);
  const costInSale = convertToSaleCurrency(item.costPrice, item.currency, saleCurrency, exchangeRate);
  const lineTotal = (unitInSale - item.discount) * item.quantity;
  const profit = lineTotal - costInSale * item.quantity;
  const discountId = `cart-discount-${item.productId}`;
  const cellLabel = "text-xs font-medium text-muted-foreground @2xl:sr-only";

  return (
    <li
      className={cn(
        "grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border/60 bg-background p-3",
        "@2xl:grid-cols-[var(--cart-cols)] @2xl:items-center @2xl:gap-3 @2xl:rounded-none @2xl:border-0 @2xl:bg-transparent @2xl:px-4 @2xl:py-3",
      )}
    >
      {/* Product name (+ remove button on cards) */}
      <div className="col-span-2 flex min-w-0 items-start justify-between gap-2 @2xl:col-span-1">
        <p className="min-w-0 break-words font-medium leading-snug">{item.productName}</p>
        <RemoveButton className="-me-2 -mt-2 @2xl:hidden" item={item} onRemove={onRemove} t={t} />
      </div>

      {/* Quantity stepper */}
      <div className="flex flex-col gap-1 @2xl:items-center">
        <span className={cellLabel}>{t("sales.col.qty")}</span>
        <div className="inline-flex w-fit items-center rounded-lg border border-border/60 bg-muted/20 p-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-md md:h-8 md:w-8"
            onClick={() => onQtyChange(item.productId, item.quantity - 1)}
            disabled={item.quantity <= 1}
            aria-label={format(t("sales.decreaseQty"), { name: item.productName })}
          >
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">{item.quantity}</span>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-md md:h-8 md:w-8"
            onClick={() => onQtyChange(item.productId, item.quantity + 1)}
            disabled={item.quantity >= item.availableQty}
            aria-label={format(t("sales.increaseQty"), { name: item.productName })}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Unit price */}
      <div className="flex flex-col gap-1 text-end">
        <span className={cellLabel}>{t("sales.col.price")}</span>
        <span className="text-sm tabular-nums">{unitInSale.toFixed(2)}</span>
      </div>

      {/* Discount per unit */}
      <div className="flex flex-col gap-1">
        <label htmlFor={discountId} className={cellLabel}>{t("sales.col.discount")}</label>
        <Input
          id={discountId}
          type="number"
          inputMode="decimal"
          min={0}
          max={unitInSale}
          step={0.01}
          value={item.discount}
          onChange={(event) => onDiscountChange(item.productId, parseFloat(event.target.value) || 0)}
          className="text-end text-sm @2xl:h-9"
          aria-label={`${t("sales.col.discount")} — ${item.productName}`}
        />
      </div>

      {/* Line total */}
      <div className="flex flex-col gap-1 text-end">
        <span className={cellLabel}>{t("sales.col.total")}</span>
        <span className="font-semibold tabular-nums">{lineTotal.toFixed(2)}</span>
      </div>

      {canViewCost && (
        <div className="flex flex-col gap-1 text-end">
          <span className={cellLabel}>{t("sales.col.cost")}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{(costInSale * item.quantity).toFixed(2)}</span>
        </div>
      )}
      {canViewProfit && (
        <div className="flex flex-col gap-1 text-end">
          <span className={cellLabel}>{t("sales.col.profit")}</span>
          <span className={cn("text-xs font-semibold tabular-nums", profitTone(profit))}>{profit.toFixed(2)}</span>
        </div>
      )}

      <div className="hidden @2xl:flex @2xl:justify-end">
        <RemoveButton item={item} onRemove={onRemove} t={t} />
      </div>
    </li>
  );
}

function RemoveButton({
  item,
  onRemove,
  t,
  className,
}: {
  item: CartItem;
  onRemove: (id: number) => void;
  t: (k: string) => string;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("shrink-0 text-muted-foreground hover:text-destructive md:h-8 md:w-8", className)}
      onClick={() => onRemove(item.productId)}
      aria-label={format(t("sales.removeItem"), { name: item.productName })}
    >
      <XCircle className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}
