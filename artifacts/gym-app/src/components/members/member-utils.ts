/** Helpers shared by the Members list, forms and invoice printing. */

export function toDateInput(d: string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toISOString().split("T")[0];
}

export function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

export function fmtCurrency(amount: number | null | undefined, currency: string): string {
  if (amount == null) return "—";
  return `${currency} ${amount.toFixed(2)}`;
}

export function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  const diff = new Date(d).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export type ExpiryState = "expired" | "urgent" | "warning" | "ok";

export function expiryState(status: string, expiryDate: string | null | undefined): { state: ExpiryState; days: number | null } {
  const days = daysUntil(expiryDate);
  if (status === "expired" || (days !== null && days < 0)) return { state: "expired", days };
  if (days !== null && days <= 5) return { state: "urgent", days };
  if (days !== null && days <= 14) return { state: "warning", days };
  return { state: "ok", days };
}

const AVATAR_COLORS = [
  "bg-violet-600", "bg-blue-600", "bg-emerald-600",
  "bg-orange-600", "bg-rose-600", "bg-indigo-600", "bg-teal-600", "bg-amber-600",
];

export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xfffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initialsOf(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

export interface MemberInvoiceData {
  invoiceNum: string;
  memberName: string;
  memberPhone?: string;
  planName: string;
  planPrice: number;
  startDate: string;
  expiryDate: string;
  amountPaid: number;
  discount: number;
  balance: number;
  currency: string;
  isRenewal: boolean;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Print an 80mm thermal receipt for a registration or renewal. */
export function printMemberInvoice(
  inv: MemberInvoiceData,
  settings: Record<string, unknown>,
  t: (key: string) => string,
  locale: string,
) {
  const sym = inv.currency === "CDF" ? "FC" : "$";
  const fmt = (n: number) => inv.currency === "CDF" ? `FC ${n % 1 === 0 ? n : n.toFixed(2)}` : `${sym}${n % 1 === 0 ? n : n.toFixed(2)}`;
  const fmtD = (d: string) => { try { return new Date(d).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }); } catch { return d; } };
  const dir = document.documentElement.dir === "rtl" ? "rtl" : "ltr";

  const html = `<!DOCTYPE html>
<html dir="${dir}" lang="${escapeHtml(document.documentElement.lang)}">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(inv.invoiceNum)}</title>
  <style>
    @page { size: 80mm auto; margin: 3mm 6mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; width: 68mm; padding: 0; font-size: 11px; color: #111; background: #fff; }
    .gym-name { font-size: 15px; font-weight: 700; letter-spacing: -0.3px; }
    .gym-sub { font-size: 10px; color: #666; margin-top: 2px; }
    .divider { border: none; border-top: 1px solid #e5e7eb; margin: 8px 0; }
    .divider-dashed { border: none; border-top: 1px dashed #d1d5db; margin: 8px 0; }
    .row { display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 4px; }
    .label { color: #6b7280; }
    .val { font-weight: 500; }
    .badge { display: inline-block; background: #f3f4f6; border-radius: 3px; padding: 1px 4px; font-size: 9px; font-weight: 600; color: #374151; }
    .total-row { display: flex; justify-content: space-between; font-size: 13px; font-weight: 700; padding: 6px 0; border-top: 2px solid #111; margin-top: 3px; }
    .sum-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 11px; }
    .balance-due { color: #dc2626; font-weight: 600; }
    .balance-ok { color: #059669; font-weight: 600; }
    .footer { margin-top: 14px; text-align: center; font-size: 10px; color: #9ca3af; }
    @media print { html, body { width: 68mm; } }
  </style>
</head>
<body>
  <div style="text-align:center;margin-bottom:16px">
    <img src="${window.location.origin}${import.meta.env.BASE_URL}gym-logo.jpg" onerror="this.style.display='none'" style="max-height:60px;margin-bottom:10px;object-fit:contain" alt=""/>
    <div class="gym-name">${escapeHtml(settings.gymName ?? "Oxygen Fitness Gym")}</div>
    ${settings.address ? `<div class="gym-sub">${escapeHtml(settings.address)}</div>` : ""}
    ${settings.phone ? `<div class="gym-sub">${escapeHtml(settings.phone)}</div>` : ""}
  </div>
  <hr class="divider">
  <div class="row"><span class="label">${t("members.invoice.number")}</span><span class="val badge">${escapeHtml(inv.invoiceNum)}</span></div>
  <div class="row"><span class="label">${t("members.invoice.date")}</span><span class="val">${fmtD(new Date().toISOString())}</span></div>
  <div class="row"><span class="label">${t("members.invoice.type")}</span><span class="val">${inv.isRenewal ? t("members.invoice.typeRenewal") : t("members.invoice.typeNew")}</span></div>
  <hr class="divider">
  <div class="row"><span class="label">${t("members.invoice.member")}</span><span class="val">${escapeHtml(inv.memberName)}</span></div>
  ${inv.memberPhone ? `<div class="row"><span class="label">${t("members.invoice.phone")}</span><span class="val">${escapeHtml(inv.memberPhone)}</span></div>` : ""}
  <hr class="divider">
  <div class="row"><span class="label">${t("members.invoice.plan")}</span><span class="val">${escapeHtml(inv.planName)}</span></div>
  <div class="row"><span class="label">${t("members.invoice.start")}</span><span class="val">${fmtD(inv.startDate)}</span></div>
  <div class="row"><span class="label">${t("members.invoice.expiry")}</span><span class="val">${fmtD(inv.expiryDate)}</span></div>
  <hr class="divider">
  <div class="sum-row"><span class="label">${t("members.invoice.price")}</span><span>${fmt(inv.planPrice)}</span></div>
  ${inv.discount > 0 ? `<div class="sum-row"><span class="label">${t("members.invoice.discount")}</span><span style="color:#dc2626">-${fmt(inv.discount)}</span></div>` : ""}
  <div class="total-row"><span>${t("members.invoice.total")}</span><span>${fmt(inv.planPrice - inv.discount)}</span></div>
  <div class="sum-row"><span class="label">${t("members.invoice.paid")}</span><span>${fmt(inv.amountPaid)}</span></div>
  <div class="sum-row"><span class="label">${t("members.invoice.balance")}</span><span class="${inv.balance > 0 ? "balance-due" : "balance-ok"}">${fmt(inv.balance)}</span></div>
  <hr class="divider-dashed" style="margin-top:20px">
  <div class="footer">${escapeHtml(settings.receiptFooter ?? t("members.invoice.thanks"))}</div>
</body>
</html>`;

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
