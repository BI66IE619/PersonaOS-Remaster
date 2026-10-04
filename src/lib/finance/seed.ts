import type { Category, Transaction } from "./types";
import { mulberry32 } from "@/lib/utils";
import { pad } from "@/lib/dates";

const SEED = 77;
const DAYS = 120;

export const CATEGORIES: Category[] = [
  { id: "food", label: "Food", color: "#fbbf24", kind: "expense" },
  { id: "transport", label: "Transport", color: "#22d3ee", kind: "expense" },
  { id: "subs", label: "Subscriptions", color: "#a78bfa", kind: "expense" },
  { id: "games", label: "Games", color: "#f472b6", kind: "expense" },
  { id: "school", label: "School", color: "#60a5fa", kind: "expense" },
  { id: "clothes", label: "Clothes", color: "#34d399", kind: "expense" },
  { id: "health", label: "Health", color: "#f87171", kind: "expense" },
  { id: "other", label: "Other", color: "#a9b0ba", kind: "expense" },
  { id: "job", label: "Job", color: "#4ade80", kind: "income" },
  { id: "gift", label: "Gift", color: "#fda4af", kind: "income" },
];

/** [min, max] cents, and how often a category fires on an average day. */
const SPEND: Record<string, { lo: number; hi: number; odds: number; labels: string[] }> = {
  food: { lo: 450, hi: 4_600, odds: 0.62, labels: ["Snack", "Lunch", "Groceries", "Coffee"] },
  transport: { lo: 250, hi: 3_200, odds: 0.34, labels: ["Bus pass", "Rideshare", "Fuel"] },
  games: { lo: 999, hi: 6_999, odds: 0.09, labels: ["Game", "DLC", "In-app"] },
  school: { lo: 500, hi: 6_200, odds: 0.11, labels: ["Supplies", "Books", "Project fee"] },
  clothes: { lo: 1_200, hi: 12_000, odds: 0.06, labels: ["T-shirt", "Hoodie", "Shoes"] },
  health: { lo: 400, hi: 4_500, odds: 0.07, labels: ["Pharmacy", "Gym", "Snack bar"] },
  other: { lo: 300, hi: 4_200, odds: 0.18, labels: ["Misc", "Gift", "Donation"] },
};

const SUBSCRIPTIONS = [
  { label: "Spotify", cents: 1_099, day: 3 },
  { label: "Netflix", cents: 1_599, day: 9 },
  { label: "PlayStation Plus", cents: 999, day: 15 },
  { label: "iCloud+", cents: 99, day: 21 },
];

/** Twice-monthly paycheque. */
const PAYDAY = [1, 16];
const PAY_CENTS = 48_000;

export function generateTransactions(now: Date = new Date()): Transaction[] {
  const rnd = mulberry32(SEED);
  const out: Transaction[] = [];
  const today = new Date(now);

  for (let back = DAYS - 1; back >= 0; back--) {
    const d = new Date(today);
    d.setDate(d.getDate() - back);
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const dow = d.getDay();
    const weekend = dow === 0 || dow === 6;

    for (const income of CATEGORIES.filter((c) => c.kind === "income")) {
      if (income.id === "job" && PAYDAY.includes(d.getDate())) {
        const jitter = Math.round((rnd() - 0.5) * 1_600);
        out.push({
          id: `t-${date}-job`,
          date,
          amountCents: PAY_CENTS + jitter,
          categoryId: "job",
          note: "Paycheque",
        });
      }
      if (income.id === "gift" && rnd() < 0.012) {
        out.push({
          id: `t-${date}-gift`,
          date,
          amountCents: 2_000 + Math.round(rnd() * 18_000),
          categoryId: "gift",
          note: "Birthday money",
        });
      }
    }

    for (const sub of SUBSCRIPTIONS) {
      if (d.getDate() === sub.day) {
        out.push({
          id: `t-${date}-${sub.label}`,
          date,
          amountCents: -sub.cents,
          categoryId: "subs",
          note: sub.label,
          recurring: true,
        });
      }
    }

    for (const [id, cfg] of Object.entries(SPEND)) {
      // Weekends carry most discretionary spending.
      const p = cfg.odds * (weekend && id !== "transport" ? 1.5 : 1);
      if (rnd() < p) {
        const span = cfg.hi - cfg.lo;
        const cents = Math.round(cfg.lo + rnd() * span);
        const label = cfg.labels[Math.floor(rnd() * cfg.labels.length)];
        out.push({
          id: `t-${date}-${id}-${Math.floor(rnd() * 1e6)}`,
          date,
          amountCents: -cents,
          categoryId: id,
          note: label,
        });
      }
    }
  }

  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
