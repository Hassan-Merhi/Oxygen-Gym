import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { fmt as format } from "@/lib/i18n-format";
import { useFmtDate } from "@/lib/useFmtDate";
import { useGetMe } from "@/hooks/use-me";
import { canApproveCorrections } from "@/lib/permissions";
import {
  useGetSettings,
  useCompleteSale,
  useVoidSale,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Ban, History, ShoppingCart, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CartList } from "@/components/sales/cart-list";
import { CheckoutBar } from "@/components/sales/checkout-bar";
import { ProductFinder, type ProductSearchResult } from "@/components/sales/product-finder";
import { SaleDetailDialog } from "@/components/sales/sale-detail-dialog";
import { SaleEditDialog } from "@/components/sales/sale-edit-dialog";
import { SaleHistory } from "@/components/sales/sale-history";
import { convertToSaleCurrency, fmtMoney, printReceipt, type CartItem } from "@/components/sales/sales-utils";

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
  // Voiding a posted sale is a correction: it also needs approveCorrections.
  const canVoid = canManage && canApproveCorrections(me);

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
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);

  const [viewSaleId, setViewSaleId] = useState<number | null>(null);
  const [voidSaleId, setVoidSaleId] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidingSale, setVoidingSale] = useState<Record<string, unknown> | null>(null);
  const [editSaleId, setEditSaleId] = useState<number | null>(null);
  const [printingSaleId, setPrintingSaleId] = useState<number | null>(null);

  const exchangeRate = Number(settings?.usdToCdfRate) > 0 ? Number(settings?.usdToCdfRate) : 2800;

  const completeSaleMut = useCompleteSale();
  const voidSaleMut = useVoidSale();

  const toSaleCurrency = useCallback(
    (price: number, fromCurrency: string) => convertToSaleCurrency(price, fromCurrency, saleCurrency, exchangeRate),
    [saleCurrency, exchangeRate],
  );

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
        toast({ title: product.quantity < 1 ? t("sales.toast.insufficientStock") : format(t("sales.toast.notAvailable"), { name: product.name }), variant: "destructive" });
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
      toast({ title: t("sales.toast.paymentShort"), variant: "destructive" });
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
      const message = error instanceof Error && error.message ? error.message : t("sales.toast.completeFailed");
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
      toast({ title: t("sales.toast.voidFailed"), variant: "destructive" });
    }
  };

  const handlePrintSale = async (saleId: number) => {
    if (!settings || printingSaleId) return;
    setPrintingSaleId(saleId);
    try {
      const response = await fetch(`/api/sales/${saleId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("gym_token") ?? ""}` },
      });
      if (!response.ok) throw new Error("receipt");
      const sale = await response.json() as Record<string, unknown>;
      printReceipt(sale, settings, t);
    } catch {
      toast({ title: t("sales.toast.printFailed"), variant: "destructive" });
    } finally {
      setPrintingSaleId(null);
    }
  };

  const handleBarcodeEnter = () => {
    if (!barcodeInput.trim()) return;
    if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current);
    void addProductToCart(barcodeInput);
    setBarcodeInput("");
  };

  const closeVoidDialog = () => {
    setVoidSaleId(null);
    setVoidReason("");
    setVoidingSale(null);
  };

  const cartCount = useMemo(() => cart.length, [cart]);

  if (!canAccess) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Ban className="h-12 w-12" aria-hidden="true" />
        <p>{t("sales.restricted")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-5">
      <PageHeader
        icon={ShoppingCart}
        iconClass="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
        title={t("sales.title")}
        subtitle={t("sales.subtitle")}
      />

      <Tabs defaultValue="pos" className="flex flex-1 flex-col">
        <TabsList className="w-full rounded-xl border border-border/60 bg-card p-1 shadow-sm sm:w-fit">
          <TabsTrigger value="pos" className="flex-1 gap-2 rounded-lg px-4 data-[state=active]:shadow-sm sm:flex-none">
            <ShoppingCart className="h-4 w-4" aria-hidden="true" />{t("sales.pos")}
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-1 gap-2 rounded-lg px-4 data-[state=active]:shadow-sm sm:flex-none">
            <History className="h-4 w-4" aria-hidden="true" />{t("sales.history")}
          </TabsTrigger>
        </TabsList>

        {/* Products and cart sit side by side from lg (1024px); stacked below. */}
        <TabsContent value="pos" className="mt-4 grid flex-1 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(17rem,20rem)_minmax(0,1fr)]">
          <div className="lg:sticky lg:top-20">
            <ProductFinder
              t={t}
              barcodeRef={barcodeRef}
              barcodeInput={barcodeInput}
              onBarcodeChange={handleBarcodeChange}
              onBarcodeEnter={handleBarcodeEnter}
              productSearch={productSearch}
              onProductSearchChange={(value) => { setProductSearch(value); setSearchOpen(true); }}
              searchOpen={searchOpen}
              onSearchFocus={() => setSearchOpen(true)}
              searchResults={searchResults}
              onPick={addFromSearch}
              saleCurrency={saleCurrency}
              onSaleCurrencyChange={setSaleCurrency}
              exchangeRate={exchangeRate}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <section className="flex min-h-[18rem] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm lg:min-h-[26rem]" aria-labelledby="sales-cart-title">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-5 sm:py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ShoppingCart className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 id="sales-cart-title" className="font-semibold">{t("sales.cart")}</h2>
                      {cartCount > 0 && <Badge variant="secondary">{cartCount}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{t("sales.cartHint")}</p>
                  </div>
                </div>

                {cartCount > 0 && (
                  <div className="flex items-center gap-3">
                    <div className="hidden text-end sm:block">
                      <p className="text-xs text-muted-foreground">{t("sales.currentTotal")}</p>
                      <p className="font-bold tabular-nums">{fmt(cartTotals.total)}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={clearCart} className="gap-1.5 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t("sales.clearCart")}
                    </Button>
                  </div>
                )}
              </div>

              {cartCount === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-muted/50">
                    <ShoppingCart className="h-9 w-9 text-muted-foreground/50" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{t("sales.cartEmpty")}</p>
                    <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("sales.cartEmptyHint")}</p>
                  </div>
                </div>
              ) : (
                <CartList
                  items={cart}
                  canViewCost={canViewCost}
                  canViewProfit={canViewProfit}
                  saleCurrency={saleCurrency}
                  exchangeRate={exchangeRate}
                  onQtyChange={updateQty}
                  onDiscountChange={updateDiscount}
                  onRemove={removeItem}
                  t={t}
                />
              )}
            </section>

            {cartCount > 0 && (
              <CheckoutBar
                t={t}
                fmt={(n) => fmt(n)}
                total={cartTotals.total}
                discount={cartTotals.discount}
                cost={cartTotals.cost}
                profit={cartTotals.profit}
                canViewCost={canViewCost}
                canViewProfit={canViewProfit}
                paymentAmount={paymentAmount}
                onPaymentAmountChange={setPaymentAmount}
                changeDue={changeDue}
                notes={notes}
                onNotesChange={setNotes}
                completing={completing}
                onComplete={handleCompleteSale}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-4 flex flex-1 flex-col gap-4">
          <SaleHistory
            t={t}
            locale={locale}
            canEdit={isAdmin}
            canVoid={canVoid}
            printingSaleId={printingSaleId}
            onView={setViewSaleId}
            onPrint={(id) => void handlePrintSale(id)}
            onEdit={setEditSaleId}
            onVoid={(sale) => { setVoidSaleId(sale.id as number); setVoidingSale(sale); }}
          />
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

      <AlertDialog open={!!voidSaleId} onOpenChange={(nextOpen) => { if (!nextOpen) closeVoidDialog(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-destructive" aria-hidden="true" />{t("sales.void")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("sales.voidConfirm")}
              {voidingSale && <span className="mt-1 block font-semibold">{(voidingSale.saleNumber as string) || `#${voidingSale.id as number}`}</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="sale-void-reason" className="text-sm font-medium">{t("sales.voidReason")} *</Label>
            <Textarea
              id="sale-void-reason"
              rows={2}
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              placeholder={t("sales.voidReason")}
              required
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleVoid}
              disabled={!voidReason.trim() || voidSaleMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {voidSaleMut.isPending ? t("common.loading") : t("sales.void")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
