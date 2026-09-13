import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { useGetMe } from "@/hooks/use-me";
import { useToast } from "@/hooks/use-toast";
import {
  useGetStockSummary,
  useListProducts,
  useCreateProduct,
  useUpdateProduct,
  useListProductPurchases,
  useGetProductHistory,
} from "@workspace/api-client-react";
import type { ProductRecord, StockPurchaseRecord } from "@workspace/api-client-react";
import { PageHeader } from "@/components/ui/page-header";
import { ProductStatusBadge } from "@/lib/status-badge";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Package,
  PackageCheck,
  AlertTriangle,
  Layers,
  DollarSign,
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  ShoppingCart,
  History,
  Archive,
  RotateCcw,
  Trash2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  SlidersHorizontal,
  Barcode,
  Boxes,
  BadgeDollarSign,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useFmtDate } from "@/lib/useFmtDate";

type ProductStatus = "active" | "archived" | "deleted" | "all";

function fmtMoney(n: number, cur: string = "USD"): string {
  if (cur === "CDF") return `${Math.round(n).toLocaleString()} FC`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  const [showFilters, setShowFilters] = useState(false);
  const limit = 20;

  const [showProductModal, setShowProductModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null);
  const [activeProduct, setActiveProduct] = useState<ProductRecord | null>(null);

  const summaryQ = useGetStockSummary({ query: { enabled: canView, queryKey: ["getStockSummary"] } });
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
  const totalPages = Math.ceil(total / limit);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["/api/stock"] });
    qc.invalidateQueries({ queryKey: ["/api/stock/summary"] });
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

  async function changeStatus(product: ProductRecord, newStatus: "archived" | "active" | "deleted") {
    const confirmMsg = newStatus === "deleted" ? t("stock.confirm.delete") : t("stock.confirm.archive");
    if (!window.confirm(confirmMsg)) return;
    await updateMutation.mutateAsync({ id: product.id, data: { status: newStatus } });
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
    <div className="space-y-6">
      <PageHeader
        icon={Package}
        iconClass="bg-indigo-500/10 text-indigo-500"
        title={t("stock.title")}
        subtitle={`${total} ${t("stock.card.total").toLowerCase()}`}
        actions={canManage ? (
          <Button onClick={openAdd} className="gap-2">
            <Plus className="h-4 w-4" />
            {t("stock.addProduct")}
          </Button>
        ) : undefined}
      />

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        <SummaryCard icon={<Package className="h-4 w-4" />} label={t("stock.card.total")} value={summary?.totalProducts ?? 0} color="indigo" />
        <SummaryCard icon={<PackageCheck className="h-4 w-4" />} label={t("stock.card.active")} value={summary?.activeProducts ?? 0} color="emerald" />
        <SummaryCard icon={<AlertTriangle className="h-4 w-4" />} label={t("stock.card.lowStock")} value={summary?.lowStockCount ?? 0} color="amber" danger={Boolean(summary?.lowStockCount && summary.lowStockCount > 0)} />
        <SummaryCard icon={<Layers className="h-4 w-4" />} label={t("stock.card.qty")} value={summary?.totalQuantity ?? 0} color="blue" />
        {canViewCost ? (
          <SummaryCard icon={<DollarSign className="h-4 w-4" />} label={t("stock.card.value")} value={`$${(summary?.totalValueUsd ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} color="purple" />
        ) : (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-3 text-center text-xs text-muted-foreground">
            {t("acc.restricted")}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 bg-background pl-9"
              placeholder={t("stock.search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <button
            type="button"
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors md:hidden ${
              showFilters
                ? "border-primary bg-primary/5 text-primary"
                : "border-input bg-background text-muted-foreground"
            }`}
            onClick={() => setShowFilters((value) => !value)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t("common.filters") || "Filters"}
            {(status !== "active" || lowStock) && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
          </button>
        </div>

        <div className={`flex flex-wrap gap-2 ${showFilters ? "flex" : "hidden md:flex"}`}>
          <Select value={status} onValueChange={(value) => { setStatus(value as ProductStatus); setPage(1); }}>
            <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("stock.filter.status")}</SelectItem>
              <SelectItem value="active">{t("stock.status.active")}</SelectItem>
              <SelectItem value="archived">{t("stock.status.archived")}</SelectItem>
              <SelectItem value="deleted">{t("stock.status.deleted")}</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex h-9 cursor-pointer select-none items-center gap-2 rounded-md border border-input bg-background px-3 text-sm transition-colors hover:bg-muted/40">
            <Checkbox checked={lowStock} onCheckedChange={(value) => { setLowStock(Boolean(value)); setPage(1); }} />
            {t("stock.filter.lowStock")}
          </label>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm divide-y divide-border/50 md:hidden">
        {productsQ.isLoading ? (
          <div className="divide-y divide-border/50">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 px-3 py-3">
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                </div>
                <div className="h-5 w-14 shrink-0 animate-pulse rounded-full bg-muted" />
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="p-10 text-center">
            <Package className="mx-auto mb-2 h-9 w-9 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("stock.empty")}</p>
          </div>
        ) : products.map((product) => (
          <div key={product.id} className={`flex items-center gap-3 px-3 py-3 ${product.isLowStock && product.status === "active" ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold">{product.name}</span>
                {product.isLowStock && product.status === "active" && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/60 bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                    <AlertTriangle className="h-3 w-3" /> Low
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="text-sm font-bold tabular-nums text-foreground">{product.quantity}</span>
                <span>·</span>
                <span>{fmtMoney(product.sellingPrice, product.currency)}</span>
              </div>
            </div>
            <StatusBadge status={product.status} t={t} />
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
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-border bg-card shadow-sm md:block">
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("stock.col.name")}</th>
                <th className="px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("stock.col.quantity")}</th>
                <th className="px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("stock.col.sellingPrice")}</th>
                {canViewCost && <th className="hidden px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground lg:table-cell">{t("stock.col.costPrice")}</th>}
                {canViewCost && <th className="hidden px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground xl:table-cell">{t("stock.col.stockValue")}</th>}
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("stock.col.status")}</th>
                <th className="px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("stock.col.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {productsQ.isLoading ? (
                <tr>
                  <td colSpan={canViewCost ? 7 : 5} className="py-14 text-center text-muted-foreground">Loading...</td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={canViewCost ? 7 : 5} className="py-20 text-center">
                    <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                    <p className="font-medium text-muted-foreground">{t("stock.empty")}</p>
                    <p className="mt-1 text-xs text-muted-foreground/50">{t("stock.emptyHint")}</p>
                    {canManage && (
                      <Button onClick={openAdd} className="mt-4 gap-2" size="sm">
                        <Plus className="h-4 w-4" /> {t("stock.addProduct")}
                      </Button>
                    )}
                  </td>
                </tr>
              ) : products.map((product) => (
                <tr key={product.id} className={`group transition-colors hover:bg-muted/30 ${product.isLowStock && product.status === "active" ? "bg-amber-50/30 dark:bg-amber-950/10" : ""}`}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{product.name}</span>
                      {product.isLowStock && product.status === "active" && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/60 bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
                          <AlertTriangle className="h-3 w-3" /> Low
                        </span>
                      )}
                    </div>
                    {product.productNumber && <p className="mt-0.5 text-xs text-muted-foreground/60">{product.productNumber}</p>}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <span className={`text-base font-bold tabular-nums ${product.isLowStock && product.status === "active" ? "text-amber-600" : "text-foreground"}`}>
                      {product.quantity}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <span className="font-semibold tabular-nums">{fmtMoney(product.sellingPrice, product.currency)}</span>
                  </td>
                  {canViewCost && (
                    <td className="hidden px-5 py-3.5 text-right lg:table-cell">
                      <span className="tabular-nums text-muted-foreground">{fmtMoney(product.costPrice, product.currency)}</span>
                    </td>
                  )}
                  {canViewCost && (
                    <td className="hidden px-5 py-3.5 text-right xl:table-cell">
                      <span className="tabular-nums text-muted-foreground">${product.stockValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </td>
                  )}
                  <td className="px-5 py-3.5">
                    <StatusBadge status={product.status} t={t} />
                  </td>
                  <td className="px-5 py-3.5 text-right">
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
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{total} {t("members.total")}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((value) => value - 1)} disabled={page === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">{t("common.page")} {page} {t("common.of")} {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage((value) => value + 1)} disabled={page === totalPages}>
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
          await createMutation.mutateAsync({ data: data as unknown as import("@workspace/api-client-react").CreateProductBody });
          toast({ title: t("stock.toast.created") });
          invalidate();
          setShowProductModal(false);
        }}
        onUpdate={async (id, data) => {
          await updateMutation.mutateAsync({ id, data: data as import("@workspace/api-client-react").UpdateProductBody });
          toast({ title: t("stock.toast.updated") });
          invalidate();
          setShowProductModal(false);
        }}
      />

      {activeProduct && (
        <PurchaseModal
          open={showPurchaseModal}
          onClose={() => { setShowPurchaseModal(false); setActiveProduct(null); }}
          product={activeProduct}
          canViewCost={canViewCost}
          t={t}
          onAdd={async (data) => {
            await useAddStockPurchaseMut(activeProduct.id, data, qc);
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
          onClose={() => { setShowHistoryModal(false); setActiveProduct(null); }}
          product={activeProduct}
          canViewCost={canViewCost}
          t={t}
        />
      )}
    </div>
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
  t: (k: string) => string;
  onEdit: (product: ProductRecord) => void;
  onPurchase: (product: ProductRecord) => void;
  onHistory: (product: ProductRecord) => void;
  onStatus: (product: ProductRecord, status: "archived" | "active" | "deleted") => Promise<void>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canManage && (
          <DropdownMenuItem onClick={() => onEdit(product)}>
            <Pencil className="mr-2 h-4 w-4" /> {t("stock.actions.edit")}
          </DropdownMenuItem>
        )}
        {canManage && (
          <DropdownMenuItem onClick={() => onPurchase(product)}>
            <ShoppingCart className="mr-2 h-4 w-4" /> {t("stock.actions.purchase")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onHistory(product)}>
          <History className="mr-2 h-4 w-4" /> {t("stock.actions.history")}
        </DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuSeparator />
            {product.status === "active" && (
              <DropdownMenuItem onClick={() => void onStatus(product, "archived")} className="text-amber-700">
                <Archive className="mr-2 h-4 w-4" /> {t("stock.actions.archive")}
              </DropdownMenuItem>
            )}
            {product.status === "archived" && (
              <DropdownMenuItem onClick={() => void onStatus(product, "active")}>
                <RotateCcw className="mr-2 h-4 w-4" /> {t("stock.actions.restore")}
              </DropdownMenuItem>
            )}
            {product.status !== "deleted" && (
              <DropdownMenuItem onClick={() => void onStatus(product, "deleted")} className="text-rose-700">
                <Trash2 className="mr-2 h-4 w-4" /> {t("stock.actions.delete")}
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
  t: (k: string) => string;
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

    const quantity = Number.parseInt(form.quantity, 10);
    const alertQuantity = Number.parseInt(form.alertQuantity, 10);
    const costPrice = Number.parseFloat(form.costPrice);
    const sellingPrice = Number.parseFloat(form.sellingPrice);

    setSaving(true);
    setError("");
    try {
      const data = {
        name: form.name.trim(),
        barcode: form.barcode.trim() || null,
        quantity: Number.isFinite(quantity) ? Math.max(0, quantity) : 0,
        alertQuantity: Number.isFinite(alertQuantity) ? Math.max(0, alertQuantity) : 5,
        costPrice: Number.isFinite(costPrice) ? Math.max(0, costPrice) : 0,
        sellingPrice: Number.isFinite(sellingPrice) ? Math.max(0, sellingPrice) : 0,
        currency: form.currency,
        status: form.status,
        category: editing?.category ?? null,
        supplier: editing?.supplier ?? null,
        description: editing?.description ?? null,
        notes: editing?.notes ?? null,
      };

      if (editing) await onUpdate(editing.id, data);
      else await onCreate(data);
    } catch (caught: unknown) {
      const apiError = caught as {
        data?: { error?: string };
        response?: { data?: { error?: string } };
        message?: string;
      };
      const message = apiError?.data?.error ?? apiError?.response?.data?.error ?? apiError?.message ?? "An error occurred";
      if (message.toLowerCase().includes("barcode")) setError(t("stock.barcodeExists"));
      else setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-lg overflow-hidden p-0">
        <DialogHeader className="border-b border-border bg-muted/15 px-6 py-5 text-left">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
              {editing ? <Pencil className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-xl">{editing ? t("stock.editProduct") : t("stock.addProduct")}</DialogTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {editing
                  ? "Update the product, pricing and stock details."
                  : "Add the essential product and inventory details."}
              </p>
              {editing?.productNumber && (
                <p className="mt-1 text-xs font-medium text-muted-foreground/70">{editing.productNumber}</p>
              )}
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

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Package className="h-3.5 w-3.5" /> Product
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-name">{t("stock.field.name")} *</Label>
              <Input
                id="product-name"
                autoFocus
                value={form.name}
                onChange={(event) => set("name", event.target.value)}
                placeholder="Product name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-barcode" className="flex items-center gap-1.5">
                <Barcode className="h-3.5 w-3.5 text-muted-foreground" />
                {t("stock.field.barcode")}
              </Label>
              <Input
                id="product-barcode"
                value={form.barcode}
                onChange={(event) => set("barcode", event.target.value)}
                placeholder="Scan or enter barcode"
              />
            </div>
          </section>

          <div className="h-px bg-border" />

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <BadgeDollarSign className="h-3.5 w-3.5" /> Pricing
            </div>
            <div className={`grid grid-cols-1 gap-3 ${canViewCost ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
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
                <Label htmlFor="product-selling-price">{t("stock.field.sellingPrice")}</Label>
                <Input
                  id="product-selling-price"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={form.sellingPrice}
                  onChange={(event) => set("sellingPrice", event.target.value)}
                />
              </div>
              {canViewCost && (
                <div className="space-y-1.5">
                  <Label htmlFor="product-cost-price">{t("stock.field.costPrice")}</Label>
                  <Input
                    id="product-cost-price"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={form.costPrice}
                    onChange={(event) => set("costPrice", event.target.value)}
                  />
                </div>
              )}
            </div>
          </section>

          <div className="h-px bg-border" />

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Boxes className="h-3.5 w-3.5" /> Inventory
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="product-quantity">{t("stock.field.quantity")}</Label>
                <Input
                  id="product-quantity"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={form.quantity}
                  onChange={(event) => set("quantity", event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="product-alert-quantity">{t("stock.field.alertQty")}</Label>
                <Input
                  id="product-alert-quantity"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={form.alertQuantity}
                  onChange={(event) => set("alertQuantity", event.target.value)}
                />
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
          </section>
        </div>

        <DialogFooter className="border-t border-border bg-muted/15 px-6 py-4 sm:justify-between">
          <p className="hidden text-xs text-muted-foreground sm:block">
            Fields not shown here are no longer part of the product editor.
          </p>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button variant="outline" onClick={onClose} disabled={saving} className="flex-1 sm:flex-none">
              {t("common.cancel")}
            </Button>
            <Button onClick={save} disabled={saving} className="flex-1 sm:min-w-24 sm:flex-none">
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>
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
  t: (k: string) => string;
  onAdd: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState({
    quantityAdded: "1",
    costPerUnit: canViewCost ? String(product.costPrice) : "0",
    totalCost: "0",
    currency: product.currency,
    exchangeRate: "1",
    supplier: product.supplier ?? "",
    notes: "",
    paidFromCash: false,
    purchaseDate: new Date().toISOString().split("T")[0],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const quantity = Number.parseFloat(form.quantityAdded) || 1;
      const costPerUnit = Number.parseFloat(form.costPerUnit) || 0;
      setForm((current) => ({ ...current, totalCost: String((quantity * costPerUnit).toFixed(2)) }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function set(key: string, value: string | boolean) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "quantityAdded" || key === "costPerUnit") {
        const quantity = Number.parseFloat(key === "quantityAdded" ? String(value) : next.quantityAdded) || 0;
        const costPerUnit = Number.parseFloat(key === "costPerUnit" ? String(value) : next.costPerUnit) || 0;
        next.totalCost = String((quantity * costPerUnit).toFixed(2));
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      await onAdd({
        quantityAdded: Number.parseInt(form.quantityAdded, 10) || 1,
        costPerUnit: Number.parseFloat(form.costPerUnit) || 0,
        totalCost: Number.parseFloat(form.totalCost) || 0,
        currency: form.currency,
        exchangeRate: Number.parseFloat(form.exchangeRate) || 1,
        supplier: form.supplier || null,
        notes: form.notes || null,
        paidFromCash: form.paidFromCash,
        purchaseDate: form.purchaseDate || null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("stock.addPurchase")}: {product.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>{t("stock.purchase.qty")} *</Label>
              <Input type="number" min="1" value={form.quantityAdded} onChange={(event) => set("quantityAdded", event.target.value)} className="mt-1" />
            </div>
            {canViewCost && (
              <div>
                <Label>{t("stock.purchase.costPerUnit")}</Label>
                <Input type="number" min="0" step="0.01" value={form.costPerUnit} onChange={(event) => set("costPerUnit", event.target.value)} className="mt-1" />
              </div>
            )}
            {canViewCost && (
              <div>
                <Label>{t("stock.purchase.totalCost")}</Label>
                <Input type="number" min="0" step="0.01" value={form.totalCost} onChange={(event) => set("totalCost", event.target.value)} className="mt-1" />
              </div>
            )}
            <div>
              <Label>{t("stock.purchase.currency")}</Label>
              <Select value={form.currency} onValueChange={(value) => set("currency", value)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="CDF">CDF</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("stock.purchase.exchangeRate")}</Label>
              <Input type="number" min="1" step="0.01" value={form.exchangeRate} onChange={(event) => set("exchangeRate", event.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>{t("stock.purchase.supplier")}</Label>
              <Input value={form.supplier} onChange={(event) => set("supplier", event.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>{t("stock.purchase.date")}</Label>
              <Input type="date" value={form.purchaseDate} onChange={(event) => set("purchaseDate", event.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label>{t("stock.purchase.notes")}</Label>
            <Textarea value={form.notes} onChange={(event) => set("notes", event.target.value)} className="mt-1" rows={2} />
          </div>
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
            <Checkbox checked={form.paidFromCash} onCheckedChange={(value) => set("paidFromCash", Boolean(value))} />
            {t("stock.purchase.paidFromCash")}
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={saving}>{saving ? t("common.saving") : t("common.save")}</Button>
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
  t: (k: string) => string;
}) {
  const { fmtDate, fmtDateTime } = useFmtDate();
  const historyQ = useGetProductHistory(product.id, { query: { enabled: open, queryKey: ["getProductHistory", product.id] } });
  const purchasesQ = useListProductPurchases(product.id, { query: { enabled: open, queryKey: ["listProductPurchases", product.id] } });

  const history = historyQ.data ?? [];
  const purchases = (purchasesQ.data ?? []) as StockPurchaseRecord[];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[80vh] w-[95vw] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("stock.history.title")}: {product.name}</DialogTitle>
        </DialogHeader>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{t("stock.purchaseList")}</h3>
          {purchases.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">{t("stock.noPurchases")}</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Ref#</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Qty</th>
                    {canViewCost && <th className="px-3 py-2 text-left font-medium text-muted-foreground">Total Cost</th>}
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Supplier</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">By</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((purchase) => (
                    <tr key={purchase.id} className="border-b border-border/50">
                      <td className="px-3 py-2">{fmtDate(purchase.purchaseDate)}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{purchase.purchaseNumber ?? "—"}</td>
                      <td className="px-3 py-2 font-bold">+{purchase.quantityAdded}</td>
                      {canViewCost && <td className="px-3 py-2">{purchase.totalCost.toLocaleString()} {purchase.currency}</td>}
                      <td className="px-3 py-2 text-muted-foreground">{purchase.supplier ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{purchase.createdBy ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{t("stock.history.title")}</h3>
          {history.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">{t("stock.noHistory")}</p>
          ) : (
            <div className="space-y-2">
              {history.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 rounded-lg border border-border/50 bg-muted/20 p-3 text-xs">
                  <div className="flex-1">
                    <span className="font-medium capitalize text-foreground">{entry.action.replace(/_/g, " ")}</span>
                    {entry.userName && <span className="ml-2 text-muted-foreground">by {entry.userName}</span>}
                  </div>
                  <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(entry.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({ icon, label, value, color, danger }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: "indigo" | "emerald" | "amber" | "blue" | "purple";
  danger?: boolean;
}) {
  const palette = {
    indigo: { bar: "bg-indigo-500", icon: "bg-indigo-500/10 text-indigo-500", val: "text-indigo-600 dark:text-indigo-400" },
    emerald: { bar: "bg-emerald-500", icon: "bg-emerald-500/10 text-emerald-500", val: "text-emerald-600 dark:text-emerald-400" },
    amber: { bar: danger ? "bg-amber-500" : "bg-amber-400", icon: danger ? "bg-amber-500/15 text-amber-600" : "bg-amber-400/10 text-amber-500", val: danger ? "text-amber-600 dark:text-amber-400" : "text-amber-500 dark:text-amber-400" },
    blue: { bar: "bg-blue-500", icon: "bg-blue-500/10 text-blue-500", val: "text-blue-600 dark:text-blue-400" },
    purple: { bar: "bg-violet-500", icon: "bg-violet-500/10 text-violet-500", val: "text-violet-600 dark:text-violet-400" },
  }[color];

  return (
    <div className={`relative flex items-center gap-3 overflow-hidden rounded-xl border bg-card px-3 py-2.5 shadow-sm ${danger ? "border-amber-300 bg-amber-50/40 dark:border-amber-700 dark:bg-amber-900/10" : ""}`}>
      <div className={`absolute bottom-0 left-0 top-0 w-1 ${palette.bar}`} />
      <div className={`shrink-0 rounded-lg p-1.5 ${palette.icon}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className={`text-lg font-bold leading-tight tabular-nums ${palette.val}`}>{value}</p>
        <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  return <ProductStatusBadge status={status} label={t(`stock.status.${status}`)} />;
}

async function useAddStockPurchaseMut(
  productId: number,
  data: Record<string, unknown>,
  qc: ReturnType<typeof useQueryClient>,
): Promise<void> {
  const { addStockPurchase } = await import("@workspace/api-client-react");
  await addStockPurchase(productId, data as unknown as Parameters<typeof addStockPurchase>[1]);
  qc.invalidateQueries({ queryKey: ["listProductPurchases"] });
  qc.invalidateQueries({ queryKey: ["getProductHistory"] });
}
