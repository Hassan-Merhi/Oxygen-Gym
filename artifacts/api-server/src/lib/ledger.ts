/**
 * Read side of the general ledger.
 *
 * `accounting_entries` is the single source of truth for every money figure in
 * the app: Cash Book, account statements, balances, P&L, dashboard and the
 * balance sheet all derive from it. Source tables (payments, vouchers, sales,
 * ...) only describe documents; they are joined here for names and references.
 */
import { db, type DbExecutor } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ACCOUNTS, normalizeName } from "./accounting";
import { addMoney, money, subtractMoney } from "../shared/accounting/decimal";
import { getExchangeRate, toUsdCdf } from "../shared/accounting/currency";

export interface LedgerLine {
  entryId: number;
  journalId: string;
  date: Date;
  sourceType: string;
  sourceBase: string;
  sourceId: number | null;
  sourceNumber: string | null;
  accountId: number | null;
  accountName: string;
  accountType: string;
  counterAccount: string;
  description: string;
  party: string;
  side: "debit" | "credit";
  debitUsd: number;
  creditUsd: number;
  debitCdf: number;
  creditCdf: number;
  /** Native amount in `currency` (zero for pure USD revaluation lines). */
  amount: number;
  currency: "USD" | "CDF";
  exchangeRate: number;
  createdBy: string | null;
}

export interface LedgerQuery {
  accountNames?: readonly string[];
  accountTypes?: readonly string[];
  accountId?: number;
  dateFrom?: Date;
  dateTo?: Date;
  /** Skip period-closing journals (they zero income/expense into retained earnings). */
  excludeClosing?: boolean;
  /** Only lines recorded in this currency (USD or CDF). */
  currency?: string;
  search?: string;
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
}

type RawLine = Record<string, unknown>;

function num(value: unknown): number {
  return money(Number(value ?? 0));
}

function toLine(row: RawLine): LedgerLine {
  const debitUsd = num(row.debit_usd);
  const debitCdf = num(row.debit_cdf);
  const currency = String(row.currency ?? "USD").toUpperCase() === "CDF" ? "CDF" : "USD";
  return {
    entryId: Number(row.id),
    journalId: String(row.journal_id ?? ""),
    date: row.entry_date instanceof Date ? row.entry_date : new Date(String(row.entry_date)),
    sourceType: String(row.source_type ?? ""),
    sourceBase: String(row.source_base ?? ""),
    sourceId: row.source_id == null ? null : Number(row.source_id),
    sourceNumber: row.source_number == null ? null : String(row.source_number),
    accountId: row.account_id == null ? null : Number(row.account_id),
    accountName: String(row.account_name ?? ""),
    accountType: String(row.account_type ?? ""),
    counterAccount: String(row.counter_account ?? ""),
    description: String(row.description ?? ""),
    party: String(row.party ?? ""),
    side: debitUsd > 0 || debitCdf > 0 ? "debit" : "credit",
    debitUsd,
    creditUsd: num(row.credit_usd),
    debitCdf,
    creditCdf: num(row.credit_cdf),
    amount: num(row.amount),
    currency,
    exchangeRate: Number(row.exchange_rate ?? 1),
    createdBy: row.created_by == null ? null : String(row.created_by),
  };
}

const SOURCE_BASE = sql`regexp_replace(regexp_replace(e.source_type, '^void_', ''), '_(correction|reversal|void)$', '')`;

