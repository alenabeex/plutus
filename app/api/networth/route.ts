import { NextRequest } from "next/server";
import { requireUnlocked, withRefreshedSession } from "@/lib/auth";
import { db, latestBalances, snapshotNetworth } from "@/lib/db";
import type { NetworthData } from "@/lib/types";

export const runtime = "nodejs";

// Mockup group ordering and allocation colors
const GROUP_ORDER = ["Cash", "Manual Assets", "Investments", "Credit Cards"];
const ALLOCATION_COLORS: Record<string, string> = {
  Investments: "#16181d",
  "Manual Assets": "#8a8f98",
  Cash: "#c2c6cc",
  "Credit Cards": "#e3e5e9",
};

// "Venmo / Cash" is a manual account that belongs in the Cash group per mockup
function accountGroup(
  row: { name: string; kind: string; is_liability: number }
): string {
  if (row.is_liability) return "Credit Cards";
  if (row.name === "Venmo / Cash") return "Cash";
  if (row.kind === "cash") return "Cash";
  if (row.kind === "manual") return "Manual Assets";
  if (row.kind === "investment") return "Investments";
  return "Manual Assets";
}

export async function GET(req: NextRequest) {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const d = db();
  const rows = latestBalances(d);

  // Build groups
  const groupMap = new Map<string, { name: string; type: "asset" | "liability"; items: { code: string; name: string; sub: string; value: number; logo: string | null }[] }>();
  for (const name of GROUP_ORDER) {
    groupMap.set(name, { name, type: name === "Credit Cards" ? "liability" : "asset", items: [] });
  }
  for (const row of rows) {
    const g = accountGroup(row);
    const group = groupMap.get(g)!;
    // Manual assets encode detail in the label ("Bitcoin · 0.25 BTC",
    // "Masterworks — Ed Ruscha") — split at the first separator into
    // title + subtitle so the view renders one line each.
    let name = row.name;
    let sub = row.sub ?? "";
    if (g === "Manual Assets" && !sub) {
      const sep = [" · ", " — ", " - "]
        .map((s) => ({ s, i: name.indexOf(s) }))
        .filter((x) => x.i > 0)
        .sort((a, b) => a.i - b.i)[0];
      if (sep) {
        sub = name.slice(sep.i + sep.s.length);
        name = name.slice(0, sep.i);
      }
    }
    group.items.push({ code: row.code, name, sub, value: row.value ?? 0, logo: row.logo ?? null });
  }
  const groups = GROUP_ORDER.map((n) => groupMap.get(n)!).filter((g) => g.items.length > 0);

  // Totals
  const assets = rows.filter((r) => !r.is_liability).reduce((s, r) => s + (r.value ?? 0), 0);
  const liabilities = rows.filter((r) => r.is_liability).reduce((s, r) => s + Math.abs(r.value ?? 0), 0);
  const total = assets - liabilities;

  // Allocation sums (for donut chart)
  const allocGroups = ["Investments", "Manual Assets", "Cash", "Credit Cards"];
  const allocSums: Record<string, number> = { Investments: 0, "Manual Assets": 0, Cash: 0, "Credit Cards": 0 };
  for (const row of rows) {
    const g = accountGroup(row);
    allocSums[g] = (allocSums[g] ?? 0) + Math.abs(row.value ?? 0);
  }
  const allocation = allocGroups.map((label) => ({
    label,
    value: allocSums[label] ?? 0,
    color: ALLOCATION_COLORS[label],
  }));

  // Chart: all networth_snapshots ordered ASC
  const snapshots = d
    .prepare(`SELECT date, total FROM networth_snapshots ORDER BY date ASC`)
    .all() as { date: string; total: number }[];

  // Ensure today's snapshot exists
  if (snapshots.length === 0) {
    snapshotNetworth(d);
    snapshots.push(...(d.prepare(`SELECT date, total FROM networth_snapshots ORDER BY date ASC`).all() as { date: string; total: number }[]));
  }

  // Delta vs snapshot >= 30 days ago (or earliest if none that old)
  const todayMs = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(todayMs - thirtyDaysMs).toISOString().slice(0, 10);
  const older = snapshots.filter((s) => s.date <= cutoff);
  const refSnap = older.length > 0 ? older[older.length - 1] : snapshots[0];

  let deltaAbs = 0;
  let deltaPct = 0;
  let allocation30d = "—";

  if (snapshots.length > 1 && refSnap) {
    deltaAbs = total - refSnap.total;
    deltaPct = refSnap.total !== 0 ? Math.round((deltaAbs / refSnap.total) * 1000) / 10 : 0;
    const sign = deltaPct >= 0 ? "+" : "";
    allocation30d = `${sign}${deltaPct.toFixed(1)}%`;
  }

  const body: NetworthData = {
    total,
    deltaAbs,
    deltaPct,
    range: "All",
    chart: {
      points: snapshots.map((s) => ({ date: s.date, total: s.total })),
    },
    allocation,
    allocation30d,
    assets,
    liabilities,
    groups,
  };

  return withRefreshedSession(req, body);
}
