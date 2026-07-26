"use client";

import {
  Bitcoin,
  Home,
  Car,
  Banknote,
  TrendingUp,
  Gem,
  Briefcase,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { MUTED, SOFT } from "@/lib/colors";
import type { AssetIconKey } from "@/lib/asset-icons";

/** Key → glyph. Same circle treatment as an institution's initials avatar:
 *  SOFT fill, MUTED glyph — GOOD/BAD stay reserved for money direction. */
export const ASSET_ICON_GLYPHS: Record<AssetIconKey, LucideIcon> = {
  crypto: Bitcoin,
  property: Home,
  vehicle: Car,
  cash: Banknote,
  investment: TrendingUp,
  collectible: Gem,
  business: Briefcase,
  other: Wallet,
};

export function AssetIcon({
  icon,
  size = 38,
  selected = false,
}: {
  icon: AssetIconKey;
  /** avatar diameter in px — 38 matches the institution rows */
  size?: number;
  /** picker state: draws the ring, nothing else changes */
  selected?: boolean;
}) {
  const Glyph = ASSET_ICON_GLYPHS[icon];
  return (
    <span
      className="flex items-center justify-center shrink-0"
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: SOFT,
        color: MUTED,
        boxShadow: selected ? `0 0 0 2px ${MUTED}` : "none",
      }}
    >
      <Glyph size={Math.round(size * 0.45)} strokeWidth={2} />
    </span>
  );
}
