// Seed configuration — the shape of first-run data.
// REAL data lives at ~/FinanceTracker/seed.local.json (outside any repo, next
// to the DB). The DEMO_SEED below is intentionally fake and safe to publish.
// Totals (income/fixed/variable/savings/grade) are COMPUTED from the arrays at
// seed time, never hardcoded — so a config can't be internally inconsistent.

export interface SeedAccount {
  code: string; name: string; institution: string; sub: string;
  kind: "cash" | "investment" | "credit" | "manual";
  is_liability: 0 | 1; value: number;
  /** last 4 — the only thing separating two cards an issuer names identically */
  mask?: string;
  /** if set, also tracked as a manual asset with value history */
  manualLabel?: string;
}
export interface SeedBudgetMonth {
  month: string; // '2026-01'
  income: { label: string; value: number }[];
  taxSetAside: number;
  fixed: { label: string; value: number }[];
  variable: { label: string; value: number }[];
  cashPct: number | null; cashAmt: number | null;
  investedPct: number | null; investedAmt: number | null;
  source: "sheet" | "app";
}
export interface SeedSubscription {
  name: string; amount: number; day: number;
  cadence: "monthly" | "annual";
  kind: "subscription" | "bill" | "fee";
  renewal: string | null; approx: 0 | 1;
}
export interface SeedConfig {
  accounts: SeedAccount[];
  categories: string[];
  budgetMonths: SeedBudgetMonth[];
  subscriptions: SeedSubscription[];
}

// Grade computation lives in lib/format.ts (gradeFor) — single source.

/** Fake, publishable demo data — used only when no seed.local.json exists. */
export const DEMO_SEED: SeedConfig = {
  accounts: [
    { code: "CH", name: "Demo Checking", institution: "First Bank", sub: "First Bank", kind: "cash", is_liability: 0, value: 4200.0 },
    { code: "SV", name: "High-Yield Savings", institution: "Marcus", sub: "Marcus", kind: "cash", is_liability: 0, value: 12500.0 },
    { code: "BT", name: "Bitcoin", institution: "", sub: "0.10 BTC", kind: "manual", is_liability: 0, value: 6800.0, manualLabel: "Bitcoin · 0.10 BTC" },
    { code: "CC", name: "Comic Collection", institution: "", sub: "", kind: "manual", is_liability: 0, value: 350.0, manualLabel: "Comic Collection" },
    { code: "VG", name: "Brokerage", institution: "Vanguard", sub: "Vanguard", kind: "investment", is_liability: 0, value: 22400.0 },
    { code: "VG", name: "Roth IRA", institution: "Vanguard", sub: "Vanguard", kind: "investment", is_liability: 0, value: 9100.0 },
    { code: "EM", name: "401(k)", institution: "Employer", sub: "Employer", kind: "investment", is_liability: 0, value: 18750.0 },
    { code: "TC", name: "Travel Card", institution: "First Bank", sub: "First Bank", kind: "credit", is_liability: 1, value: -640.25, mask: "1187" },
    { code: "RC", name: "Rewards Card", institution: "First Bank", sub: "First Bank", kind: "credit", is_liability: 1, value: -120.8, mask: "2043" },
    // Two cards, one generic issuer name — real issuers do this (both of a
    // Chase pair arrive as "CREDIT CARD"/"Ultimate Rewards®"). Kept in the
    // demo seed so the mask disambiguation stays exercised without real data.
    { code: "SB", name: "CREDIT CARD", institution: "Second Bank", sub: "Premier Rewards", kind: "credit", is_liability: 1, value: -310.4, mask: "6612" },
    { code: "SB", name: "CREDIT CARD", institution: "Second Bank", sub: "Premier Rewards", kind: "credit", is_liability: 1, value: -1875.6, mask: "9908" },
  ],
  categories: [
    "Groceries", "Eat Out", "Events / Ent.", "Car Mainten.", "Misc. / Maint / Home",
    "Pets", "Gifts", "Car Gas", "Travel / Parking", "Shopping / Personal",
    "Education / Training", "Apps / Subs", "Interest Fees / Violations",
  ],
  budgetMonths: [
    {
      month: "2026-01",
      income: [{ label: "Salary", value: 5200.0 }, { label: "Freelance", value: 800.0 }],
      taxSetAside: 0,
      fixed: [
        { label: "Rent", value: 1850.0 }, { label: "Utilities", value: 140.0 },
        { label: "Internet", value: 60.0 }, { label: "Gym", value: 42.0 },
        { label: "Streaming", value: 15.99 }, { label: "Cloud Storage", value: 2.99 },
      ],
      variable: [
        { label: "Groceries", value: 310.5 }, { label: "Eat Out", value: 184.2 },
        { label: "Events / Ent.", value: 45.0 }, { label: "Car Mainten.", value: 0 },
        { label: "Misc. / Maint / Home", value: 62.3 }, { label: "Pets", value: 0 },
        { label: "Gifts", value: 25.0 }, { label: "Car Gas", value: 96.4 },
        { label: "Travel / Parking", value: 18.0 }, { label: "Shopping / Personal", value: 71.6 },
        { label: "Education / Training", value: 0 }, { label: "Apps / Subs", value: 9.99 },
        { label: "Interest Fees / Violations", value: 0 },
      ],
      cashPct: 70, cashAmt: null, investedPct: 30, investedAmt: null,
      source: "app",
    },
  ],
  subscriptions: [
    { name: "Cloud Storage", amount: 2.99, day: 9, cadence: "monthly", kind: "subscription", renewal: null, approx: 0 },
    { name: "Streaming", amount: 15.99, day: 12, cadence: "monthly", kind: "subscription", renewal: null, approx: 0 },
    { name: "Gym", amount: 42.0, day: 15, cadence: "monthly", kind: "subscription", renewal: null, approx: 0 },
    { name: "Rent", amount: 1850.0, day: 1, cadence: "monthly", kind: "bill", renewal: null, approx: 0 },
    { name: "Utilities", amount: 140.0, day: 20, cadence: "monthly", kind: "bill", renewal: null, approx: 1 },
    { name: "Travel Card", amount: 95.0, day: 12, cadence: "annual", kind: "fee", renewal: "Apr", approx: 0 },
  ],
};
