import { useGetProductHistory, useListProductPurchases } from "@workspace/api-client-react";
import type { ProductRecord, StockPurchaseRecord } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useFmtDate } from "@/lib/useFmtDate";
import { fmt } from "@/lib/i18n-format";
import { fmtCount, fmtMoney } from "./stock-utils";

export function HistoryModal({
  open,
  onClose,
  product,
  canViewCost,
  t,
}: {
  open: boolean;
  onClose: () => void;
  product: ProductRecord;
  canViewCost: boolean;
  t: (key: string) => string;
}) {
  const { fmtDate, fmtDateTime } = useFmtDate();
  const historyQ = useGetProductHistory(product.id, {
    query: { enabled: open, queryKey: ["getProductHistory", product.id] },
  });
  const purchasesQ = useListProductPurchases(product.id, {
    query: { enabled: open, queryKey: ["listProductPurchases", product.id] },
  });

  const history = historyQ.data ?? [];
  const purchases = (purchasesQ.data ?? []) as StockPurchaseRecord[];

  const actionLabel = (action: string) => {
    const key = `stock.historyAction.${action}`;
    const label = t(key);
    return label === key ? action.replace(/_/g, " ") : label;
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("stock.history.title")}: {product.name}</DialogTitle>
        </DialogHeader>

        <section aria-labelledby="purchases-title">
          <h3 id="purchases-title" className="mb-2 text-sm font-semibold text-muted-foreground">{t("stock.purchaseList")}</h3>
          {purchasesQ.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : purchases.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted-foreground">{t("stock.noPurchases")}</p>
          ) : (
            <ul className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border text-sm">
              <li className="hidden grid-cols-4 gap-3 bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid" aria-hidden="true">
                <span>{t("stock.purchase.date")}</span>
                <span>{t("stock.purchase.qty")}</span>
                <span className="text-end">{canViewCost ? t("stock.purchase.totalCost") : ""}</span>
                <span>{t("stock.purchase.supplier")}</span>
              </li>
              {purchases.map((purchase) => (
                <li key={purchase.id} className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-4">
                  <span>{fmtDate(purchase.purchaseDate)}</span>
                  <span className="text-end font-semibold tabular-nums sm:text-start">+{fmtCount(purchase.quantityAdded)}</span>
                  <span className="tabular-nums sm:text-end">
                    {canViewCost ? fmtMoney(purchase.totalCost, purchase.currency) : ""}
                  </span>
                  <span className="truncate text-end text-muted-foreground sm:text-start">{purchase.supplier ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="history-title" className="mt-2">
          <h3 id="history-title" className="mb-2 text-sm font-semibold text-muted-foreground">{t("stock.history.title")}</h3>
          {historyQ.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : history.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted-foreground">{t("stock.noHistory")}</p>
          ) : (
            <ul className="space-y-2">
              {history.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/15 p-3 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <span className="inline-block font-medium text-foreground first-letter:uppercase">{actionLabel(entry.action)}</span>
                    {entry.userName && <span className="ms-2 text-muted-foreground">{fmt(t("stock.history.by"), { name: entry.userName })}</span>}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(entry.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
