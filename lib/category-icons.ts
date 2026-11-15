// Category icon vocabulary (Alena 2026-11-14: "icons can be edited too").
// A category's icon is one of these keys, stored in categories.icon. NULL
// means "not chosen" — the row falls back to guessCategoryIcon, the keyword
// match every category used before icons were editable, so nothing changes
// for a category nobody has touched.
// Pure data (no React), same split as lib/asset-icons: the route validates
// against it, the glyphs live in components/views/budget.tsx.

export const CATEGORY_ICON_KEYS = [
  "housing", "utilities", "internet", "insurance", "health", "apps",
  "groceries", "dining", "coffee", "events", "music", "repair", "car", "fuel",
  "pets", "gifts", "travel", "shopping", "education", "fees", "home",
  "fitness", "kids", "business", "crypto", "heart", "tag",
] as const;

export type CategoryIconKey = (typeof CATEGORY_ICON_KEYS)[number];

/** Plain-word name for each icon — the picker's tooltip and aria-label. */
export const CATEGORY_ICON_LABELS: Record<CategoryIconKey, string> = {
  housing: "Housing", utilities: "Utilities", internet: "Phone / internet",
  insurance: "Insurance", health: "Health", apps: "Apps / subscriptions",
  groceries: "Groceries", dining: "Eating out", coffee: "Coffee",
  events: "Events", music: "Music", repair: "Repairs", car: "Car",
  fuel: "Gas", pets: "Pets", gifts: "Gifts", travel: "Travel",
  shopping: "Shopping", education: "Education", fees: "Fees", home: "Home",
  fitness: "Fitness", kids: "Kids", business: "Business", crypto: "Crypto",
  heart: "Heart", tag: "Tag",
};

export function isCategoryIconKey(v: unknown): v is CategoryIconKey {
  return typeof v === "string" && (CATEGORY_ICON_KEYS as readonly string[]).includes(v);
}

// First match wins — order matters ("car mainten." is a repair, not a car;
// "misc. / maint / home" is the home bucket only after repair had its turn).
const KEYWORDS: [RegExp, CategoryIconKey][] = [
  [/rent|housing|mortgage|apartment/i, "housing"],
  [/utilit|electric|power/i, "utilities"],
  [/phone|internet|wifi/i, "internet"],
  [/insurance/i, "insurance"],
  [/medical|health|doctor|dental/i, "health"],
  [/app|subs/i, "apps"],
  [/grocer/i, "groceries"],
  [/eat|restaurant|dining|food/i, "dining"],
  // \bent\b, not ent\b: the old pattern also matched "Car Payment"
  [/event|\bent\b|entertain/i, "events"],
  [/mainten|repair/i, "repair"],
  [/gas|fuel/i, "fuel"],
  [/pet/i, "pets"],
  [/gift/i, "gifts"],
  [/travel|parking|flight|hotel/i, "travel"],
  [/shop|personal/i, "shopping"],
  [/education|training|course|school/i, "education"],
  [/interest|fee|violation/i, "fees"],
  [/crypto|coin|bitcoin/i, "crypto"],
  [/home|house|misc|maint/i, "home"],
  [/business/i, "business"],
  [/\bcar\b|auto|vehicle/i, "car"],
  [/coffee|cafe/i, "coffee"],
  [/gym|fitness/i, "fitness"],
  [/kid|child|baby/i, "kids"],
];

/** Keyword guess for a label with no chosen icon; null when nothing fits
 *  (the caller picks its own fallback — Tag for expenses, piggy bank for a
 *  savings destination). */
export function guessCategoryIcon(label: string): CategoryIconKey | null {
  return KEYWORDS.find(([re]) => re.test(label))?.[1] ?? null;
}
