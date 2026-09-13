import type { Plan } from "@workspace/db/schema";
import { convertCurrencyAmount } from "../../shared/accounting/currency";
import { money, subtractMoney } from "../../shared/accounting/decimal";

export function planPriceInCurrency(plan: Plan, currency: string, exchangeRate: number): number {
  return convertCurrencyAmount(money(plan.price), plan.currency ?? "USD", currency, exchangeRate);
}

export function calculateMemberBalance(planPrice: number, amountPaid: number, discount: number): number {
  return subtractMoney(subtractMoney(planPrice, discount), amountPaid);
}