function whereClause(query: LedgerQuery) {
  const parts = [sql`TRUE`];
  if (query.accountId !== undefined) parts.push(sql`e.account_id = ${query.accountId}`);
  if (query.accountNames?.length) {
    const names = query.accountNames.map((name) => normalizeName(name).toLowerCase());
    parts.push(sql`lower(a.name) IN (${sql.join(names.map((name) => sql`${name}`), sql`, `)})`);
  }
  if (query.accountTypes?.length) {
    parts.push(sql`a.type IN (${sql.join(query.accountTypes.map((type) => sql`${type}`), sql`, `)})`);
  }
  if (query.dateFrom) parts.push(sql`e.entry_date >= ${query.dateFrom}`);
  if (query.dateTo) parts.push(sql`e.entry_date <= ${query.dateTo}`);
  if (query.excludeClosing) parts.push(sql`e.source_type <> 'period_close'`);
  if (query.currency) parts.push(sql`upper(e.currency) = ${query.currency.toUpperCase()}`);
  if (query.search) {
    const like = `%${query.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    parts.push(sql`(
      e.description ILIKE ${like} OR e.source_number ILIKE ${like}
      OR a.name ILIKE ${like} OR COALESCE(party.name, '') ILIKE ${like}
    )`);
  }
  return sql.join(parts, sql` AND `);
}

const PARTY_JOIN = sql`
  LEFT JOIN LATERAL (
    SELECT CASE ${SOURCE_BASE}
      WHEN 'payment' THEN (SELECT COALESCE(NULLIF(TRIM(p.linked_entity_name), ''), NULLIF(TRIM(p.member_name), '')) FROM payments p WHERE p.id = e.source_id)
      WHEN 'voucher' THEN (SELECT COALESCE(NULLIF(TRIM(v.paid_to), ''), NULLIF(TRIM(v.received_from), ''), NULLIF(TRIM(v.linked_entity_name), '')) FROM vouchers v WHERE v.id = e.source_id)
      WHEN 'sale' THEN 'POS'
      WHEN 'payroll' THEN (SELECT pr.user_name FROM payroll pr WHERE pr.id = e.source_id)
      WHEN 'stock_purchase' THEN (SELECT NULLIF(TRIM(sp.supplier), '') FROM stock_purchases sp WHERE sp.id = e.source_id)
      WHEN 'supplier_credit' THEN (SELECT sc.supplier FROM supplier_credits sc WHERE sc.id = e.source_id)
      WHEN 'supplier_payment' THEN (
        SELECT sc.supplier FROM supplier_payments spay JOIN supplier_credits sc ON sc.id = spay.credit_id WHERE spay.id = e.source_id
      )
      ELSE NULL
    END AS name
  ) party ON TRUE`;

const COUNTER_JOIN = sql`
  LEFT JOIN LATERAL (
    SELECT c.account_name_snapshot AS name
    FROM accounting_entries c
    WHERE c.journal_id = e.journal_id
      AND c.id <> e.id
      AND ((c.debit_usd > 0 OR c.debit_cdf > 0) <> (e.debit_usd > 0 OR e.debit_cdf > 0))
    ORDER BY ABS(c.id - e.id), c.id
    LIMIT 1
  ) counter ON TRUE`;

/** Ledger lines with account, counter-account and party, oldest first by default. */
export async function getLedgerLines(query: LedgerQuery = {}, executor: DbExecutor = db): Promise<LedgerLine[]> {
  const order = query.order === "desc" ? sql`DESC` : sql`ASC`;
  const limit = query.limit !== undefined ? sql`LIMIT ${query.limit}` : sql``;
  const offset = query.offset !== undefined ? sql`OFFSET ${query.offset}` : sql``;
  const result = await executor.execute(sql`
    SELECT e.id, e.journal_id, e.entry_date, e.source_type, ${SOURCE_BASE} AS source_base, e.source_id, e.source_number,
           e.account_id, COALESCE(a.name, e.account_name_snapshot) AS account_name, COALESCE(a.type, '') AS account_type,
           counter.name AS counter_account, e.description, COALESCE(party.name, '') AS party,
           e.debit_usd, e.credit_usd, e.debit_cdf, e.credit_cdf, e.amount, e.currency, e.exchange_rate, e.created_by
    FROM accounting_entries e
    LEFT JOIN chart_of_accounts a ON a.id = e.account_id
    ${PARTY_JOIN}
    ${COUNTER_JOIN}
    WHERE ${whereClause(query)}
    ORDER BY e.entry_date ${order}, e.id ${order}
    ${limit} ${offset}
  `);
  return (result.rows as RawLine[]).map(toLine);
}

export async function countLedgerLines(query: LedgerQuery = {}, executor: DbExecutor = db): Promise<number> {
  const result = await executor.execute(sql`
    SELECT COUNT(*) AS total
    FROM accounting_entries e
    LEFT JOIN chart_of_accounts a ON a.id = e.account_id
    ${query.search ? PARTY_JOIN : sql``}
    WHERE ${whereClause(query)}
  `);
  return Number((result.rows[0] as { total?: unknown } | undefined)?.total ?? 0);
}

export interface MoneyBalance {
  /** Native USD notes/balance. */
  usd: number;
  /** Native CDF notes/balance. */
  cdf: number;
  /** Book value in USD at the rates locked on each entry. */
  bookUsd: number;
  bookCdf: number;
}

/** Native per-currency balance of money accounts (default: the cash drawer). */
export async function getMoneyBalance(
  options: { accountNames?: readonly string[]; asOf?: Date; before?: Date } = {},
  executor: DbExecutor = db,
): Promise<MoneyBalance> {
  const names = (options.accountNames ?? [ACCOUNTS.CASH]).map((name) => normalizeName(name).toLowerCase());
  const result = await executor.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN e.currency = 'USD' THEN (CASE WHEN e.debit_usd > 0 OR e.debit_cdf > 0 THEN e.amount ELSE -e.amount END) ELSE 0 END), 0) AS usd,
      COALESCE(SUM(CASE WHEN e.currency = 'CDF' THEN (CASE WHEN e.debit_usd > 0 OR e.debit_cdf > 0 THEN e.amount ELSE -e.amount END) ELSE 0 END), 0) AS cdf,
      COALESCE(SUM(e.debit_usd - e.credit_usd), 0) AS book_usd,
      COALESCE(SUM(e.debit_cdf - e.credit_cdf), 0) AS book_cdf
    FROM accounting_entries e
    JOIN chart_of_accounts a ON a.id = e.account_id
    WHERE lower(a.name) IN (${sql.join(names.map((name) => sql`${name}`), sql`, `)})
      ${options.asOf ? sql`AND e.entry_date <= ${options.asOf}` : sql``}
      ${options.before ? sql`AND e.entry_date < ${options.before}` : sql``}
  `);
  const row = (result.rows[0] ?? {}) as Record<string, unknown>;
  return { usd: num(row.usd), cdf: num(row.cdf), bookUsd: num(row.book_usd), bookCdf: num(row.book_cdf) };
}

