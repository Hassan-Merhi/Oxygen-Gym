import type { Plan } from "@workspace/db/schema";

export function planPriceInCurrency(plan: Plan, currency: string, exchangeRate: number): number {
  const planCurrency = plan.currency ?? "USD";
  if (planCurrency === currency) return plan.price;
  if (planCurrency === "CDF" && currency === "USD") return plan.price / exchangeRate;
  if (planCurrency === "USD" && currency === "CDF") return plan.price * exchangeRate;
  return plan.price;
}

export function calculateMemberBalance(planPrice: number, amountPaid: number, discount: number): number {
  return planPrice - discount - amountPaid;
}
