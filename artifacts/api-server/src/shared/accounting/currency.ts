import type { DbExecutor } from "@workspace/db";
import { getExchangeRate as getRepositoryExchangeRate } from "../../repositories/settings";

export interface ConvertedMoney {
  amountUsd: number;
  amountCdf: number;
}

export function getExchangeRate(executor?: DbExecutor): Promise<number> {
  return getRepositoryExchangeRate(executor);
}

export function toUsdCdf(amount: number, currency: string, rate: number): ConvertedMoney {
  const normalized = currency.toUpperCase();
  return {
    amountUsd: normalized === "USD" ? amount : amount / rate,
    amountCdf: normalized === "CDF" ? amount : amount * rate,
  };
}
