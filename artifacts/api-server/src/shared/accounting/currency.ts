import type { DbExecutor } from "@workspace/db";
import { getExchangeRate as getRepositoryExchangeRate } from "../../repositories/settings";
import { divideMoney, fxRate, money, multiplyMoney } from "./decimal";

export interface ConvertedMoney {
  amountUsd: number;
  amountCdf: number;
}

const EXCHANGE_RATE_CACHE_TTL_MS = 5_000;
let cachedExchangeRate: { value: number; expiresAt: number } | undefined;
let exchangeRateInflight: Promise<number> | undefined;

export async function getExchangeRate(executor?: DbExecutor): Promise<number> {
  // Transactional callers must read through their transaction so accounting
  // writes keep their existing consistency semantics.
  if (executor) return fxRate(await getRepositoryExchangeRate(executor));

  const now = Date.now();
  if (cachedExchangeRate && cachedExchangeRate.expiresAt > now) {
    return cachedExchangeRate.value;
  }

  // Many screens request several finance-backed endpoints in parallel. Collapse
  // their identical settings-table reads and keep the result for only a few
  // seconds so an exchange-rate edit still becomes visible almost immediately.
  if (exchangeRateInflight) return exchangeRateInflight;
  exchangeRateInflight = getRepositoryExchangeRate()
    .then((rawRate) => {
      const value = fxRate(rawRate);
      cachedExchangeRate = { value, expiresAt: Date.now() + EXCHANGE_RATE_CACHE_TTL_MS };
      return value;
    })
    .finally(() => {
      exchangeRateInflight = undefined;
    });

  return exchangeRateInflight;
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
