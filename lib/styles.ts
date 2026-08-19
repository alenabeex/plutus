import { INK, SOFT } from "@/lib/colors";

// Shared view-template classes (T8.1/T8.2). One card shell for every view —
// rounded-xl (12px) + p-6 (24px) match canonical shadcn Card tokens
// (github.com/shadcn-ui/ui new-york style), swapped in 2026-08-07 to
// replace the non-canonical "radix-rhea" radius-4xl/--card-spacing scheme.
export const CARD =
  "rounded-xl bg-white p-6 shadow-[0_1px_2px_rgba(16,17,20,0.05)] border border-[rgba(228,228,231,.6)]";

// ⋯-popover standard (Alena, 2026-07-29): every popover menu in the app is a
// stack of full-width rows with the SOFT rounded hover — the Export menu's
// look. Use MENU_ITEM on each row (add color overrides inline) and the
// SOFT-background hover via menuItemHover.
export const MENU_ITEM: React.CSSProperties = {
  all: "unset" as unknown as undefined,
  display: "block", width: "100%", boxSizing: "border-box",
  padding: "9px 12px", borderRadius: 10, fontSize: 13, fontWeight: 500,
  color: INK, cursor: "pointer", textAlign: "left",
};
export const menuItemHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) =>
    ((e.currentTarget as HTMLElement).style.background = SOFT),
  onMouseLeave: (e: React.MouseEvent<HTMLElement>) =>
    ((e.currentTarget as HTMLElement).style.background = "transparent"),
};
