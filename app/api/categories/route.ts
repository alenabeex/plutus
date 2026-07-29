import { NextRequest, NextResponse } from "next/server";
import { requireUnlocked, withRefreshedSession, withJsonErrors } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// Cash Flow edit mode (spec Alena 2026-07-28): categories are renamable and
// deletable from the category modal.

// Rename. Rules/transactions reference category_id, so a rename is label-only
// — nothing recategorizes.
export const PATCH = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const body = (await req.json()) as { id?: number; name?: string };
  if (typeof body.id !== "number") {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 40) {
    return NextResponse.json({ ok: false, error: "Name must be 1–40 characters" }, { status: 400 });
  }

  const d = db();
  const cat = d.prepare(`SELECT id FROM categories WHERE id = ?`).get(body.id);
  if (!cat) {
    return NextResponse.json({ ok: false, error: "category not found" }, { status: 400 });
  }
  const clash = d
    .prepare(`SELECT id FROM categories WHERE lower(name) = lower(?) AND id != ?`)
    .get(name, body.id);
  if (clash) {
    return NextResponse.json({ ok: false, error: "A category with that name already exists" }, { status: 400 });
  }

  d.prepare(`UPDATE categories SET name = ? WHERE id = ?`).run(name, body.id);
  return withRefreshedSession(req, { ok: true });
});

// Delete. Non-destructive to the ledger — the category's transactions fall
// back to Uncategorized (category_id NULL, still visible, still
// re-categorizable) and its learned rules go with it so the next sync can't
// resurrect the label.
export const DELETE = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const body = (await req.json()) as { id?: number };
  if (typeof body.id !== "number") {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }

  const d = db();
  const cat = d.prepare(`SELECT id FROM categories WHERE id = ?`).get(body.id);
  if (!cat) {
    return NextResponse.json({ ok: false, error: "category not found" }, { status: 400 });
  }

  d.prepare(`UPDATE transactions SET category_id = NULL WHERE category_id = ?`).run(body.id);
  d.prepare(`DELETE FROM category_rules WHERE category_id = ?`).run(body.id);
  d.prepare(`DELETE FROM categories WHERE id = ?`).run(body.id);
  return withRefreshedSession(req, { ok: true });
});
