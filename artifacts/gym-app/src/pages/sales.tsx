import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useFmtDate } from "@/lib/useFmtDate";
import { useGetMe } from "@/hooks/use-me";
import {
  useListSales,
  useGetSettings,
  useCompleteSale,
  useVoidSale,
  useGetSale,
  usePatchSale,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ShoppingCart,
  Barcode,
  Trash2,
  Printer,
  Eye,
  ChevronLeft,
  ChevronRight,
  Search,
  Plus,
  Minus,
  XCircle,
  ReceiptText,
  Ban,
  History,
  Pencil,
  CalendarDays,
  CircleDollarSign,
  CreditCard,
  RotateCcw,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface CartItem {
  productId: number;
  productName: string;
  currency: string;
  sellingPrice: number;
  costPrice: number;
  availableQty: number;
  quantity: number;
  unitPrice: number;
  discount: number;
}

interface SaleItemData {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  costPrice: number;
  profit: number;
  currency: string;
}

type HistoryPeriod = "all" | "today" | "yesterday" | "monthly" | "yearly" | "custom";

function fmtMoney(n: number | null | undefined, sym: string): string {
  const value = Number(n ?? 0);
  const decimals = value % 1 === 0 ? 0 : 2;
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: 2,
  });
  return sym === "FC" ? `FC ${formatted}` : `${sym}${formatted}`;
}

function localDateInput(date: Date): string {
  const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return copy.toISOString().slice(0, 10);
}

function saleDayKey(value: unknown): string {
  const raw = String(value ?? "");
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "unknown" : localDateInput(date);
}

