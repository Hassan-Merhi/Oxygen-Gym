import { useState, useRef, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { useGetMe } from "@/hooks/use-me";
import {
  useListSales,
  useGetSettings,
  useLookupBarcode,
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
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Types ────────────────────────────────────────────────────────────────────
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

// ─── Receipt helpers ───────────────────────────────────────────────────────────
function fmtMoney(n: number | null | undefined, sym: string): string {
  const v = n ?? 0;
  const s = v % 1 === 0 ? `${v}` : v.toFixed(2);
  return sym === "FC" ? `FC ${s}` : `${sym}${s}`;
}

// ─── Receipt Print ─────────────────────────────────────────────────────────────
function printReceipt(sale: Record<string, unknown>, settings: Record<string, unknown>, t: (key: string) => string) {
  const items = (sale.items ?? []) as SaleItemData[];
  const currency = sale.currency as string;
  const sym = currency === "CDF" ? "FC" : "$";
  const fmt = (n: number | null | undefined) => fmtMoney(n, sym);
  const saleNum = (sale.saleNumber as string) ?? `SALE-${sale.id}`;

  const rows = items.map((item: SaleItemData) => {
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
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; width: 68mm; padding: 0; font-size: 11px; color: #111; background: #fff; }
        .gym-name { font-size: 15px; font-weight: 700; letter-spacing: -0.3px; }
        .gym-sub { font-size: 10px; color: #666; margin-top: 2px; }
        .divider { border: none; border-top: 1px solid #e5e7eb; margin: 8px 0; }
        .divider-dashed { border: none; border-top: 1px dashed #d1d5db; margin: 8px 0; }
        .meta-row { display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 4px; }
        .meta-label { color: #6b7280; }
        .meta-val { font-weight: 500; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        thead th { font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; font-weight: 600; padding: 0 0 6px; border-bottom: 1px solid #e5e7eb; }
        thead th:last-child { text-align: right; }
        thead th:nth-child(2) { text-align: center; }
        thead th:nth-child(3), thead th:nth-child(4) { text-align: right; }
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
  const doc = (iframe.contentDocument ?? (iframe.contentWindow as Window).document);
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => {
    (iframe.contentWindow as Window).focus();
    (iframe.contentWindow as Window).print();
    setTimeout(() => iframe.remove(), 2000);
  }, 500);
}

// ─── Cart Item Row ─────────────────────────────────────────────────────────────
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
    <TableRow>
      <TableCell className="font-medium">{item.productName}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onQtyChange(item.productId, item.quantity - 1)}
            disabled={item.quantity <= 1}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <span className="w-6 text-center text-sm">{item.quantity}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onQtyChange(item.productId, item.quantity + 1)}
            disabled={item.quantity >= item.availableQty}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </TableCell>
      <TableCell className="text-right">{unitInSale.toFixed(2)}</TableCell>
      <TableCell>
        <Input
          type="number"
          min={0}
          max={unitInSale}
          step={0.01}
          value={item.discount}
          onChange={(e) => onDiscountChange(item.productId, parseFloat(e.target.value) || 0)}
          className="w-20 h-7 text-sm text-right"
        />
      </TableCell>
      <TableCell className="text-right font-semibold">{lineTotal.toFixed(2)}</TableCell>
      {canViewCost && <TableCell className="text-right text-muted-foreground text-xs">{(costInSale * item.quantity).toFixed(2)}</TableCell>}
      {canViewProfit && (
        <TableCell className={`text-right text-xs font-medium ${profit >= 0 ? "text-green-600" : "text-red-600"}`}>
          {profit.toFixed(2)}
        </TableCell>
      )}
      <TableCell>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onRemove(item.productId)}>
          <XCircle className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ─── Sale Detail Dialog ────────────────────────────────────────────────────────
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
  const { data: sale } = useGetSale(saleId ?? 0, { query: { enabled: !!saleId && open, queryKey: ["getSale", saleId] } });
  const { toast } = useToast();

  if (!sale) return null;
  const saleData = sale as unknown as Record<string, unknown>;
  const items = (saleData.items ?? []) as SaleItemData[];
  const currency = saleData.currency as string;
  const sym = currency === "CDF" ? "FC" : "$";
  const fmt = (n: number | null | undefined) => fmtMoney(n, sym);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5" />
            {saleData.saleNumber as string}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-muted-foreground">{t("sales.history.date")}:</span> {new Date(saleData.saleDate as string).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>
            <div><span className="text-muted-foreground">{t("sales.receipt.cashier")}:</span> {saleData.createdBy as string ?? "—"}</div>
            <div><span className="text-muted-foreground">{t("sales.currency")}:</span> {currency}</div>
            <div>
              <Badge variant={saleData.status === "voided" ? "destructive" : "default"}>
                {t(`sales.status.${saleData.status as string}`)}
              </Badge>
            </div>
          </div>

          {saleData.status === "voided" && (
            <div className="rounded-md bg-destructive/10 text-destructive p-3 text-sm">
              <strong>{t("sales.void")}:</strong> {saleData.voidedBy as string} — {saleData.voidReason as string}
            </div>
          )}

          {/* Items */}
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
              {items.map((item, i) => (
                <TableRow key={i}>
                  <TableCell>{item.productName}</TableCell>
                  <TableCell className="text-center">{item.quantity}</TableCell>
                  <TableCell className="text-right">{fmt(item.unitPrice)}</TableCell>
                  <TableCell className="text-right">{item.discount > 0 ? `-${fmt(item.discount * item.quantity)}` : "—"}</TableCell>
                  <TableCell className="text-right font-semibold">{fmt(item.lineTotal ?? ((item.unitPrice - (item.discount ?? 0)) * item.quantity))}</TableCell>
                  {canViewCost && <TableCell className="text-right text-muted-foreground text-xs">{fmt(item.costPrice * item.quantity)}</TableCell>}
                  {canViewProfit && <TableCell className={`text-right text-xs font-medium ${item.profit >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(item.profit)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Totals */}
          <div className="flex flex-col gap-1 items-end text-sm border-t pt-3">
            {(saleData.totalDiscount as number) > 0 && (
              <div className="flex gap-8"><span className="text-muted-foreground">{t("sales.receipt.discount")}:</span><span className="text-destructive">-{fmt(saleData.totalDiscount as number)}</span></div>
            )}
            <div className="flex gap-8 font-bold text-base"><span>{t("sales.receipt.total")}:</span><span>{fmt(saleData.totalAmount as number)}</span></div>
            <div className="flex gap-8"><span className="text-muted-foreground">{t("sales.receipt.paid")}:</span><span>{fmt(saleData.paymentAmount as number)}</span></div>
            <div className="flex gap-8"><span className="text-muted-foreground">{t("sales.receipt.change")}:</span><span>{fmt(saleData.changeDue as number)}</span></div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => {
            if (settings) printReceipt(saleData, settings as Record<string, unknown>, t);
          }}>
            <Printer className="h-4 w-4 mr-2" />{t("sales.printReceipt")}
          </Button>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function Sales() {
  const { t } = useI18n();
  const me = useGetMe();
  const { data: settingsData } = useGetSettings();
  const settings = settingsData as unknown as Record<string, unknown> | null;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Permissions
  const isAdmin = me?.role === "admin";
  const canAccess = isAdmin || Boolean(me?.permissions?.sales);
  const canViewCost = isAdmin || Boolean(me?.permissions?.viewCost);
  const canViewProfit = isAdmin || Boolean(me?.permissions?.viewProfit);
  const canManage = isAdmin || Boolean(me?.permissions?.manageInventory);

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [saleCurrency, setSaleCurrency] = useState<"USD" | "CDF">("USD");
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [completing, setCompleting] = useState(false);

  // Barcode
  const barcodeRef = useRef<HTMLInputElement>(null);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeTimer, setBarcodeTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Product search
  const [productSearch, setProductSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  // History tab
  const [historyPage, setHistoryPage] = useState(1);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");

  // Modals
  const [viewSaleId, setViewSaleId] = useState<number | null>(null);
  const [voidSaleId, setVoidSaleId] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidingSale, setVoidingSale] = useState<Record<string, unknown> | null>(null);
  const [editSaleId, setEditSaleId] = useState<number | null>(null);
  const [editCurrency, setEditCurrency] = useState<"USD" | "CDF">("USD");
  const [editSale, setEditSale] = useState<Record<string, unknown> | null>(null);

  const exchangeRate = (settings?.usdToCdfRate as number) ?? 2800;

  // Queries
  const { data: historyData } = useListSales({
    page: String(historyPage),
    limit: "15",
    search: historySearch || undefined,
    status: historyStatus || undefined,
  });

  // Mutations
  const completeSaleMut = useCompleteSale();
  const voidSaleMut = useVoidSale();
  const patchSaleMut = usePatchSale();

  // Computed cart totals
  const toSaleCurrency = useCallback((price: number, fromCurrency: string) => {
    if (fromCurrency === saleCurrency) return price;
    if (saleCurrency === "USD" && fromCurrency === "CDF") return price / exchangeRate;
    if (saleCurrency === "CDF" && fromCurrency === "USD") return price * exchangeRate;
    return price;
  }, [saleCurrency, exchangeRate]);

  const cartTotals = cart.reduce((acc, item) => {
    const unitInSale = toSaleCurrency(item.unitPrice, item.currency);
    const costInSale = toSaleCurrency(item.costPrice, item.currency);
    const lineTotal = (unitInSale - item.discount) * item.quantity;
    const lineCost = costInSale * item.quantity;
    acc.total += lineTotal;
    acc.discount += item.discount * item.quantity;
    acc.cost += lineCost;
    acc.profit += lineTotal - lineCost;
    return acc;
  }, { total: 0, discount: 0, cost: 0, profit: 0 });

  const changeDue = Math.max(0, paymentAmount - cartTotals.total);
  const cartSym = saleCurrency === "USD" ? "$" : saleCurrency;
  const fmt = (n: number | null | undefined) => `${cartSym} ${(n ?? 0).toFixed(2)}`;

  // ── Barcode scanning (treat rapid keystrokes as scanner) ─────────────────
  const addProductToCart = useCallback(async (barcode: string) => {
    if (!barcode.trim()) return;
    try {
      // Call the barcode lookup directly via fetch since useLookupBarcode is a query
      const authHeaders = { "Authorization": `Bearer ${localStorage.getItem("gym_token") ?? ""}` };
      const res = await fetch(`/api/sales/lookup-barcode?barcode=${encodeURIComponent(barcode.trim())}`, { headers: authHeaders });
      if (!res.ok) {
        toast({ title: t("sales.toast.barcodeNotFound"), variant: "destructive" });
        await fetch(`/api/activity-logs`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify({ action: "barcode_not_found", entity: "product", details: { barcode } }) }).catch(() => null);
        return;
      }
      const product = await res.json() as {
        id: number; name: string; currency: string; sellingPrice: number;
        costPrice: number; quantity: number; status: string;
      };

      if (product.status !== "active") {
        toast({ title: `"${product.name}" is not available for sale`, variant: "destructive" });
        return;
      }

      setCart((prev) => {
        const existing = prev.find((c) => c.productId === product.id);
        if (existing) {
          if (existing.quantity >= product.quantity) {
            toast({ title: t("sales.toast.insufficientStock"), variant: "destructive" });
            return prev;
          }
          return prev.map((c) => c.productId === product.id ? { ...c, quantity: c.quantity + 1 } : c);
        }
        if (product.quantity < 1) {
          toast({ title: t("sales.toast.insufficientStock"), variant: "destructive" });
          return prev;
        }
        return [...prev, {
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

  const handleBarcodeChange = (val: string) => {
    setBarcodeInput(val);
    if (barcodeTimer) clearTimeout(barcodeTimer);
    const timer = setTimeout(() => {
      if (val.trim()) {
        addProductToCart(val.trim());
        setBarcodeInput("");
      }
    }, 150); // scanners send chars fast; 150ms debounce
    setBarcodeTimer(timer);
  };

  // ── Product search (text input → server lookup by barcode or name) ────────
  // We use the products list API by proxying through barcode lookup + simple text
  // The actual product search uses the /api/stock endpoint with search param
  const [searchResults, setSearchResults] = useState<Array<{
    id: number; name: string; currency: string; sellingPrice: number;
    costPrice: number; quantity: number; status: string;
  }>>([]);

  const searchProducts = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults([]); return; }
    const res = await fetch(`/api/stock?search=${encodeURIComponent(q)}&limit=10`, { headers: { "Authorization": `Bearer ${localStorage.getItem("gym_token") ?? ""}` } }).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json() as { items: Array<{ id: number; name: string; currency: string; sellingPrice: number; costPrice: number; quantity: number; status: string }> };
    setSearchResults(data.items.filter((p) => p.status === "active" && p.quantity > 0));
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => { if (searchOpen) searchProducts(productSearch); }, 300);
    return () => clearTimeout(timeout);
  }, [productSearch, searchOpen, searchProducts]);

  const addFromSearch = (product: typeof searchResults[0]) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.productId === product.id);
      if (existing) {
        if (existing.quantity >= product.quantity) {
          toast({ title: t("sales.toast.insufficientStock"), variant: "destructive" });
          return prev;
        }
        return prev.map((c) => c.productId === product.id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, {
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

  const updateQty = (productId: number, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((c) => c.productId !== productId));
    } else {
      setCart((prev) => prev.map((c) => c.productId === productId ? { ...c, quantity: qty } : c));
    }
  };

  const updateDiscount = (productId: number, discount: number) => {
    setCart((prev) => prev.map((c) => c.productId === productId ? { ...c, discount } : c));
  };

  const removeItem = (productId: number) => {
    setCart((prev) => prev.filter((c) => c.productId !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setPaymentAmount(0);
    setNotes("");
    toast({ title: t("sales.toast.cartCleared") });
  };

  // ── Complete sale ─────────────────────────────────────────────────────────
  const handleCompleteSale = async () => {
    if (cart.length === 0) return;
    if (paymentAmount < cartTotals.total) {
      toast({ title: "Payment amount is less than the total", variant: "destructive" });
      return;
    }

    setCompleting(true);
    try {
      const items = cart.map((item) => {
        const unitInSale = toSaleCurrency(item.unitPrice, item.currency);
        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: unitInSale,
          discount: item.discount,
        };
      });

      const result = await completeSaleMut.mutateAsync({
        data: {
          items,
          currency: saleCurrency,
          paymentAmount,
          notes: notes || undefined,
        },
      });

      toast({ title: t("sales.toast.completed") });
      queryClient.invalidateQueries();

      // Auto-print receipt
      const saleData = result as unknown as Record<string, unknown>;
      if (settings) {
        setTimeout(() => printReceipt(saleData, settings, t), 500);
      }

      setCart([]);
      setPaymentAmount(0);
      setNotes("");
      barcodeRef.current?.focus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to complete sale";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setCompleting(false);
    }
  };

  // ── Patch sale currency (admin only) ──────────────────────────────────────
  const handlePatchCurrency = async () => {
    if (!editSaleId) return;
    try {
      await patchSaleMut.mutateAsync({ id: editSaleId, data: { currency: editCurrency } });
      toast({ title: t("sales.toast.currencyUpdated") });
      queryClient.invalidateQueries();
      setEditSaleId(null);
    } catch {
      toast({ title: t("sales.toast.updateFailed"), variant: "destructive" });
    }
  };

  // ── Void sale ─────────────────────────────────────────────────────────────
  const handleVoid = async () => {
    if (!voidSaleId || !voidReason.trim()) return;
    try {
      await voidSaleMut.mutateAsync({ id: voidSaleId, data: { reason: voidReason } });
      toast({ title: t("sales.toast.voided") });
      queryClient.invalidateQueries();
      setVoidSaleId(null);
      setVoidReason("");
      setVoidingSale(null);
    } catch {
      toast({ title: "Failed to void sale", variant: "destructive" });
    }
  };

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-muted-foreground">
        <Ban className="h-12 w-12" />
        <p>{t("sales.restricted")}</p>
      </div>
    );
  }

  const historyItems = (historyData as unknown as { items: Record<string, unknown>[]; total: number; page: number; limit: number } | undefined);
  const totalHistoryPages = historyItems ? Math.max(1, Math.ceil(historyItems.total / 15)) : 1;

  return (
    <div className="flex flex-col h-full gap-4">
      <PageHeader
        icon={ShoppingCart}
        iconClass="bg-emerald-500/10 text-emerald-600"
        title={t("sales.title")}
      />

      <Tabs defaultValue="pos" className="flex-1 flex flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="pos" className="gap-2">
            <ShoppingCart className="h-4 w-4" />{t("sales.pos")}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" />{t("sales.history")}
          </TabsTrigger>
        </TabsList>

        {/* ── POS Tab ──────────────────────────────────────────────────── */}
        <TabsContent value="pos" className="flex-1 flex flex-col lg:flex-row gap-4 mt-4">

          {/* Left panel — barcode + product search */}
          <div className="flex flex-col gap-4 lg:w-80 flex-shrink-0">
            {/* Barcode scanner */}
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <Label className="font-semibold flex items-center gap-2">
                <Barcode className="h-4 w-4" />{t("sales.barcode")}
              </Label>
              <Input
                ref={barcodeRef}
                value={barcodeInput}
                onChange={(e) => handleBarcodeChange(e.target.value)}
                placeholder={t("sales.barcodePlaceholder")}
                className="font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && barcodeInput.trim()) {
                    if (barcodeTimer) clearTimeout(barcodeTimer);
                    addProductToCart(barcodeInput.trim());
                    setBarcodeInput("");
                  }
                }}
              />
            </div>

            {/* Product search */}
            <div className="rounded-lg border bg-card p-4 space-y-3 relative">
              <Label className="font-semibold flex items-center gap-2">
                <Search className="h-4 w-4" />{t("sales.searchProduct")}
              </Label>
              <Input
                value={productSearch}
                onChange={(e) => { setProductSearch(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                placeholder={t("sales.searchProduct")}
              />
              {searchOpen && searchResults.length > 0 && (
                <div className="absolute left-4 right-4 top-full z-50 mt-1 rounded-md border bg-popover shadow-md">
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex justify-between gap-2"
                      onClick={() => addFromSearch(p)}
                    >
                      <span>{p.name}</span>
                      <span className="text-muted-foreground">{p.currency} {p.sellingPrice.toFixed(2)} · {p.quantity} left</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Currency selector */}
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <Label className="font-semibold">{t("sales.currency")}</Label>
              <Select value={saleCurrency} onValueChange={(v) => setSaleCurrency(v as "USD" | "CDF")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="CDF">CDF</SelectItem>
                </SelectContent>
              </Select>
              {saleCurrency === "CDF" && (
                <p className="text-xs text-muted-foreground">Rate: 1 USD = {exchangeRate.toLocaleString()} CDF</p>
              )}
            </div>
          </div>

          {/* Right panel — cart + checkout */}
          <div className="flex flex-col gap-4 flex-1 min-w-0">
            {/* Cart table */}
            <div className="rounded-lg border bg-card flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between p-3 border-b">
                <h2 className="font-semibold flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4" />
                  {t("sales.cart")}
                  {cart.length > 0 && <Badge variant="secondary">{cart.length}</Badge>}
                </h2>
                {cart.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearCart} className="text-muted-foreground gap-1 text-xs">
                    <Trash2 className="h-3 w-3" />{t("sales.clearCart")}
                  </Button>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center flex-1 gap-2 py-12 text-muted-foreground">
                  <ShoppingCart className="h-12 w-12 opacity-30" />
                  <p className="font-medium">{t("sales.cartEmpty")}</p>
                  <p className="text-sm text-center max-w-xs">{t("sales.cartEmptyHint")}</p>
                </div>
              ) : (
                <div className="overflow-auto flex-1">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("sales.col.product")}</TableHead>
                        <TableHead>{t("sales.col.qty")}</TableHead>
                        <TableHead className="text-right">{t("sales.col.price")}</TableHead>
                        <TableHead className="text-right">{t("sales.col.discount")}</TableHead>
                        <TableHead className="text-right">{t("sales.col.total")}</TableHead>
                        {canViewCost && <TableHead className="text-right text-xs">{t("sales.col.cost")}</TableHead>}
                        {canViewProfit && <TableHead className="text-right text-xs">{t("sales.col.profit")}</TableHead>}
                        <TableHead></TableHead>
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

            {/* Checkout panel — sticky on mobile when cart has items */}
            {cart.length > 0 && (
              <div className="rounded-lg border bg-card p-4 space-y-4 md:static sticky bottom-0 z-10 shadow-lg md:shadow-none">
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  {cartTotals.discount > 0 && (
                    <>
                      <span className="text-muted-foreground">{t("sales.totalDiscount")}</span>
                      <span className="text-right text-destructive font-medium">-{fmt(cartTotals.discount)}</span>
                    </>
                  )}
                  {canViewCost && (
                    <>
                      <span className="text-muted-foreground">{t("sales.col.cost")}</span>
                      <span className="text-right">{fmt(cartTotals.cost)}</span>
                    </>
                  )}
                  {canViewProfit && (
                    <>
                      <span className="text-muted-foreground">{t("sales.col.profit")}</span>
                      <span className={`text-right font-medium ${cartTotals.profit >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(cartTotals.profit)}</span>
                    </>
                  )}
                  <span className="font-bold text-base">{t("sales.grandTotal")}</span>
                  <span className="text-right font-bold text-base">{fmt(cartTotals.total)}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label>{t("sales.paymentAmount")}</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={paymentAmount || ""}
                      onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                      className="text-right"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("sales.changeDue")}</Label>
                    <Input readOnly value={fmt(changeDue)} className="text-right font-semibold bg-muted" />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("sales.notes")}</Label>
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="..." />
                  </div>
                </div>

                <Button
                  className="w-full h-12 text-base font-bold"
                  onClick={handleCompleteSale}
                  disabled={completing || cart.length === 0 || paymentAmount < cartTotals.total}
                >
                  {completing ? t("common.loading") : `✓ ${t("sales.completeSale")} — ${fmt(cartTotals.total)}`}
                </Button>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── History Tab ───────────────────────────────────────────────── */}
        <TabsContent value="history" className="flex-1 flex flex-col gap-4 mt-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder={t("sales.history.number") + " / " + t("sales.history.by")}
                value={historySearch}
                onChange={(e) => { setHistorySearch(e.target.value); setHistoryPage(1); }}
              />
            </div>
            <Select value={historyStatus || "all"} onValueChange={(v) => { setHistoryStatus(v === "all" ? "" : v); setHistoryPage(1); }}>
              <SelectTrigger className="w-40 shrink-0"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="completed">{t("sales.status.completed")}</SelectItem>
                <SelectItem value="voided">{t("sales.status.voided")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Mobile sale cards */}
          <div className="md:hidden rounded-lg border overflow-hidden bg-card divide-y divide-border/50">
            {!historyItems || historyItems.items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                <ReceiptText className="h-10 w-10 opacity-30" />
                <p className="text-sm">{t("sales.empty")}</p>
              </div>
            ) : historyItems.items.map((sale) => {
              const cur = sale.currency as string;
              const curSym = cur === "USD" ? "$" : cur;
              const fmtS = (n: number) => `${curSym} ${(n as number).toFixed(2)}`;
              return (
                <div key={sale.id as number} className={`flex items-center gap-3 px-3 py-3 ${sale.status === "voided" ? "opacity-60" : ""}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground">#{sale.id as number} · {new Date(sale.saleDate as string).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                    <p className="font-bold text-sm tabular-nums">{fmtS(sale.totalAmount as number)}</p>
                    <p className="text-xs text-muted-foreground">Paid: {fmtS(sale.paymentAmount as number)}</p>
                  </div>
                  <Badge variant={sale.status === "voided" ? "destructive" : "default"} className="text-xs shrink-0">
                    {t(`sales.status.${sale.status as string}`)}
                  </Badge>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setViewSaleId(sale.id as number)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { if (settings) printReceipt(sale, settings, t); }}>
                      <Printer className="h-4 w-4" />
                    </Button>
                    {isAdmin && sale.status !== "voided" && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditSaleId(sale.id as number); setEditCurrency((sale.currency as "USD" | "CDF") ?? "USD"); setEditSale(sale); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {sale.status !== "voided" && canManage && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => { setVoidSaleId(sale.id as number); setVoidingSale(sale); }}>
                        <Ban className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border overflow-x-auto flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("sales.history.date")}</TableHead>
                  <TableHead className="text-right">{t("sales.history.total")}</TableHead>
                  <TableHead>{t("sales.history.currency")}</TableHead>
                  <TableHead className="text-right">{t("sales.history.payment")}</TableHead>
                  <TableHead className="text-right">{t("sales.history.change")}</TableHead>
                  <TableHead>{t("sales.history.status")}</TableHead>
                  <TableHead>{t("sales.history.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!historyItems || historyItems.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <ReceiptText className="h-10 w-10 opacity-30" />
                        <p>{t("sales.empty")}</p>
                        <p className="text-sm">{t("sales.emptyHint")}</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : historyItems.items.map((sale) => {
                  const cur = sale.currency as string;
                  const curSym = cur === "USD" ? "$" : cur;
                  const fmtS = (n: number) => `${curSym} ${(n as number).toFixed(2)}`;
                  return (
                    <TableRow key={sale.id as number} className={sale.status === "voided" ? "opacity-60" : ""}>
                      <TableCell className="text-sm">{new Date(sale.saleDate as string).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</TableCell>
                      <TableCell className="text-right font-semibold">{fmtS(sale.totalAmount as number)}</TableCell>
                      <TableCell><Badge variant="outline">{cur}</Badge></TableCell>
                      <TableCell className="text-right">{fmtS(sale.paymentAmount as number)}</TableCell>
                      <TableCell className="text-right">{fmtS(sale.changeDue as number)}</TableCell>
                      <TableCell>
                        <Badge variant={sale.status === "voided" ? "destructive" : "default"}>
                          {t(`sales.status.${sale.status as string}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            title={t("sales.viewSale")}
                            onClick={() => setViewSaleId(sale.id as number)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            title={t("sales.printReceipt")}
                            onClick={() => {
                              if (settings) printReceipt(sale, settings, t);
                              toast({ title: t("sales.toast.printed") });
                            }}
                          >
                            <Printer className="h-4 w-4" />
                          </Button>
                          {isAdmin && sale.status !== "voided" && (
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              title={t("sales.editCurrency")}
                              onClick={() => { setEditSaleId(sale.id as number); setEditCurrency((sale.currency as "USD" | "CDF") ?? "USD"); setEditSale(sale); }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {sale.status !== "voided" && canManage && (
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                              title={t("sales.void")}
                              onClick={() => { setVoidSaleId(sale.id as number); setVoidingSale(sale); }}
                            >
                              <Ban className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {historyItems && historyItems.total > 15 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{historyItems.total} total</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" disabled={historyPage <= 1} onClick={() => setHistoryPage((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span>{t("common.page")} {historyPage} {t("common.of")} {totalHistoryPages}</span>
                <Button variant="outline" size="icon" disabled={historyPage >= totalHistoryPages} onClick={() => setHistoryPage((p) => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Sale Detail Modal ──────────────────────────────────────────────── */}
      <SaleDetailDialog
        saleId={viewSaleId}
        open={!!viewSaleId}
        onClose={() => setViewSaleId(null)}
        settings={settings}
        canViewCost={canViewCost}
        canViewProfit={canViewProfit}
        t={t}
      />

      {/* ── Edit Sale Currency Dialog (admin only) ─────────────────────────── */}
      <Dialog open={!!editSaleId} onOpenChange={(o) => { if (!o) { setEditSaleId(null); setEditSale(null); } }}>
        <DialogContent className="w-[95vw] max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              {t("sales.editCurrency")}
            </DialogTitle>
          </DialogHeader>
          {editSale && (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm space-y-1 border">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("sales.history.number")}</span>
                <span className="font-medium">{(editSale.saleNumber as string) ?? `#${editSale.id}`}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("sales.history.date")}</span>
                <span>{new Date(editSale.saleDate as string).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("sales.history.total")}</span>
                <span className="font-semibold">{(editSale.currency as string) === "CDF" ? "FC" : "$"} {(editSale.totalAmount as number)?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("sales.history.status")}</span>
                <Badge variant={(editSale.status as string) === "voided" ? "destructive" : "default"} className="text-xs">
                  {t(`sales.status.${editSale.status as string}`)}
                </Badge>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t("sales.currency")}</Label>
            <Select value={editCurrency} onValueChange={(v) => setEditCurrency(v as "USD" | "CDF")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD ($)</SelectItem>
                <SelectItem value="CDF">CDF (FC)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditSaleId(null); setEditSale(null); }}>{t("common.cancel")}</Button>
            <Button onClick={handlePatchCurrency} disabled={patchSaleMut.isPending}>
              {patchSaleMut.isPending ? t("common.loading") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Void Confirm Dialog ────────────────────────────────────────────── */}
      <AlertDialog open={!!voidSaleId} onOpenChange={(o) => { if (!o) { setVoidSaleId(null); setVoidReason(""); setVoidingSale(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-destructive" />{t("sales.void")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("sales.voidConfirm")}
              {voidingSale && (
                <span className="block mt-1 font-semibold">{voidingSale.saleNumber as string}</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 py-2">
            <Label className="text-sm font-medium">{t("sales.voidReason")} *</Label>
            <Textarea
              className="mt-1"
              rows={2}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
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
