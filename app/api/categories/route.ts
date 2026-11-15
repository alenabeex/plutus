import { NextRequest, NextResponse } from "next/server";
import { requireUnlocked, withRefreshedSession, withJsonErrors } from "@/lib/auth";
import { db } from "@/lib/db";
import { addCategory, updateCategory, deleteCategory, CategoryError } from "@/lib/category-ops";
import { categorizeTransactions } from "@/lib/derive";
import { aiCategorize } from "@/lib/ai-categorize";

export const runtime = "nodejs";

// Category list edits (Alena 2026-11-14, superseding the 2026-07-28 per-row
// edit mode): the Expenses card's Edit opens a list of every category, where
// categories are added, renamed, given an icon and deleted. Validation and the writes live
// in lib/category-ops.ts (the tested seam); only its CategoryError becomes a
// 400 — anything else falls through to withJsonErrors' generic 500.

function guard<T>(fn: () => T): T | NextResponse {
  try {
    return fn();
  } catch (e) {
    if (e instanceof CategoryError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    throw e;
  }
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
}
const badBody = () => NextResponse.json({ ok: false, error: "bad request body" }, { status: 400 });

// POST { action: "add", name, grp }  — add a category.
// POST { action: "sort" }            — re-run categorization after the list
//   changed: the rule engine first, then the AI fallback over whatever is
//   still Uncategorized (a deleted category's transactions; merchants that
//   only fit a category that didn't exist until now). The AI is optional —
//   no key is a normal outcome, and a failed call never fails the request:
//   the list edit already happened and the rules still apply.
export const POST = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const body = await readBody(req);
  if (!body) return badBody();
  const d = db();

  if (body.action === "add") {
    const id = guard(() => addCategory(d, { name: body.name, grp: body.grp }));
    if (id instanceof NextResponse) return id;
    return withRefreshedSession(req, { ok: true, id });
  }

  if (body.action === "sort") {
    const byRules = categorizeTransactions(d);
    let ai: { status: "done" | "no-key" | "nothing-to-do" | "refusal" | "failed"; categorized: number };
    try {
      const r = await aiCategorize(d);
      ai = { status: r.skipped ?? "done", categorized: r.categorized };
    } catch {
      ai = { status: "failed", categorized: 0 };
    }
    return withRefreshedSession(req, { ok: true, byRules, ai });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
});

// Edit one category: `name` renames it (label-only, nothing recategorizes),
// `icon` sets or clears (null) its icon. Either or both; both land or
// neither does.
export const PATCH = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const body = await readBody(req);
  if (!body) return badBody();
  if (typeof body.id !== "number") {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }
  const id = body.id;
  const patch = {
    ...("name" in body ? { name: body.name } : {}),
    ...("icon" in body ? { icon: body.icon } : {}),
  };
  const r = guard(() => updateCategory(db(), id, patch));
  if (r instanceof NextResponse) return r;
  return withRefreshedSession(req, { ok: true });
});

// Delete — the category's transactions fall back to Uncategorized and its
// learned rules go with it (see deleteCategory).
export const DELETE = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const body = await readBody(req);
  if (!body) return badBody();
  if (typeof body.id !== "number") {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }
  const id = body.id;
  const released = guard(() => deleteCategory(db(), id));
  if (released instanceof NextResponse) return released;
  return withRefreshedSession(req, { ok: true, released });
});
