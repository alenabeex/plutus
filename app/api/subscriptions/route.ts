import { NextRequest, NextResponse } from "next/server";
import { requireUnlocked, withRefreshedSession, withJsonErrors } from "@/lib/auth";
import { db } from "@/lib/db";
import { monthLabel } from "@/lib/format";
import type { SubscriptionsData } from "@/lib/types";

export const runtime = "nodejs";

function defaultMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function buildSubscriptionsData(month: string): SubscriptionsData {
  const [y, m] = month.split("-").map(Number);
  const firstDow = new Date(y, m - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthAbbr = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  const renewalMonth = monthAbbr;

  const d = db();
  const subs = d
    .prepare(`SELECT * FROM subscriptions WHERE status != 'dismissed'`)
    .all() as {
    id: number; name: string; amount: number; day: number;
    cadence: string; kind: string; renewal: string | null; approx: number; status: string;
  }[];

  // Build events keyed by day
  const events: Record<number, { name: string; bill: boolean }[]> = {};

  let subsTotal = 0;
  let billsTotal = 0;

  for (const s of subs) {
    const isBill = s.kind === "bill";
    const isAnnual = s.cadence === "annual";

    if (isAnnual) {
      // Annual fees: only show in their renewal month
      if (!s.renewal) continue;
      if (s.renewal.slice(0, 3) !== renewalMonth) continue;
    }

    // Format name for calendar display per mockup pattern:
    // monthly exact: "Name $amount"  e.g. "StorQuest $90"
    // approx: "Name ~$amount"        e.g. "PG&E ~$183"
    const amtFmt = s.approx
      ? `~$${s.amount % 1 === 0 ? s.amount : s.amount.toFixed(2)}`
      : `$${s.amount % 1 === 0 ? s.amount : s.amount.toFixed(2)}`;
    const displayName = `${s.name} ${amtFmt}`;

    const day = s.day;
    if (!events[day]) events[day] = [];
    events[day].push({ name: displayName, bill: isBill });

    // thisMonth totals: monthly only (no annual fees in monthly sums per mockup)
    if (!isAnnual) {
      if (isBill) {
        billsTotal += s.amount;
      } else {
        subsTotal += s.amount;
      }
    }
  }

  // Annual fees list (all, not filtered by month — show upcoming)
  const annualFees = subs
    .filter((s) => s.cadence === "annual" && s.kind === "fee")
    .map((s) => ({
      label: s.name,
      fee: s.amount,
      when: s.renewal ?? "",
    }));

  // Newly detected: status = 'detected'
  const newlyDetected = subs
    .filter((s) => s.status === "detected")
    .map((s) => ({
      id: s.id,
      name: s.name,
      value: `$${s.amount % 1 === 0 ? s.amount : s.amount.toFixed(2)}`,
    }));

  return {
    month,
    monthLabel: monthLabel(month),
    firstDow,
    daysInMonth,
    events,
    thisMonth: {
      subs: subsTotal,
      bills: billsTotal,
      total: subsTotal + billsTotal,
    },
    annualFees,
    newlyDetected,
  };
}

export const GET = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const url = new URL(req.url);
  // Default: current calendar month
  const month = url.searchParams.get("month") || defaultMonth();

  const body = buildSubscriptionsData(month);

  return withRefreshedSession(req, body);
});

export const POST = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const payload = (await req.json()) as { id?: number; action?: "confirm" | "dismiss"; month?: string };
  const { id, action, month } = payload;

  if (typeof id !== "number" || (action !== "confirm" && action !== "dismiss")) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const status = action === "confirm" ? "confirmed" : "dismissed";
  db().prepare(`UPDATE subscriptions SET status = ? WHERE id = ?`).run(status, id);

  const body = buildSubscriptionsData(month || defaultMonth());

  return withRefreshedSession(req, body);
});
