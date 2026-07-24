import type Database from "better-sqlite3-multiple-ciphers";
import { db } from "./db";

// Derivation layer: linked-connection data → the three views.
// - Net worth: already derived (accounts+balances → latestBalances).
// - Cash Flow variable spending: transactions → category sums (this file).
// - Subscriptions: recurring-charge detection over transactions (this file).
// Runs at the end of every Plaid sync; everything is idempotent.

/* ── categorization (plan T4.2) ─────────────────────────────────────────── */

// Starter rules: substring (LIKE) patterns → her 13 categories. Corrections
// made in the app become new rows in category_rules and win over these.
const DEFAULT_RULES: [pattern: string, category: string][] = [
  ["grocery", "Groceries"], ["market", "Groceries"], ["trader joe", "Groceries"],
  ["whole foods", "Groceries"], ["safeway", "Groceries"], ["costco", "Groceries"],
  ["restaurant", "Eat Out"], ["cafe", "Eat Out"], ["coffee", "Eat Out"],
  ["doordash", "Eat Out"], ["ubereats", "Eat Out"], ["grubhub", "Eat Out"],
  ["pizza", "Eat Out"], ["sushi", "Eat Out"], ["taco", "Eat Out"],
  ["cinema", "Events / Ent."], ["theatre", "Events / Ent."], ["ticketmaster", "Events / Ent."],
  ["autozone", "Car Mainten."], ["jiffy lube", "Car Mainten."], ["mechanic", "Car Mainten."],
  ["home depot", "Misc. / Maint / Home"], ["lowes", "Misc. / Maint / Home"], ["ikea", "Misc. / Maint / Home"],
  ["petco", "Pets"], ["petsmart", "Pets"], ["chewy", "Pets"],
  ["shell", "Car Gas"], ["chevron", "Car Gas"], ["exxon", "Car Gas"], ["76 ", "Car Gas"], ["arco", "Car Gas"],
  ["parking", "Travel / Parking"], ["airline", "Travel / Parking"], ["airbnb", "Travel / Parking"],
  ["hotel", "Travel / Parking"], ["lyft", "Travel / Parking"], ["uber", "Travel / Parking"],
  ["amazon", "Shopping / Personal"], ["target", "Shopping / Personal"], ["sephora", "Shopping / Personal"],
  ["udemy", "Education / Training"], ["coursera", "Education / Training"],
  ["spotify", "Apps / Subs"], ["netflix", "Apps / Subs"], ["hulu", "Apps / Subs"],
  ["apple.com", "Apps / Subs"], ["google", "Apps / Subs"], ["openai", "Apps / Subs"],
  ["interest", "Interest Fees / Violations"], ["late fee", "Interest Fees / Violations"],
  ["overdraft", "Interest Fees / Violations"], ["citation", "Interest Fees / Violations"],
];

/** Ensure starter rules exist (idempotent — skips if any rules present). */
function seedDefaultRules(d: Database.Database = db()): void {
  const count = (d.prepare(`SELECT COUNT(*) c FROM category_rules`).get() as { c: number }).c;
  if (count > 0) return;
  const cat = d.prepare(`SELECT id FROM categories WHERE name = ?`);
  const ins = d.prepare(`INSERT INTO category_rules (pattern, field, category_id) VALUES (?, 'merchant', ?)`);
  for (const [pattern, name] of DEFAULT_RULES) {
    const row = cat.get(name) as { id: number } | undefined;
    if (row) ins.run(pattern, row.id);
  }
}

/** Apply rules to every uncategorized transaction. Longest pattern wins
 *  (most specific). Returns how many got a category. */
export function categorizeTransactions(d: Database.Database = db()): number {
  seedDefaultRules(d);
  const rules = (d.prepare(
    `SELECT pattern, category_id FROM category_rules ORDER BY LENGTH(pattern) DESC`,
  ).all() as { pattern: string; category_id: number }[]);

  const uncat = d.prepare(
    `SELECT id, name, merchant FROM transactions WHERE category_id IS NULL AND pending = 0`,
  ).all() as { id: number; name: string | null; merchant: string | null }[];

  const upd = d.prepare(`UPDATE transactions SET category_id = ? WHERE id = ?`);
  let hits = 0;
  for (const t of uncat) {
    const hay = `${t.merchant ?? ""} ${t.name ?? ""}`.toLowerCase();
    const rule = rules.find((r) => hay.includes(r.pattern.toLowerCase()));
    if (rule) { upd.run(rule.category_id, t.id); hits++; }
  }
  return hits;
}

