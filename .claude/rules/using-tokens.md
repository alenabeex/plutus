---
paths:
  - "**/*.tsx"
  - "**/*.ts"
  - "**/*.css"
---
# Using tokens

Color and type are defined once: CSS custom properties in
`app/globals.css` `:root` (shadcn new-york), mirrored as TS constants in
`lib/colors.ts` (INK, MUTED, LINE, SOFT, CARD, GOOD, BAD, WARN, grade
scale). Shared component classes live in `lib/styles.ts` (CARD,
MENU_ITEM). Consume these — never hardcode.

## Always
- In TSX: import from `@/lib/colors` / `@/lib/styles`; in CSS/Tailwind
  theme work: use the `--` variables.
- New color or type value? Add it to `globals.css` AND `lib/colors.ts`
  (they mirror each other — both files' comments say so), then use it.
- New text color must clear WCAG AA (4.5:1) on all three surfaces:
  CARD #ffffff, page #fafafa, SOFT #f4f4f5. Note the ratio in the
  `lib/colors.ts` comment like the existing entries do.

## Never
- Never hardcode a hex, rgba, or px font-size in a component.
- Never use GOOD/BAD for anything but money direction (gain/loss,
  asset/liability). Static decoration never gets semantic color.
- Never duplicate an existing token under a new name.
- Never style a popover menu by hand — use MENU_ITEM + menuItemHover.
