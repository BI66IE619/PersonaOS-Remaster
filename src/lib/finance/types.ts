export type CategoryKind = "income" | "expense";

export type Category = {
  id: string;
  label: string;
  color: string;
  kind: CategoryKind;
};

export type Transaction = {
  id: string;
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  /** Signed cents. Positive is money in, negative is money out. */
  amountCents: number;
  categoryId: string;
  note: string;
  /** True for generated subscriptions so they can be surfaced separately. */
  recurring?: boolean;
};

export type CategoryTotal = {
  id: string;
  label: string;
  color: string;
  cents: number;
  /** Share of the month's total spend, 0 to 1. */
  pct: number;
};

export type MoneyView = {
  /** YYYY-MM */
  month: string;
  incomeCents: number;
  spentCents: number;
  netCents: number;
  /** Largest single category total, used to scale the category bars. */
  topCents: number;
  byCategory: CategoryTotal[];
  transactions: Transaction[];
  /** Running net across the month, for the trend line. */
  cumulative: { date: string; cents: number }[];
  subscriptions: { label: string; cents: number; cadence: "monthly" | "yearly" }[];
  topMerchants: { label: string; cents: number }[];
  /** Net worth across the whole history window. */
  balanceCents: number;
};

export interface FinanceProvider {
  getMonth(ref: Date): Promise<MoneyView>;
}
