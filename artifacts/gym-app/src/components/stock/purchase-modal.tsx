import { useEffect, useState } from "react";
import type { ProductRecord } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "./stock-utils";

function initialForm(product: ProductRecord) {
  return {
    quantityAdded: "1",
    costPerUnit: String(product.costPrice),
    totalCost: String(product.costPrice),
    currency: product.currency as string,
    exchangeRate: product.currency === "USD" ? "1" : "",
    supplier: product.supplier ?? "",
    notes: "",
    paidFromCash: false,
    purchaseDate: new Date().toISOString().slice(0, 10),
  };
}

export function PurchaseModal({
  open,
  onClose,
  product,
  canViewCost,
  t,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  product: ProductRecord;
  canViewCost: boolean;
  t: (key: string) => string;
  onAdd: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState(() => initialForm(product));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(initialForm(product));
    setError("");
  }, [open, product]);

  function set(key: keyof typeof form, value: string | boolean) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "quantityAdded" || key === "costPerUnit") {
        const quantity = Number.parseInt(String(key === "quantityAdded" ? value : next.quantityAdded), 10) || 0;
        const unitCost = Number.parseFloat(String(key === "costPerUnit" ? value : next.costPerUnit)) || 0;
        next.totalCost = String(quantity * unitCost);
      }
      return next;
    });
  }

  function setCurrency(value: string) {
    setForm((current) => ({ ...current, currency: value, exchangeRate: value === "USD" ? "1" : "" }));
  }

  async function save() {
    const quantity = Number.parseInt(form.quantityAdded, 10);
    const unitCost = Number.parseFloat(form.costPerUnit);
    const totalCost = Number.parseFloat(form.totalCost);
    const exchangeRateText = form.exchangeRate.trim();
    const exchangeRate = exchangeRateText ? Number.parseFloat(exchangeRateText) : undefined;

    if (!Number.isInteger(quantity) || quantity < 1) {
      setError(t("stock.validation.qtyMin"));
      return;
    }
    if (!Number.isFinite(unitCost) || unitCost < 0 || !Number.isFinite(totalCost) || totalCost < 0) {
      setError(t("stock.validation.costMin"));
      return;
    }
    if (exchangeRate !== undefined && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
      setError(t("stock.validation.rate"));
      return;
    }

    setSaving(true);
    setError("");
    try {
      await onAdd({
        quantityAdded: quantity,
        costPerUnit: unitCost,
        totalCost,
        currency: form.currency,
        ...(exchangeRate !== undefined && { exchangeRate }),
        supplier: form.supplier.trim() || null,
        notes: form.notes.trim() || null,
        paidFromCash: form.paidFromCash,
        purchaseDate: form.purchaseDate || null,
      });
    } catch (caught: unknown) {
      setError(errorMessage(caught, t("stock.purchase.failed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("stock.addPurchase")}: {product.name}</DialogTitle>
        </DialogHeader>

        <form id="purchase-form" className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          {error && (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="purchase-qty">{t("stock.purchase.qty")} *</Label>
              <Input id="purchase-qty" type="number" inputMode="numeric" min="1" step="1" value={form.quantityAdded} onChange={(event) => set("quantityAdded", event.target.value)} />
            </div>
            {canViewCost && (
              <div className="space-y-1.5">
                <Label htmlFor="purchase-unit">{t("stock.purchase.costPerUnit")}</Label>
                <Input id="purchase-unit" type="number" inputMode="decimal" min="0" step="0.01" value={form.costPerUnit} onChange={(event) => set("costPerUnit", event.target.value)} />
              </div>
            )}
            {canViewCost && (
              <div className="space-y-1.5">
                <Label htmlFor="purchase-total">{t("stock.purchase.totalCost")}</Label>
                <Input id="purchase-total" type="number" inputMode="decimal" min="0" step="0.01" value={form.totalCost} onChange={(event) => set("totalCost", event.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="purchase-currency">{t("stock.purchase.currency")}</Label>
              <Select value={form.currency} onValueChange={setCurrency}>
                <SelectTrigger id="purchase-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="CDF">CDF / FC</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.currency === "CDF" && (
              <div className="space-y-1.5">
                <Label htmlFor="purchase-rate">{t("stock.purchase.exchangeRate")}</Label>
                <Input
                  id="purchase-rate"
                  type="number"
                  inputMode="decimal"
                  min="0.000001"
                  step="0.01"
                  value={form.exchangeRate}
                  onChange={(event) => set("exchangeRate", event.target.value)}
                  placeholder={t("stock.purchase.systemRate")}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="purchase-supplier">{t("stock.purchase.supplier")}</Label>
              <Input id="purchase-supplier" value={form.supplier} onChange={(event) => set("supplier", event.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="purchase-date">{t("stock.purchase.date")}</Label>
              <Input id="purchase-date" type="date" value={form.purchaseDate} onChange={(event) => set("purchaseDate", event.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="purchase-notes">{t("stock.purchase.notes")}</Label>
            <Textarea id="purchase-notes" value={form.notes} onChange={(event) => set("notes", event.target.value)} rows={2} />
          </div>

          <label className="flex min-h-11 cursor-pointer select-none items-center gap-3 text-sm">
            <Checkbox checked={form.paidFromCash} onCheckedChange={(checked) => set("paidFromCash", Boolean(checked))} />
            {t("stock.purchase.paidFromCash")}
          </label>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" form="purchase-form" disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
