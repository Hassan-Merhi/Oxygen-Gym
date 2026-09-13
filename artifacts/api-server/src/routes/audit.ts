import { Router, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { sqlRows } from "../lib/sql-rows";

const router = Router();
router.use(requireAuth());

// ── Types ──────────────────────────────────────────────────────────────────
interface AuditIssue {
  id?: string | number;
  description: string;
  severity: "error" | "warning";
}
interface AuditSection {
  name: string;
  pass: boolean;
  issueCount: number;
  issues: AuditIssue[];
}

type AuditSqlScalar = string | number | boolean | null | undefined;
interface AuditSqlRow {
  id?: string | number;
  permissions?: Record<string, boolean>;
  expiryDate?: string | number;
  [key: string]: AuditSqlScalar | Record<string, boolean>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function getAccountingSummary() {
  const [rev, exp, payroll, inv, balance] = await Promise.all([
    db.execute(sql`SELECT COALESCE(SUM(amount_usd),0) AS total FROM cash_ledger WHERE direction='in'`),
    db.execute(sql`SELECT COALESCE(SUM(amount_usd),0) AS total FROM cash_ledger WHERE direction='out' AND source_type NOT IN ('payroll','stock_purchase')`),
    db.execute(sql`SELECT COALESCE(SUM(amount_usd),0) AS total FROM cash_ledger WHERE direction='out' AND source_type='payroll'`),
    db.execute(sql`SELECT COALESCE(SUM(total_cost_usd),0) AS total FROM stock_purchases`),
    db.execute(sql`SELECT COALESCE(balance_usd,0) AS bal_usd, COALESCE(balance_cdf,0) AS bal_cdf FROM cash_ledger ORDER BY id DESC LIMIT 1`),
  ]);
  const totalRevenue = Number(sqlRows<AuditSqlRow>(rev)[0]?.total ?? 0);
  const totalExpenses = Number(sqlRows<AuditSqlRow>(exp)[0]?.total ?? 0);
  const totalPayroll = Number(sqlRows<AuditSqlRow>(payroll)[0]?.total ?? 0);
  const totalInventoryCost = Number(sqlRows<AuditSqlRow>(inv)[0]?.total ?? 0);
  const cashBalanceUsd = Number(sqlRows<AuditSqlRow>(balance)[0]?.bal_usd ?? 0);
  const cashBalanceCdf = Number(sqlRows<AuditSqlRow>(balance)[0]?.bal_cdf ?? 0);
  const totalProfit = totalRevenue - totalExpenses - totalPayroll - totalInventoryCost;
  return { totalRevenue, totalExpenses, totalPayroll, totalInventoryCost, totalProfit, cashBalanceUsd, cashBalanceCdf };
}

async function cashReconciliation(): Promise<AuditSection> {
  const [computed, actual] = await Promise.all([
    db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN direction='in' THEN amount_usd ELSE -amount_usd END), 0) AS expected_usd,
        COALESCE(SUM(CASE WHEN direction='in' THEN amount_cdf ELSE -amount_cdf END), 0) AS expected_cdf
      FROM cash_ledger
    `),
    db.execute(sql`SELECT COALESCE(balance_usd,0) AS bal_usd, COALESCE(balance_cdf,0) AS bal_cdf FROM cash_ledger ORDER BY id DESC LIMIT 1`),
  ]);
  const expectedUsd = Number(sqlRows<AuditSqlRow>(computed)[0]?.expected_usd ?? 0);
  const expectedCdf = Number(sqlRows<AuditSqlRow>(computed)[0]?.expected_cdf ?? 0);
  const actualUsd = Number(sqlRows<AuditSqlRow>(actual)[0]?.bal_usd ?? 0);
  const actualCdf = Number(sqlRows<AuditSqlRow>(actual)[0]?.bal_cdf ?? 0);
  const diffUsd = Math.abs(expectedUsd - actualUsd);
  const diffCdf = Math.abs(expectedCdf - actualCdf);
  const issues: AuditIssue[] = [];
  if (diffUsd > 0.01) issues.push({ description: `USD balance mismatch: expected $${expectedUsd.toFixed(2)}, actual $${actualUsd.toFixed(2)}, difference $${diffUsd.toFixed(2)}`, severity: "error" });
  if (diffCdf > 0.01) issues.push({ description: `CDF balance mismatch: expected ${expectedCdf.toFixed(2)}, actual ${actualCdf.toFixed(2)}, difference ${diffCdf.toFixed(2)}`, severity: "error" });
  return { name: "Cash Reconciliation", pass: issues.length === 0, issueCount: issues.length, issues };
}

async function salesAudit(): Promise<AuditSection> {
  const [missingLedger, emptyItems, mismatchRows] = await Promise.all([
    db.execute(sql`
      SELECT s.id, s.sale_number FROM sales s
      WHERE s.status = 'completed'
      AND NOT EXISTS (SELECT 1 FROM cash_ledger cl WHERE cl.source_type = 'sale' AND cl.source_id = s.id)
    `),
    db.execute(sql`
      SELECT id, sale_number FROM sales
      WHERE status = 'completed' AND (items IS NULL OR jsonb_array_length(items) = 0)
    `),
    db.execute(sql`
      SELECT * FROM (
        SELECT s.id, s.sale_number, s.total_amount,
          (SELECT COALESCE(SUM((item->>'lineTotal')::float), 0) FROM jsonb_array_elements(s.items) AS item) AS computed
        FROM sales s WHERE s.status = 'completed'
      ) t WHERE ABS(t.total_amount - t.computed) > 0.01
    `),
  ]);
  const issues: AuditIssue[] = [];
  for (const r of sqlRows<AuditSqlRow>(missingLedger)) issues.push({ id: r.id, description: `Sale ${r.sale_number ?? r.id} has no ledger entry`, severity: "error" });
  for (const r of sqlRows<AuditSqlRow>(emptyItems)) issues.push({ id: r.id, description: `Sale ${r.sale_number ?? r.id} has no items`, severity: "error" });
  for (const r of sqlRows<AuditSqlRow>(mismatchRows)) issues.push({ id: r.id, description: `Sale ${r.sale_number ?? r.id}: total mismatch — stored ${Number(r.total_amount).toFixed(2)}, computed ${Number(r.computed).toFixed(2)}`, severity: "error" });
  return { name: "Sales Audit", pass: issues.length === 0, issueCount: issues.length, issues };
}

async function voidedSalesAudit(): Promise<AuditSection> {
  const result = await db.execute(sql`
    SELECT s.id, s.sale_number FROM sales s
    WHERE s.status = 'voided'
    AND NOT EXISTS (
      SELECT 1 FROM cash_ledger cl WHERE cl.source_id = s.id AND cl.direction = 'out'
    )
  `);
  const issues: AuditIssue[] = sqlRows<AuditSqlRow>(result).map(r => ({
    id: r.id,
    description: `Voided sale ${r.sale_number ?? r.id} missing reversal ledger entry`,
    severity: "warning" as const,
  }));
  return { name: "Void Sales Audit", pass: issues.length === 0, issueCount: issues.length, issues };
}

async function inventoryAudit(): Promise<{ section: AuditSection; rows: AuditSqlRow[] }> {
  const result = await db.execute(sql`
    WITH purchases AS (
      SELECT product_id, COALESCE(SUM(quantity_added), 0) AS total_purchased
      FROM stock_purchases GROUP BY product_id
    ),
    completed_sold AS (
      SELECT (item->>'productId')::int AS pid, COALESCE(SUM((item->>'quantity')::int), 0) AS total_sold
      FROM sales, jsonb_array_elements(items) AS item
      WHERE status = 'completed'
      GROUP BY (item->>'productId')::int
    ),
    voided_sold AS (
      SELECT (item->>'productId')::int AS pid, COALESCE(SUM((item->>'quantity')::int), 0) AS total_restored
      FROM sales, jsonb_array_elements(items) AS item
      WHERE status = 'voided'
      GROUP BY (item->>'productId')::int
    )
    SELECT
      p.id, p.name, p.product_number AS "productNumber", p.quantity AS actual,
      COALESCE(pur.total_purchased, 0) - COALESCE(cs.total_sold, 0) + COALESCE(vs.total_restored, 0) AS expected,
      (COALESCE(pur.total_purchased, 0) - COALESCE(cs.total_sold, 0) + COALESCE(vs.total_restored, 0)) - p.quantity AS diff
    FROM products p
    LEFT JOIN purchases pur ON p.id = pur.product_id
    LEFT JOIN completed_sold cs ON p.id = cs.pid
    LEFT JOIN voided_sold vs ON p.id = vs.pid
    WHERE p.status != 'deleted'
    ORDER BY ABS((COALESCE(pur.total_purchased, 0) - COALESCE(cs.total_sold, 0) + COALESCE(vs.total_restored, 0)) - p.quantity) DESC
  `);
  const rows = sqlRows<AuditSqlRow>(result);
  const issues: AuditIssue[] = rows
    .filter(r => Math.abs(Number(r.diff)) > 0)
    .map(r => ({
      id: r.id,
      description: `${r.name}: expected ${r.expected}, actual ${r.actual}, diff ${Number(r.diff) > 0 ? "+" : ""}${r.diff}`,
      severity: (Math.abs(Number(r.diff)) > 5 ? "error" : "warning") as "error" | "warning",
    }));
  return { section: { name: "Inventory Audit", pass: issues.length === 0, issueCount: issues.length, issues }, rows };
}

async function payrollAudit(): Promise<AuditSection> {
  const [missingLedger, missingPayment] = await Promise.all([
    db.execute(sql`
      SELECT id, payroll_number FROM payroll
      WHERE status = 'paid'
      AND NOT EXISTS (SELECT 1 FROM cash_ledger cl WHERE cl.source_type = 'payroll' AND cl.source_id = payroll.id)
    `),
    db.execute(sql`SELECT id, payroll_number FROM payroll WHERE status = 'paid' AND payment_id IS NULL`),
  ]);
  const issues: AuditIssue[] = [];
  for (const r of sqlRows<AuditSqlRow>(missingLedger)) issues.push({ id: r.id, description: `Payroll ${r.payroll_number ?? r.id}: paid but no ledger entry`, severity: "error" });
  for (const r of sqlRows<AuditSqlRow>(missingPayment)) issues.push({ id: r.id, description: `Payroll ${r.payroll_number ?? r.id}: paid but no payment record`, severity: "error" });
  return { name: "Payroll Audit", pass: issues.length === 0, issueCount: issues.length, issues };
}

async function membershipAudit(): Promise<AuditSection> {
  const [expiredActive, negativeBalance] = await Promise.all([
    db.execute(sql`
      SELECT id, member_number AS "memberNumber", name, expiry_date AS "expiryDate"
      FROM members WHERE status = 'active' AND expiry_date IS NOT NULL AND expiry_date < NOW()
    `),
    db.execute(sql`
      SELECT id, member_number AS "memberNumber", name, balance FROM members WHERE balance < -0.01
    `),
  ]);
  const issues: AuditIssue[] = [];
  for (const r of sqlRows<AuditSqlRow>(expiredActive)) {
    issues.push({ id: r.id, description: `Member ${r.memberNumber} (${r.name}): status=active but expired on ${new Date(String(r.expiryDate ?? "")).toLocaleDateString()}`, severity: "warning" });
  }
  for (const r of sqlRows<AuditSqlRow>(negativeBalance)) {
    issues.push({ id: r.id, description: `Member ${r.memberNumber} (${r.name}): negative balance ${Number(r.balance).toFixed(2)}`, severity: "warning" });
  }
  return { name: "Membership Audit", pass: issues.length === 0, issueCount: issues.length, issues };
}

async function currencyAudit(): Promise<AuditSection> {
  const [ledger, payments] = await Promise.all([
    db.execute(sql`SELECT COUNT(*) AS cnt FROM cash_ledger WHERE exchange_rate IS NULL OR amount_usd IS NULL OR amount_cdf IS NULL`),
    db.execute(sql`SELECT COUNT(*) AS cnt FROM payments WHERE exchange_rate IS NULL OR amount_usd IS NULL`),
  ]);
  const issues: AuditIssue[] = [];
  const lc = Number(sqlRows<AuditSqlRow>(ledger)[0]?.cnt ?? 0);
  const pc = Number(sqlRows<AuditSqlRow>(payments)[0]?.cnt ?? 0);
  if (lc > 0) issues.push({ description: `${lc} ledger entries missing exchange rate or USD/CDF amounts`, severity: "warning" });
  if (pc > 0) issues.push({ description: `${pc} payment records missing exchange rate or USD amount`, severity: "warning" });
  return { name: "Multi-Currency Audit", pass: issues.length === 0, issueCount: issues.length, issues };
}

async function accountingEntriesAudit(): Promise<AuditSection> {
  const tableExists = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'accounting_entries'
    ) AS exists
  `);
  if (!sqlRows<AuditSqlRow>(tableExists)[0]?.exists) {
    return { name: "Accounting Entries Audit", pass: true, issueCount: 0, issues: [{ description: "accounting_entries table not yet created", severity: "warning" }] };
  }

  const [
    completedPaymentsMissing,
    recordedVouchersMissing,
    completedSalesMissing,
    paidPayrollMissing,
    paidStockMissing,
    cancelledMissingReversal,
    nullAccountIds,
  ] = await Promise.all([
    db.execute(sql`
      SELECT id, payment_number FROM payments
      WHERE status = 'completed'
      AND NOT EXISTS (SELECT 1 FROM accounting_entries ae WHERE ae.source_type = 'payment' AND ae.source_id = payments.id)
      LIMIT 20
    `),
    db.execute(sql`
      SELECT id, voucher_number FROM vouchers
      WHERE status = 'recorded'
      AND NOT EXISTS (SELECT 1 FROM accounting_entries ae WHERE ae.source_type = 'voucher' AND ae.source_id = vouchers.id)
      LIMIT 20
    `),
    db.execute(sql`
      SELECT id, sale_number FROM sales
      WHERE status = 'completed'
      AND NOT EXISTS (SELECT 1 FROM accounting_entries ae WHERE ae.source_type = 'sale' AND ae.source_id = sales.id)
      LIMIT 20
    `),
    db.execute(sql`
      SELECT id, payroll_number FROM payroll
      WHERE status = 'paid'
      AND NOT EXISTS (SELECT 1 FROM accounting_entries ae WHERE ae.source_type = 'payroll' AND ae.source_id = payroll.id)
      LIMIT 20
    `),
    db.execute(sql`
      SELECT id, purchase_number FROM stock_purchases
      WHERE paid_from_cash = 1
      AND NOT EXISTS (SELECT 1 FROM accounting_entries ae WHERE ae.source_type = 'stock_purchase' AND ae.source_id = stock_purchases.id)
      LIMIT 20
    `),
    db.execute(sql`
      SELECT DISTINCT ae.source_type, ae.source_id
      FROM accounting_entries ae
      WHERE ae.source_type = 'payment'
        AND EXISTS (SELECT 1 FROM payments p WHERE p.id = ae.source_id AND p.status = 'cancelled')
        AND NOT EXISTS (
          SELECT 1 FROM accounting_entries rev
          WHERE (rev.source_type = 'payment_reversal' OR rev.source_type = 'payment_correction')
            AND rev.source_id = ae.source_id
        )
      LIMIT 20
    `),
    db.execute(sql`SELECT COUNT(*) AS cnt FROM accounting_entries WHERE account_id IS NULL`),
  ]);

  const issues: AuditIssue[] = [];
  for (const r of sqlRows<AuditSqlRow>(completedPaymentsMissing)) {
    issues.push({ id: r.id, description: `Payment ${r.payment_number ?? r.id}: no accounting entries`, severity: "error" });
  }
  for (const r of sqlRows<AuditSqlRow>(recordedVouchersMissing)) {
    issues.push({ id: r.id, description: `Voucher ${r.voucher_number ?? r.id}: no accounting entries`, severity: "error" });
  }
  for (const r of sqlRows<AuditSqlRow>(completedSalesMissing)) {
    issues.push({ id: r.id, description: `Sale ${r.sale_number ?? r.id}: no accounting entries`, severity: "warning" });
  }
  for (const r of sqlRows<AuditSqlRow>(paidPayrollMissing)) {
    issues.push({ id: r.id, description: `Payroll ${r.payroll_number ?? r.id}: paid but no accounting entries`, severity: "error" });
  }
  for (const r of sqlRows<AuditSqlRow>(paidStockMissing)) {
    issues.push({ id: r.id, description: `Stock purchase ${r.purchase_number ?? r.id}: paid but no accounting entries`, severity: "warning" });
  }
  for (const r of sqlRows<AuditSqlRow>(cancelledMissingReversal)) {
    issues.push({ description: `Cancelled ${r.source_type} #${r.source_id}: has accounting entries but missing reversal`, severity: "warning" });
  }
  const nullCnt = Number(sqlRows<AuditSqlRow>(nullAccountIds)[0]?.cnt ?? 0);
  if (nullCnt > 0) {
    issues.push({ description: `${nullCnt} accounting entries are unlinked (missing account_id — chart of accounts not matched)`, severity: "warning" });
  }

  return { name: "Accounting Entries Audit", pass: issues.length === 0, issueCount: issues.length, issues };
}

async function permissionAudit(): Promise<AuditSection> {
  const users = await db.execute(sql`SELECT id, name, role, permissions FROM users WHERE role != 'admin'`);
  const issues: AuditIssue[] = [];
  for (const u of sqlRows<AuditSqlRow>(users)) {
    const p = u.permissions ?? {};
    if (p.viewAccounting && p.viewProfit && p.viewCost && u.role === "staff") {
      issues.push({ id: u.id, description: `Staff "${u.name}" has all financial permissions — verify this is intentional`, severity: "warning" });
    }
  }
  const adminCount = await db.execute(sql`SELECT COUNT(*) AS cnt FROM users WHERE role='admin'`);
  if (Number(sqlRows<AuditSqlRow>(adminCount)[0]?.cnt ?? 0) === 0) {
    issues.push({ description: "No admin user found in the system", severity: "error" });
  }
  return { name: "Permission Audit", pass: issues.length === 0, issueCount: issues.length, issues };
}

async function dataIntegrityAudit(): Promise<AuditSection> {
  const [
    negativeQty,
    invalidMemberStatus,
    membersNoNumber,
    salesNoNumber,
    payrollNoNumber,
    paymentsNoNumber,
  ] = await Promise.all([
    db.execute(sql`SELECT id, name, quantity FROM products WHERE quantity < 0 AND status != 'deleted'`),
    db.execute(sql`SELECT COUNT(*) AS cnt FROM members WHERE status NOT IN ('active','expired','frozen','inactive','archived')`),
    db.execute(sql`SELECT COUNT(*) AS cnt FROM members WHERE member_number IS NULL`),
    db.execute(sql`SELECT COUNT(*) AS cnt FROM sales WHERE sale_number IS NULL`),
    db.execute(sql`SELECT COUNT(*) AS cnt FROM payroll WHERE payroll_number IS NULL`),
    db.execute(sql`SELECT COUNT(*) AS cnt FROM payments WHERE payment_number IS NULL`),
  ]);
  const issues: AuditIssue[] = [];
  for (const r of sqlRows<AuditSqlRow>(negativeQty)) {
    issues.push({ id: r.id, description: `Product "${r.name}" has negative quantity (${r.quantity})`, severity: "error" });
  }
  if (Number(sqlRows<AuditSqlRow>(invalidMemberStatus)[0]?.cnt ?? 0) > 0) {
    issues.push({ description: `${sqlRows<AuditSqlRow>(invalidMemberStatus)[0].cnt} members have invalid status values`, severity: "error" });
  }
  const noNumMembers = Number(sqlRows<AuditSqlRow>(membersNoNumber)[0]?.cnt ?? 0);
  if (noNumMembers > 0) issues.push({ description: `${noNumMembers} members missing member numbers`, severity: "warning" });
  const noNumSales = Number(sqlRows<AuditSqlRow>(salesNoNumber)[0]?.cnt ?? 0);
  if (noNumSales > 0) issues.push({ description: `${noNumSales} sales missing sale numbers`, severity: "warning" });
  const noNumPayroll = Number(sqlRows<AuditSqlRow>(payrollNoNumber)[0]?.cnt ?? 0);
  if (noNumPayroll > 0) issues.push({ description: `${noNumPayroll} payroll records missing payroll numbers`, severity: "warning" });
  const noNumPayments = Number(sqlRows<AuditSqlRow>(paymentsNoNumber)[0]?.cnt ?? 0);
  if (noNumPayments > 0) issues.push({ description: `${noNumPayments} payments missing payment numbers`, severity: "warning" });
  return { name: "Data Integrity", pass: issues.length === 0, issueCount: issues.length, issues };
}

async function systemHealth() {
  const start = Date.now();
  const [members, staff, products, sales, payments, payroll, vouchers, checkIns, dbSize, tableSizes] = await Promise.all([
    db.execute(sql`SELECT COUNT(*) AS cnt FROM members`),
    db.execute(sql`SELECT COUNT(*) AS cnt FROM users`),
    db.execute(sql`SELECT COUNT(*) AS cnt FROM products WHERE status != 'deleted'`),
    db.execute(sql`SELECT COUNT(*) AS cnt FROM sales`),
    db.execute(sql`SELECT COUNT(*) AS cnt FROM payments`),
    db.execute(sql`SELECT COUNT(*) AS cnt FROM payroll`),
    db.execute(sql`SELECT COUNT(*) AS cnt FROM vouchers`),
    db.execute(sql`SELECT COUNT(*) AS cnt FROM check_ins`),
    db.execute(sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`),
    db.execute(sql`
      SELECT table_name AS name, pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS size
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY pg_total_relation_size(quote_ident(table_name)) DESC
      LIMIT 10
    `),
  ]);
  const dbResponseMs = Date.now() - start;
  return {
    records: {
      members: Number(sqlRows<AuditSqlRow>(members)[0]?.cnt ?? 0),
      staff: Number(sqlRows<AuditSqlRow>(staff)[0]?.cnt ?? 0),
      products: Number(sqlRows<AuditSqlRow>(products)[0]?.cnt ?? 0),
      sales: Number(sqlRows<AuditSqlRow>(sales)[0]?.cnt ?? 0),
      payments: Number(sqlRows<AuditSqlRow>(payments)[0]?.cnt ?? 0),
      payroll: Number(sqlRows<AuditSqlRow>(payroll)[0]?.cnt ?? 0),
      vouchers: Number(sqlRows<AuditSqlRow>(vouchers)[0]?.cnt ?? 0),
      checkIns: Number(sqlRows<AuditSqlRow>(checkIns)[0]?.cnt ?? 0),
    },
    dbSize: sqlRows<AuditSqlRow>(dbSize)[0]?.size ?? "Unknown",
    dbResponseMs,
    tableSizes: sqlRows<AuditSqlRow>(tableSizes),
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────

router.get("/run", async (_req: Request, res: Response) => {
  const [
    accounting,
    reconciliation,
    sales,
    voidedSales,
    inventoryResult,
    payroll,
    memberships,
    currency,
    accountingEntries,
    permissions,
    dataIntegrity,
    health,
  ] = await Promise.all([
    getAccountingSummary(),
    cashReconciliation(),
    salesAudit(),
    voidedSalesAudit(),
    inventoryAudit(),
    payrollAudit(),
    membershipAudit(),
    currencyAudit(),
    accountingEntriesAudit(),
    permissionAudit(),
    dataIntegrityAudit(),
    systemHealth(),
  ]);

  const sections: AuditSection[] = [
    reconciliation, sales, voidedSales, inventoryResult.section,
    payroll, memberships, currency, accountingEntries, permissions, dataIntegrity,
  ];
  const totalIssues = sections.reduce((acc, s) => acc + s.issueCount, 0);

  res.json({
    generatedAt: new Date().toISOString(),
    accounting,
    totalIssues,
    sections,
    inventoryRows: inventoryResult.rows,
    systemHealth: health,
  });
});

// ── Fix tools (admin only) ─────────────────────────────────────────────────

router.post("/fix/inventory", async (_req: Request, res: Response) => {
  const result = await db.execute(sql`
    WITH computed AS (
      SELECT p.id,
        COALESCE((SELECT SUM(sp.quantity_added) FROM stock_purchases sp WHERE sp.product_id = p.id), 0) AS purchased,
        COALESCE((
          SELECT SUM((item->>'quantity')::int) FROM sales s, jsonb_array_elements(s.items) AS item
          WHERE (item->>'productId')::int = p.id AND s.status = 'completed'
        ), 0) AS sold,
        COALESCE((
          SELECT SUM((item->>'quantity')::int) FROM sales s, jsonb_array_elements(s.items) AS item
          WHERE (item->>'productId')::int = p.id AND s.status = 'voided'
        ), 0) AS restored
      FROM products p WHERE p.status != 'deleted'
    )
    UPDATE products SET quantity = c.purchased - c.sold + c.restored
    FROM computed c WHERE products.id = c.id
    RETURNING products.id, products.name, products.quantity
  `);
  res.json({ fixed: result.rows.length, rows: result.rows });
});

router.post("/fix/dashboard", async (_req: Request, res: Response) => {
  res.json({ message: "Dashboard KPIs are computed dynamically — no cache to clear." });
});

router.post("/fix/accounts", async (_req: Request, res: Response) => {
  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN direction='in' THEN amount_usd ELSE -amount_usd END), 0) AS balance_usd,
      COALESCE(SUM(CASE WHEN direction='in' THEN amount_cdf ELSE -amount_cdf END), 0) AS balance_cdf,
      COUNT(*) AS entries
    FROM cash_ledger
  `);
  res.json({ summary: result.rows[0] });
});

export default router;