/** Value a native USD + CDF balance at today's rate. */
export function valueAtRate(balance: { usd: number; cdf: number }, rate: number): { balanceUsd: number; balanceCdf: number } {
  const cdfAsUsd = toUsdCdf(balance.cdf, "CDF", rate).amountUsd;
  const usdAsCdf = toUsdCdf(balance.usd, "USD", rate).amountCdf;
  return {
    balanceUsd: addMoney(balance.usd, cdfAsUsd),
    balanceCdf: addMoney(balance.cdf, usdAsCdf),
  };
}

/**
 * Current drawer balance. `usd`/`cdf` are the notes physically expected in the
 * drawer per currency; `balanceUsd`/`balanceCdf` value both at today's rate.
 */
export async function getCurrentBalance(executor: DbExecutor = db) {
  const [balance, rate] = await Promise.all([getMoneyBalance({}, executor), getExchangeRate(executor)]);
  return { ...valueAtRate(balance, rate), nativeUsd: balance.usd, nativeCdf: balance.cdf, bookUsd: balance.bookUsd, rate };
}

export interface CashMovement {
  entryId: number;
  journalId: string;
  sourceType: string;
  sourceId: number | null;
  sourceNumber: string | null;
  date: Date;
  direction: "in" | "out";
  category: string;
  amount: number;
  currency: "USD" | "CDF";
  exchangeRate: number;
  amountUsd: number;
  amountCdf: number;
  description: string;
  party: string;
  account: string;
  createdBy: string | null;
}

export function lineToMovement(line: LedgerLine): CashMovement {
  const direction = line.side === "debit" ? "in" : "out";
  return {
    entryId: line.entryId,
    journalId: line.journalId,
    sourceType: line.sourceType,
    sourceId: line.sourceId,
    sourceNumber: line.sourceNumber,
    date: line.date,
    direction,
    category: line.counterAccount || line.sourceBase,
    amount: line.amount,
    currency: line.currency,
    exchangeRate: line.exchangeRate,
    amountUsd: direction === "in" ? line.debitUsd : line.creditUsd,
    amountCdf: direction === "in" ? line.debitCdf : line.creditCdf,
    description: line.description,
    party: line.party,
    account: line.accountName,
    createdBy: line.createdBy,
  };
}

/** Movements of a money account (default Cash), oldest first. */
export async function getCashMovements(
  options: { accountNames?: readonly string[]; dateFrom?: Date; dateTo?: Date } = {},
  executor: DbExecutor = db,
): Promise<CashMovement[]> {
  const lines = await getLedgerLines({
    accountNames: options.accountNames ?? [ACCOUNTS.CASH],
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
  }, executor);
  return lines.map(lineToMovement);
}

/** Signed native change of a movement in its own currency. */
export function signedNative(movement: Pick<CashMovement, "direction" | "amount">): number {
  return movement.direction === "in" ? movement.amount : -movement.amount;
}

/** Running per-currency balance for a list of movements that starts at `opening`. */
export function withRunningBalance<T extends CashMovement>(
  movements: T[],
  opening: { usd: number; cdf: number },
): Array<T & { balanceUsd: number; balanceCdf: number }> {
  let usd = opening.usd;
  let cdf = opening.cdf;
  return movements.map((movement) => {
    if (movement.currency === "USD") usd = addMoney(usd, signedNative(movement));
    else cdf = addMoney(cdf, signedNative(movement));
    return { ...movement, balanceUsd: usd, balanceCdf: cdf };
  });
}

/** Sum of money in / out over a range (native per currency and USD book value). */
export function summarizeMovements(movements: CashMovement[]) {
  const summary = { inUsd: 0, outUsd: 0, inCdf: 0, outCdf: 0, inBookUsd: 0, outBookUsd: 0 };
  for (const movement of movements) {
    if (movement.direction === "in") {
      if (movement.currency === "USD") summary.inUsd = addMoney(summary.inUsd, movement.amount);
      else summary.inCdf = addMoney(summary.inCdf, movement.amount);
      summary.inBookUsd = addMoney(summary.inBookUsd, movement.amountUsd);
    } else {
      if (movement.currency === "USD") summary.outUsd = addMoney(summary.outUsd, movement.amount);
      else summary.outCdf = addMoney(summary.outCdf, movement.amount);
      summary.outBookUsd = addMoney(summary.outBookUsd, movement.amountUsd);
    }
  }
  return { ...summary, netBookUsd: subtractMoney(summary.inBookUsd, summary.outBookUsd) };
}
