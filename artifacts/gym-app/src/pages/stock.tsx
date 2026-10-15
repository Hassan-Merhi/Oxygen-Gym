import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateProduct,
  useGetStockSummary,
  useListProducts,
  useUpdateProduct,
} from "@workspace/api-client-react";
import type { CreateProductBody, ProductRecord, UpdateProductBody } from "@workspace/api-client-react";
import { AlertCircle, AlertTriangle, DollarSign, Layers, Package, Plus, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n-format";
import { useGetMe } from "@/hooks/use-me";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Pager } from "@/components/ui/pager";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProductList } from "@/components/stock/product-list";
import { ProductModal } from "@/components/stock/product-modal";
import { PurchaseModal } from "@/components/stock/purchase-modal";
import { HistoryModal } from "@/components/stock/history-modal";
import { fmtCount, fmtMoney, type ProductStatus, type ProductStatusChange } from "@/components/stock/stock-utils";

export default function Stock() {
  const { t } = useI18n();
  const me = useGetMe();
  const { toast } = useToast();
  const qc = useQueryClient();

  const canView = Boolean(me?.role === "admin" || me?.permissions?.stock);
  const canManage = Boolean(me?.role === "admin" || me?.permissions?.manageInventory);
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
  const [pendingStatus, setPendingStatus] = useState<{ product: ProductRecord; status: ProductStatusChange } | null>(null);

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

  async function applyStatus(product: ProductRecord, nextStatus: ProductStatusChange) {
    try {
      await updateMutation.mutateAsync({ id: product.id, data: { status: nextStatus } });
      toast({ title: t("stock.toast.updated") });
      invalidate();
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    }
  }

  function requestStatus(product: ProductRecord, nextStatus: ProductStatusChange) {
    // Restoring is harmless; archiving and deleting ask for confirmation first.
    if (nextStatus === "active") void applyStatus(product, nextStatus);
    else setPendingStatus({ product, status: nextStatus });
  }

  if (!canView) {
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-center">
        <AlertCircle className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="text-muted-foreground">{t("stock.restricted")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        icon={Package}
        iconClass="bg-indigo-500/10 text-indigo-700 dark:text-indigo-400"
        title={t("stock.title")}
        subtitle={fmt(t("stock.subtitleCount"), { count: fmtCount(summary?.totalProducts ?? total) })}
        actions={canManage ? (
          <Button onClick={openAdd} className="gap-2 rounded-lg px-4 shadow-sm">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("stock.addProduct")}
          </Button>
        ) : undefined}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={Package} label={t("stock.card.total")} value={fmtCount(summary?.totalProducts ?? 0)} />
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
          actionLabel={t("stock.card.lowStockShow")}
        />
        <MetricCard icon={Layers} label={t("stock.card.qty")} value={fmtCount(summary?.totalQuantity ?? 0)} />
        {canViewCost ? (
          <MetricCard icon={DollarSign} label={t("stock.card.value")} value={fmtMoney(summary?.totalValueUsd ?? 0)} />
        ) : (
          <div className="flex min-h-[98px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/10 px-4 text-center text-xs text-muted-foreground">
            {t("stock.valueRestricted")}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border/70 bg-card p-3 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1">
            <label htmlFor="stock-search" className="sr-only">{t("stock.search")}</label>
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="stock-search"
              type="search"
              className="h-10 border-0 bg-muted/40 ps-9 shadow-none"
              placeholder={t("stock.search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 md:flex">
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value as ProductStatus);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-10 w-full bg-background md:w-40" aria-label={t("stock.field.status")}>
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
                "flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-md border px-3 text-sm transition-colors max-md:min-h-11 pointer-coarse:min-h-11",
                lowStock
                  ? "border-amber-400/70 bg-amber-500/10 text-amber-800 dark:text-amber-300"
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
              <span className="truncate">{t("stock.filter.lowStock")}</span>
            </label>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <ProductList
          products={products}
          isLoading={productsQ.isLoading}
          canManage={canManage}
          canViewCost={canViewCost}
          t={t}
          onEdit={openEdit}
          onPurchase={openPurchase}
          onHistory={openHistory}
          onStatus={requestStatus}
        />
      </div>

      {totalPages > 1 && (
        <Pager
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          summary={`${fmtCount(total)} ${t("members.total")}`}
        />
      )}

      <ProductModal
        open={showProductModal}
        onClose={() => setShowProductModal(false)}
        editing={editingProduct}
        canViewCost={canViewCost}
        t={t}
        onCreate={async (data) => {
          await createMutation.mutateAsync({ data: data as unknown as CreateProductBody });
          toast({ title: t("stock.toast.created") });
          invalidate();
          setShowProductModal(false);
        }}
        onUpdate={async (id, data) => {
          await updateMutation.mutateAsync({ id, data: data as UpdateProductBody });
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

      <AlertDialog open={!!pendingStatus} onOpenChange={(o) => { if (!o) setPendingStatus(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingStatus?.status === "deleted" ? t("stock.actions.delete") : t("stock.actions.archive")}
              {pendingStatus ? ` — ${pendingStatus.product.name}` : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingStatus?.status === "deleted" ? t("stock.confirm.delete") : t("stock.confirm.archive")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={pendingStatus?.status === "deleted" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
              onClick={() => {
                if (pendingStatus) void applyStatus(pendingStatus.product, pendingStatus.status);
                setPendingStatus(null);
              }}
            >
              {pendingStatus?.status === "deleted" ? t("stock.actions.delete") : t("stock.actions.archive")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  attention = false,
  onClick,
  actionLabel,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  attention?: boolean;
  onClick?: () => void;
  actionLabel?: string;
}) {
  const className = cn(
    "min-h-[98px] min-w-0 rounded-2xl border border-border/70 bg-card px-4 py-4 shadow-sm transition-colors",
    onClick && "cursor-pointer hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    attention && "border-amber-400/40",
  );

  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground",
          attention && "bg-amber-500/10 text-amber-700 dark:text-amber-400",
        )}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
      </div>
      <p className={cn(
        "mt-2 truncate text-2xl font-bold tracking-tight tabular-nums",
        attention && "text-amber-700 dark:text-amber-400",
      )}>
        {value}
      </p>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={cn(className, "text-start")} onClick={onClick} title={actionLabel}>
        {content}
        {actionLabel && <span className="sr-only">{actionLabel}</span>}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
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
