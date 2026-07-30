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
/** Demo/bootstrap transaction. `monthOffset` is relative to the seed month
 *  (0 = current, -1 = last month …) so demo data always covers "now". */
export interface SeedTransaction {
  accountCode: string;   // matches SeedAccount.code (+ mask when ambiguous)
  accountMask?: string;
  monthOffset: number;
  day: number;
  name: string;
  merchant: string;
  amount: number;        // Plaid convention: positive = money out
}
export interface SeedConfig {
  accounts: SeedAccount[];
  categories: string[];
  budgetMonths: SeedBudgetMonth[];
  subscriptions: SeedSubscription[];
  transactions?: SeedTransaction[];
}

// Spend categories. App scaffolding, not user data — a blank install seeds
// these and nothing else, so transactions have somewhere to land before the
// user has linked anything. Split into two groups (Cash Flow contract):
//   need — recurring obligations: housing, utilities, insurance, subscriptions
//   want — discretionary: everything else, AI/rules-categorized
export const NEED_CATEGORIES = [
  "Rent / Housing", "Utilities", "Phone / Internet", "Insurance",
  "Medical / Health", "Apps / Subs",
];
export const WANT_CATEGORIES = [
  "Groceries", "Eat Out", "Events / Ent.", "Car Mainten.", "Misc. / Maint / Home",
  "Pets", "Gifts", "Car Gas", "Travel / Parking", "Shopping / Personal",
  "Education / Training", "Interest Fees / Violations",
];
export const DEFAULT_CATEGORIES = [...NEED_CATEGORIES, ...WANT_CATEGORIES];

// Grade computation lives in lib/format.ts (gradeFor) — single source.

/** Fake, publishable demo data — used only when no seed.local.json exists. */
export const DEMO_SEED: SeedConfig = {
  accounts: [
    { code: "CH", name: "Demo Checking", institution: "First Bank", sub: "First Bank", kind: "cash", is_liability: 0, value: 4200.0 },
    { code: "SV", name: "High-Yield Savings", institution: "Marcus", sub: "Marcus", kind: "cash", is_liability: 0, value: 12500.0 },
    // Venmo: cash kind but a SPENDING source in the Cash Flow contract —
    // inflows there are reimbursements/transfers, never income.
    { code: "VM", name: "Venmo", institution: "Venmo", sub: "Venmo", kind: "cash", is_liability: 0, value: 86.4 },
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
  categories: DEFAULT_CATEGORIES,
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
  // Fake ledger exercising every Cash Flow classification path:
  //   income (payroll into checking) · needs paid from checking (rent, PG&E,
  //   internet) · needs on the card (streaming) · wants on the card
  //   (groceries, eat out, gas, shopping) · Venmo spend · a checking↔card
  //   autopay TRANSFER PAIR that must cancel out of both sides · one
  //   unknown merchant that stays uncategorized until a rule/AI names it.
  transactions: demoLedger(),
};

function demoLedger(): SeedTransaction[] {
  const monthly: Omit<SeedTransaction, "monthOffset">[] = [
    // income → Demo Checking (Plaid: negative = money in)
    { accountCode: "CH", day: 1,  name: "ACME CORP DIRECT DEP PAYROLL", merchant: "Acme Corp", amount: -2600.0 },
    { accountCode: "CH", day: 15, name: "ACME CORP DIRECT DEP PAYROLL", merchant: "Acme Corp", amount: -2600.0 },
    // needs paid straight from checking
    { accountCode: "CH", day: 2,  name: "OAKWOOD PROPERTIES RENT ACH", merchant: "Oakwood Properties", amount: 1850.0 },
    { accountCode: "CH", day: 18, name: "PG&E WEB ONLINE PAYMENT", merchant: "PG&E", amount: 138.7 },
    { accountCode: "CH", day: 8,  name: "COMCAST XFINITY INTERNET", merchant: "Comcast", amount: 60.0 },
    // transfer pair: checking pays the Travel Card — must vanish from BOTH sides
    { accountCode: "CH", day: 20, name: "FIRST BANK CREDIT CRD AUTOPAY", merchant: "First Bank Card Payment", amount: 640.25 },
    { accountCode: "TC", accountMask: "1187", day: 20, name: "PAYMENT THANK YOU - WEB", merchant: "Payment Thank You", amount: -640.25 },
    // needs on the card
    { accountCode: "TC", accountMask: "1187", day: 12, name: "STREAMFLIX.COM SUBSCRIPTION", merchant: "Netflix", amount: 15.99 },
    // wants on the card
    { accountCode: "TC", accountMask: "1187", day: 4,  name: "TRADER JOE'S #112", merchant: "Trader Joe's", amount: 84.3 },
    { accountCode: "TC", accountMask: "1187", day: 16, name: "TRADER JOE'S #112", merchant: "Trader Joe's", amount: 91.15 },
    { accountCode: "RC", accountMask: "2043", day: 6,  name: "DOORDASH*THAI PALACE", merchant: "DoorDash", amount: 38.6 },
    { accountCode: "RC", accountMask: "2043", day: 21, name: "SHELL OIL 5744", merchant: "Shell", amount: 52.4 },
    { accountCode: "RC", accountMask: "2043", day: 24, name: "AMAZON MKTPL*88YT2", merchant: "Amazon", amount: 47.9 },
    // Venmo = spending source; its cash-in is a transfer, never income
    { accountCode: "VM", day: 10, name: "VENMO PAYMENT SAM R", merchant: "Venmo", amount: 45.0 },
    { accountCode: "VM", day: 11, name: "VENMO CASHOUT FROM BANK", merchant: "Venmo", amount: -60.0 },
    // unknown merchant → uncategorized queue until a rule or AI names it
    { accountCode: "RC", accountMask: "2043", day: 14, name: "BLUE TOKAI ROASTERS SF", merchant: "Blue Tokai Roasters", amount: 21.5 },
  ];
  const out: SeedTransaction[] = [];
  for (const monthOffset of [-2, -1, 0]) {
    for (const t of monthly) out.push({ ...t, monthOffset });
  }
  return out;
}