function printReceipt(
  sale: Record<string, unknown>,
  settings: Record<string, unknown>,
  t: (key: string) => string,
) {
  const items = (sale.items ?? []) as SaleItemData[];
  const currency = sale.currency as string;
  const sym = currency === "CDF" ? "FC" : "$";
  const fmt = (n: number | null | undefined) => fmtMoney(n, sym);
  const saleNum = (sale.saleNumber as string) ?? `SALE-${sale.id}`;

  const rows = items.map((item) => {
    const lineTotal = item.lineTotal ?? ((item.unitPrice - (item.discount ?? 0)) * item.quantity);
    return `
      <tr>
        <td style="padding:6px 0">${item.productName}</td>
        <td style="padding:6px 8px;text-align:center;color:#666">${item.quantity}</td>
        <td style="padding:6px 0;text-align:right;color:#666">${fmt(item.unitPrice)}</td>
        <td style="padding:6px 0;text-align:right;color:#e53e3e">${item.discount > 0 ? `-${fmt(item.discount * item.quantity)}` : ""}</td>
        <td style="padding:6px 0;text-align:right;font-weight:600">${fmt(lineTotal)}</td>
      </tr>
    `;
  }).join("");

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Receipt — ${saleNum}</title>
      <style>
        @page { size: 80mm auto; margin: 3mm 6mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; width: 68mm; font-size: 11px; color: #111; background: #fff; }
        .gym-name { font-size: 15px; font-weight: 700; letter-spacing: -0.3px; }
        .gym-sub { font-size: 10px; color: #666; margin-top: 2px; }
        .divider { border: none; border-top: 1px solid #e5e7eb; margin: 8px 0; }
        .divider-dashed { border: none; border-top: 1px dashed #d1d5db; margin: 8px 0; }
        .meta-row { display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 4px; }
        .meta-label { color: #6b7280; }
        .meta-val { font-weight: 500; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        thead th { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: #9ca3af; font-weight: 600; padding: 0 0 6px; border-bottom: 1px solid #e5e7eb; }
        thead th:last-child, thead th:nth-child(3), thead th:nth-child(4) { text-align: right; }
        thead th:nth-child(2) { text-align: center; }
        tbody tr { border-bottom: 1px solid #f3f4f6; }
        .summary { margin-top: 10px; }
        .summary-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 11px; }
        .summary-row.total { font-size: 13px; font-weight: 700; padding: 6px 0; border-top: 2px solid #111; margin-top: 3px; }
        .summary-row .label { color: #6b7280; }
        .summary-row.total .label { color: #111; }
        .badge { display: inline-block; background: #f3f4f6; border-radius: 3px; padding: 1px 4px; font-size: 9px; font-weight: 600; color: #374151; }
        .footer { margin-top: 14px; text-align: center; font-size: 10px; color: #9ca3af; }
        @media print { html, body { width: 68mm; } }
      </style>
    </head>
    <body>
      <div style="text-align:center;margin-bottom:16px">
        <img src="${window.location.origin}/gym-logo.jpg" onerror="this.style.display='none'" style="max-height:60px;margin-bottom:10px;object-fit:contain" alt=""/>
        <div class="gym-name">${settings.gymName ?? "Oxygen Fitness Gym"}</div>
        ${settings.address ? `<div class="gym-sub">${settings.address}</div>` : ""}
        ${settings.phone ? `<div class="gym-sub">${settings.phone}</div>` : ""}
        ${settings.receiptHeader ? `<div style="margin-top:6px;font-size:12px;color:#666;font-style:italic">${settings.receiptHeader}</div>` : ""}
      </div>
      <hr class="divider">
      <div class="meta-row"><span class="meta-label">${t("sales.history.number")}</span><span class="meta-val badge">${saleNum}</span></div>
      <div class="meta-row"><span class="meta-label">Date</span><span class="meta-val">${new Date(sale.saleDate as string).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span></div>
      <div class="meta-row"><span class="meta-label">${t("sales.receipt.cashier")}</span><span class="meta-val">${sale.createdBy ?? "—"}</span></div>
      <hr class="divider">
      <table>
        <thead>
          <tr>
            <th style="text-align:left">${t("sales.col.product")}</th>
            <th>${t("sales.col.qty")}</th>
            <th>${t("sales.col.price")}</th>
            <th>${t("sales.col.discount")}</th>
            <th>${t("sales.col.total")}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="summary">
        ${(sale.totalDiscount as number) > 0 ? `<div class="summary-row"><span class="label">${t("sales.receipt.discount")}</span><span style="color:#e53e3e">-${fmt(sale.totalDiscount as number)}</span></div>` : ""}
        <div class="summary-row total"><span class="label">${t("sales.receipt.total")}</span><span>${fmt(sale.totalAmount as number)}</span></div>
        <div class="summary-row"><span class="label">${t("sales.receipt.paid")}</span><span>${fmt(sale.paymentAmount as number)}</span></div>
        <div class="summary-row"><span class="label">${t("sales.receipt.change")}</span><span style="font-weight:600;color:#059669">${fmt(sale.changeDue as number)}</span></div>
      </div>
      <hr class="divider-dashed" style="margin-top:20px">
      <div class="footer">${settings.receiptFooter ?? "Thank you for your visit!"}</div>
    </body>
    </html>
  `;

  const existing = document.getElementById("__gym_print_frame__");
  if (existing) existing.remove();
  const iframe = document.createElement("iframe");
  iframe.id = "__gym_print_frame__";
  iframe.style.cssText = "position:fixed;top:0;left:-9999px;width:400px;height:1000px;border:none;";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument ?? (iframe.contentWindow as Window).document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    (iframe.contentWindow as Window).focus();
    (iframe.contentWindow as Window).print();
    setTimeout(() => iframe.remove(), 2000);
  }, 500);
}

function CartRow({
  item,
  canViewCost,
  canViewProfit,
  saleCurrency,
  exchangeRate,
  onQtyChange,
  onDiscountChange,
  onRemove,
  t,
}: {
  item: CartItem;
  canViewCost: boolean;
  canViewProfit: boolean;
  saleCurrency: string;
  exchangeRate: number;
  onQtyChange: (id: number, qty: number) => void;
  onDiscountChange: (id: number, discount: number) => void;
  onRemove: (id: number) => void;
  t: (k: string) => string;
}) {
  const toSaleCurrency = (price: number, fromCurrency: string) => {
    if (fromCurrency === saleCurrency) return price;
    if (saleCurrency === "USD" && fromCurrency === "CDF") return price / exchangeRate;
    if (saleCurrency === "CDF" && fromCurrency === "USD") return price * exchangeRate;
    return price;
  };

  const unitInSale = toSaleCurrency(item.unitPrice, item.currency);
  const costInSale = toSaleCurrency(item.costPrice, item.currency);
  const lineTotal = (unitInSale - item.discount) * item.quantity;
  const profit = lineTotal - costInSale * item.quantity;

  return (
    <TableRow className="group">
      <TableCell className="py-3.5 font-medium">{item.productName}</TableCell>
      <TableCell className="py-3.5">
        <div className="inline-flex items-center rounded-lg border border-border/60 bg-muted/20 p-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md"
            onClick={() => onQtyChange(item.productId, item.quantity - 1)}
            disabled={item.quantity <= 1}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-8 text-center text-sm font-semibold tabular-nums">{item.quantity}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md"
            onClick={() => onQtyChange(item.productId, item.quantity + 1)}
            disabled={item.quantity >= item.availableQty}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
      <TableCell className="py-3.5 text-right tabular-nums">{unitInSale.toFixed(2)}</TableCell>
      <TableCell className="py-3.5">
        <Input
          type="number"
          min={0}
          max={unitInSale}
          step={0.01}
          value={item.discount}
          onChange={(event) => onDiscountChange(item.productId, parseFloat(event.target.value) || 0)}
          className="h-8 w-20 text-right text-sm"
        />
      </TableCell>
      <TableCell className="py-3.5 text-right font-semibold tabular-nums">{lineTotal.toFixed(2)}</TableCell>
      {canViewCost && (
        <TableCell className="py-3.5 text-right text-xs tabular-nums text-muted-foreground">
          {(costInSale * item.quantity).toFixed(2)}
        </TableCell>
      )}
      {canViewProfit && (
        <TableCell className={cn("py-3.5 text-right text-xs font-semibold tabular-nums", profit >= 0 ? "text-emerald-500" : "text-red-500")}>
          {profit.toFixed(2)}
        </TableCell>
      )}
      <TableCell className="py-3.5 text-right">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(item.productId)}
          aria-label={`Remove ${item.productName}`}
        >
          <XCircle className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function SaleDetailDialog({
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

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-h-[85vh] w-[95vw] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5" />
            {saleData.saleNumber as string}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-border/60 bg-muted/20 p-4 text-sm sm:grid-cols-2">
            <div><span className="text-muted-foreground">{t("sales.history.date")}:</span> {new Date(saleData.saleDate as string).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}</div>
            <div><span className="text-muted-foreground">{t("sales.receipt.cashier")}:</span> {(saleData.createdBy as string) ?? "—"}</div>
            <div><span className="text-muted-foreground">{t("sales.currency")}:</span> {currency}</div>
            <div>
              <Badge variant={saleData.status === "voided" ? "destructive" : "default"}>
                {t(`sales.status.${saleData.status as string}`)}
              </Badge>
            </div>
          </div>

          {saleData.status === "voided" && (
            <div className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              <strong>{t("sales.void")}:</strong> {saleData.voidedBy as string} — {saleData.voidReason as string}
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("sales.col.product")}</TableHead>
                <TableHead className="text-center">{t("sales.col.qty")}</TableHead>
                <TableHead className="text-right">{t("sales.col.price")}</TableHead>
                <TableHead className="text-right">{t("sales.col.discount")}</TableHead>
                <TableHead className="text-right">{t("sales.col.total")}</TableHead>
                {canViewCost && <TableHead className="text-right">{t("sales.col.cost")}</TableHead>}
                {canViewProfit && <TableHead className="text-right">{t("sales.col.profit")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={`${item.productId}-${index}`}>
                  <TableCell>{item.productName}</TableCell>
                  <TableCell className="text-center">{item.quantity}</TableCell>
                  <TableCell className="text-right">{fmt(item.unitPrice)}</TableCell>
                  <TableCell className="text-right">{item.discount > 0 ? `-${fmt(item.discount * item.quantity)}` : "—"}</TableCell>
                  <TableCell className="text-right font-semibold">{fmt(item.lineTotal ?? ((item.unitPrice - (item.discount ?? 0)) * item.quantity))}</TableCell>
                  {canViewCost && <TableCell className="text-right text-xs text-muted-foreground">{fmt(item.costPrice * item.quantity)}</TableCell>}
                  {canViewProfit && <TableCell className={cn("text-right text-xs font-medium", item.profit >= 0 ? "text-emerald-500" : "text-red-500")}>{fmt(item.profit)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="ml-auto flex max-w-xs flex-col gap-1 border-t pt-3 text-sm">
            {(saleData.totalDiscount as number) > 0 && (
              <div className="flex justify-between gap-8"><span className="text-muted-foreground">{t("sales.receipt.discount")}</span><span className="text-destructive">-{fmt(saleData.totalDiscount as number)}</span></div>
            )}
            <div className="flex justify-between gap-8 text-base font-bold"><span>{t("sales.receipt.total")}</span><span>{fmt(saleData.totalAmount as number)}</span></div>
            <div className="flex justify-between gap-8"><span className="text-muted-foreground">{t("sales.receipt.paid")}</span><span>{fmt(saleData.paymentAmount as number)}</span></div>
            <div className="flex justify-between gap-8"><span className="text-muted-foreground">{t("sales.receipt.change")}</span><span>{fmt(saleData.changeDue as number)}</span></div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { if (settings) printReceipt(saleData, settings, t); }}>
            <Printer className="mr-2 h-4 w-4" />{t("sales.printReceipt")}
          </Button>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SaleEditDialog({
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
  const [editItems, setEditItems] = useState<Array<{
    productId: number;
    productName: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    costPrice: number;
  }>>([]);

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
      toast({ title: "Sale updated" });
      onSaved();
      onClose();
    } catch {
      toast({ title: "Failed to save changes", variant: "destructive" });
    }
  };

  if (!sale) return null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" />
            Edit Sale — {sale.saleNumber as string}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("sales.currency")}</Label>
              <Select value={currency} onValueChange={(value) => setCurrency(value as "USD" | "CDF")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="CDF">CDF (FC)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={saleDate} onChange={(event) => setSaleDate(event.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} placeholder="Optional notes…" onChange={(event) => setNotes(event.target.value)} />
          </div>

          <div>
            <Label className="mb-2 block font-semibold">Items</Label>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="w-12 text-center">Qty</TableHead>
                  <TableHead className="w-32 text-right">Unit Price ({sym})</TableHead>
                  <TableHead className="w-32 text-right">Discount ({sym})</TableHead>
                  <TableHead className="w-24 text-right">Line Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {editItems.map((item, index) => {
                  const lineTotal = (item.unitPrice - item.discount) * item.quantity;
                  return (
                    <TableRow key={item.productId}>
                      <TableCell className="text-sm">{item.productName}</TableCell>
                      <TableCell className="text-center text-muted-foreground">{item.quantity}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          className="h-8 w-full text-right"
                          value={item.unitPrice}
                          onChange={(event) => {
                            const updated = [...editItems];
                            updated[index] = { ...item, unitPrice: parseFloat(event.target.value) || 0 };
                            setEditItems(updated);
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          max={item.unitPrice}
                          step="0.01"
                          className="h-8 w-full text-right"
                          value={item.discount}
                          onChange={(event) => {
                            const next = Math.max(0, Math.min(parseFloat(event.target.value) || 0, item.unitPrice));
                            const updated = [...editItems];
                            updated[index] = { ...item, discount: next };
                            setEditItems(updated);
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold">{fmt(lineTotal)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Payment Received ({sym})</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={paymentAmount}
                onChange={(event) => setPaymentAmount(parseFloat(event.target.value) || 0)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Change Due ({sym})</Label>
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-semibold">
                {fmt(liveChange)}
              </div>
            </div>
          </div>

          <div className="ml-auto flex max-w-xs flex-col gap-1 border-t pt-3 text-sm">
            {liveDiscount > 0 && (
              <div className="flex justify-between gap-6"><span className="text-muted-foreground">Discount</span><span className="text-destructive">-{fmt(liveDiscount)}</span></div>
            )}
            <div className="flex justify-between gap-6 text-base font-bold"><span>Total</span><span>{fmt(liveTotal)}</span></div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={handleSave} disabled={patchSaleMut.isPending}>
            {patchSaleMut.isPending ? t("common.loading") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Sales() {
  const { t } = useI18n();
  const { locale } = useFmtDate();
  const me = useGetMe();
  const { data: settingsData } = useGetSettings();
  const settings = settingsData as unknown as Record<string, unknown> | null;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const isAdmin = me?.role === "admin";
  const canAccess = isAdmin || Boolean(me?.permissions?.sales);
  const canViewCost = isAdmin || Boolean(me?.permissions?.viewCost);
  const canViewProfit = isAdmin || Boolean(me?.permissions?.viewProfit);
  const canManage = isAdmin || Boolean(me?.permissions?.manageInventory);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [saleCurrency, setSaleCurrency] = useState<"USD" | "CDF">("CDF");
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [notes, setNotes] = useState("");
  const [completing, setCompleting] = useState(false);

  const barcodeRef = useRef<HTMLInputElement>(null);
  const barcodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [barcodeInput, setBarcodeInput] = useState("");

  const [productSearch, setProductSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchSequenceRef = useRef(0);
  const [searchResults, setSearchResults] = useState<Array<{
    id: number;
    name: string;
    currency: string;
    sellingPrice: number;
    costPrice: number;
    quantity: number;
    status: string;
  }>>([]);

  const [historyPage, setHistoryPage] = useState(1);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [historyCurrency, setHistoryCurrency] = useState("");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>("all");

  const [viewSaleId, setViewSaleId] = useState<number | null>(null);
  const [voidSaleId, setVoidSaleId] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidingSale, setVoidingSale] = useState<Record<string, unknown> | null>(null);
  const [editSaleId, setEditSaleId] = useState<number | null>(null);
  const [printingSaleId, setPrintingSaleId] = useState<number | null>(null);

  const exchangeRate = Number(settings?.usdToCdfRate) > 0 ? Number(settings?.usdToCdfRate) : 2800;

  const { data: historyData } = useListSales({
    page: String(historyPage),
    limit: "100",
    search: historySearch || undefined,
    status: historyStatus || undefined,
    currency: historyCurrency || undefined,
    dateFrom: historyDateFrom || undefined,
    dateTo: historyDateTo || undefined,
  });

  const completeSaleMut = useCompleteSale();
  const voidSaleMut = useVoidSale();

  const toSaleCurrency = useCallback((price: number, fromCurrency: string) => {
    if (fromCurrency === saleCurrency) return price;
    if (saleCurrency === "USD" && fromCurrency === "CDF") return price / exchangeRate;
    if (saleCurrency === "CDF" && fromCurrency === "USD") return price * exchangeRate;
    return price;
  }, [saleCurrency, exchangeRate]);

  const cartTotals = useMemo(() => cart.reduce((acc, item) => {
    const unitInSale = toSaleCurrency(item.unitPrice, item.currency);
    const costInSale = toSaleCurrency(item.costPrice, item.currency);
    const lineTotal = (unitInSale - item.discount) * item.quantity;
    const lineCost = costInSale * item.quantity;
    acc.total += lineTotal;
    acc.discount += item.discount * item.quantity;
    acc.cost += lineCost;
    acc.profit += lineTotal - lineCost;
    return acc;
  }, { total: 0, discount: 0, cost: 0, profit: 0 }), [cart, toSaleCurrency]);

  const changeDue = Math.max(0, paymentAmount - cartTotals.total);
  const cartSym = saleCurrency === "USD" ? "$" : "FC";
  const fmt = (n: number | null | undefined) => fmtMoney(n, cartSym);

  const addProductToCart = useCallback(async (barcode: string) => {
    const trimmed = barcode.trim();
    if (!trimmed) return;

    try {
      const authHeaders = { Authorization: `Bearer ${localStorage.getItem("gym_token") ?? ""}` };
      const res = await fetch(`/api/sales/lookup-barcode?barcode=${encodeURIComponent(trimmed)}`, { headers: authHeaders });
      if (!res.ok) {
        toast({ title: t("sales.toast.barcodeNotFound"), variant: "destructive" });
        void fetch("/api/activity-logs", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ action: "barcode_not_found", entity: "product", details: { barcode: trimmed } }),
        }).catch(() => null);
        return;
      }

      const product = await res.json() as {
        id: number;
        name: string;
        currency: string;
        sellingPrice: number;
        costPrice: number;
        quantity: number;
        status: string;
      };

      if (product.status !== "active" || product.quantity < 1) {
        toast({ title: product.quantity < 1 ? t("sales.toast.insufficientStock") : `"${product.name}" is not available for sale`, variant: "destructive" });
        return;
      }

      setCart((previous) => {
        const existing = previous.find((item) => item.productId === product.id);
        if (existing) {
          if (existing.quantity >= product.quantity) {
            toast({ title: t("sales.toast.insufficientStock"), variant: "destructive" });
            return previous;
          }
          return previous.map((item) => item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item);
        }

        return [...previous, {
          productId: product.id,
          productName: product.name,
          currency: product.currency,
          sellingPrice: product.sellingPrice,
          costPrice: product.costPrice,
          availableQty: product.quantity,
          quantity: 1,
          unitPrice: product.sellingPrice,
          discount: 0,
        }];
      });
    } catch {
      toast({ title: t("sales.toast.barcodeNotFound"), variant: "destructive" });
    }
  }, [toast, t]);

  const handleBarcodeChange = (value: string) => {
    setBarcodeInput(value);
    if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current);
    barcodeTimerRef.current = setTimeout(() => {
      if (!value.trim()) return;
      void addProductToCart(value);
      setBarcodeInput("");
    }, 150);
  };

  useEffect(() => () => {
    if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current);
  }, []);

  const searchProducts = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }

    const sequence = ++searchSequenceRef.current;
    try {
      const res = await fetch(`/api/stock?search=${encodeURIComponent(trimmed)}&limit=10`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("gym_token") ?? ""}` },
      });
      if (!res.ok || sequence !== searchSequenceRef.current) return;
      const data = await res.json() as { items: Array<{
        id: number;
        name: string;
        currency: string;
        sellingPrice: number;
        costPrice: number;
        quantity: number;
        status: string;
      }> };
      setSearchResults(data.items.filter((product) => product.status === "active" && product.quantity > 0));
    } catch {
      if (sequence === searchSequenceRef.current) setSearchResults([]);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (searchOpen) void searchProducts(productSearch);
    }, 250);
    return () => clearTimeout(timeout);
  }, [productSearch, searchOpen, searchProducts]);

  const addFromSearch = (product: typeof searchResults[number]) => {
    setCart((previous) => {
      const existing = previous.find((item) => item.productId === product.id);
      if (existing) {
        if (existing.quantity >= product.quantity) {
          toast({ title: t("sales.toast.insufficientStock"), variant: "destructive" });
          return previous;
        }
        return previous.map((item) => item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...previous, {
        productId: product.id,
        productName: product.name,
        currency: product.currency,
        sellingPrice: product.sellingPrice,
        costPrice: product.costPrice,
        availableQty: product.quantity,
        quantity: 1,
        unitPrice: product.sellingPrice,
        discount: 0,
      }];
    });
    setProductSearch("");
    setSearchResults([]);
    setSearchOpen(false);
  };

  const updateQty = (productId: number, quantity: number) => {
    setCart((previous) => previous.flatMap((item) => {
      if (item.productId !== productId) return [item];
      if (quantity <= 0) return [];
      return [{ ...item, quantity: Math.min(quantity, item.availableQty) }];
    }));
  };

  const updateDiscount = (productId: number, discount: number) => {
    setCart((previous) => previous.map((item) => {
      if (item.productId !== productId) return item;
      const maxDiscount = toSaleCurrency(item.unitPrice, item.currency);
      return { ...item, discount: Math.max(0, Math.min(discount, maxDiscount)) };
    }));
  };

  const removeItem = (productId: number) => {
    setCart((previous) => previous.filter((item) => item.productId !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setPaymentAmount(0);
    setNotes("");
    toast({ title: t("sales.toast.cartCleared") });
  };

  const handleCompleteSale = async () => {
    if (cart.length === 0) return;
    if (paymentAmount < cartTotals.total) {
      toast({ title: "Payment amount is less than the total", variant: "destructive" });
      return;
    }

    setCompleting(true);
    try {
      const result = await completeSaleMut.mutateAsync({
        data: {
          items: cart.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: toSaleCurrency(item.unitPrice, item.currency),
            discount: item.discount,
          })),
          currency: saleCurrency,
          paymentAmount,
          notes: notes || undefined,
        },
      });

      toast({ title: t("sales.toast.completed") });
      void queryClient.invalidateQueries();

      const saleData = result as unknown as Record<string, unknown>;
      if (settings) setTimeout(() => printReceipt(saleData, settings, t), 500);

      setCart([]);
      setPaymentAmount(0);
      setNotes("");
      barcodeRef.current?.focus();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to complete sale";
      toast({ title: message, variant: "destructive" });
    } finally {
      setCompleting(false);
    }
  };

  const handleVoid = async () => {
    if (!voidSaleId || !voidReason.trim()) return;
    try {
      await voidSaleMut.mutateAsync({ id: voidSaleId, data: { reason: voidReason.trim() } });
      toast({ title: t("sales.toast.voided") });
      void queryClient.invalidateQueries();
      setVoidSaleId(null);
      setVoidReason("");
      setVoidingSale(null);
    } catch {
      toast({ title: "Failed to void sale", variant: "destructive" });
    }
  };

  const handlePrintSale = async (saleId: number) => {
    if (!settings || printingSaleId) return;
    setPrintingSaleId(saleId);
    try {
      const response = await fetch(`/api/sales/${saleId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("gym_token") ?? ""}` },
      });
      if (!response.ok) throw new Error("Failed to load receipt");
      const sale = await response.json() as Record<string, unknown>;
      printReceipt(sale, settings, t);
    } catch {
      toast({ title: "Could not load this receipt for printing", variant: "destructive" });
    } finally {
      setPrintingSaleId(null);
    }
  };

  const applyHistoryPeriod = (period: HistoryPeriod) => {
    setHistoryPeriod(period);
    setHistoryPage(1);

    if (period === "all") {
      setHistoryDateFrom("");
      setHistoryDateTo("");
      return;
    }
    if (period === "custom") return;

    const today = new Date();
    let from = new Date(today);
    let to = new Date(today);

    if (period === "yesterday") {
      from.setDate(from.getDate() - 1);
      to = new Date(from);
    } else if (period === "monthly") {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (period === "yearly") {
      from = new Date(today.getFullYear(), 0, 1);
    }

    setHistoryDateFrom(localDateInput(from));
    setHistoryDateTo(localDateInput(to));
  };

  const clearHistoryFilters = () => {
    setHistorySearch("");
    setHistoryStatus("");
    setHistoryCurrency("");
    setHistoryDateFrom("");
    setHistoryDateTo("");
    setHistoryPeriod("all");
    setHistoryPage(1);
  };

  if (!canAccess) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Ban className="h-12 w-12" />
        <p>{t("sales.restricted")}</p>
      </div>
    );
  }

  const historyItems = historyData as unknown as {
    items: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  } | undefined;
  const totalHistoryPages = historyItems ? Math.max(1, Math.ceil(historyItems.total / 100)) : 1;
  const hasHistoryFilters = Boolean(historySearch || historyStatus || historyCurrency || historyDateFrom || historyDateTo);

  const groupedByDay = useMemo(() => {
    const items = historyItems?.items ?? [];
    const byDay: Record<string, { usd: typeof items; cdf: typeof items }> = {};
    for (const sale of items) {
      const day = saleDayKey(sale.saleDate);
      if (!byDay[day]) byDay[day] = { usd: [], cdf: [] };
      if ((sale.currency as string) === "USD") byDay[day].usd.push(sale);
      else byDay[day].cdf.push(sale);
    }
    return Object.entries(byDay).sort(([a], [b]) => b.localeCompare(a));
  }, [historyItems]);

  return (
    <div className="flex h-full flex-col gap-5">
      <PageHeader
        icon={ShoppingCart}
        iconClass="bg-emerald-500/10 text-emerald-500"
        title={t("sales.title")}
        subtitle="Fast checkout and a cleaner view of every sale"
      />

      <Tabs defaultValue="pos" className="flex flex-1 flex-col">
        <TabsList className="h-11 w-fit rounded-xl border border-border/60 bg-card p-1 shadow-sm">
          <TabsTrigger value="pos" className="h-8 gap-2 rounded-lg px-4 data-[state=active]:shadow-sm">
            <ShoppingCart className="h-4 w-4" />{t("sales.pos")}
          </TabsTrigger>
          <TabsTrigger value="history" className="h-8 gap-2 rounded-lg px-4 data-[state=active]:shadow-sm">
            <History className="h-4 w-4" />{t("sales.history")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pos" className="mt-4 flex flex-1 flex-col gap-4 xl:flex-row">
          <div className="flex shrink-0 flex-col gap-4 xl:w-[340px]">
            <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                  <Barcode className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold">Add products</p>
                  <p className="text-xs text-muted-foreground">Scan a barcode or search by name</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("sales.barcode")}</Label>
                  <div className="relative">
                    <Barcode className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={barcodeRef}
                      value={barcodeInput}
                      onChange={(event) => handleBarcodeChange(event.target.value)}
                      placeholder={t("sales.barcodePlaceholder")}
                      className="h-11 pl-9 font-mono"
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" || !barcodeInput.trim()) return;
                        if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current);
                        void addProductToCart(barcodeInput);
                        setBarcodeInput("");
                      }}
                    />
                  </div>
                </div>

                <div className="relative space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("sales.searchProduct")}</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={productSearch}
                      onChange={(event) => { setProductSearch(event.target.value); setSearchOpen(true); }}
                      onFocus={() => setSearchOpen(true)}
                      placeholder={t("sales.searchProduct")}
                      className="h-11 pl-9"
                    />
                  </div>

                  {searchOpen && searchResults.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border/70 bg-popover shadow-xl">
                      {searchResults.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          className="flex w-full items-center justify-between gap-3 border-b border-border/40 px-3 py-3 text-left text-sm last:border-0 hover:bg-accent"
                          onClick={() => addFromSearch(product)}
                        >
                          <span className="min-w-0 truncate font-medium">{product.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {fmtMoney(product.sellingPrice, product.currency === "CDF" ? "FC" : "$")} · {product.quantity} left
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CircleDollarSign className="h-4 w-4 text-primary" />
                  <Label className="font-semibold">{t("sales.currency")}</Label>
                </div>
                <Badge variant="outline" className="font-mono">1 USD = {exchangeRate.toLocaleString()} CDF</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["CDF", "USD"] as const).map((currency) => (
                  <button
                    key={currency}
                    type="button"
                    onClick={() => setSaleCurrency(currency)}
                    className={cn(
                      "rounded-xl border px-3 py-3 text-left transition-colors",
                      saleCurrency === currency
                        ? "border-primary/50 bg-primary/10 text-foreground"
                        : "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40",
                    )}
                  >
                    <p className="font-semibold">{currency === "CDF" ? "FC / CDF" : "$ / USD"}</p>
                    <p className="mt-0.5 text-xs">{saleCurrency === currency ? "Selected" : "Use currency"}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex min-h-[440px] flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ShoppingCart className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold">{t("sales.cart")}</h2>
                      {cart.length > 0 && <Badge variant="secondary">{cart.length}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">Review quantities and discounts before checkout</p>
                  </div>
                </div>

                {cart.length > 0 && (
                  <div className="flex items-center gap-3">
                    <div className="hidden text-right sm:block">
                      <p className="text-xs text-muted-foreground">Current total</p>
                      <p className="font-bold tabular-nums">{fmt(cartTotals.total)}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={clearCart} className="gap-1.5 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />{t("sales.clearCart")}
                    </Button>
                  </div>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-muted/50">
                    <ShoppingCart className="h-9 w-9 text-muted-foreground/35" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{t("sales.cartEmpty")}</p>
                    <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("sales.cartEmptyHint")}</p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-auto">
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>{t("sales.col.product")}</TableHead>
                        <TableHead>{t("sales.col.qty")}</TableHead>
                        <TableHead className="text-right">{t("sales.col.price")}</TableHead>
                        <TableHead className="text-right">{t("sales.col.discount")}</TableHead>
                        <TableHead className="text-right">{t("sales.col.total")}</TableHead>
                        {canViewCost && <TableHead className="text-right text-xs">{t("sales.col.cost")}</TableHead>}
                        {canViewProfit && <TableHead className="text-right text-xs">{t("sales.col.profit")}</TableHead>}
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cart.map((item) => (
                        <CartRow
                          key={item.productId}
                          item={item}
                          canViewCost={canViewCost}
                          canViewProfit={canViewProfit}
                          saleCurrency={saleCurrency}
                          exchangeRate={exchangeRate}
                          onQtyChange={updateQty}
                          onDiscountChange={updateDiscount}
                          onRemove={removeItem}
                          t={t}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {cart.length > 0 && (
              <div className="sticky bottom-0 z-10 rounded-2xl border border-border/60 bg-card p-4 shadow-xl md:static md:shadow-sm">
                <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">{t("sales.paymentAmount")}</Label>
                      <div className="relative">
                        <CreditCard className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={paymentAmount || ""}
                          onChange={(event) => setPaymentAmount(parseFloat(event.target.value) || 0)}
                          className="h-10 pl-9 text-right font-semibold"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">{t("sales.changeDue")}</Label>
                      <Input readOnly value={fmt(changeDue)} className="h-10 bg-muted/40 text-right font-semibold" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">{t("sales.notes")}</Label>
                      <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional note…" className="h-10" />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 lg:min-w-[280px]">
                    <div className="flex items-end justify-between gap-4 px-1">
                      <div className="space-y-0.5 text-xs text-muted-foreground">
                        {cartTotals.discount > 0 && <p>Discount: <span className="font-medium text-destructive">-{fmt(cartTotals.discount)}</span></p>}
                        {canViewCost && <p>Cost: <span className="font-medium text-foreground">{fmt(cartTotals.cost)}</span></p>}
                        {canViewProfit && <p>Profit: <span className={cn("font-medium", cartTotals.profit >= 0 ? "text-emerald-500" : "text-red-500")}>{fmt(cartTotals.profit)}</span></p>}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">{t("sales.grandTotal")}</p>
                        <p className="text-2xl font-bold tracking-tight tabular-nums">{fmt(cartTotals.total)}</p>
                      </div>
                    </div>
                    <Button
                      className="h-11 w-full font-semibold"
                      onClick={handleCompleteSale}
                      disabled={completing || paymentAmount < cartTotals.total}
                    >
                      {completing ? t("common.loading") : t("sales.completeSale")}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-4 flex flex-1 flex-col gap-4">
          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="font-semibold">Sales history</p>
                <p className="text-xs text-muted-foreground">Find sales quickly by period, currency, status, or receipt number</p>
              </div>

              <div className="relative w-full lg:w-80">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-10 pl-9"
                  placeholder={`${t("sales.history.number")} / ${t("sales.history.by")}`}
                  value={historySearch}
                  onChange={(event) => { setHistorySearch(event.target.value); setHistoryPage(1); }}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1 rounded-xl bg-muted/50 p-1">
                  {([
                    ["today", "Today"],
                    ["yesterday", "Yesterday"],
                    ["all", "All"],
                    ["monthly", "Monthly"],
                    ["yearly", "Yearly"],
                  ] as Array<[HistoryPeriod, string]>).map(([period, label]) => (
                    <button
                      key={period}
                      type="button"
                      onClick={() => applyHistoryPeriod(period)}
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                        historyPeriod === period
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="flex overflow-hidden rounded-xl border border-border/60 bg-background">
                  {(["", "USD", "CDF"] as const).map((currency) => (
                    <button
                      key={currency || "all-currency"}
                      type="button"
                      className={cn(
                        "px-3 py-2 text-sm font-medium transition-colors",
                        historyCurrency === currency
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                      onClick={() => { setHistoryCurrency(currency); setHistoryPage(1); }}
                    >
                      {currency === "" ? "All currencies" : currency}
                    </button>
                  ))}
                </div>

                <Select value={historyStatus || "all"} onValueChange={(value) => { setHistoryStatus(value === "all" ? "" : value); setHistoryPage(1); }}>
                  <SelectTrigger className="h-10 w-40 shrink-0 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="completed">{t("sales.status.completed")}</SelectItem>
                    <SelectItem value="voided">{t("sales.status.voided")}</SelectItem>
                  </SelectContent>
                </Select>

                {hasHistoryFilters && (
                  <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={clearHistoryFilters}>
                    <RotateCcw className="h-3.5 w-3.5" />Reset
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap items-end gap-2 border-t border-border/50 pt-3">
                <div className="space-y-1">
                  <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">From</Label>
                  <Input
                    type="date"
                    value={historyDateFrom}
                    onChange={(event) => { setHistoryDateFrom(event.target.value); setHistoryPeriod("custom"); setHistoryPage(1); }}
                    className="h-9 w-40 rounded-xl"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">To</Label>
                  <Input
                    type="date"
                    value={historyDateTo}
                    onChange={(event) => { setHistoryDateTo(event.target.value); setHistoryPeriod("custom"); setHistoryPage(1); }}
                    className="h-9 w-40 rounded-xl"
                  />
                </div>
                <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarDays className="h-4 w-4" />
                  <span>{historyItems?.total ?? 0} sale{(historyItems?.total ?? 0) === 1 ? "" : "s"} found</span>
                </div>
              </div>
            </div>
          </div>

          {!historyItems || historyItems.items.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card/40 px-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                <ReceiptText className="h-7 w-7 text-muted-foreground/40" />
              </div>
              <div>
                <p className="font-semibold text-foreground">{t("sales.empty")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{hasHistoryFilters ? "No sales match the selected filters." : t("sales.emptyHint")}</p>
              </div>
              {hasHistoryFilters && <Button variant="outline" size="sm" onClick={clearHistoryFilters}>Clear filters</Button>}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {groupedByDay.map(([dayKey, { usd, cdf }]) => {
                const dayLabel = dayKey === "unknown"
                  ? "Unknown date"
                  : new Date(`${dayKey}T12:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
                const showBothCurrencies = historyCurrency === "" && usd.length > 0 && cdf.length > 0;

                const renderSaleRow = (sale: Record<string, unknown>) => {
                  const currency = sale.currency as string;
                  const sym = currency === "USD" ? "$" : "FC";
                  const formatSaleMoney = (value: number) => fmtMoney(Number(value), sym);
                  const saleNumber = (sale.saleNumber as string) || `#${sale.id as number}`;
                  const time = sale.saleDate
                    ? new Date(sale.saleDate as string).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
                    : "";

                  return (
                    <div
                      key={sale.id as number}
                      className={cn(
                        "grid grid-cols-[minmax(130px,1.2fr)_minmax(110px,1fr)_minmax(120px,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30 lg:grid-cols-[minmax(150px,1.4fr)_1fr_1fr_minmax(120px,1fr)_auto]",
                        sale.status === "voided" && "opacity-55",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{saleNumber}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{time || (sale.createdBy as string) || "—"}</p>
                      </div>

                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</p>
                        <p className="font-semibold tabular-nums">{formatSaleMoney(sale.totalAmount as number)}</p>
                      </div>

                      <div className="hidden sm:block">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Paid / change</p>
                        <p className="text-sm tabular-nums">{formatSaleMoney(sale.paymentAmount as number)}</p>
                        <p className="text-xs tabular-nums text-muted-foreground">Change {formatSaleMoney(sale.changeDue as number)}</p>
                      </div>

                      <div className="hidden lg:block">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</p>
                        <Badge variant={sale.status === "voided" ? "destructive" : "default"} className="mt-1 text-xs">
                          {t(`sales.status.${sale.status as string}`)}
                        </Badge>
                      </div>

                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setViewSaleId(sale.id as number)} aria-label={`View ${saleNumber}`}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => void handlePrintSale(sale.id as number)}
                          disabled={printingSaleId === sale.id}
                          aria-label={`Print ${saleNumber}`}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        {isAdmin && sale.status !== "voided" && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditSaleId(sale.id as number)} aria-label={`Edit ${saleNumber}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {sale.status !== "voided" && canManage && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => { setVoidSaleId(sale.id as number); setVoidingSale(sale); }}
                            aria-label={`Void ${saleNumber}`}
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                };

                return (
                  <div key={dayKey} className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
                    <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background text-muted-foreground shadow-sm">
                          <CalendarDays className="h-4 w-4" />
                        </div>
                        <span className="text-sm font-semibold">{dayLabel}</span>
                      </div>
                      <Badge variant="secondary">{usd.length + cdf.length} sale{usd.length + cdf.length === 1 ? "" : "s"}</Badge>
                    </div>

                    {usd.length > 0 && (
                      <>
                        {showBothCurrencies && (
                          <div className="flex items-center gap-2 border-b border-border/40 bg-emerald-500/5 px-4 py-2">
                            <span className="text-xs font-semibold text-emerald-500">$ USD</span>
                            <span className="text-xs text-muted-foreground">{usd.length} sale{usd.length === 1 ? "" : "s"}</span>
                          </div>
                        )}
                        <div className="divide-y divide-border/40">{usd.map(renderSaleRow)}</div>
                      </>
                    )}

                    {cdf.length > 0 && (
                      <>
                        {showBothCurrencies && (
                          <div className="flex items-center gap-2 border-y border-border/40 bg-blue-500/5 px-4 py-2">
                            <span className="text-xs font-semibold text-blue-500">FC CDF</span>
                            <span className="text-xs text-muted-foreground">{cdf.length} sale{cdf.length === 1 ? "" : "s"}</span>
                          </div>
                        )}
                        <div className="divide-y divide-border/40">{cdf.map(renderSaleRow)}</div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {historyItems && historyItems.total > 100 && (
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-3 text-sm text-muted-foreground">
              <span>{historyItems.total} total sales</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={historyPage <= 1} onClick={() => setHistoryPage((page) => page - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span>{t("common.page")} {historyPage} {t("common.of")} {totalHistoryPages}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={historyPage >= totalHistoryPages} onClick={() => setHistoryPage((page) => page + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <SaleDetailDialog
        saleId={viewSaleId}
        open={!!viewSaleId}
        onClose={() => setViewSaleId(null)}
        settings={settings}
        canViewCost={canViewCost}
        canViewProfit={canViewProfit}
        t={t}
      />

      <SaleEditDialog
        saleId={editSaleId}
        open={!!editSaleId}
        onClose={() => setEditSaleId(null)}
        onSaved={() => { void queryClient.invalidateQueries(); }}
        t={t}
      />

      <AlertDialog open={!!voidSaleId} onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setVoidSaleId(null);
          setVoidReason("");
          setVoidingSale(null);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-destructive" />{t("sales.void")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("sales.voidConfirm")}
              {voidingSale && <span className="mt-1 block font-semibold">{(voidingSale.saleNumber as string) || `#${voidingSale.id as number}`}</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 py-2">
            <Label className="text-sm font-medium">{t("sales.voidReason")} *</Label>
            <Textarea
              className="mt-1"
              rows={2}
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              placeholder={t("sales.voidReason")}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleVoid}
              disabled={!voidReason.trim() || voidSaleMut.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {voidSaleMut.isPending ? t("common.loading") : t("sales.void")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
