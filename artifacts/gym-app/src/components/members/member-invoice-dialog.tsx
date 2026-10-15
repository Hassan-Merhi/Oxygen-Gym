import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { printMemberInvoice, type MemberInvoiceData } from "./member-utils";

export function MemberInvoiceDialog({
  data,
  onClose,
  settings,
  t,
  fmtDate,
  locale,
}: {
  data: MemberInvoiceData | null;
  onClose: () => void;
  settings: Record<string, unknown>;
  t: (k: string) => string;
  fmtDate: (d: string | null | undefined) => string;
  locale: string;
}) {
  const money = (n: number) => (data?.currency === "CDF" ? `FC ${n}` : `$${n}`);
  const Row = ({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) => (
    <div className={cn("flex justify-between gap-4", className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end">{children}</dd>
    </div>
  );

  return (
    <Dialog open={!!data} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-4 w-4" aria-hidden="true" />
            {data?.isRenewal ? t("members.invoice.title_renewal") : t("members.invoice.title_new")}
          </DialogTitle>
        </DialogHeader>
        {data && (
          <div className="space-y-3 text-sm">
            <dl className="space-y-1.5 rounded-lg bg-muted/50 p-3">
              <Row label={t("members.invoice.member")}><span className="font-medium">{data.memberName}</span></Row>
              {data.memberPhone && <Row label={t("members.invoice.phone")}><span dir="ltr">{data.memberPhone}</span></Row>}
              <Row label={t("members.invoice.plan")}><span className="font-medium">{data.planName}</span></Row>
              <Row label={t("members.invoice.start")}>{fmtDate(data.startDate)}</Row>
              <Row label={t("members.invoice.expiry")}>{fmtDate(data.expiryDate)}</Row>
            </dl>
            <dl className="space-y-1.5 rounded-lg bg-muted/50 p-3">
              <Row label={t("members.invoice.price")}>{money(data.planPrice)}</Row>
              {data.discount > 0 && <Row label={t("members.invoice.discount")}><span className="text-red-700 dark:text-red-400">-{money(data.discount)}</span></Row>}
              <Row label={t("members.invoice.paid")} className="mt-1 border-t pt-1.5 font-semibold">{money(data.amountPaid)}</Row>
              <Row label={t("members.invoice.balance")}>
                <span className={cn("font-medium", data.balance > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>{money(data.balance)}</span>
              </Row>
            </dl>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.close")}</Button>
          <Button onClick={() => { if (data) printMemberInvoice(data, settings, t, locale); }}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            {t("members.invoice.print")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
