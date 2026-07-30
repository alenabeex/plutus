import { NextRequest, NextResponse } from "next/server";
import { requireUnlocked, withRefreshedSession, withJsonErrors } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// The one write path the read-only Cash Flow redesign allows (spec
// 2026-07-27's own rule: edit the transaction, never the sheet). Two actions:
//  - "category": recategorize one transaction, then learn a category_rules
//    row for its merchant (derive.ts:83's design — "corrections made in the
//    app become new rows in category_rules and win over these") so future
//    transactions from that merchant categorize themselves on the next sync.
//  - "dispute": mark a transaction excluded from Cash Flow entirely (wrong
//    charge, refunded in cash, etc.) — no undo UI yet, see report.
//  - "move": reclassify a transaction into a different Cash Flow area —
//    income, saved (money that became investments), expense, or disputed
//    (the visible folder at the bottom of Expenses; stored as
//    txn_class='excluded', same value "dispute" always wrote, so old rows
//    and new ones are one population). Moving to expense takes an optional
//    categoryId so the txn lands in a real category instead of
//    Uncategorized. classifyTransactions only fills NULL txn_class rows,
//    so a manual move sticks across syncs.
//  - "rename": override the transaction's display label. Writes `merchant`
//    (the display COALESCE prefers it), so future rule-learning keys on the
//    name the user actually recognizes.
type Body =
  | { id: number; action: "category"; categoryId: number }
  | { id: number; action: "dispute" }
  | { id: number; action: "move"; to: "income" | "saved" | "expense" | "disputed"; categoryId?: number }
  | { id: number; action: "rename"; label: string };

export const PUT = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const body = (await req.json()) as Partial<Body>;
  if (typeof body.id !== "number") {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }

  const d = db();
  const txn = d.prepare(`SELECT id, merchant FROM transactions WHERE id = ?`).get(body.id) as
    { id: number; merchant: string | null } | undefined;
  if (!txn) {
    return NextResponse.json({ ok: false, error: "transaction not found" }, { status: 400 });
  }

  if (body.action === "category") {
    const categoryId = (body as { categoryId?: number }).categoryId;
    if (typeof categoryId !== "number") {
      return NextResponse.json({ ok: false, error: "categoryId is required" }, { status: 400 });
    }
    const category = d.prepare(`SELECT id FROM categories WHERE id = ?`).get(categoryId);
    if (!category) {
      return NextResponse.json({ ok: false, error: "category not found" }, { status: 400 });
    }

    d.prepare(`UPDATE transactions SET category_id = ? WHERE id = ?`).run(categoryId, body.id);

    // Rule-learning: only merchants (a name-only txn has nothing stable to
    // pattern-match on). Update an existing exact-pattern rule rather than
    // duplicating it — categorizeTransactions matches longest pattern first,
    // so a duplicate would just be dead weight, not a correctness bug.
    const merchant = txn.merchant?.trim();
    if (merchant) {
      const pattern = merchant.toLowerCase();
      const existingRule = d
        .prepare(`SELECT id FROM category_rules WHERE field = 'merchant' AND pattern = ?`)
        .get(pattern) as { id: number } | undefined;
      if (existingRule) {
        d.prepare(`UPDATE category_rules SET category_id = ? WHERE id = ?`).run(categoryId, existingRule.id);
      } else {
        d.prepare(`INSERT INTO category_rules (pattern, field, category_id) VALUES (?, 'merchant', ?)`)
          .run(pattern, categoryId);
      }
    }

    return withRefreshedSession(req, { ok: true });
  }

  if (body.action === "move") {
    const to = (body as { to?: string }).to;
    if (to !== "income" && to !== "saved" && to !== "expense" && to !== "disputed") {
      return NextResponse.json({ ok: false, error: "bad destination" }, { status: 400 });
    }
    if (to === "disputed") {
      // keep category_id — un-disputing back to expense restores it
      d.prepare(`UPDATE transactions SET txn_class = 'excluded' WHERE id = ?`).run(body.id);
    } else if (to === "expense") {
      const categoryId = (body as { categoryId?: number }).categoryId;
      if (typeof categoryId === "number") {
        const category = d.prepare(`SELECT id FROM categories WHERE id = ?`).get(categoryId);
        if (!category) {
          return NextResponse.json({ ok: false, error: "category not found" }, { status: 400 });
        }
        d.prepare(`UPDATE transactions SET txn_class = 'expense', category_id = ? WHERE id = ?`)
          .run(categoryId, body.id);
      } else {
        d.prepare(`UPDATE transactions SET txn_class = 'expense' WHERE id = ?`).run(body.id);
      }
    } else {
      // income/saved don't use categories — clear any stale one
      d.prepare(`UPDATE transactions SET txn_class = ?, category_id = NULL WHERE id = ?`)
        .run(to, body.id);
    }
    return withRefreshedSession(req, { ok: true });
  }

  if (body.action === "rename") {
    const label = typeof (body as { label?: string }).label === "string"
      ? (body as { label: string }).label.trim()
      : "";
    if (!label || label.length > 80) {
      return NextResponse.json({ ok: false, error: "Label must be 1–80 characters" }, { status: 400 });
    }
    d.prepare(`UPDATE transactions SET merchant = ? WHERE id = ?`).run(label, body.id);
    return withRefreshedSession(req, { ok: true });
  }

  if (body.action === "dispute") {
    // cashflowView's query filters txn_class IN ('income','expense'), so an
    // 'excluded' txn drops out of rows AND totals on the next GET. classify-
    // Transactions only fills NULL txn_class rows, so this sticks.
    d.prepare(`UPDATE transactions SET txn_class = 'excluded' WHERE id = ?`).run(body.id);
    return withRefreshedSession(req, { ok: true });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
});
