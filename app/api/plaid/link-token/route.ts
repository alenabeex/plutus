import { NextRequest, NextResponse } from "next/server";
import { requireUnlocked, withRefreshedSession } from "@/lib/auth";
import { getPlaidClient, Products, CountryCode } from "@/lib/plaid";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const client = getPlaidClient();
  if (!client) {
    return NextResponse.json(
      {
        error: "plaid-not-configured",
        hint: "add finance-plaid-client-id / finance-plaid-secret to Keychain",
      },
      { status: 503 },
    );
  }

  const products: Products[] = [Products.Transactions];

  // Investments is optional — some Plaid plans / sandbox configs may not support it.
  // We add it best-effort; if link creation fails, callers may retry without it.
  const optionalProducts: Products[] | undefined = [Products.Investments];

  const linkRes = await client.linkTokenCreate({
    user: { client_user_id: "alena-local" },
    client_name: "Plutus",
    products,
    optional_products: optionalProducts,
    country_codes: [CountryCode.Us],
    language: "en",
    // Full two-year history at link time (Plaid default is only 90 days and
    // it can't be raised later without re-linking). Depth doesn't change
    // Transactions billing — it's a flat per-Item subscription.
    transactions: { days_requested: 730 },
  });

  return withRefreshedSession(req, { link_token: linkRes.data.link_token });
}
