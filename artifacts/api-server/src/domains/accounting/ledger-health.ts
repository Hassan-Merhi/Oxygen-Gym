import { db, type DbExecutor } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getMoneyBalance } from "../../lib/ledger";
import { getExchangeRate } from "../../shared/accounting/currency";
import { money, subtractMoney } from "../../shared/accounting/decimal";
import { getTrialBalance } from "./ledger-reports";

function num(value: unknown): number {
  return money(Number(value ?? 0));
}

/** Value of live stock (quantity x cost) in USD at `rate` for CDF-costed products. */
export async function getStockValuation(rate: number, executor: DbExecutor = db): Promise<number> {
  const result = await executor.execute(sql`
    SELECT COALESCE(SUM(
      CASE WHEN UPPER(COALESCE(currency, 'USD')) = 'CDF' THEN (cost_price * quantity) / ${rate} ELSE cost_price * quantity END
    ), 0) AS value
    FROM products WHERE status <> 'deleted' AND deleted_at IS NULL AND quantity > 0
  `);
  return num((result.rows[0] as Record<string, unknown> | undefined)?.value);
}

/** Open supplier balances in USD (CDF credits at the rate locked on the credit). */
export async function getOpenPayables(rate: number, executor: DbExecutor = db): Promise<number> {
  const result = await executor.execute(sql`
    SELECT COALESCE(SUM(
      CASE WHEN UPPER(COALESCE(currency, 'USD')) = 'CDF'
        THEN (total_amount - amount_paid) / CASE WHEN exchange_rate >= 10 THEN exchange_rate ELSE ${rate} END
        ELSE total_amount - amount_paid END
    ), 0) AS value
    FROM supplier_credits WHERE deleted_at IS NULL AND status <> 'cancelled'
  `);
  return num((result.rows[0] as Record<string, unknown> | undefined)?.value);
}

async function accountBalance(name: string, normal: "debit" | "credit", executor: DbExecutor): Promise<number> {
  const result = await executor.execute(sql`
    SELECT COALESCE(SUM(${normal === "debit" ? sql`e.debit_usd - e.credit_usd` : sql`e.credit_usd - e.debit_usd`}), 0) AS value
    FROM accounting_entries e JOIN chart_of_accounts a ON a.id = e.account_id
    WHERE lower(a.name) = ${name.toLowerCase()}
  `);
  return num((result.rows[0] as Record<string, unknown> | undefined)?.value);
}

export interface HealthCheck {
  key: string;
  ok: boolean;
  expected: number;
  actual: number;
  difference: number;
  message: string;
}

/**
 * Reconciliation of the ledger against its sub-ledgers. Every check is
 * read-only. A failing check never fixes itself; it tells the owner where the
 * books disagree.
 */
export async function getLedgerHealth(executor: DbExecutor = db) {
  const rate = await getExchangeRate(executor);
  const [trial, unbalanced, cash, stockValue, inventoryBook, payables, payablesBook] = await Promise.all([
    getTrialBalance(undefined, executor),
    executor.execute(sql`
      SELECT journal_id FROM accounting_entries GROUP BY journal_id
      HAVING ABS(SUM(debit_usd) - SUM(credit_usd)) > 0.00001 OR ABS(SUM(debit_cdf) - SUM(credit_cdf)) > 0.00001
      LIMIT 20
    `),
    getMoneyBalance({}, executor),
    getStockValuation(rate, executor),
    accountBalance("Inventory", "debit", executor),
    getOpenPayables(rate, executor),
    accountBalance("Supplier Payables", "credit", executor),
  ]);
  const unbalancedJournals = (unbalanced.rows as Array<{ journal_id: string }>).map((row) => row.journal_id);

  const checks: HealthCheck[] = [
    {
      key: "trial_balance",
      ok: trial.balanced,
      expected: trial.totals.debitUsd,
      actual: trial.totals.creditUsd,
      difference: subtractMoney(trial.totals.debitUsd, trial.totals.creditUsd),
      message: trial.balanced ? "Debits equal credits." : "Total debits and credits differ.",
    },
    {
      key: "journals_balanced",
      ok: unbalancedJournals.length === 0,
      expected: 0,
      actual: unbalancedJournals.length,
      difference: unbalancedJournals.length,
      message: unbalancedJournals.length === 0 ? "Every journal balances." : `Unbalanced journals: ${unbalancedJournals.join(", ")}`,
    },
    {
      key: "cash_usd_not_negative",
      ok: cash.usd >= -0.004,
      expected: 0,
      actual: cash.usd,
      difference: Math.min(0, cash.usd),
      message: cash.usd >= -0.004 ? "USD cash is not negative." : "The books show more USD paid out than the drawer received.",
    },
    {
      key: "cash_cdf_not_negative",
      ok: cash.cdf >= -0.5,
      expected: 0,
      actual: cash.cdf,
      difference: Math.min(0, cash.cdf),
      message: cash.cdf >= -0.5 ? "CDF cash is not negative." : "The books show more CDF paid out than the drawer received.",
    },
    {
      key: "inventory",
      ok: Math.abs(stockValue - inventoryBook) < 0.01,
      expected: stockValue,
      actual: inventoryBook,
      difference: subtractMoney(stockValue, inventoryBook),
      message: Math.abs(stockValue - inventoryBook) < 0.01
        ? "Inventory account matches stock on hand."
        : "Inventory account differs from stock on hand (CDF-costed stock moves with the rate until the next close).",
    },
    {
      key: "supplier_payables",
      ok: Math.abs(payables - payablesBook) < 0.01,
      expected: payables,
      actual: payablesBook,
      difference: subtractMoney(payables, payablesBook),
      message: Math.abs(payables - payablesBook) < 0.01 ? "Supplier Payables matches open supplier balances." : "Supplier Payables differs from open supplier balances.",
    },
  ];
  return { ok: checks.every((check) => check.ok), rate, checks };
}
