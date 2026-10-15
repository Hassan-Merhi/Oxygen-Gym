/** Shared types and helpers for the Sales / POS screens. */

export interface CartItem {
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

export interface SaleItemData {
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

export type HistoryPeriod = "all" | "today" | "yesterday" | "monthly" | "yearly" | "custom";

export function fmtMoney(n: number | null | undefined, sym: string): string {
  const value = Number(n ?? 0);
  const decimals = value % 1 === 0 ? 0 : 2;
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: 2,
  });
  return sym === "FC" ? `FC ${formatted}` : `${sym}${formatted}`;
}

export function localDateInput(date: Date): string {
  const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return copy.toISOString().slice(0, 10);
}

export function saleDayKey(value: unknown): string {
  const raw = String(value ?? "");
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "unknown" : localDateInput(date);
}

export function printReceipt(
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
      <title>${t("sales.receipt.title")} — ${saleNum}</title>
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
        <img src="${window.location.origin}${import.meta.env.BASE_URL}gym-logo.jpg" onerror="this.style.display='none'" style="max-height:60px;margin-bottom:10px;object-fit:contain" alt=""/>
        <div class="gym-name">${settings.gymName ?? "Oxygen Fitness Gym"}</div>
        ${settings.address ? `<div class="gym-sub">${settings.address}</div>` : ""}
        ${settings.phone ? `<div class="gym-sub">${settings.phone}</div>` : ""}
        ${settings.receiptHeader ? `<div style="margin-top:6px;font-size:12px;color:#666;font-style:italic">${settings.receiptHeader}</div>` : ""}
      </div>
      <hr class="divider">
      <div class="meta-row"><span class="meta-label">${t("sales.history.number")}</span><span class="meta-val badge">${saleNum}</span></div>
      <div class="meta-row"><span class="meta-label">${t("sales.history.date")}</span><span class="meta-val">${new Date(sale.saleDate as string).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span></div>
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
      <div class="footer">${settings.receiptFooter ?? t("sales.receipt.thanks")}</div>
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

/** Convert a product price into the currency the sale is being made in. */
export function convertToSaleCurrency(
  price: number,
  fromCurrency: string,
  saleCurrency: string,
  exchangeRate: number,
): number {
  if (fromCurrency === saleCurrency) return price;
  if (saleCurrency === "USD" && fromCurrency === "CDF") return price / exchangeRate;
  if (saleCurrency === "CDF" && fromCurrency === "USD") return price * exchangeRate;
  return price;
}

export function currencySymbol(currency: string | null | undefined): string {
  return currency === "USD" ? "$" : "FC";
}

/** Amount colour that keeps >= 4.5:1 contrast in light mode and stays soft in dark mode. */
export function profitTone(value: number): string {
  return value >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400";
}
