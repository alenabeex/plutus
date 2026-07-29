import { NextRequest, NextResponse } from "next/server";
import { requireUnlocked, withRefreshedSession, withJsonErrors } from "@/lib/auth";
import { db } from "@/lib/db";
import { runPlaidSync } from "@/lib/sync";

export const runtime = "nodejs";

// body optional — { institution?: string } scopes the sync to one connection
// (Connections view's per-row Re-sync). Absent/empty body syncs every item,
// same as before this scoping existed.
export const POST = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const body = (await req.json().catch(() => ({}))) as { institution?: unknown };
  const institution =
    typeof body.institution === "string" && body.institution.trim() ? body.institution.trim() : undefined;

  if (institution) {
    const exists = db()
      .prepare(`SELECT 1 FROM items WHERE institution = ? AND status != 'removed' LIMIT 1`)
      .get(institution);
    if (!exists) {
      return NextResponse.json({ error: "institution-not-found" }, { status: 400 });
    }
  }

  const result = await runPlaidSync(undefined, institution);

  if (!result.configured) {
    return NextResponse.json(
      {
        error: "plaid-not-configured",
        hint: "add finance-plaid-client-id / finance-plaid-secret to Keychain",
      },
      { status: 503 },
    );
  }

  return withRefreshedSession(req, { ok: true, synced: result.synced, errors: result.errors });
});
