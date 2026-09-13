import { db, type DbExecutor } from "@workspace/db";
import { settingsTable } from "@workspace/db/schema";

export interface FinancialSettings {
  usdToCdfRate: number;
  defaultCurrency: string;
}

export async function getFinancialSettings(
  executor: DbExecutor = db,
): Promise<FinancialSettings> {
  const [row] = await executor
    .select({
      rate: settingsTable.usdToCdfRate,
      defaultCurrency: settingsTable.defaultCurrency,
    })
    .from(settingsTable)
    .limit(1);

  const candidateRate = Number(row?.rate ?? 2800);
  return {
    usdToCdfRate: Number.isFinite(candidateRate) && candidateRate > 0 ? candidateRate : 2800,
    defaultCurrency: row?.defaultCurrency ?? "USD",
  };
}

export async function getExchangeRate(executor: DbExecutor = db): Promise<number> {
  return (await getFinancialSettings(executor)).usdToCdfRate;
}
