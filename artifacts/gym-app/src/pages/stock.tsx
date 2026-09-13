import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useGetMe } from "@/hooks/use-me";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateProduct,
  useGetProductHistory,
  useGetStockSummary,
  useListProductPurchases,
  useListProducts,
  useUpdateProduct,
} from "@workspace/api-client-react";
import type { ProductRecord, StockPurchaseRecord } from "@workspace/api-client-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  History,
  Layers,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useFmtDate } from "@/lib/useFmtDate";
import { cn } from "@/lib/utils";

type ProductStatus = "active" | "archived" | "deleted" | "all";

const compactNumber = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function fmtMoney(value: number, currency: string = "USD"): string {
  const amount = Number.isFinite(value) ? value : 0;
  const formatted = compactNumber.format(amount);
  return currency === "CDF" ? `${formatted} FC` : `$${formatted}`;
}

function fmtCount(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value || 0);
}

export default function Stock() {
  const { t } = useI18n();
  const me = useGetMe();
  const { toast } = useToast();
  const qc = useQueryClient();

  const canView = me?.role === "admin" || me?.permissions?.stock;
  const canManage = me?.role === "admin" || me?.permissions?.manageInventory;
  const canViewCost = Boolean(me?.role === "admin" || me?.permissions?.viewCost);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<ProductStatus>("active");
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 20;

  const [showProductModal, setShowProductModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null);
  const [activeProduct, setActiveProduct] = useState<ProductRecord | null>(null);

  const summaryQ = useGetStockSummary({
    query: { enabled: canView, queryKey: ["getStockSummary"] },
  });
  const productsQ = useListProducts({
    page,
    limit,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(status !== "all" && { status }),
    ...(lowStock && { lowStock: "true" }),
  });

  const summary = summaryQ.data;
  const products = productsQ.data?.items ?? [];
  const total = productsQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ["getStockSummary"] });
    void qc.invalidateQueries({ queryKey: ["/api/stock"] });
    void qc.invalidateQueries({ queryKey: ["/api/stock/summary"] });
  }

  function openAdd() {
    setEditingProduct(null);
    setShowProductModal(true);
  }

  function openEdit(product: ProductRecord) {
    setEditingProduct(product);
    setShowProductModal(true);
  }

  function openPurchase(product: ProductRecord) {
    setActiveProduct(product);
    setShowPurchaseModal(true);
  }

  function openHistory(product: ProductRecord) {
    setActiveProduct(product);
    setShowHistoryModal(true);
  }

  async function changeStatus(product: ProductRecord, nextStatus: "archived" | "active" | "deleted") {
    const confirmMessage = nextStatus === "deleted" ? t("stock.confirm.delete") : t("stock.confirm.archive");
    if (nextStatus !== "active" && !window.confirm(confirmMessage)) return;

    await updateMutation.mutateAsync({ id: product.id, data: { status: nextStatus } });
    toast({ title: t("stock.toast.updated") });
    invalidate();
  }

  if (!canView) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
        <AlertCircle className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">{t("stock.restricted")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        icon={Package}
        iconClass="bg-indigo-500/10 text-indigo-500"
        title={t("stock.title")}
        subtitle={`${fmtCount(summary?.totalProducts ?? total)} ${t("stock.card.total").toLowerCase()}`}
        actions={canManage ? (
          <Button onClick={openAdd} className="gap-2 rounded-lg px-4 shadow-sm">
            <Plus className="h-4 w-4" />
            {t("stock.addProduct")}
          </Button>
        ) : undefined}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          icon={Package}
          label={t("stock.card.total")}
          value={fmtCount(summary?.totalProducts ?? 0)}
        />
        <MetricCard
          icon={AlertTriangle}
          label={t("stock.card.lowStock")}
          value={fmtCount(summary?.lowStockCount ?? 0)}
          attention={Boolean(summary?.lowStockCount)}
          onClick={() => {
            setStatus("active");
            setLowStock(true);
            setPage(1);
          }}
        />
        <MetricCard
          icon={Layers}
          label={t("stock.card.qty")}
          value={fmtCount(summary?.totalQuantity ?? 0)}
        />
        {canViewCost ? (
          <MetricCard
            icon={DollarSign}
            label={t("stock.card.value")}
            value={fmtMoney(summary?.totalValueUsd ?? 0)}
          />
        ) : (
          <div className="flex min-h-[98px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/10 px-4 text-center text-xs text-muted-foreground">
            {t("acc.restricted")}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border/70 bg-card p-3 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-10 border-0 bg-muted/40 pl-9 shadow-none focus-visible:ring-1"
              placeholder={t("stock.search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value as ProductStatus);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-10 w-[132px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t("stock.status.active")}</SelectItem>
                <SelectItem value="all">{t("stock.filter.status")}</SelectItem>
                <SelectItem value="archived">{t("stock.status.archived")}</SelectItem>
                <SelectItem value="deleted">{t("stock.status.deleted")}</SelectItem>
              </SelectContent>
            </Select>

            <label
              className={cn(
                "flex h-10 cursor-pointer select-none items-center gap-2 rounded-md border px-3 text-sm transition-colors",
                lowStock
                  ? "border-amber-400/70 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border-input bg-background text-muted-foreground hover:bg-muted/40",
              )}
            >
              <Checkbox
                checked={lowStock}
                onCheckedChange={(checked) => {
                  setLowStock(Boolean(checked));
                  setPage(1);
                }}
              />
              <span className="whitespace-nowrap">{t("stock.filter.lowStock")}</span>
            </label>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/70 bg-muted/20">
                <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {t("stock.col.name")}
                </th>
                <th className="px-5 py-3.5 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {t("stock.col.quantity")}
                </th>
                <th className="px-5 py-3.5 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {t("stock.col.sellingPrice")}
                </th>
                {canViewCost && (
                  <th className="px-5 py-3.5 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {t("stock.col.costPrice")}
                  </th>
                )}
                {canViewCost && (
                  <th className="px-5 py-3.5 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {t("stock.col.stockValue")}
                  </th>
                )}
                <th className="w-[72px] px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {t("stock.col.actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {productsQ.isLoading ? (
                <TableLoading colSpan={canViewCost ? 6 : 4} />
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={canViewCost ? 6 : 4} className="px-6 py-16 text-center">
                    <Package className="mx-auto mb-3 h-9 w-9 text-muted-foreground/30" />
                    <p className="font-medium text-muted-foreground">{t("stock.empty")}</p>
                    <p className="mt-1 text-xs text-muted-foreground/60">{t("stock.emptyHint")}</p>
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr key={product.id} className="group transition-colors hover:bg-muted/20">
                    <td className="px-5 py-4">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-semibold text-foreground">{product.name}</span>
                        {product.isLowStock && product.status === "active" && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3" />
                            Low
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className={cn(
                        "text-base font-semibold tabular-nums",
                        product.isLowStock && product.status === "active" && "text-amber-600 dark:text-amber-400",
                      )}>
                        {fmtCount(product.quantity)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right font-medium tabular-nums">
                      {fmtMoney(product.sellingPrice, product.currency)}
                    </td>
                    {canViewCost && (
                      <td className="px-5 py-4 text-right tabular-nums text-muted-foreground">
                        {fmtMoney(product.costPrice, product.currency)}
                      </td>
                    )}
                    {canViewCost && (
                      <td className="px-5 py-4 text-right font-medium tabular-nums text-muted-foreground">
                        {fmtMoney(product.stockValueUsd, "USD")}
                      </td>
                    )}
                    <td className="px-4 py-4 text-right">
                      <ProductActions
                        product={product}
                        canManage={canManage}
                        t={t}
                        onEdit={openEdit}
                        onPurchase={openPurchase}
                        onHistory={openHistory}
                        onStatus={changeStatus}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-border/50 md:hidden">
          {productsQ.isLoading ? (
            Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="space-y-3 p-4">
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
              </div>
            ))
          ) : products.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <Package className="mx-auto mb-3 h-9 w-9 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">{t("stock.empty")}</p>
            </div>
          ) : (
            products.map((product) => (
              <div key={product.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold">{product.name}</p>
                      {product.isLowStock && product.status === "active" && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                          <AlertTriangle className="h-3 w-3" /> Low
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Qty <strong className="text-foreground">{fmtCount(product.quantity)}</strong></span>
                      <span>Sell <strong className="text-foreground">{fmtMoney(product.sellingPrice, product.currency)}</strong></span>
                      {canViewCost && <span>Cost <strong className="text-foreground">{fmtMoney(product.costPrice, product.currency)}</strong></span>}
                    </div>
                  </div>
                  <ProductActions
                    product={product}
                    canManage={canManage}
                    t={t}
                    onEdit={openEdit}
                    onPurchase={openPurchase}
                    onHistory={openHistory}
                    onStatus={changeStatus}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 px-1">
          <span className="text-sm text-muted-foreground">
            {fmtCount(total)} {t("members.total")}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[92px] text-center text-xs text-muted-foreground">
              {t("common.page")} {page} {t("common.of")} {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <ProductModal
        open={showProductModal}
        onClose={() => setShowProductModal(false)}
        editing={editingProduct}
        canViewCost={canViewCost}
        t={t}
        onCreate={async (data) => {
          await createMutation.mutateAsync({
            data: data as unknown as import("@workspace/api-client-react").CreateProductBody,
          });
          toast({ title: t("stock.toast.created") });
          invalidate();
          setShowProductModal(false);
        }}
        onUpdate={async (id, data) => {
          await updateMutation.mutateAsync({
            id,
            data: data as import("@workspace/api-client-react").UpdateProductBody,
          });
          toast({ title: t("stock.toast.updated") });
          invalidate();
          setShowProductModal(false);
        }}
      />

      {activeProduct && (
        <PurchaseModal
          open={showPurchaseModal}
          onClose={() => {
            setShowPurchaseModal(false);
            setActiveProduct(null);
          }}
          product={activeProduct}
          canViewCost={canViewCost}
          t={t}
          onAdd={async (data) => {
            await addStockPurchaseMut(activeProduct.id, data, qc);
            toast({ title: t("stock.toast.purchaseAdded") });
            invalidate();
            setShowPurchaseModal(false);
            setActiveProduct(null);
          }}
        />
      )}

      {activeProduct && (
        <HistoryModal
          open={showHistoryModal}
          onClose={() => {
            setShowHistoryModal(false);
            setActiveProduct(null);
          }}
          product={activeProduct}
          canViewCost={canViewCost}
          t={t}
        />
      )}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  attention = false,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  attention?: boolean;
  onClick?: () => void;
}) {
  const className = cn(
    "min-h-[98px] rounded-2xl border border-border/70 bg-card px-4 py-4 shadow-sm transition-colors",
    onClick && "cursor-pointer hover:bg-muted/20",
    attention && "border-amber-400/40",
  );

  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground",
          attention && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        )}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className={cn(
        "mt-2 text-2xl font-bold tracking-tight tabular-nums",
        attention && "text-amber-600 dark:text-amber-400",
      )}>
        {value}
      </p>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={cn(className, "text-left")} onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

function TableLoading({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-14 text-center text-sm text-muted-foreground">
        Loading products…
      </td>
    </tr>
  );
}

function ProductActions({
  product,
  canManage,
  t,
  onEdit,
  onPurchase,
  onHistory,
  onStatus,
}: {
  product: ProductRecord;
  canManage: boolean;
  t: (key: string) => string;
  onEdit: (product: ProductRecord) => void;
  onPurchase: (product: ProductRecord) => void;
  onHistory: (product: ProductRecord) => void;
  onStatus: (product: ProductRecord, status: "archived" | "active" | "deleted") => Promise<void>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${product.name}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {canManage && (
          <DropdownMenuItem onClick={() => onEdit(product)}>
            <Pencil className="mr-2 h-4 w-4" />
            {t("stock.actions.edit")}
          </DropdownMenuItem>
        )}
        {canManage && (
          <DropdownMenuItem onClick={() => onPurchase(product)}>
            <ShoppingCart className="mr-2 h-4 w-4" />
            {t("stock.actions.purchase")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onHistory(product)}>
          <History className="mr-2 h-4 w-4" />
          {t("stock.actions.history")}
        </DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuSeparator />
            {product.status === "active" && (
              <DropdownMenuItem className="text-amber-700" onClick={() => void onStatus(product, "archived")}>
                <Archive className="mr-2 h-4 w-4" />
                {t("stock.actions.archive")}
              </DropdownMenuItem>
            )}
            {product.status === "archived" && (
              <DropdownMenuItem onClick={() => void onStatus(product, "active")}>
                <RotateCcw className="mr-2 h-4 w-4" />
                {t("stock.actions.restore")}
              </DropdownMenuItem>
            )}
            {product.status !== "deleted" && (
              <DropdownMenuItem className="text-rose-700" onClick={() => void onStatus(product, "deleted")}>
                <Trash2 className="mr-2 h-4 w-4" />
                {t("stock.actions.delete")}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProductModal({
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
  const [form, setForm] = useState({
    name: "",
    barcode: "",
    quantity: "0",
    alertQuantity: "5",
    costPrice: "0",
    sellingPrice: "0",
    currency: "USD",
    status: "active",
  });
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
      setForm({
        name: "",
        barcode: "",
        quantity: "0",
        alertQuantity: "5",
        costPrice: "0",
        sellingPrice: "0",
        currency: "USD",
        status: "active",
      });
    }
    setError("");
  }, [open, editing]);

  function set(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!form.name.trim()) {
      setError(`${t("stock.field.name")} is required`);
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
      const err = caught as {
        data?: { error?: string };
        response?: { data?: { error?: string } };
        message?: string;
      };
      const message = err.data?.error ?? err.response?.data?.error ?? err.message ?? "An error occurred";
      setError(message.toLowerCase().includes("barcode") ? t("stock.barcodeExists") : message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-lg overflow-hidden p-0">
        <DialogHeader className="border-b border-border bg-muted/20 px-6 py-5 text-left">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
              {editing ? <Pencil className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            </div>
            <div>
              <DialogTitle className="text-xl">{editing ? t("stock.editProduct") : t("stock.addProduct")}</DialogTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {editing ? "Update the product, pricing and inventory details." : "Add a product and its inventory details."}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("stock.field.name")} *</Label>
              <Input autoFocus value={form.name} onChange={(event) => set("name", event.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("stock.field.barcode")}</Label>
              <Input value={form.barcode} onChange={(event) => set("barcode", event.target.value)} placeholder="Scan or enter barcode" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("stock.field.currency")}</Label>
              <Select value={form.currency} onValueChange={(value) => set("currency", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="CDF">CDF / FC</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("stock.field.sellingPrice")}</Label>
              <Input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(event) => set("sellingPrice", event.target.value)} />
            </div>
            {canViewCost && (
              <div className="space-y-1.5">
                <Label>{t("stock.field.costPrice")}</Label>
                <Input type="number" min="0" step="0.01" value={form.costPrice} onChange={(event) => set("costPrice", event.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t("stock.field.quantity")}</Label>
              <Input type="number" min="0" step="1" value={form.quantity} onChange={(event) => set("quantity", event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("stock.field.alertQty")}</Label>
              <Input type="number" min="0" step="1" value={form.alertQuantity} onChange={(event) => set("alertQuantity", event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("stock.field.status")}</Label>
              <Select value={form.status} onValueChange={(value) => set("status", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("stock.status.active")}</SelectItem>
                  <SelectItem value="archived">{t("stock.status.archived")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border bg-muted/10 px-6 py-4">
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PurchaseModal({
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
  const [form, setForm] = useState({
    quantityAdded: "1",
    costPerUnit: String(product.costPrice),
    totalCost: String(product.costPrice),
    currency: product.currency,
    exchangeRate: "1",
    supplier: product.supplier ?? "",
    notes: "",
    paidFromCash: false,
    purchaseDate: new Date().toISOString().slice(0, 10),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm({
      quantityAdded: "1",
      costPerUnit: String(product.costPrice),
      totalCost: String(product.costPrice),
      currency: product.currency,
      exchangeRate: "1",
      supplier: product.supplier ?? "",
      notes: "",
      paidFromCash: false,
      purchaseDate: new Date().toISOString().slice(0, 10),
    });
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

  async function save() {
    const quantity = Number.parseInt(form.quantityAdded, 10);
    const unitCost = Number.parseFloat(form.costPerUnit);
    const totalCost = Number.parseFloat(form.totalCost);
    const exchangeRate = Number.parseFloat(form.exchangeRate);

    if (!Number.isInteger(quantity) || quantity < 1) {
      setError("Quantity must be at least 1.");
      return;
    }
    if (!Number.isFinite(unitCost) || unitCost < 0 || !Number.isFinite(totalCost) || totalCost < 0) {
      setError("Cost must be zero or greater.");
      return;
    }
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      setError("Enter a valid exchange rate.");
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
        exchangeRate,
        supplier: form.supplier.trim() || null,
        notes: form.notes.trim() || null,
        paidFromCash: form.paidFromCash,
        purchaseDate: form.purchaseDate || null,
      });
    } catch (caught: unknown) {
      const err = caught as { data?: { error?: string }; response?: { data?: { error?: string } }; message?: string };
      setError(err.data?.error ?? err.response?.data?.error ?? err.message ?? "Unable to add stock purchase.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-md">
        <DialogHeader>
          <DialogTitle>{t("stock.addPurchase")}: {product.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("stock.purchase.qty")} *</Label>
              <Input type="number" min="1" step="1" value={form.quantityAdded} onChange={(event) => set("quantityAdded", event.target.value)} />
            </div>
            {canViewCost && (
              <div className="space-y-1.5">
                <Label>{t("stock.purchase.costPerUnit")}</Label>
                <Input type="number" min="0" step="0.01" value={form.costPerUnit} onChange={(event) => set("costPerUnit", event.target.value)} />
              </div>
            )}
            {canViewCost && (
              <div className="space-y-1.5">
                <Label>{t("stock.purchase.totalCost")}</Label>
                <Input type="number" min="0" step="0.01" value={form.totalCost} onChange={(event) => set("totalCost", event.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t("stock.purchase.currency")}</Label>
              <Select value={form.currency} onValueChange={(value) => set("currency", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="CDF">CDF / FC</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("stock.purchase.exchangeRate")}</Label>
              <Input type="number" min="0.000001" step="0.01" value={form.exchangeRate} onChange={(event) => set("exchangeRate", event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("stock.purchase.supplier")}</Label>
              <Input value={form.supplier} onChange={(event) => set("supplier", event.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("stock.purchase.date")}</Label>
              <Input type="date" value={form.purchaseDate} onChange={(event) => set("purchaseDate", event.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("stock.purchase.notes")}</Label>
            <Textarea value={form.notes} onChange={(event) => set("notes", event.target.value)} rows={2} />
          </div>

          <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
            <Checkbox checked={form.paidFromCash} onCheckedChange={(checked) => set("paidFromCash", Boolean(checked))} />
            {t("stock.purchase.paidFromCash")}
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryModal({
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

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-h-[82vh] w-[95vw] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("stock.history.title")}: {product.name}</DialogTitle>
        </DialogHeader>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{t("stock.purchaseList")}</h3>
          {purchases.length === 0 ? (
            <p className="py-5 text-center text-xs text-muted-foreground">{t("stock.noPurchases")}</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Date</th>
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Qty</th>
                      {canViewCost && <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Total Cost</th>}
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Supplier</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {purchases.map((purchase) => (
                      <tr key={purchase.id}>
                        <td className="px-3 py-2.5">{fmtDate(purchase.purchaseDate)}</td>
                        <td className="px-3 py-2.5 font-semibold">+{fmtCount(purchase.quantityAdded)}</td>
                        {canViewCost && (
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {fmtMoney(purchase.totalCost, purchase.currency)}
                          </td>
                        )}
                        <td className="px-3 py-2.5 text-muted-foreground">{purchase.supplier ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{t("stock.history.title")}</h3>
          {history.length === 0 ? (
            <p className="py-5 text-center text-xs text-muted-foreground">{t("stock.noHistory")}</p>
          ) : (
            <div className="space-y-2">
              {history.map((entry) => (
                <div key={entry.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/15 p-3 text-xs">
                  <div className="min-w-0">
                    <span className="font-medium capitalize text-foreground">{entry.action.replace(/_/g, " ")}</span>
                    {entry.userName && <span className="ml-2 text-muted-foreground">by {entry.userName}</span>}
                  </div>
                  <span className="shrink-0 text-muted-foreground">{fmtDateTime(entry.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

async function addStockPurchaseMut(
  productId: number,
  data: Record<string, unknown>,
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  const { addStockPurchase } = await import("@workspace/api-client-react");
  await addStockPurchase(productId, data as unknown as Parameters<typeof addStockPurchase>[1]);
  void queryClient.invalidateQueries({ queryKey: ["listProductPurchases"] });
  void queryClient.invalidateQueries({ queryKey: ["getProductHistory"] });
}
