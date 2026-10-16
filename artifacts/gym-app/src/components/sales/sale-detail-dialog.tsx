import { useGetSale } from "@workspace/api-client-react";
import { Printer, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFmtDate } from "@/lib/useFmtDate";
import { cn } from "@/lib/utils";
import { fmtMoney, printReceipt, profitTone, type SaleItemData } from "./sales-utils";

export function SaleDetailDialog({
  saleId,
  open,
  onClose,
  settings,
  canViewCost,
  canViewProfit,
  t,
}: {
  saleId: number | null;
  open: boolean;
  onClose: () => void;
  settings: Record<string, unknown> | null;
  canViewCost: boolean;
  canViewProfit: boolean;
  t: (k: string) => string;
}) {
  const { data: sale } = useGetSale(saleId ?? 0, {
    query: { enabled: !!saleId && open, queryKey: ["getSale", saleId] },
  });
  const { locale } = useFmtDate();

  if (!sale) return null;
  const saleData = sale as unknown as Record<string, unknown>;
  const items = (saleData.items ?? []) as SaleItemData[];
  const currency = saleData.currency as string;
  const sym = currency === "CDF" ? "FC" : "$";
  const fmt = (n: number | null | undefined) => fmtMoney(n, sym);
  const lineTotalOf = (item: SaleItemData) => item.lineTotal ?? ((item.unitPrice - (item.discount ?? 0)) * item.quantity);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5" aria-hidden="true" />
            {saleData.saleNumber as string}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <dl className="grid grid-cols-1 gap-3 rounded-xl border border-border/60 bg-muted/20 p-4 text-sm sm:grid-cols-2">
            <div className="flex flex-wrap gap-1"><dt className="text-muted-foreground">{t("sales.history.date")}:</dt><dd>{new Date(saleData.saleDate as string).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}</dd></div>
            <div className="flex flex-wrap gap-1"><dt className="text-muted-foreground">{t("sales.receipt.cashier")}:</dt><dd>{(saleData.createdBy as string) ?? "—"}</dd></div>
            <div className="flex flex-wrap gap-1"><dt className="text-muted-foreground">{t("sales.currency")}:</dt><dd>{currency}</dd></div>
            <div>
              <dt className="sr-only">{t("sales.history.status")}</dt>
              <dd>
                <Badge variant={saleData.status === "voided" ? "destructive" : "default"}>
                  {t(`sales.status.${saleData.status as string}`)}
                </Badge>
              </dd>
            </div>
          </dl>

          {saleData.status === "voided" && (
            <div className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive dark:text-red-300">
              <strong>{t("sales.void")}:</strong> {saleData.voidedBy as string} — {saleData.voidReason as string}
            </div>
          )}

          {/* Phones: one card per line item. */}
          <ul className="space-y-2 sm:hidden" aria-label={t("sales.saleItems")}>
            {items.map((item, index) => (
              <li key={`${item.productId}-${index}`} className="rounded-xl border border-border/60 p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 font-medium">{item.productName}</p>
                  <p className="shrink-0 font-semibold tabular-nums">{fmt(lineTotalOf(item))}</p>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <dt>{t("sales.col.qty")}</dt><dd className="text-end tabular-nums text-foreground">{item.quantity}</dd>
                  <dt>{t("sales.col.price")}</dt><dd className="text-end tabular-nums text-foreground">{fmt(item.unitPrice)}</dd>
                  {item.discount > 0 && <><dt>{t("sales.col.discount")}</dt><dd className="text-end tabular-nums text-destructive">-{fmt(item.discount * item.quantity)}</dd></>}
                  {canViewCost && <><dt>{t("sales.col.cost")}</dt><dd className="text-end tabular-nums">{fmt(item.costPrice * item.quantity)}</dd></>}
                  {canViewProfit && <><dt>{t("sales.col.profit")}</dt><dd className={cn("text-end font-medium tabular-nums", profitTone(item.profit))}>{fmt(item.profit)}</dd></>}
                </dl>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("sales.col.product")}</TableHead>
                  <TableHead className="text-center">{t("sales.col.qty")}</TableHead>
                  <TableHead className="text-end">{t("sales.col.price")}</TableHead>
                  <TableHead className="text-end">{t("sales.col.discount")}</TableHead>
                  <TableHead className="text-end">{t("sales.col.total")}</TableHead>
                  {canViewCost && <TableHead className="text-end">{t("sales.col.cost")}</TableHead>}
                  {canViewProfit && <TableHead className="text-end">{t("sales.col.profit")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => (
                  <TableRow key={`${item.productId}-${index}`}>
                    <TableCell>{item.productName}</TableCell>
                    <TableCell className="text-center">{item.quantity}</TableCell>
                    <TableCell className="text-end tabular-nums">{fmt(item.unitPrice)}</TableCell>
                    <TableCell className="text-end tabular-nums">{item.discount > 0 ? `-${fmt(item.discount * item.quantity)}` : "—"}</TableCell>
                    <TableCell className="text-end font-semibold tabular-nums">{fmt(lineTotalOf(item))}</TableCell>
                    {canViewCost && <TableCell className="text-end text-xs tabular-nums text-muted-foreground">{fmt(item.costPrice * item.quantity)}</TableCell>}
                    {canViewProfit && <TableCell className={cn("text-end text-xs font-medium tabular-nums", profitTone(item.profit))}>{fmt(item.profit)}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <dl className="ms-auto flex max-w-xs flex-col gap-1 border-t pt-3 text-sm">
            {(saleData.totalDiscount as number) > 0 && (
              <div className="flex justify-between gap-8"><dt className="text-muted-foreground">{t("sales.receipt.discount")}</dt><dd className="text-destructive tabular-nums">-{fmt(saleData.totalDiscount as number)}</dd></div>
            )}
            <div className="flex justify-between gap-8 text-base font-bold"><dt>{t("sales.receipt.total")}</dt><dd className="tabular-nums">{fmt(saleData.totalAmount as number)}</dd></div>
            <div className="flex justify-between gap-8"><dt className="text-muted-foreground">{t("sales.receipt.paid")}</dt><dd className="tabular-nums">{fmt(saleData.paymentAmount as number)}</dd></div>
            <div className="flex justify-between gap-8"><dt className="text-muted-foreground">{t("sales.receipt.change")}</dt><dd className="tabular-nums">{fmt(saleData.changeDue as number)}</dd></div>
          </dl>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { if (settings) printReceipt(saleData, settings, t); }}>
            <Printer className="h-4 w-4" aria-hidden="true" />{t("sales.printReceipt")}
          </Button>
          <Button onClick={onClose}>{t("common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
