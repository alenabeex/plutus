import { NextRequest, NextResponse } from "next/server";
import { requireUnlocked, withRefreshedSession, withJsonErrors } from "@/lib/auth";
import { runPlaidSync } from "@/lib/sync";

export const runtime = "nodejs";

export const POST = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const result = await runPlaidSync();

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
