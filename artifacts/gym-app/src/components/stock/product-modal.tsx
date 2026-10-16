import { useEffect, useState } from "react";
import type { ProductRecord } from "@workspace/api-client-react";
import { AlertCircle, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "./stock-utils";

const EMPTY_FORM = {
  name: "",
  barcode: "",
  quantity: "0",
  alertQuantity: "5",
  costPrice: "0",
  sellingPrice: "0",
  currency: "USD",
  status: "active",
};

export function ProductModal({
  open,
  onClose,
  editing,
  canViewCost,
  t,
  onCreate,
  onUpdate,
}: {
  open: boolean;
  onClose: () => void;
  editing: ProductRecord | null;
  canViewCost: boolean;
  t: (key: string) => string;
  onCreate: (data: Record<string, unknown>) => Promise<void>;
  onUpdate: (id: number, data: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.name,
        barcode: editing.barcode ?? "",
        quantity: String(editing.quantity),
        alertQuantity: String(editing.alertQuantity),
        costPrice: String(editing.costPrice),
        sellingPrice: String(editing.sellingPrice),
        currency: editing.currency,
        status: editing.status,
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setError("");
  }, [open, editing]);

  function set(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!form.name.trim()) {
      setError(t("stock.validation.nameRequired"));
      return;
    }

    setSaving(true);
    setError("");
    try {
      const quantity = Number.parseInt(form.quantity, 10);
      const alertQuantity = Number.parseInt(form.alertQuantity, 10);
      const costPrice = Number.parseFloat(form.costPrice);
      const sellingPrice = Number.parseFloat(form.sellingPrice);
      const data = {
        name: form.name.trim(),
        barcode: form.barcode.trim() || null,
        quantity: Number.isFinite(quantity) ? Math.max(0, quantity) : 0,
        alertQuantity: Number.isFinite(alertQuantity) ? Math.max(0, alertQuantity) : 5,
        costPrice: Number.isFinite(costPrice) ? Math.max(0, costPrice) : 0,
        sellingPrice: Number.isFinite(sellingPrice) ? Math.max(0, sellingPrice) : 0,
        currency: form.currency,
        status: form.status,
        description: editing?.description ?? null,
        category: editing?.category ?? null,
        supplier: editing?.supplier ?? null,
        notes: editing?.notes ?? null,
      };

      if (editing) await onUpdate(editing.id, data);
      else await onCreate(data);
    } catch (caught: unknown) {
      const message = errorMessage(caught, t("common.error"));
      setError(message.toLowerCase().includes("barcode") ? t("stock.barcodeExists") : message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-700 dark:text-indigo-400">
              {editing ? <Pencil className="h-5 w-5" aria-hidden="true" /> : <Plus className="h-5 w-5" aria-hidden="true" />}
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-xl">{editing ? t("stock.editProduct") : t("stock.addProduct")}</DialogTitle>
              <DialogDescription className="mt-1">
                {editing ? t("stock.modal.editDesc") : t("stock.modal.addDesc")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form
          id="product-form"
          className="space-y-5"
          onSubmit={(event) => { event.preventDefault(); void save(); }}
        >
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="product-name">{t("stock.field.name")} *</Label>
              <Input id="product-name" autoFocus required value={form.name} onChange={(event) => set("name", event.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="product-barcode">{t("stock.field.barcode")}</Label>
              <Input id="product-barcode" dir="ltr" className="text-start" value={form.barcode} onChange={(event) => set("barcode", event.target.value)} placeholder={t("stock.field.barcodePlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-currency">{t("stock.field.currency")}</Label>
              <Select value={form.currency} onValueChange={(value) => set("currency", value)}>
                <SelectTrigger id="product-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="CDF">CDF / FC</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-sell">{t("stock.field.sellingPrice")}</Label>
              <Input id="product-sell" type="number" inputMode="decimal" min="0" step="0.01" value={form.sellingPrice} onChange={(event) => set("sellingPrice", event.target.value)} />
            </div>
            {canViewCost && (
              <div className="space-y-1.5">
                <Label htmlFor="product-cost">{t("stock.field.costPrice")}</Label>
                <Input id="product-cost" type="number" inputMode="decimal" min="0" step="0.01" value={form.costPrice} onChange={(event) => set("costPrice", event.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="product-qty">{t("stock.field.quantity")}</Label>
              <Input id="product-qty" type="number" inputMode="numeric" min="0" step="1" value={form.quantity} onChange={(event) => set("quantity", event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-alert">{t("stock.field.alertQty")}</Label>
              <Input id="product-alert" type="number" inputMode="numeric" min="0" step="1" value={form.alertQuantity} onChange={(event) => set("alertQuantity", event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-status">{t("stock.field.status")}</Label>
              <Select value={form.status} onValueChange={(value) => set("status", value)}>
                <SelectTrigger id="product-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("stock.status.active")}</SelectItem>
                  <SelectItem value="archived">{t("stock.status.archived")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" form="product-form" disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
