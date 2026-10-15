import { useId, type RefObject } from "react";
import { Barcode, CircleDollarSign, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmt as format } from "@/lib/i18n-format";
import { cn } from "@/lib/utils";
import { fmtMoney } from "./sales-utils";

export interface ProductSearchResult {
  id: number;
  name: string;
  currency: string;
  sellingPrice: number;
  costPrice: number;
  quantity: number;
  status: string;
}

interface ProductFinderProps {
  t: (k: string) => string;
  barcodeRef: RefObject<HTMLInputElement | null>;
  barcodeInput: string;
  onBarcodeChange: (value: string) => void;
  onBarcodeEnter: () => void;
  productSearch: string;
  onProductSearchChange: (value: string) => void;
  searchOpen: boolean;
  onSearchFocus: () => void;
  searchResults: ProductSearchResult[];
  onPick: (product: ProductSearchResult) => void;
  saleCurrency: "USD" | "CDF";
  onSaleCurrencyChange: (currency: "USD" | "CDF") => void;
  exchangeRate: number;
}

/** Left POS column: barcode scan, product search and the sale currency. */
export function ProductFinder({
  t,
  barcodeRef,
  barcodeInput,
  onBarcodeChange,
  onBarcodeEnter,
  productSearch,
  onProductSearchChange,
  searchOpen,
  onSearchFocus,
  searchResults,
  onPick,
  saleCurrency,
  onSaleCurrencyChange,
  exchangeRate,
}: ProductFinderProps) {
  const barcodeId = useId();
  const searchId = useId();
  const listId = useId();
  const showResults = searchOpen && searchResults.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm" aria-labelledby={`${barcodeId}-title`}>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
            <Barcode className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 id={`${barcodeId}-title`} className="font-semibold">{t("sales.addProducts")}</h2>
            <p className="text-xs text-muted-foreground">{t("sales.addProductsHint")}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={barcodeId} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("sales.barcode")}</Label>
            <div className="relative">
              <Barcode className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id={barcodeId}
                ref={barcodeRef}
                value={barcodeInput}
                onChange={(event) => onBarcodeChange(event.target.value)}
                placeholder={t("sales.barcodePlaceholder")}
                className="h-11 ps-9 font-mono"
                autoComplete="off"
                onKeyDown={(event) => {
                  if (event.key === "Enter") onBarcodeEnter();
                }}
              />
            </div>
          </div>

          <div className="relative space-y-1.5">
            <Label htmlFor={searchId} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("sales.searchLabel")}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id={searchId}
                type="search"
                role="combobox"
                aria-expanded={showResults}
                aria-controls={listId}
                aria-autocomplete="list"
                autoComplete="off"
                value={productSearch}
                onChange={(event) => onProductSearchChange(event.target.value)}
                onFocus={onSearchFocus}
                placeholder={t("sales.searchProduct")}
                className="h-11 ps-9"
              />
            </div>

            {showResults && (
              <ul id={listId} role="listbox" aria-label={t("sales.searchLabel")} className="absolute inset-x-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border border-border/70 bg-popover shadow-xl">
                {searchResults.map((product) => (
                  <li key={product.id} role="option" aria-selected={false}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-border/40 px-3 py-3 text-start text-sm last:border-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                      onClick={() => onPick(product)}
                    >
                      <span className="min-w-0 truncate font-medium">{product.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {fmtMoney(product.sellingPrice, product.currency === "CDF" ? "FC" : "$")} · {format(t("sales.stockLeft"), { count: product.quantity })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CircleDollarSign className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold">{t("sales.currency")}</h2>
          </div>
          <Badge variant="outline" className="font-mono">1 USD = {exchangeRate.toLocaleString()} CDF</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("sales.currency")}>
          {(["CDF", "USD"] as const).map((currency) => (
            <button
              key={currency}
              type="button"
              role="radio"
              aria-checked={saleCurrency === currency}
              onClick={() => onSaleCurrencyChange(currency)}
              className={cn(
                "min-h-11 rounded-xl border px-3 py-2.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                saleCurrency === currency
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40",
              )}
            >
              <span className="block font-semibold">{currency === "CDF" ? "FC / CDF" : "$ / USD"}</span>
              <span className="mt-0.5 block text-xs">{saleCurrency === currency ? t("sales.currencySelected") : t("sales.useCurrency")}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
