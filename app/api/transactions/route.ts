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
type Body =
  | { id: number; action: "category"; categoryId: number }
  | { id: number; action: "dispute" };

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

  if (body.action === "dispute") {
    // cashflowView's query filters txn_class IN ('income','expense'), so an
    // 'excluded' txn drops out of rows AND totals on the next GET. classify-
    // Transactions only fills NULL txn_class rows, so this sticks.
    d.prepare(`UPDATE transactions SET txn_class = 'excluded' WHERE id = ?`).run(body.id);
    return withRefreshedSession(req, { ok: true });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
});
