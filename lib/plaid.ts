import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";
import { plaidCreds, keychainGet } from "@/lib/keychain";

let _client: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi | null {
  // only a SUCCESSFUL construction is cached — a missing-creds result is
  // re-checked every call, so adding keys to the Keychain takes effect
  // without a server restart (audit P2)
  if (_client) return _client;

  const creds = plaidCreds();
  if (!creds) return null;

  const envKey = keychainGet("finance-plaid-env") ?? "sandbox";
  const basePath =
    envKey === "production"
      ? PlaidEnvironments.production
      : PlaidEnvironments.sandbox;

  const config = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": creds.clientId,
        "PLAID-SECRET": creds.secret,
      },
    },
  });

  _client = new PlaidApi(config);
  return _client;
}

// Institution branding — logo is a base64 152×152 PNG. Optional metadata:
// not all institutions publish one, and a branding failure must never fail
// the caller (linking, syncing), so this always resolves.
export async function fetchBranding(
  client: PlaidApi,
  institutionId: string,
): Promise<{ logo: string | null; primaryColor: string | null }> {
  try {
    const res = await client.institutionsGetById({
      institution_id: institutionId,
      country_codes: [CountryCode.Us],
      options: { include_optional_metadata: true },
    });
    return {
      logo: res.data.institution.logo ?? null,
      primaryColor: res.data.institution.primary_color ?? null,
    };
  } catch (e) {
    console.error("institution branding fetch failed:", e);
    return { logo: null, primaryColor: null };
  }
}

// Re-export enums so callers don't need to import plaid directly.
export { Products, CountryCode };
