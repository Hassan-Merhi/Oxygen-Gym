import { useEffect, useState } from "react";
import { useGetSale, usePatchSale } from "@workspace/api-client-react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { fmt as format } from "@/lib/i18n-format";
import { fmtMoney, type SaleItemData } from "./sales-utils";

interface EditItem {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  costPrice: number;
}

export function SaleEditDialog({
  saleId,
  open,
  onClose,
  onSaved,
  t,
}: {
  saleId: number | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  t: (k: string) => string;
}) {
  const { data: saleRaw } = useGetSale(saleId ?? 0, {
    query: { enabled: !!saleId && open, queryKey: ["getSaleEdit", saleId] },
  });
  const patchSaleMut = usePatchSale();
  const { toast } = useToast();

  const sale = saleRaw as unknown as Record<string, unknown> | undefined;
  const originalItems = (sale?.items ?? []) as SaleItemData[];
  const [currency, setCurrency] = useState<"USD" | "CDF">("CDF");
  const [saleDate, setSaleDate] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [editItems, setEditItems] = useState<EditItem[]>([]);

  const sym = currency === "CDF" ? "FC" : "$";
  const fmt = (n: number) => fmtMoney(n, sym);

  useEffect(() => {
    if (!sale) return;
    setCurrency((sale.currency as "USD" | "CDF") ?? "USD");
    setSaleDate(sale.saleDate ? String(sale.saleDate).slice(0, 10) : "");
    setNotes((sale.notes as string) ?? "");
    setPaymentAmount((sale.paymentAmount as number) ?? 0);
    setEditItems(originalItems.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount ?? 0,
      costPrice: item.costPrice ?? 0,
    })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleRaw]);

  const liveTotal = editItems.reduce((sum, item) => sum + (item.unitPrice - item.discount) * item.quantity, 0);
  const liveDiscount = editItems.reduce((sum, item) => sum + item.discount * item.quantity, 0);
  const liveChange = Math.max(0, paymentAmount - liveTotal);

  const updateItem = (index: number, patch: Partial<EditItem>) => {
    setEditItems((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const handleSave = async () => {
    if (!saleId) return;
    try {
      await patchSaleMut.mutateAsync({
        id: saleId,
        data: {
          currency,
          notes: notes || null,
          saleDate: saleDate || null,
          paymentAmount,
          items: editItems.map((item) => ({
            productId: item.productId,
            unitPrice: item.unitPrice,
            discount: item.discount,
          })),
        },
      });
      toast({ title: t("sales.toast.updated") });
      onSaved();
      onClose();
    } catch {
      toast({ title: t("sales.toast.updateFailed"), variant: "destructive" });
    }
  };

  if (!sale) return null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" aria-hidden="true" />
            {format(t("sales.editTitle"), { number: String(sale.saleNumber ?? "") })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sale-edit-currency">{t("sales.currency")}</Label>
              <Select value={currency} onValueChange={(value) => setCurrency(value as "USD" | "CDF")}>
                <SelectTrigger id="sale-edit-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="CDF">CDF (FC)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sale-edit-date">{t("sales.saleDate")}</Label>
              <Input id="sale-edit-date" type="date" value={saleDate} onChange={(event) => setSaleDate(event.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sale-edit-notes">{t("sales.notes")}</Label>
            <Textarea id="sale-edit-notes" rows={2} value={notes} placeholder={t("sales.notesPlaceholder")} onChange={(event) => setNotes(event.target.value)} />
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">{t("sales.saleItems")}</legend>
            <div className="hidden grid-cols-[minmax(0,1fr)_3rem_8rem_8rem_6rem] gap-3 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid" aria-hidden="true">
              <span>{t("sales.col.product")}</span>
              <span className="text-center">{t("sales.col.qty")}</span>
              <span className="text-end">{t("sales.col.price")} ({sym})</span>
              <span className="text-end">{t("sales.col.discount")} ({sym})</span>
              <span className="text-end">{t("sales.col.total")}</span>
            </div>
            <ul className="space-y-2 sm:space-y-0 sm:divide-y sm:divide-border/50">
              {editItems.map((item, index) => {
                const lineTotal = (item.unitPrice - item.discount) * item.quantity;
                const priceId = `sale-edit-price-${item.productId}`;
                const discountId = `sale-edit-discount-${item.productId}`;
                return (
                  <li
                    key={item.productId}
                    className="grid grid-cols-2 gap-3 rounded-xl border border-border/60 p-3 sm:grid-cols-[minmax(0,1fr)_3rem_8rem_8rem_6rem] sm:items-center sm:rounded-none sm:border-0 sm:px-1 sm:py-2"
                  >
                    <p className="col-span-2 min-w-0 text-sm font-medium sm:col-span-1">{item.productName}</p>
                    <p className="text-sm text-muted-foreground sm:text-center">
                      <span className="sm:sr-only">{t("sales.col.qty")}: </span>{item.quantity}
                    </p>
                    <p className="text-end text-sm font-semibold tabular-nums sm:order-last">
                      <span className="font-normal text-muted-foreground sm:sr-only">{t("sales.col.total")}: </span>{fmt(lineTotal)}
                    </p>
                    <div className="space-y-1">
                      <Label htmlFor={priceId} className="text-xs text-muted-foreground sm:sr-only">{t("sales.col.price")} ({sym})</Label>
                      <Input
                        id={priceId}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        className="w-full text-end sm:h-9"
                        value={item.unitPrice}
                        onChange={(event) => updateItem(index, { unitPrice: parseFloat(event.target.value) || 0 })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={discountId} className="text-xs text-muted-foreground sm:sr-only">{t("sales.col.discount")} ({sym})</Label>
                      <Input
                        id={discountId}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max={item.unitPrice}
                        step="0.01"
                        className="w-full text-end sm:h-9"
                        value={item.discount}
                        onChange={(event) => updateItem(index, { discount: Math.max(0, Math.min(parseFloat(event.target.value) || 0, item.unitPrice)) })}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sale-edit-payment">{t("sales.paymentAmount")} ({sym})</Label>
              <Input
                id="sale-edit-payment"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={paymentAmount}
                onChange={(event) => setPaymentAmount(parseFloat(event.target.value) || 0)}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t("sales.changeDue")} ({sym})</p>
              <div className="flex min-h-11 items-center rounded-md border bg-muted/40 px-3 text-sm font-semibold tabular-nums md:min-h-9" aria-live="polite">
                {fmt(liveChange)}
              </div>
            </div>
          </div>

          <dl className="ms-auto flex max-w-xs flex-col gap-1 border-t pt-3 text-sm">
            {liveDiscount > 0 && (
              <div className="flex justify-between gap-6"><dt className="text-muted-foreground">{t("sales.receipt.discount")}</dt><dd className="text-destructive tabular-nums">-{fmt(liveDiscount)}</dd></div>
            )}
            <div className="flex justify-between gap-6 text-base font-bold"><dt>{t("sales.history.total")}</dt><dd className="tabular-nums">{fmt(liveTotal)}</dd></div>
          </dl>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={handleSave} disabled={patchSaleMut.isPending}>
            {patchSaleMut.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
