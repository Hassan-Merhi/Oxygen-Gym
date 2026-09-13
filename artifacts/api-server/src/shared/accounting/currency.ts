import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db/schema";

export interface ConvertedMoney {
  amountUsd: number;
  amountCdf: number;
}

export async function getExchangeRate(): Promise<number> {
  const [settings] = await db.select({ rate: settingsTable.usdToCdfRate }).from(settingsTable);
  return settings?.rate ?? 2800;
}

export function toUsdCdf(amount: number, currency: string, rate: number): ConvertedMoney {
  const normalized = currency.toUpperCase();
  return {
    amountUsd: normalized === "USD" ? amount : amount / rate,
    amountCdf: normalized === "CDF" ? amount : amount * rate,
  };
}
