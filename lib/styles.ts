// Shared view-template classes (T8.1/T8.2). One card shell for every view —
// spacing on the 4px grid (p-5 = 20px, matches Card's --card-spacing);
// rounded-2xl resolves to the same 18px radius the wireframe locked.
export const CARD =
  "rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(16,17,20,0.05)] border border-[rgba(16,17,20,0.03)]";

// ⋯-popover standard (Alena, 2026-07-29): every popover menu in the app is a
// stack of full-width rows with the SOFT rounded hover — the Export menu's
// look. Use MENU_ITEM on each row (add color overrides inline) and the
// SOFT-background hover via menuItemHover.
export const MENU_ITEM: React.CSSProperties = {
  all: "unset" as unknown as undefined,
  display: "block", width: "100%", boxSizing: "border-box",
  padding: "9px 12px", borderRadius: 10, fontSize: 13, fontWeight: 500,
  color: "#16181d", cursor: "pointer", textAlign: "left",
};
export const menuItemHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) =>
    ((e.currentTarget as HTMLElement).style.background = "#eef0f3"),
  onMouseLeave: (e: React.MouseEvent<HTMLElement>) =>
    ((e.currentTarget as HTMLElement).style.background = "transparent"),
};
