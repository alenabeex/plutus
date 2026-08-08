// Single source of truth for the wireframe's hex palette. Previously each
// view file re-declared these four constants independently — a change to
// the brand green meant editing four files. Semantic colors (GOOD/BAD) are
// reserved for money direction (gain/loss, asset/liability) — never for
// static values. See 05_tools/skills/product-designer.md.
// Every text color here clears WCAG AA (4.5:1) on all three surfaces the app
// paints text on: CARD #ffffff, page #fafafa, SOFT #f4f4f5. Palette matches
// the shadcn zinc concept (networth-shadcn-concept.html): foreground/muted-fg/
// border/accent/danger tokens copied over 2026-08-07.
export const INK = "#18181b";
export const MUTED = "#71717a";
export const LINE = "#e4e4e7";
export const SOFT = "#f4f4f5";
export const CARD = "#ffffff";
export const GOOD = "#047857";
export const BAD = "#be123c";
// Connection-health amber (stale sync). GOOD/BAD stay money-direction
// semantics; the traffic-light dot on Connections reuses green/red and
// adds this for the in-between state.
export const WARN = "#8a6410";
// Grade scale (Cash Flow savings-rate tile). GREAT is a deeper green than
// GOOD so the top tier reads as distinct, not just "green again". Each has
// a tint for the tile background; every pairing clears AA (4.5:1):
// GREAT 8.27:1, GOOD 4.73:1, OKAY 4.71:1, BAD 4.61:1 on its own tint.
export const GREAT = "#1f4d30";
export const TINT_GREAT = "#d2f3e0";
export const TINT_GOOD = "#dcf3e5";
export const TINT_WARN = "#f7f0da";
export const TINT_BAD = "#f9eae7";
