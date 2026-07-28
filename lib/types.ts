// API contracts — these mirror index.html's DATA shapes exactly.
// View components consume these; API routes produce them. Do not extend
// without updating both sides (and the wireframe contract).

import type { AssetIconKey } from "@/lib/asset-icons";

export interface NetworthData {
  total: number;
  deltaAbs: number;
  deltaPct: number;
  range: string;
  chart: { points: { date: string; total: number }[] };
  allocation: { label: string; value: number; color: string }[];
  allocation30d: string;
  assets: number;
  liabilities: number;
  groups: {
    name: string;
    type: "asset" | "liability";
    items: { id: number; code: string; name: string; sub: string; value: number; logo?: string | null; mask?: string | null; kind?: string; ambiguous?: boolean }[];
  }[];
}

export interface SubscriptionsData {
  month: string;
  monthLabel: string;
  firstDow: number;
  daysInMonth: number;
  events: Record<number, { name: string; bill: boolean }[]>;
  thisMonth: { subs: number; bills: number; total: number };
  annualFees: { label: string; fee: number; when: string }[];
  newlyDetected: { id: number; name: string; value: string }[];
}

export interface ConnectionsData {
  institutions: { code: string; name: string; sub: string; status: "healthy" | "reauth"; last: string; health: "good" | "stale" | "error"; healthReason: string; logo?: string | null }[];
  itemsUsed: number;
  itemsTotal: number;
  manualAssets: { id: number; label: string; value: number; icon: AssetIconKey }[];
  security: string[];
  plaidConfigured: boolean; // keys present in Keychain?
}

export interface CashflowTxn {
  id: number;
  date: string;   // '2026-07-21'
  label: string;  // merchant if set, else name
  value: number;  // display sign: positive dollars for both income and expenses
}

export interface CashflowRow {
  label: string;          // category (expenses) or payer (income)
  value: number;
  txns: CashflowTxn[];    // empty for stored/sheet months → no drill-down
  grp?: "need" | "want";  // expense rows only — income rows omit this key
}

export interface CashflowData {
  month: string;          // '2026-07'
  monthLabel: string;     // 'JUL 2026'
  months: string[];       // all months for the ‹ › nav
  source: "derived" | "stored";
  income: CashflowRow[];
  totalIncome: number;
  expenses: CashflowRow[]; // flat, ranked by value desc
  totalExpenses: number;
  totalNeeds: number;      // for the allocation bar
  totalWants: number;
  saved: number;           // totalIncome − totalExpenses
}
