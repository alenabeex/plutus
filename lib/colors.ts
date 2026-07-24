// Single source of truth for the wireframe's hex palette. Previously each
// view file re-declared these four constants independently — a change to
// the brand green meant editing four files. Semantic colors (GOOD/BAD) are
// reserved for money direction (gain/loss, asset/liability) — never for
// static values. See 05_tools/skills/product-designer.md.
export const INK = "#16181d";
export const MUTED = "#7a7f88";
export const LINE = "#e3e5e9";
export const SOFT = "#eef0f3";
export const CARD = "#ffffff";
export const GOOD = "#3e7c52";
export const BAD = "#b04a3f";
// Connection-health amber (stale sync). GOOD/BAD stay money-direction
// semantics; the traffic-light dot on Connections reuses green/red and
// adds this for the in-between state.
export const WARN = "#b8862e";
