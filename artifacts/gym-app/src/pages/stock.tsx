import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { useGetMe } from "@/hooks/use-me";
import { useToast } from "@/hooks/use-toast";
import {
  useGetStockSummary,
  useListProducts,
  useCreateProduct,
  useUpdateProduct,
  useAddStockPurchase,
  useListProductPurchases,
  useGetProductHistory,
} from "@workspace/api-client-react";
import type { ProductRecord, StockPurchaseRecord } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

type ProductStatus = "active" | "archived" | "deleted" | "all";

// ── Currency formatter ────────────────────────────────────────────────────────
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
  const canViewProfit = Boolean(me?.role === "admin" || me?.permissions?.viewProfit);

  // ── Filters ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<ProductStatus>("active");
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 20;

  // ── Modals ─────────────────────────────────────────────────────────────────
  const [showProductModal, setShowProductModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null);
  const [activeProduct, setActiveProduct] = useState<ProductRecord | null>(null);

  // ── Data ───────────────────────────────────────────────────────────────────
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

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["/api/stock"] });
    qc.invalidateQueries({ queryKey: ["/api/stock/summary"] });
  }

  function openAdd() { setEditingProduct(null); setShowProductModal(true); }
  function openEdit(p: ProductRecord) { setEditingProduct(p); setShowProductModal(true); }

  function openPurchase(p: ProductRecord) { setActiveProduct(p); setShowPurchaseModal(true); }
  function openHistory(p: ProductRecord) { setActiveProduct(p); setShowHistoryModal(true); }

  async function changeStatus(p: ProductRecord, newStatus: "archived" | "active" | "deleted") {
    const confirmMsg = newStatus === "deleted" ? t("stock.confirm.delete") : t("stock.confirm.archive");
    if (!window.confirm(confirmMsg)) return;
    await updateMutation.mutateAsync({ id: p.id, data: { status: newStatus } });
    toast({ title: t("stock.toast.updated") });
    invalidate();
  }

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3">
        <AlertCircle className="w-10 h-10 text-muted-foreground" />
        <p className="text-muted-foreground">{t("stock.restricted")}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("stock.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total} {t("stock.card.total").toLowerCase()}</p>
        </div>
        {canManage && (
          <Button onClick={openAdd} className="gap-2 shadow-sm">
            <Plus className="w-4 h-4" />{t("stock.addProduct")}
          </Button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard icon={<Package className="w-5 h-5 text-indigo-500" />} label={t("stock.card.total")} value={summary?.totalProducts ?? 0} color="indigo" />
        <SummaryCard icon={<PackageCheck className="w-5 h-5 text-emerald-500" />} label={t("stock.card.active")} value={summary?.activeProducts ?? 0} color="emerald" />
        <SummaryCard icon={<AlertTriangle className="w-5 h-5 text-amber-500" />} label={t("stock.card.lowStock")} value={summary?.lowStockCount ?? 0} color="amber" danger={Boolean(summary?.lowStockCount && summary.lowStockCount > 0)} />
        <SummaryCard icon={<Layers className="w-5 h-5 text-blue-500" />} label={t("stock.card.qty")} value={summary?.totalQuantity ?? 0} color="blue" />
        {canViewCost ? (
          <SummaryCard icon={<DollarSign className="w-5 h-5 text-violet-500" />} label={t("stock.card.value")} value={`$${(summary?.totalValueUsd ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} color="purple" />
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 flex items-center justify-center text-xs text-muted-foreground text-center">{t("acc.restricted")}</div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input className="pl-9 h-9 bg-background" placeholder={t("stock.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v as ProductStatus); setPage(1); }}>
          <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("stock.filter.status")}</SelectItem>
            <SelectItem value="active">{t("stock.status.active")}</SelectItem>
            <SelectItem value="archived">{t("stock.status.archived")}</SelectItem>
            <SelectItem value="deleted">{t("stock.status.deleted")}</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm h-9 px-3 rounded-md border border-input bg-background hover:bg-muted/40 transition-colors">
          <Checkbox checked={lowStock} onCheckedChange={(v) => { setLowStock(Boolean(v)); setPage(1); }} />
          {t("stock.filter.lowStock")}
        </label>
      </div>

      {/* Product table */}
      <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">{t("stock.col.name")}</th>
                <th className="text-right px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">{t("stock.col.sellingPrice")}</th>
                {canViewCost && <th className="text-right px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground hidden lg:table-cell">{t("stock.col.costPrice")}</th>}
                <th className="text-right px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">{t("stock.col.quantity")}</th>
                {canViewCost && <th className="text-right px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground hidden xl:table-cell">{t("stock.col.stockValue")}</th>}
                <th className="text-left px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">{t("stock.col.status")}</th>
                <th className="px-5 py-3.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground text-right">{t("stock.col.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {productsQ.isLoading ? (
                <tr><td colSpan={12} className="text-center py-14 text-muted-foreground">Loading...</td></tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center py-20">
                    <Package className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                    <p className="text-muted-foreground font-medium">{t("stock.empty")}</p>
                    <p className="text-muted-foreground/50 text-xs mt-1">{t("stock.emptyHint")}</p>
                    {canManage && (
                      <Button onClick={openAdd} className="mt-4 gap-2" size="sm">
                        <Plus className="w-4 h-4" />{t("stock.addProduct")}
                      </Button>
                    )}
                  </td>
                </tr>
              ) : products.map((p) => (
                <tr key={p.id} className={`hover:bg-muted/30 transition-colors group ${p.isLowStock && p.status === "active" ? "bg-amber-50/30 dark:bg-amber-950/10" : ""}`}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      {p.isLowStock && p.status === "active" && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full border border-amber-200/60">
                          <AlertTriangle className="w-3 h-3" />Low
                        </span>
                      )}
                    </div>
                    {p.productNumber && <p className="text-xs text-muted-foreground/60 mt-0.5">{p.productNumber}</p>}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <span className="font-semibold tabular-nums">{fmtMoney(p.sellingPrice, p.currency)}</span>
                  </td>
                  {canViewCost && (
                    <td className="px-5 py-3.5 text-right hidden lg:table-cell">
                      <span className="text-muted-foreground tabular-nums">{fmtMoney(p.costPrice, p.currency)}</span>
                    </td>
                  )}
                  <td className="px-5 py-3.5 text-right">
                    <span className={`font-bold tabular-nums text-base ${p.isLowStock && p.status === "active" ? "text-amber-600" : "text-foreground"}`}>
                      {p.quantity}
                    </span>
                  </td>
                  {canViewCost && (
                    <td className="px-5 py-3.5 text-right hidden xl:table-cell">
                      <span className="tabular-nums text-muted-foreground">${p.stockValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </td>
                  )}
                  <td className="px-5 py-3.5">
                    <StatusBadge status={p.status} t={t} />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canManage && (
                          <DropdownMenuItem onClick={() => openEdit(p)}>
                            <Pencil className="w-4 h-4 mr-2" />{t("stock.actions.edit")}
                          </DropdownMenuItem>
                        )}
                        {canManage && (
                          <DropdownMenuItem onClick={() => openPurchase(p)}>
                            <ShoppingCart className="w-4 h-4 mr-2" />{t("stock.actions.purchase")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => openHistory(p)}>
                          <History className="w-4 h-4 mr-2" />{t("stock.actions.history")}
                        </DropdownMenuItem>
                        {canManage && (
                          <>
                            <DropdownMenuSeparator />
                            {p.status === "active" && (
                              <DropdownMenuItem onClick={() => changeStatus(p, "archived")} className="text-amber-700">
                                <Archive className="w-4 h-4 mr-2" />{t("stock.actions.archive")}
                              </DropdownMenuItem>
                            )}
                            {p.status === "archived" && (
                              <DropdownMenuItem onClick={() => changeStatus(p, "active")}>
                                <RotateCcw className="w-4 h-4 mr-2" />{t("stock.actions.restore")}
                              </DropdownMenuItem>
                            )}
                            {p.status !== "deleted" && (
                              <DropdownMenuItem onClick={() => changeStatus(p, "deleted")} className="text-rose-700">
                                <Trash2 className="w-4 h-4 mr-2" />{t("stock.actions.delete")}
                              </DropdownMenuItem>
                            )}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{total} {t("members.total")}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 1}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-sm">{t("common.page")} {page} {t("common.of")} {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page === totalPages}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      {/* Add/Edit Product Modal */}
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

      {/* Stock Purchase Modal */}
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

      {/* History Modal */}
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

// ── Product Modal ──────────────────────────────────────────────────────────────

function ProductModal({
  open, onClose, editing, canViewCost, t, onCreate, onUpdate,
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
    name: "", barcode: "", description: "", category: "", supplier: "",
    notes: "", quantity: "0", alertQuantity: "5",
    costPrice: "0", sellingPrice: "0", currency: "USD", status: "active",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      if (editing) {
        setForm({
          name: editing.name,
          barcode: editing.barcode ?? "",
          description: editing.description ?? "",
          category: editing.category ?? "",
          supplier: editing.supplier ?? "",
          notes: editing.notes ?? "",
          quantity: String(editing.quantity),
          alertQuantity: String(editing.alertQuantity),
          costPrice: String(editing.costPrice),
          sellingPrice: String(editing.sellingPrice),
          currency: editing.currency,
          status: editing.status,
        });
      } else {
        setForm({ name: "", barcode: "", description: "", category: "", supplier: "", notes: "", quantity: "0", alertQuantity: "5", costPrice: "0", sellingPrice: "0", currency: "USD", status: "active" });
      }
      setError("");
    }
  }, [open, editing]);

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.name.trim()) { setError(t("stock.field.name") + " is required"); return; }
    setSaving(true);
    setError("");
    try {
      const data = {
        name: form.name.trim(),
        barcode: form.barcode.trim() || null,
        description: form.description.trim() || null,
        category: form.category.trim() || null,
        supplier: form.supplier.trim() || null,
        notes: form.notes.trim() || null,
        quantity: parseInt(form.quantity) || 0,
        alertQuantity: parseInt(form.alertQuantity) || 5,
        costPrice: parseFloat(form.costPrice) || 0,
        sellingPrice: parseFloat(form.sellingPrice) || 0,
        currency: form.currency,
        status: form.status,
      };
      if (editing) await onUpdate(editing.id, data);
      else await onCreate(data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      const msg = err?.response?.data?.error ?? "An error occurred";
      if (msg.toLowerCase().includes("barcode")) setError(t("stock.barcodeExists"));
      else setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t("stock.editProduct") : t("stock.addProduct")}</DialogTitle>
        </DialogHeader>

        {error && <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>{t("stock.field.name")} *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>{t("stock.field.barcode")}</Label>
            <Input value={form.barcode} onChange={(e) => set("barcode", e.target.value)} className="mt-1" placeholder="e.g. 123456789" />
          </div>
          <div>
            <Label>{t("stock.field.category")}</Label>
            <Input value={form.category} onChange={(e) => set("category", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>{t("stock.field.supplier")}</Label>
            <Input value={form.supplier} onChange={(e) => set("supplier", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>{t("stock.field.currency")}</Label>
            <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="CDF">CDF</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("stock.field.sellingPrice")}</Label>
            <Input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(e) => set("sellingPrice", e.target.value)} className="mt-1" />
          </div>
          {canViewCost && (
            <div>
              <Label>{t("stock.field.costPrice")}</Label>
              <Input type="number" min="0" step="0.01" value={form.costPrice} onChange={(e) => set("costPrice", e.target.value)} className="mt-1" />
            </div>
          )}
          <div>
            <Label>{t("stock.field.quantity")}</Label>
            <Input type="number" min="0" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>{t("stock.field.alertQty")}</Label>
            <Input type="number" min="0" value={form.alertQuantity} onChange={(e) => set("alertQuantity", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>{t("stock.field.status")}</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t("stock.status.active")}</SelectItem>
                <SelectItem value="archived">{t("stock.status.archived")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>{t("stock.field.description")}</Label>
            <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} className="mt-1" rows={2} />
          </div>
          <div className="col-span-2">
            <Label>{t("stock.field.notes")}</Label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} className="mt-1" rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Purchase Modal ─────────────────────────────────────────────────────────────

function PurchaseModal({
  open, onClose, product, canViewCost, t, onAdd,
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
      const qty = parseFloat(form.quantityAdded) || 1;
      const cpu = parseFloat(form.costPerUnit) || 0;
      setForm((f) => ({ ...f, totalCost: String((qty * cpu).toFixed(2)) }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function set(k: string, v: string | boolean) { setForm((f) => {
    const next = { ...f, [k]: v };
    if (k === "quantityAdded" || k === "costPerUnit") {
      const qty = parseFloat(k === "quantityAdded" ? String(v) : next.quantityAdded) || 0;
      const cpu = parseFloat(k === "costPerUnit" ? String(v) : next.costPerUnit) || 0;
      next.totalCost = String((qty * cpu).toFixed(2));
    }
    return next;
  }); }

  async function save() {
    setSaving(true);
    try {
      await onAdd({
        quantityAdded: parseInt(form.quantityAdded) || 1,
        costPerUnit: parseFloat(form.costPerUnit) || 0,
        totalCost: parseFloat(form.totalCost) || 0,
        currency: form.currency,
        exchangeRate: parseFloat(form.exchangeRate) || 1,
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("stock.addPurchase")}: {product.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("stock.purchase.qty")} *</Label>
              <Input type="number" min="1" value={form.quantityAdded} onChange={(e) => set("quantityAdded", e.target.value)} className="mt-1" />
            </div>
            {canViewCost && (
              <div>
                <Label>{t("stock.purchase.costPerUnit")}</Label>
                <Input type="number" min="0" step="0.01" value={form.costPerUnit} onChange={(e) => set("costPerUnit", e.target.value)} className="mt-1" />
              </div>
            )}
            {canViewCost && (
              <div>
                <Label>{t("stock.purchase.totalCost")}</Label>
                <Input type="number" min="0" step="0.01" value={form.totalCost} onChange={(e) => set("totalCost", e.target.value)} className="mt-1" />
              </div>
            )}
            <div>
              <Label>{t("stock.purchase.currency")}</Label>
              <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="CDF">CDF</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("stock.purchase.exchangeRate")}</Label>
              <Input type="number" min="1" step="0.01" value={form.exchangeRate} onChange={(e) => set("exchangeRate", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>{t("stock.purchase.supplier")}</Label>
              <Input value={form.supplier} onChange={(e) => set("supplier", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>{t("stock.purchase.date")}</Label>
              <Input type="date" value={form.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label>{t("stock.purchase.notes")}</Label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} className="mt-1" rows={2} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
            <Checkbox checked={form.paidFromCash} onCheckedChange={(v) => set("paidFromCash", Boolean(v))} />
            {t("stock.purchase.paidFromCash")}
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── History Modal ──────────────────────────────────────────────────────────────

function HistoryModal({
  open, onClose, product, canViewCost, t,
}: {
  open: boolean;
  onClose: () => void;
  product: ProductRecord;
  canViewCost: boolean;
  t: (k: string) => string;
}) {
  const historyQ = useGetProductHistory(product.id, { query: { enabled: open, queryKey: ["getProductHistory", product.id] } });
  const purchasesQ = useListProductPurchases(product.id, { query: { enabled: open, queryKey: ["listProductPurchases", product.id] } });

  const history = historyQ.data ?? [];
  const purchases = (purchasesQ.data ?? []) as StockPurchaseRecord[];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("stock.history.title")}: {product.name}</DialogTitle>
        </DialogHeader>

        {/* Purchases section */}
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">{t("stock.purchaseList")}</h3>
          {purchases.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">{t("stock.noPurchases")}</p>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Ref#</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Qty</th>
                    {canViewCost && <th className="text-left px-3 py-2 font-medium text-muted-foreground">Total Cost</th>}
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Supplier</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">By</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((p) => (
                    <tr key={p.id} className="border-b border-border/50">
                      <td className="px-3 py-2">{new Date(p.purchaseDate).toLocaleDateString()}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{p.purchaseNumber ?? "—"}</td>
                      <td className="px-3 py-2 font-bold">+{p.quantityAdded}</td>
                      {canViewCost && <td className="px-3 py-2">{p.totalCost.toLocaleString()} {p.currency}</td>}
                      <td className="px-3 py-2 text-muted-foreground">{p.supplier ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{p.createdBy ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Activity history */}
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">{t("stock.history.title")}</h3>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">{t("stock.noHistory")}</p>
          ) : (
            <div className="space-y-2">
              {history.map((h) => (
                <div key={h.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-muted/20 text-xs">
                  <div className="flex-1">
                    <span className="font-medium capitalize text-foreground">{h.action.replace(/_/g, " ")}</span>
                    {h.userName && <span className="text-muted-foreground ml-2">by {h.userName}</span>}
                  </div>
                  <span className="text-muted-foreground whitespace-nowrap">{new Date(h.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Shared components ──────────────────────────────────────────────────────────

function SummaryCard({ icon, label, value, color, danger }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: "indigo" | "emerald" | "amber" | "blue" | "purple";
  danger?: boolean;
}) {
  const styles = {
    indigo:  { wrap: "bg-white border-slate-200 shadow-sm", iconWrap: "bg-indigo-50", text: "text-foreground" },
    emerald: { wrap: "bg-white border-slate-200 shadow-sm", iconWrap: "bg-emerald-50", text: "text-foreground" },
    amber:   { wrap: danger ? "bg-amber-50 border-amber-200 shadow-sm" : "bg-white border-slate-200 shadow-sm", iconWrap: danger ? "bg-amber-100" : "bg-amber-50", text: danger ? "text-amber-700" : "text-foreground" },
    blue:    { wrap: "bg-white border-slate-200 shadow-sm", iconWrap: "bg-blue-50", text: "text-foreground" },
    purple:  { wrap: "bg-white border-slate-200 shadow-sm", iconWrap: "bg-violet-50", text: "text-foreground" },
  }[color];

  return (
    <div className={`rounded-xl border p-4 ${styles.wrap}`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-lg ${styles.iconWrap}`}>{icon}</div>
      </div>
      <p className={`text-2xl font-bold tabular-nums ${styles.text}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1 font-medium">{label}</p>
    </div>
  );
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const map: Record<string, string> = {
    active:   "bg-emerald-100 text-emerald-700 border border-emerald-200/60",
    archived: "bg-amber-100 text-amber-700 border border-amber-200/60",
    deleted:  "bg-rose-100 text-rose-700 border border-rose-200/60",
  };
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${map[status] ?? "bg-slate-100 text-slate-700"}`}>
      {t(`stock.status.${status}`)}
    </span>
  );
}

// ── Hook helper (avoids rules-of-hooks violation in callback) ──────────────────
async function useAddStockPurchaseMut(
  productId: number,
  data: Record<string, unknown>,
  qc: ReturnType<typeof useQueryClient>,
): Promise<void> {
  // Call the raw API function directly instead of the hook
  const { addStockPurchase } = await import("@workspace/api-client-react");
  await addStockPurchase(productId, data as unknown as Parameters<typeof addStockPurchase>[1]);
  qc.invalidateQueries({ queryKey: ["listProductPurchases"] });
  qc.invalidateQueries({ queryKey: ["getProductHistory"] });
}
