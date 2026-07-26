// Manual-asset icon vocabulary. Plaid institutions arrive with a logo; a
// manual asset has nothing to draw, so the owner picks one of these keys and
// the row gets the same avatar + title treatment as a linked account.
// Pure data (no React) so the API route can use it too — the actual glyphs
// live in components/asset-icon.tsx.

export const ASSET_ICON_KEYS = [
  "crypto",
  "property",
  "vehicle",
  "cash",
  "investment",
  "collectible",
  "business",
  "other",
] as const;

export type AssetIconKey = (typeof ASSET_ICON_KEYS)[number];

/** Sub-line under the asset title — the category, in plain words. */
export const ASSET_ICON_LABELS: Record<AssetIconKey, string> = {
  crypto: "Crypto",
  property: "Property",
  vehicle: "Vehicle",
  cash: "Cash",
  investment: "Investment",
  collectible: "Collectible",
  business: "Business",
  other: "Manual asset",
};

export const DEFAULT_ASSET_ICON: AssetIconKey = "other";

export function isAssetIconKey(v: unknown): v is AssetIconKey {
  return typeof v === "string" && (ASSET_ICON_KEYS as readonly string[]).includes(v);
}

const KEYWORDS: [AssetIconKey, RegExp][] = [
  ["crypto", /\b(bitcoin|btc|eth|ethereum|crypto|coin|solana|wallet)\b/i],
  ["property", /\b(home|house|condo|apartment|property|real estate|land)\b/i],
  ["vehicle", /\b(car|truck|vehicle|motorcycle|boat|tesla|van)\b/i],
  ["cash", /\b(cash|safe|envelope|petty)\b/i],
  ["investment", /\b(brokerage|fund|equity|shares|stock|angel|401k|ira)\b/i],
  ["collectible", /\b(collection|art|comic|jewelry|watch|card|vintage|antique)\b/i],
  ["business", /\b(business|llc|company|inc|freelance|consult)\b/i],
];

/**
 * Icon for a row saved before the icon column existed (or any row whose icon
 * is missing). Keyword match on the label, else the neutral default.
 */
export function guessAssetIcon(label: string): AssetIconKey {
  for (const [key, re] of KEYWORDS) {
    if (re.test(label)) return key;
  }
  return DEFAULT_ASSET_ICON;
}
