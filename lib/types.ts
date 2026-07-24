// API contracts — these mirror index.html's DATA shapes exactly.
// View components consume these; API routes produce them. Do not extend
// without updating both sides (and the wireframe contract).

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
    items: { code: string; name: string; sub: string; value: number; logo?: string | null }[];
  }[];
}

export interface BudgetData {
  month: string;           // '2026-01'
  monthLabel: string;      // 'JAN 2026'
  months: string[];        // all available months for the ‹ › nav
  income: { label: string; value: number }[];
  taxSetAside: number;
  totalIncome: number;
  totalLeftAfterFixed: number;
  fixed: { label: string; value: number }[];
  totalFixed: number;
  variable: { label: string; value: number }[];
  totalVariable: number;
  savings: {
    amount: number;
    cashPct: number; cashAmt: number;
    investedPct: number; investedAmt: number;
    grade: string; gradeColor: string;
  };
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
  institutions: { code: string; name: string; sub: string; status: "healthy" | "reauth"; last: string; logo?: string | null }[];
  itemsUsed: number;
  itemsTotal: number;
  manualAssets: { id: number; label: string; value: number }[];
  security: string[];
  plaidConfigured: boolean; // keys present in Keychain?
}
