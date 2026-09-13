import type { DbExecutor } from "@workspace/db";
import { getExchangeRate as getRepositoryExchangeRate } from "../../repositories/settings";
import { divideMoney, fxRate, money, multiplyMoney } from "./decimal";

export interface ConvertedMoney {
  amountUsd: number;
  amountCdf: number;
}

export async function getExchangeRate(executor?: DbExecutor): Promise<number> {
  return fxRate(await getRepositoryExchangeRate(executor));
}

export function toUsdCdf(amount: number, currency: string, rate: number): ConvertedMoney {
  const normalized = currency.toUpperCase();
  const normalizedAmount = money(amount);
  const lockedRate = fxRate(rate);
  if (normalized !== "USD" && normalized !== "CDF") {
    throw new Error(`Unsupported accounting currency: ${currency}`);
  }
  return {
    amountUsd: normalized === "USD" ? normalizedAmount : divideMoney(normalizedAmount, lockedRate),
    amountCdf: normalized === "CDF" ? normalizedAmount : multiplyMoney(normalizedAmount, lockedRate),
  };
}

export function convertCurrencyAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rate: number,
): number {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  if (from === to) return money(amount);
  if (from === "USD" && to === "CDF") return multiplyMoney(amount, fxRate(rate));
  if (from === "CDF" && to === "USD") return divideMoney(amount, fxRate(rate));
  throw new Error(`Unsupported currency conversion: ${fromCurrency} -> ${toCurrency}`);
}
