// Number formatting — product-designer skill rules.
// True minus sign (U+2212), cents on statement amounts, whole dollars on deltas.
export const usd = (n: number) =>
  (n < 0 ? "−$" : "$") +
  Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const usd0 = (n: number) =>
  (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

/** '2026-01' → 'JAN 2026' (sheet-tab style) */
export const monthLabel = (m: string) => {
  const [y, mo] = m.split("-");
  const names = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  return `${names[parseInt(mo, 10) - 1]} ${y}`;
};

/** Month-key shape guard ('2026-01'). Single source — was duplicated in
 *  budget-ops, budget/route, sheet-io, db seed (audit P3). */
export const isValidMonthKey = (m: unknown): m is string =>
  typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

/** Budget grade from the variable/income ratio, with the two guard cases a
 *  ratio alone can't express. Single source — was reimplemented three times
 *  with drifting edge behavior (audit P2). Colors: GOOD green, BAD red,
 *  --warn yellow; "—" when the month has no income yet. */
export function gradeFor(
  totalIncome: number,
  totalVariable: number,
  savings: number,
): { grade: string; gradeColor: string } {
  // Raw hex, not var(--good) etc — those names collide with shadcn's theme
  // variables, so a var()-with-fallback silently resolves to the WRONG value.
  // Kept in step with lib/colors.ts — all AA-safe (4.5:1) on white/#f2f3f5.
  const GOODC = "#3b764e";
  const BADC = "#b04a3f";
  if (totalIncome <= 0) return { grade: "—", gradeColor: "#686d76" };
  if (savings < 0) return { grade: "Very Bad", gradeColor: BADC };
  const ratio = totalVariable / totalIncome;
  if (ratio < 0.15) return { grade: "Great", gradeColor: GOODC };
  if (ratio < 0.20) return { grade: "Good", gradeColor: GOODC };
  if (ratio < 0.25) return { grade: "Okay", gradeColor: "#8a6410" };
  if (ratio < 0.30) return { grade: "Bad", gradeColor: BADC };
  return { grade: "Very Bad", gradeColor: BADC };
}