/* ── budget derivation (plan T4.3) ──────────────────────────────────────── */

export interface DerivedVariable {
  variable: { label: string; value: number }[];
  totalVariable: number;
  txnCount: number;
  uncategorized: number;
}

/** Per-category spending sums from transactions for a month ('2026-07').
 *  Plaid convention: positive amount = money out. Credit-card payments and
 *  transfers aren't spending — rules never map them, so they stay
 *  uncategorized and OUT of the category sums (visible via `uncategorized`). */
export function variableFromTransactions(month: string, d: Database.Database = db()): DerivedVariable {
  const cats = d.prepare(`SELECT id, name FROM categories ORDER BY sort ASC`).all() as
    { id: number; name: string }[];

  const sums = d.prepare(
    `SELECT category_id, ROUND(SUM(amount), 2) total, COUNT(*) n
     FROM transactions
     WHERE date LIKE ? AND pending = 0 AND amount > 0
     GROUP BY category_id`,
  ).all(`${month}%`) as { category_id: number | null; total: number; n: number }[];

  const byId = new Map(sums.filter((s) => s.category_id !== null).map((s) => [s.category_id, s]));
  const uncatRow = sums.find((s) => s.category_id === null);

  const variable = cats.map((c) => ({
    label: c.name,
    value: byId.get(c.id)?.total ?? 0,
  }));
  const totalVariable = Math.round(variable.reduce((s, v) => s + v.value, 0) * 100) / 100;
  const txnCount = sums.reduce((s, r) => s + r.n, 0);

  return { variable, totalVariable, txnCount, uncategorized: uncatRow?.n ?? 0 };
}

/* ── recurring detection (plan T5.1) ────────────────────────────────────── */

/** Group by merchant, look for ≥3 charges with ~monthly (25–35d) or ~annual
 *  (330–400d) spacing and amounts within ±15% of their median. New finds are
 *  inserted with status='detected' → they surface in the Subscriptions view's
 *  "Newly Detected" card for confirm/dismiss. Idempotent: names already in
 *  the subscriptions table (any status) are never re-inserted. */
export function detectRecurring(d: Database.Database = db()): number {
  const rows = d.prepare(
    `SELECT COALESCE(NULLIF(TRIM(merchant), ''), name) who, date, amount
     FROM transactions WHERE pending = 0 AND amount > 0 ORDER BY who, date`,
  ).all() as { who: string | null; date: string; amount: number }[];

  const known = new Set(
    (d.prepare(`SELECT name FROM subscriptions`).all() as { name: string }[])
      .map((r) => r.name.toLowerCase()),
  );

  const groups = new Map<string, { date: string; amount: number }[]>();
  for (const r of rows) {
    if (!r.who) continue;
    const k = r.who.trim();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push({ date: r.date, amount: r.amount });
  }

  const ins = d.prepare(
    `INSERT INTO subscriptions (name, amount, day, cadence, kind, renewal, approx, status)
     VALUES (?, ?, ?, ?, 'subscription', ?, ?, 'detected')`,
  );

  let found = 0;
  for (const [who, txns] of groups) {
    if (txns.length < 3 || known.has(who.toLowerCase())) continue;

    const amounts = [...txns.map((t) => t.amount)].sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    if (!txns.every((t) => Math.abs(t.amount - median) <= median * 0.15)) continue;

    const days = txns.map((t) => new Date(t.date).getTime());
    const gaps: number[] = [];
    for (let i = 1; i < days.length; i++) gaps.push((days[i] - days[i - 1]) / 86400000);
    const monthly = gaps.every((g) => g >= 25 && g <= 35);
    const annual = gaps.every((g) => g >= 330 && g <= 400);
    if (!monthly && !annual) continue;

    const lastDate = txns[txns.length - 1].date;
    const dayOfMonth = parseInt(lastDate.slice(8, 10), 10);
    const renewal = annual
      ? ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][parseInt(lastDate.slice(5, 7), 10) - 1]
      : null;
    const approx = txns.every((t) => t.amount === txns[0].amount) ? 0 : 1;

    ins.run(who, median, dayOfMonth, monthly ? "monthly" : "annual", renewal, approx);
    found++;
  }
  return found;
}

/** Full post-sync derivation pass. */
export function deriveAll(d: Database.Database = db()): { categorized: number; detected: number } {
  const categorized = categorizeTransactions(d);
  const detected = detectRecurring(d);
  return { categorized, detected };
}
