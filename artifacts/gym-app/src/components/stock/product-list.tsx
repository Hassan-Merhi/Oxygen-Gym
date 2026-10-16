import type { ProductRecord } from "@workspace/api-client-react";
import { AlertTriangle, Archive, History, MoreHorizontal, Package, Pencil, RotateCcw, ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/pager";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fmt } from "@/lib/i18n-format";
import { cn } from "@/lib/utils";
import { fmtCount, fmtMoney, type ProductStatusChange } from "./stock-utils";

type T = (key: string) => string;

interface ActionHandlers {
  onEdit: (product: ProductRecord) => void;
  onPurchase: (product: ProductRecord) => void;
  onHistory: (product: ProductRecord) => void;
  onStatus: (product: ProductRecord, status: ProductStatusChange) => void;
}

function LowBadge({ t }: { t: T }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      {t("stock.lowStockAlert")}
    </span>
  );
}

function ProductActions({ product, canManage, t, onEdit, onPurchase, onHistory, onStatus }: ActionHandlers & {
  product: ProductRecord;
  canManage: boolean;
  t: T;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={fmt(t("stock.actionsFor"), { name: product.name })}>
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {canManage && (
          <DropdownMenuItem onClick={() => onEdit(product)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {t("stock.actions.edit")}
          </DropdownMenuItem>
        )}
        {canManage && (
          <DropdownMenuItem onClick={() => onPurchase(product)}>
            <ShoppingCart className="h-4 w-4" aria-hidden="true" />
            {t("stock.actions.purchase")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onHistory(product)}>
          <History className="h-4 w-4" aria-hidden="true" />
          {t("stock.actions.history")}
        </DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuSeparator />
            {product.status === "active" && (
              <DropdownMenuItem className="text-amber-700 dark:text-amber-400" onClick={() => onStatus(product, "archived")}>
                <Archive className="h-4 w-4" aria-hidden="true" />
                {t("stock.actions.archive")}
              </DropdownMenuItem>
            )}
            {product.status === "archived" && (
              <DropdownMenuItem onClick={() => onStatus(product, "active")}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {t("stock.actions.restore")}
              </DropdownMenuItem>
            )}
            {product.status !== "deleted" && (
              <DropdownMenuItem className="text-rose-700 dark:text-rose-400" onClick={() => onStatus(product, "deleted")}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t("stock.actions.delete")}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProductList({
  products,
  isLoading,
  canManage,
  canViewCost,
  t,
  ...handlers
}: ActionHandlers & {
  products: ProductRecord[];
  isLoading: boolean;
  canManage: boolean;
  canViewCost: boolean;
  t: T;
}) {
  const th = "px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  const isLow = (p: ProductRecord) => p.isLowStock && p.status === "active";

  if (isLoading) {
    return (
      <div className="space-y-2 p-3" aria-busy="true" aria-label={t("common.loading")}>
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }
  if (products.length === 0) {
    return <EmptyState icon={Package} title={t("stock.empty")} hint={t("stock.emptyHint")} />;
  }

  return (
    <>
      {/* Cards below lg */}
      <ul className="divide-y divide-border/50 lg:hidden">
        {products.map((product) => (
          <li key={product.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 truncate font-semibold">{product.name}</p>
                  {isLow(product) && <LowBadge t={t} />}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("stock.col.quantity")}</dt>
                    <dd className={cn("font-semibold tabular-nums", isLow(product) && "text-amber-700 dark:text-amber-400")}>{fmtCount(product.quantity)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("stock.col.sellingPrice")}</dt>
                    <dd className="font-medium tabular-nums">{fmtMoney(product.sellingPrice, product.currency)}</dd>
                  </div>
                  {canViewCost && (
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("stock.col.costPrice")}</dt>
                      <dd className="tabular-nums">{fmtMoney(product.costPrice, product.currency)}</dd>
                    </div>
                  )}
                  {canViewCost && (
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("stock.col.stockValue")}</dt>
                      <dd className="tabular-nums">{fmtMoney(product.stockValueUsd, "USD")}</dd>
                    </div>
                  )}
                </dl>
              </div>
              <ProductActions product={product} canManage={canManage} t={t} {...handlers} />
            </div>
          </li>
        ))}
      </ul>

      <table className="hidden w-full text-sm lg:table">
        <thead>
          <tr className="border-b border-border/70 bg-muted/20">
            <th scope="col" className={cn(th, "text-start")}>{t("stock.col.name")}</th>
            <th scope="col" className={cn(th, "text-end")}>{t("stock.col.quantity")}</th>
            <th scope="col" className={cn(th, "text-end")}>{t("stock.col.sellingPrice")}</th>
            {canViewCost && <th scope="col" className={cn(th, "text-end")}>{t("stock.col.costPrice")}</th>}
            {canViewCost && <th scope="col" className={cn(th, "text-end")}>{t("stock.col.stockValue")}</th>}
            <th scope="col" className={cn(th, "w-[72px] text-end")}><span className="sr-only">{t("stock.col.actions")}</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {products.map((product) => (
            <tr key={product.id} className="transition-colors hover:bg-muted/20">
              <td className="px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold text-foreground">{product.name}</span>
                  {isLow(product) && <LowBadge t={t} />}
                </div>
              </td>
              <td className="px-4 py-3 text-end">
                <span className={cn("text-base font-semibold tabular-nums", isLow(product) && "text-amber-700 dark:text-amber-400")}>
                  {fmtCount(product.quantity)}
                </span>
              </td>
              <td className="px-4 py-3 text-end font-medium tabular-nums">{fmtMoney(product.sellingPrice, product.currency)}</td>
              {canViewCost && <td className="px-4 py-3 text-end tabular-nums text-muted-foreground">{fmtMoney(product.costPrice, product.currency)}</td>}
              {canViewCost && <td className="px-4 py-3 text-end font-medium tabular-nums text-muted-foreground">{fmtMoney(product.stockValueUsd, "USD")}</td>}
              <td className="px-3 py-2 text-end">
                <ProductActions product={product} canManage={canManage} t={t} {...handlers} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
