"use client";

// Cash Flow — read-only analytics (spec 2026-07-27). Numbers derive from
// transactions; the page never writes the sheet. Drill-down (expand a row to
// its transactions) replaces editing: wrong number → fix the transaction's
// category, not the sheet. The only writes are to transactions: edits from
// a row's ⋯ menu, and manual cash entries from each card's Add. Sheet-imported months render from stored JSON
// with no drill-down (txns are empty).
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown, ChevronRight, Pencil, X,
  Banknote, PiggyBank, Flag, Tag, HelpCircle, ArrowLeftRight,
  ShoppingCart, Utensils, Ticket, Wrench, Home, PawPrint, Gift, Fuel,
  Plane, ShoppingBag, GraduationCap, Smartphone, Receipt, Zap, Wifi,
  Shield, HeartPulse, Building2, Bitcoin,
  Coffee, Music, Car, Dumbbell, Baby, Briefcase, Heart,
  type LucideIcon,
} from "lucide-react";
import { MonthPicker } from "@/components/month-picker";
import { CARD, LINE, SOFT, MUTED, INK, GOOD, BAD } from "@/lib/colors";
import { MENU_ITEM, menuItemHover } from "@/lib/styles";
import { usd, gradeFor, monthLabel } from "@/lib/format";
import type { CashflowData, CashflowRow, CashflowTxn, CategoryGroup } from "@/lib/types";
import {
  CATEGORY_ICON_KEYS, CATEGORY_ICON_LABELS, guessCategoryIcon, isCategoryIconKey, type CategoryIconKey,
} from "@/lib/category-icons";

interface BudgetViewProps {
  month: string;
  onMonthChange: (m: string) => void;
  dataMonths: string[];
  monthMin?: string;
  monthMax?: string;
  onMonthsChanged: () => void;
  onLocked: () => void;
}

const pct = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 100) : 0;

// Card-header action button — same treatment as Connections' "+ Add manual
// asset" (bordered, white, hover SOFT) so every card action reads the same.
const EDIT_BTN: React.CSSProperties = {
  all: "unset" as unknown as undefined,
  cursor: "pointer",
  border: `1px solid ${LINE}`,
  borderRadius: 10,
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 600,
  background: "#fff",
  color: INK,
  whiteSpace: "nowrap",
};
const editBtnHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) =>
    ((e.currentTarget as HTMLButtonElement).style.background = SOFT),
  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) =>
    ((e.currentTarget as HTMLButtonElement).style.background = "#fff"),
};

function Tile({ label, value, bg, color, sub, subColor }: {
  label: string; value: string; bg?: string; color?: string; sub?: string; subColor?: string;
}) {
  return (
    <div
      className="flex-1 rounded-2xl p-4"
      style={{ background: bg ?? CARD, border: `1px solid ${LINE}` }}
    >
      <div className="text-xs mb-1" style={{ color: MUTED }}>{label}</div>
      <div className="num text-2xl font-extrabold" style={{ color: color ?? INK }}>{value}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: subColor ?? MUTED }}>{sub}</div>}
    </div>
  );
}

// Every Cash Flow area a transaction can live in. `area` drives which move
// targets the popover offers — you can move a txn anywhere but where it
// already is. Disputed is a real area (the folder at the bottom of
// Expenses), so a disputed txn can be moved back out the same way — and so
// is Transfer, the folder under it (Alena 2026-11-14).
export type CashflowArea = "income" | "expense" | "saved" | "disputed" | "transfer";

export interface TxnActionOpts {
  categoryId?: number | null; // null = file under Uncategorized on purpose
  to?: CashflowArea;
}
export type OnTxnAction = (
  id: number,
  action: "category" | "move",
  opts?: TxnActionOpts,
) => void;

// Destination chip — shared by the picker modal's sections. `current` marks
// where the transaction already is: shown filled and not clickable, never
// left out — a missing chip read as a missing category (Alena 2026-11-14:
// "Insurance is in Edit Categories but not in the picker").
function destChip(label: string, onClick: () => void, color?: string, current = false) {
  if (current) {
    return (
      <span
        key={label}
        aria-current="true"
        title="This transaction is already here"
        className="rounded-full px-2.5 py-1 text-xs font-semibold"
        style={{ border: `1px solid ${INK}`, background: INK, color: CARD, cursor: "default" }}
      >
        {label}
      </span>
    );
  }
  return (
    <button
      key={label}
      type="button"
      className="rounded-full px-2.5 py-1 text-xs"
      style={{ border: `1px solid ${LINE}`, color: color ?? MUTED, cursor: "pointer" }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = SOFT)}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** Where a txn lives right now, as a display label. */
function areaLabel(area: CashflowArea, rowLabel: string): string {
  return area === "income" ? "Income"
    : area === "saved" ? "Savings"
    : area === "disputed" ? "Disputed"
    : area === "transfer" ? "Transfer"
    : rowLabel;
}

/** Last day of the user's current month, 'YYYY-MM-DD' — the date editor's
 *  ceiling. Local time on purpose: the page's month cap is the local month
 *  (app/page.tsx), and the server allows for the UTC offset. */
function localMonthEnd(): string {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${last.getFullYear()}-${p(last.getMonth() + 1)}-${p(last.getDate())}`;
}

// Actions popover for one transaction — anchored to its own ⋯ button so
// each txn row owns its outside-click-close listener independently (same
// idiom as the header's Export popover / plusRef, just one instance per
// row instead of one for the whole view). Three rows: Rename · Category ·
// Month (Alena 2026-11-14). Rename swaps the rows for an input; Category
// opens the TxnPickerModal — destinations live in their own modal, grouped
// Income / Needs / Wants / Business / Savings / Other / Disputed, not inline
// here;
// Month swaps the rows for a date editor — the transaction counts as an
// entry for whatever month that date falls in.
function TxnRow({
  t, rowLabel, area, isOpen,
  onToggle, onClose, onOpenPicker, onRename, onSetDate,
}: {
  t: CashflowTxn;
  rowLabel: string;
  area: CashflowArea;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onOpenPicker: () => void;
  onRename: (label: string) => void;
  onSetDate: (date: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [dating, setDating] = useState(false);
  const [dateDraft, setDateDraft] = useState(t.date);
  const saveDate = (date: string) => {
    if (!date || date === t.date) { setDating(false); return; }
    onClose();
    onSetDate(date);
  };

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen, onClose]);

  // popover closed → next open starts on the action rows, not a stale input
  if (!isOpen && renaming) setRenaming(false);
  if (!isOpen && dating) setDating(false);

  return (
    <div
      className="flex items-center gap-3 rounded-lg px-1 py-1 text-xs"
      style={{ color: MUTED }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = SOFT)}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* proportional columns: account starts at a consistent x across
            rows, pulled left toward the merchant instead of hugging the
            amount (Alena, 2026-07-29) */}
        <span className="min-w-0 flex-[3] truncate">{t.date.slice(5)} · {t.label}</span>
        <span className="hidden min-w-0 flex-[2] truncate sm:block" style={{ opacity: 0.75 }}>
          {t.account}
        </span>
        <span className="num shrink-0">{usd(t.value)}</span>
      </div>
      <div ref={menuRef} className="relative w-9 text-right">
        <button
          type="button"
          aria-label="Actions for this transaction"
          style={{ color: MUTED, cursor: "pointer" }}
          onClick={onToggle}
        >⋯</button>
        {isOpen && (
          <div
            className="absolute right-0 z-20 p-2"
            style={{
              top: "100%", marginTop: 4, background: CARD, border: `1px solid ${LINE}`,
              borderRadius: 14, boxShadow: "0 8px 30px rgba(16,17,20,.12)", width: 230,
            }}
          >
            {renaming ? (
              <input
                type="text"
                autoFocus
                defaultValue={t.label}
                maxLength={80}
                aria-label="Rename transaction"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = (e.target as HTMLInputElement).value.trim();
                    if (v) { onClose(); onRename(v); }
                  }
                  if (e.key === "Escape") setRenaming(false);
                }}
                className="w-full rounded-lg px-2 py-1.5 text-xs text-left"
                style={{ border: `1px solid ${MUTED}`, color: INK, background: "#fff" }}
              />
            ) : dating ? (
              /* keyed: without it React reuses a menu row's <button> node
                 for Save, and MENU_ITEM's inline `all: unset` — which the
                 browser expands into every longhand — never fully clears */
              <div key="date" className="text-left">
                <label className="mb-1.5 block text-[11px]" style={{ color: MUTED }} htmlFor={`txn-date-${t.id}`}>
                  Counts in the month of this date
                </label>
                <input
                  id={`txn-date-${t.id}`}
                  type="date"
                  autoFocus
                  value={dateDraft}
                  max={localMonthEnd()}
                  onChange={(e) => setDateDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveDate(dateDraft);
                    if (e.key === "Escape") { e.stopPropagation(); setDating(false); }
                  }}
                  className="w-full rounded-lg px-2 py-1.5 text-xs"
                  style={{ border: `1px solid ${MUTED}`, color: INK, background: CARD }}
                />
                <button
                  type="button"
                  className="mt-2 w-full rounded-full py-1.5 text-xs font-semibold"
                  style={{
                    background: INK, color: CARD,
                    cursor: dateDraft && dateDraft !== t.date ? "pointer" : "default",
                    opacity: dateDraft && dateDraft !== t.date ? 1 : 0.5,
                  }}
                  disabled={!dateDraft || dateDraft === t.date}
                  onClick={() => saveDate(dateDraft)}
                >
                  Save
                </button>
                {t.bankDate && (
                  <button type="button" style={MENU_ITEM} {...menuItemHover} className="mt-1"
                          onClick={() => saveDate(t.bankDate!)}>
                    Reset to bank date ({t.bankDate.slice(5)})
                  </button>
                )}
              </div>
            ) : (
              /* stacked full-width rows with the Export menu's SOFT row
                 hover — the app's one popover standard (Alena, 2026-07-29) */
              <div key="menu" className="text-left">
                <button type="button" style={MENU_ITEM} {...menuItemHover} onClick={() => setRenaming(true)}>
                  Rename
                </button>
                <button
                  type="button"
                  style={MENU_ITEM}
                  {...menuItemHover}
                  aria-haspopup="dialog"
                  onClick={() => { onClose(); onOpenPicker(); }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span>Category</span>
                    <span className="flex min-w-0 items-center gap-0.5" style={{ color: MUTED }}>
                      <span className="truncate">{areaLabel(area, rowLabel)}</span>
                      <ChevronRight size={13} aria-hidden className="shrink-0" />
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  style={MENU_ITEM}
                  {...menuItemHover}
                  onClick={() => { setDateDraft(t.date); setDating(true); }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span>Month</span>
                    <span className="flex min-w-0 items-center gap-0.5" style={{ color: MUTED }}>
                      <span className="truncate">{monthLabel(t.date.slice(0, 7))}</span>
                      <ChevronRight size={13} aria-hidden className="shrink-0" />
                    </span>
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <span className="w-[15px]" aria-hidden />
    </div>
  );
}

// Row icon — a real glyph in the Net Worth-style avatar circle (T8.1: Net
// Worth is the view template every view matches). A category shows the icon
// its owner picked (categories.icon, edited in the categories modal); with
// none picked, the label is keyword-matched (lib/category-icons) so renamed
// or custom categories still land on something sensible; Tag is the fallback.
const CATEGORY_ICON_GLYPHS: Record<CategoryIconKey, LucideIcon> = {
  housing: Building2, utilities: Zap, internet: Wifi, insurance: Shield,
  health: HeartPulse, apps: Smartphone, groceries: ShoppingCart,
  dining: Utensils, coffee: Coffee, events: Ticket, music: Music,
  repair: Wrench, car: Car, fuel: Fuel, pets: PawPrint, gifts: Gift,
  travel: Plane, shopping: ShoppingBag, education: GraduationCap,
  fees: Receipt, home: Home, fitness: Dumbbell, kids: Baby,
  business: Briefcase, crypto: Bitcoin, heart: Heart, tag: Tag,
};

/** The icon key a category shows: its chosen one, else the keyword guess,
 *  else the plain tag. */
function categoryIconKey(name: string, chosen?: string | null): CategoryIconKey {
  return isCategoryIconKey(chosen) ? chosen : guessCategoryIcon(name) ?? "tag";
}

function rowIcon(label: string, area: CashflowArea, chosen?: string | null): LucideIcon {
  if (area === "income") return Banknote;
  if (area === "disputed") return Flag;
  if (area === "transfer") return ArrowLeftRight;
  if (area === "expense" && label === "Uncategorized") return HelpCircle;
  // saved destinations keyword-match too (Crypto → Bitcoin), piggy bank otherwise
  if (area === "saved") {
    const guess = guessCategoryIcon(label);
    return guess ? CATEGORY_ICON_GLYPHS[guess] : PiggyBank;
  }
  return CATEGORY_ICON_GLYPHS[categoryIconKey(label, chosen)];
}

function Row({
  row, total, open, onToggle, valueColor, area,
  openTxnMenu, onToggleTxnMenu, onCloseTxnMenu, onOpenPicker, onRenameTxn, onSetTxnDate,
  onEdit,
}: {
  row: CashflowRow; total: number; open: boolean; onToggle: () => void; valueColor: string;
  area: CashflowArea;
  openTxnMenu: number | null;
  onToggleTxnMenu: (id: number) => void;
  onCloseTxnMenu: () => void;
  onOpenPicker: (target: PickerTarget) => void;
  onRenameTxn: (id: number, label: string) => void;
  onSetTxnDate: (id: number, date: string) => void;
  /** edit mode: clicking the row opens the category modal instead of drilling */
  onEdit?: () => void;
}) {
  const drillable = row.txns.length > 0;
  const share = pct(row.value, total);
  // The Disputed folder shows no share bar or % — its amounts are negated,
  // so a share of expenses would be a lie (spec Alena 2026-07-28). Same for
  // the Transfer folder: own-account moves are not a share of spending.
  const noBar = area === "disputed" || area === "transfer";
  // rowIcon returns one of a fixed set of static lucide components, so this
  // is a lookup, not a component created during render — createElement keeps
  // the react-hooks/static-components lint honest about that.
  const icon = createElement(rowIcon(row.label, area, row.icon), { size: 17 });
  const clickable = !!onEdit || drillable;
  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 px-1 py-2.5 text-left"
          style={{ cursor: clickable ? "pointer" : "default" }}
          onClick={onEdit ?? (drillable ? onToggle : undefined)}
          aria-expanded={!onEdit && drillable ? open : undefined}
          aria-label={
            onEdit
              ? `Edit category ${row.label}`
              : drillable ? `${row.label}: ${usd(row.value)} — show transactions` : undefined
          }
          disabled={!clickable}
        >
          <span
            className="flex shrink-0 items-center justify-center"
            style={{ width: 38, height: 38, borderRadius: "50%", background: SOFT, color: MUTED }}
            aria-hidden
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex justify-between text-[13px]" style={{ color: INK }}>
              <span className="truncate">{row.label}</span>
              <span className="num font-semibold" style={{ color: valueColor }}>{usd(row.value)}</span>
            </div>
            {!noBar && (
              <div className="mt-1.5 h-1 rounded-full" style={{ background: SOFT }}>
                <div className="h-1 rounded-full" style={{ width: `${share}%`, background: valueColor }} />
              </div>
            )}
          </div>
          {!noBar && <span className="num w-9 text-right text-xs" style={{ color: MUTED }}>{share}%</span>}
          {noBar && <span className="w-9" aria-hidden />}
          {onEdit ? (
            <Pencil size={14} style={{ color: MUTED }} aria-hidden />
          ) : drillable ? (
            open
              ? <ChevronDown size={15} style={{ color: MUTED }} aria-hidden />
              : <ChevronRight size={15} style={{ color: MUTED }} aria-hidden />
          ) : (
            <span className="w-[15px]" aria-hidden />
          )}
        </button>
      </div>
      {drillable && open && (
        /* ml 22 + 2px border centers the guide line on the 38px avatar
           (px-1 4 + 19); pl 26 + txn px-1 4 lands the date text at 54px —
           the category label's left edge (Alena, 2026-07-29) */
        <div className="mb-2 ml-[22px] border-l-2 pl-[26px]" style={{ borderColor: LINE }}>
          {row.txns.map((t) => (
            <TxnRow
              key={t.id}
              t={t}
              rowLabel={row.label}
              area={area}
              isOpen={openTxnMenu === t.id}
              onToggle={() => onToggleTxnMenu(t.id)}
              onClose={onCloseTxnMenu}
              onOpenPicker={() => onOpenPicker({ id: t.id, area, rowLabel: row.label, txnLabel: t.label })}
              onRename={(label) => onRenameTxn(t.id, label)}
              onSetDate={(date) => onSetTxnDate(t.id, date)}
            />
          ))}
          {area === "expense" && (
            <div className="py-1 text-xs" style={{ color: MUTED }}>
              Wrong category? Fix it on the transaction.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Where a single transaction can be re-filed (spec Alena 2026-07-29): its
// own modal, opened from the row popover's category pill. Destinations are
// grouped under uppercase micro-labels — Income · Needs · Wants · Business ·
// Savings · Other (Uncategorized, Transfer) · Disputed. The category the
// transaction is already in stays in the list, marked as current.
export interface PickerTarget {
  id: number;
  area: CashflowArea;
  rowLabel: string;
  txnLabel: string;
}

function TxnPickerModal({
  target, categories, onTxnAction, onClose,
}: {
  target: PickerTarget;
  categories: { id: number; name: string; grp: CategoryGroup }[];
  onTxnAction: OnTxnAction;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isExpense = target.area === "expense";
  const pickCategory = (c: { id: number; name: string }) => {
    onClose();
    // same-area category change keeps the rule-learning path; cross-area
    // lands as an expense in that category
    if (isExpense) onTxnAction(target.id, "category", { categoryId: c.id });
    else onTxnAction(target.id, "move", { to: "expense", categoryId: c.id });
  };
  const pickArea = (to: CashflowArea) => {
    onClose();
    onTxnAction(target.id, "move", { to });
  };
  // Uncategorized (Alena 2026-11-14): file it there on purpose — the server
  // flags the row so the rule engine doesn't put it straight back.
  const pickUncategorized = () => {
    onClose();
    onTxnAction(target.id, "move", { to: "expense", categoryId: null });
  };
  const isHere = (name: string) => isExpense && name === target.rowLabel;
  const catSection = (label: string, grp: CategoryGroup) => {
    const cats = categories.filter((c) => c.grp === grp);
    if (cats.length === 0) return null;
    return section(label, cats.map((c) => destChip(c.name, () => pickCategory(c), undefined, isHere(c.name))));
  };

  const section = (label: string, chips: React.ReactNode) => (
    <div className="mb-3">
      <div className="text-[11px] mb-1.5" style={{ textTransform: "uppercase", letterSpacing: "0.06em", color: MUTED, fontWeight: 600 }}>
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">{chips}</div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      style={{ background: "rgba(16,17,20,.45)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Move ${target.txnLabel}`}
        className="flex max-h-[85dvh] w-[360px] max-w-[calc(100vw-32px)] flex-col rounded-2xl p-6"
        style={{ background: CARD, boxShadow: "0 20px 60px rgba(16,17,20,.25)" }}
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-[15px] font-bold" style={{ color: INK }}>{target.txnLabel}</h2>
          <button type="button" aria-label="Close" style={{ color: MUTED, cursor: "pointer" }} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="mb-4 text-xs" style={{ color: MUTED }}>
          Currently in <b style={{ color: INK }}>{areaLabel(target.area, target.rowLabel)}</b> — move to:
        </div>
        {/* The destinations scroll inside the modal. Without this a long
            category list (or a short window) pushed the centered modal past
            both screen edges and cut off its top — Income and the first
            Needs chips — with no way to reach them (Alena 2026-11-14). */}
        <div className="-mx-1 -mt-1 min-h-0 flex-1 overflow-y-auto px-1 pt-1">
        {target.area !== "income" && section("Income", destChip("Income", () => pickArea("income")))}
        {catSection("Needs", "need")}
        {catSection("Wants", "want")}
        {catSection("Business", "business")}
        {target.area !== "saved" && section("Savings", destChip("Savings", () => pickArea("saved")))}
        {section("Other", [
          destChip("Uncategorized", pickUncategorized, undefined, isHere("Uncategorized")),
          destChip("Transfer", () => pickArea("transfer"), undefined, target.area === "transfer"),
        ])}
        {target.area !== "disputed" && section("Disputed", destChip("Disputed", () => pickArea("disputed"), BAD))}
        </div>
      </div>
    </div>
  );
}

// Edit Categories modal (Alena 2026-11-14, superseding the 2026-07-28
// per-row edit mode): the Expenses card's Edit opens the whole category
// list — every category, including ones with no spending this month, which
// the card itself never shows. Each row has a pencil (name + icon editor,
// opens under the row) and a two-step Delete; Add is at the bottom.
// Standard modal manners: backdrop click and Escape close. The list is the
// server's (`categories` re-fetches after every change), so what is on
// screen is what is saved.
type Cat = { id: number; name: string; grp: CategoryGroup; icon: string | null };

// The pencil's editor for one category: its name and its icon, saved
// together. Only what changed is sent.
function CategoryEditor({
  cat, busy, onSave, onCancel,
}: {
  cat: Cat;
  busy: boolean;
  onSave: (patch: { name?: string; icon?: string }) => void;
  onCancel: () => void;
}) {
  const shown = categoryIconKey(cat.name, cat.icon);
  const [name, setName] = useState(cat.name);
  const [icon, setIcon] = useState<CategoryIconKey>(shown);
  const trimmed = name.trim();
  const nameChanged = trimmed.length > 0 && trimmed !== cat.name;
  const iconChanged = icon !== shown;
  const dirty = nameChanged || iconChanged;
  const save = () => {
    if (!dirty || busy || trimmed.length === 0) return;
    onSave({ ...(nameChanged ? { name: trimmed } : {}), ...(iconChanged ? { icon } : {}) });
  };
  return (
    <div className="mx-2 mb-2 rounded-xl p-3" style={{ border: `1px solid ${LINE}` }}>
      <input
        type="text"
        autoFocus
        value={name}
        maxLength={40}
        aria-label={`Name for ${cat.name}`}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
        }}
        className="w-full rounded-lg px-2 py-1.5 text-[13px]"
        style={{ border: `1px solid ${LINE}`, color: INK, background: CARD }}
      />
      <div className="mb-1.5 mt-3 text-[11px]" style={{ color: MUTED, fontWeight: 600 }}>Icon</div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Icon for ${cat.name}`}>
        {CATEGORY_ICON_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            aria-label={CATEGORY_ICON_LABELS[k]}
            aria-pressed={icon === k}
            title={CATEGORY_ICON_LABELS[k]}
            className="flex items-center justify-center"
            style={{
              width: 32, height: 32, borderRadius: "50%", cursor: "pointer",
              background: icon === k ? INK : SOFT, color: icon === k ? CARD : MUTED,
            }}
            onClick={() => setIcon(k)}
          >
            {createElement(CATEGORY_ICON_GLYPHS[k], { size: 15 })}
          </button>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="rounded-full px-3 py-1 text-xs"
                style={{ border: `1px solid ${LINE}`, color: MUTED, cursor: "pointer" }}
                onClick={onCancel}>Cancel</button>
        <button type="button" className="rounded-full px-3 py-1 text-xs font-semibold"
                style={{ background: INK, color: CARD, cursor: dirty && !busy ? "pointer" : "default", opacity: dirty && !busy ? 1 : 0.5 }}
                disabled={!dirty || busy}
                onClick={save}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

function CategoriesModal({
  categories, busy, error, onAdd, onEdit, onDelete, onClose,
}: {
  categories: Cat[];
  busy: boolean;
  error: string | null;
  onAdd: (name: string, grp: CategoryGroup) => Promise<boolean>;
  onEdit: (id: number, patch: { name?: string; icon?: string }) => Promise<boolean>;
  onDelete: (id: number) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [newGrp, setNewGrp] = useState<CategoryGroup>("want");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [armedId, setArmedId] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canAdd = newName.trim().length > 0 && !busy;
  const add = async () => {
    if (!canAdd) return;
    // keep the typed name when the server refuses it, so it can be fixed
    if (await onAdd(newName.trim(), newGrp)) setNewName("");
  };

  const catRow = (c: Cat) => (
    <div key={c.id}>
      <div className="flex items-center gap-2 rounded-lg px-2 py-1.5"
           onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = SOFT)}
           onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}>
        <span className="flex shrink-0 items-center justify-center" aria-hidden
              style={{ width: 26, height: 26, borderRadius: "50%", background: SOFT, color: MUTED }}>
          {createElement(CATEGORY_ICON_GLYPHS[categoryIconKey(c.name, c.icon)], { size: 13 })}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: INK }}>{c.name}</span>
        <button
          type="button"
          className="flex shrink-0 items-center justify-center rounded-full"
          style={{
            width: 26, height: 26, border: `1px solid ${editingId === c.id ? INK : LINE}`,
            color: editingId === c.id ? INK : MUTED, cursor: "pointer",
            background: editingId === c.id ? CARD : "transparent",
          }}
          aria-label={`Edit ${c.name}`}
          aria-expanded={editingId === c.id}
          title="Edit name and icon"
          onClick={() => { setArmedId(null); setEditingId(editingId === c.id ? null : c.id); }}
        >
          <Pencil size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="shrink-0 rounded-full px-2.5 py-1 text-xs"
          style={{
            border: `1px solid ${LINE}`, cursor: busy ? "default" : "pointer",
            color: armedId === c.id ? INK : MUTED, fontWeight: armedId === c.id ? 600 : 400,
            background: armedId === c.id ? CARD : "transparent",
          }}
          disabled={busy}
          aria-label={armedId === c.id ? `Confirm delete ${c.name}` : `Delete ${c.name}`}
          onBlur={() => setArmedId((v) => (v === c.id ? null : v))}
          onClick={() => {
            if (armedId === c.id) { setArmedId(null); setEditingId(null); onDelete(c.id); }
            else setArmedId(c.id);
          }}
        >
          {armedId === c.id ? "Really delete?" : "Delete"}
        </button>
      </div>
      {editingId === c.id && (
        <CategoryEditor
          key={c.id}
          cat={c}
          busy={busy}
          onCancel={() => setEditingId(null)}
          // stays open when the server refuses (a name clash) so it can be fixed
          onSave={async (patch) => { if (await onEdit(c.id, patch)) setEditingId(null); }}
        />
      )}
    </div>
  );

  const group = (label: string, grp: CategoryGroup) => {
    const rows = categories.filter((c) => c.grp === grp);
    return (
      <div className="mb-3">
        <div className="mb-1 px-2 text-[11px]" style={{ textTransform: "uppercase", letterSpacing: "0.06em", color: MUTED, fontWeight: 600 }}>
          {label}
        </div>
        {rows.length === 0
          ? <div className="px-2 py-1.5 text-xs" style={{ color: MUTED }}>None yet.</div>
          : rows.map(catRow)}
      </div>
    );
  };

  const grpChip = (label: string, grp: CategoryGroup) => (
    <button
      type="button"
      className="rounded-full px-2.5 py-1 text-xs"
      aria-pressed={newGrp === grp}
      style={{
        border: `1px solid ${newGrp === grp ? INK : LINE}`, cursor: "pointer",
        color: newGrp === grp ? INK : MUTED, fontWeight: newGrp === grp ? 600 : 400,
      }}
      onClick={() => setNewGrp(grp)}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      style={{ background: "rgba(16,17,20,.45)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit Categories"
        className="flex max-h-[85dvh] w-[380px] max-w-[calc(100vw-32px)] flex-col rounded-2xl p-6"
        style={{ background: CARD, boxShadow: "0 20px 60px rgba(16,17,20,.25)" }}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[15px] font-bold" style={{ color: INK }}>Edit Categories</h2>
          <button type="button" aria-label="Close" style={{ color: MUTED, cursor: "pointer" }} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="mb-4 text-xs" style={{ color: MUTED }}>
          Use the pencil to change a name or icon. Deleting a category sends its transactions to Uncategorized.
        </div>

        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto">
          {group("Needs", "need")}
          {group("Wants", "want")}
          {group("Business", "business")}
        </div>

        <div className="mt-3 border-t pt-4" style={{ borderColor: LINE }}>
          <input
            type="text"
            value={newName}
            maxLength={40}
            placeholder="New category"
            aria-label="New category name"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={{ border: `1px solid ${LINE}`, color: INK, background: CARD }}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex gap-1.5">
              {grpChip("Needs", "need")}
              {grpChip("Wants", "want")}
              {grpChip("Business", "business")}
            </div>
            <button
              type="button"
              className="rounded-full px-4 py-1.5 text-[13px] font-semibold"
              style={{ background: INK, color: CARD, cursor: canAdd ? "pointer" : "default", opacity: canAdd ? 1 : 0.5 }}
              disabled={!canAdd}
              onClick={() => void add()}
            >
              {busy ? "Saving…" : "Add"}
            </button>
          </div>
          {error && <div role="alert" className="mt-2 text-xs" style={{ color: INK }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}

// Savings-destination modal (spec Alena 2026-07-28): the Savings card's edit
// mode. A destination is a merchant grouping, not a category — its labels
// come from the bank — so "edit" here means re-routing all of its
// transactions at once: to Income, a category, or Disputed.
function SavedRowModal({
  row, categories, onClose, onMoveAll, busy,
}: {
  row: CashflowRow;
  categories: { id: number; name: string; grp: CategoryGroup }[];
  onClose: () => void;
  onMoveAll: (to: "income" | "disputed" | "expense", categoryId?: number) => void;
  busy: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chipStyle: React.CSSProperties = {
    border: `1px solid ${LINE}`, color: MUTED, cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.5 : 1,
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      style={{ background: "rgba(16,17,20,.45)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit savings destination ${row.label}`}
        className="max-h-[85dvh] w-[320px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-2xl p-6"
        style={{ background: CARD, boxShadow: "0 20px 60px rgba(16,17,20,.25)" }}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[15px] font-bold" style={{ color: INK }}>{row.label}</h2>
          <button
            type="button"
            aria-label="Close"
            style={{ color: MUTED, cursor: "pointer" }}
            onClick={onClose}
          ><X size={16} /></button>
        </div>
        <div className="mb-4 text-xs" style={{ color: MUTED }}>
          {row.txns.length} transaction{row.txns.length === 1 ? "" : "s"} · {usd(row.value)} —
          move all of them to:
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="rounded-full px-2.5 py-1 text-xs" style={chipStyle}
            disabled={busy} onClick={() => onMoveAll("income")}>Income</button>
          {categories.map((c) => (
            <button key={c.id} type="button" className="rounded-full px-2.5 py-1 text-xs" style={chipStyle}
              disabled={busy} onClick={() => onMoveAll("expense", c.id)}>{c.name}</button>
          ))}
          <button type="button" className="rounded-full px-2.5 py-1 text-xs"
            style={{ ...chipStyle, color: BAD }}
            disabled={busy} onClick={() => onMoveAll("disputed")}>Disputed</button>
        </div>
        {busy && <div className="mt-3 text-xs" style={{ color: MUTED }}>Moving…</div>}
      </div>
    </div>
  );
}

// Manual cash entry (Alena 2026-10-30): each card's "Add" opens this with its
// kind preset. Cash income, a cash expense, or a saving that no linked
// account reports — the server signs and classifies it (lib/add-manual-txn).
function AddTxnModal({
  kind, month, categories, busy, error, onClose, onAdd,
}: {
  kind: "income" | "expense" | "saved";
  month: string;
  categories: { id: number; name: string; grp: CategoryGroup }[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onAdd: (input: { label: string; amount: number; date: string; categoryId?: number }) => void;
}) {
  // Local calendar date, not toISOString's UTC one — an evening in the US
  // would otherwise prefill tomorrow (and miss the month on its last day).
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  // The entry must land in the month being viewed, or it vanishes into one
  // the user isn't looking at — the picker is clamped and the server checks.
  const [y, m] = month.split("-").map(Number);
  const monthMin = `${month}-01`;
  const monthMax = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today.startsWith(`${month}-`) ? today : monthMin);
  const [categoryId, setCategoryId] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title = kind === "income" ? "Add cash income" : kind === "expense" ? "Add cash expense" : "Add saving";
  const parsed = Number(amount);
  const valid = label.trim().length > 0 && Number.isFinite(parsed) && parsed >= 0.01
    && date >= monthMin && date <= monthMax;
  const submit = () => {
    if (!valid || busy) return;
    onAdd({ label: label.trim(), amount: parsed, date, categoryId: kind === "expense" && categoryId !== null ? categoryId : undefined });
  };
  const inputStyle: React.CSSProperties = { border: `1px solid ${LINE}`, color: INK };
  const chip = (c: { id: number; name: string }) => {
    const on = categoryId === c.id;
    return (
      <button key={c.id} type="button" className="rounded-full px-2.5 py-1 text-xs"
        style={{ border: `1px solid ${on ? INK : LINE}`, background: on ? INK : "transparent", color: on ? "#fff" : MUTED, cursor: "pointer" }}
        onClick={() => setCategoryId(on ? null : c.id)}>{c.name}</button>
    );
  };
  const section = (label: string, grp: CategoryGroup) => {
    const cats = categories.filter((c) => c.grp === grp);
    if (cats.length === 0) return null;
    return (
      <div className="mb-3">
        <div className="text-[11px] mb-1.5" style={{ textTransform: "uppercase", letterSpacing: "0.06em", color: MUTED, fontWeight: 600 }}>{label}</div>
        <div className="flex flex-wrap gap-1.5">{cats.map(chip)}</div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      style={{ background: "rgba(16,17,20,.45)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85dvh] w-[320px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-2xl p-6"
        style={{ background: CARD, boxShadow: "0 20px 60px rgba(16,17,20,.25)" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-bold" style={{ color: INK }}>{title}</h2>
          <button type="button" aria-label="Close" style={{ color: MUTED, cursor: "pointer" }} onClick={onClose}><X size={16} /></button>
        </div>
        <input type="text" autoFocus value={label} maxLength={80} placeholder="What was it?" aria-label="Label"
          onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
        <div className="mt-2 flex gap-2">
          <input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} placeholder="0.00" aria-label="Amount"
            onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            className="num w-1/2 rounded-lg px-3 py-2 text-sm" style={inputStyle} />
          <input type="date" value={date} min={monthMin} max={monthMax} aria-label="Date"
            onChange={(e) => setDate(e.target.value)}
            className="w-1/2 rounded-lg px-3 py-2 text-sm" style={inputStyle} />
        </div>
        {kind === "expense" && (
          <div className="mt-4">
            {section("Needs", "need")}
            {section("Wants", "want")}
            {section("Business", "business")}
          </div>
        )}
        {error && <div className="mt-2 text-xs" style={{ color: BAD }}>{error}</div>}
        <button
          type="button"
          className="mt-4 w-full rounded-full py-2.5 text-[13px] font-semibold"
          style={{ background: INK, color: "#fff", cursor: valid && !busy ? "pointer" : "default", opacity: valid && !busy ? 1 : 0.5 }}
          disabled={!valid || busy}
          onClick={submit}
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}

export default function BudgetView({
  month, onMonthChange, dataMonths, monthMin, monthMax, onMonthsChanged, onLocked,
}: BudgetViewProps) {
  const [data, setData] = useState<CashflowData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [openTxnMenu, setOpenTxnMenu] = useState<number | null>(null);
  // Txn destination picker modal (spec Alena 2026-07-29) — set from a row
  // popover's category pill; one at a time.
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  // >0 when the requested month has real settled transactions but isn't
  // synced yet (spec 2026-07-28's backfill gate) — the notFound render forks
  // on this to offer "Sync Month" instead of the generic empty state.
  const [gatedTxnCount, setGatedTxnCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  // why the last date edit was refused, if it was — shown under the header
  const [txnError, setTxnError] = useState<string | null>(null);
  // Expenses card's Edit (Alena 2026-11-14): opens the categories modal —
  // the full list, with add / rename / delete. catsChanged remembers that
  // the list was edited, so closing the modal re-sorts transactions once.
  const [catsOpen, setCatsOpen] = useState(false);
  const catsChanged = useRef(false);
  const [sortNote, setSortNote] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  // Savings-card edit mode: a destination row opens a modal that bulk-moves
  // all of its transactions somewhere else (destinations are merchant
  // groupings, so "edit" means re-route the money, not rename a label).
  const [editingSavings, setEditingSavings] = useState(false);
  const [editSaved, setEditSaved] = useState<CashflowRow | null>(null);
  // Manual cash entry — which card's "Add" is open, if any.
  const [addKind, setAddKind] = useState<"income" | "expense" | "saved" | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [plusOpen, setPlusOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);

  // month changed → reset loading/drill-down state during render (not in the
  // effect) so the lint-checked effect below only fetches
  const [fetchedMonth, setFetchedMonth] = useState<string | null>(null);
  if (fetchedMonth !== month) {
    setFetchedMonth(month);
    setLoading(true);
    setOpenRow(null);
    setOpenTxnMenu(null);
    setPicker(null);
    setGatedTxnCount(0);
    setSyncError(null);
    setTxnError(null);
    setCatsOpen(false);
    setSortNote(null);
    setEditingSavings(false);
    setEditSaved(null);
    setAddKind(null);
  }

  // Fetch for the current month — also called after a transaction action
  // (recategorize/dispute) so totals, sections, and grade recompute
  // server-side. No client math for any of it.
  const loadMonth = useCallback(async () => {
    const res = await fetch(`/api/budget?month=${month}`, { credentials: "same-origin" });
    if (res.status === 401) { onLocked(); return; }
    if (res.status === 404) {
      const body = await res.json().catch(() => ({}) as { gatedTxnCount?: number });
      setData(null); setNotFound(true); setGatedTxnCount(body.gatedTxnCount ?? 0); setLoading(false);
      onMonthsChanged();
      return;
    }
    if (!res.ok) { setLoading(false); return; }
    const d: CashflowData = await res.json();
    setData(d); setNotFound(false); setGatedTxnCount(0); setLoading(false);
    onMonthsChanged();
  }, [month, onLocked, onMonthsChanged]);

  // "Sync Month" — un-gates a backfill month by explicit choice (spec
  // 2026-07-28). Server re-validates everything; this just calls the action
  // and renders whatever comes back, same as any other write path here.
  const onSyncMonth = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/budget", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync-month", month }),
      });
      if (res.status === 401) { onLocked(); return; }
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setData(body as CashflowData); setNotFound(false); setGatedTxnCount(0);
        onMonthsChanged();
        return;
      }
      setSyncError(typeof body.error === "string" ? body.error : "Couldn't sync this month");
    } catch {
      setSyncError("Couldn't reach the app server");
    } finally {
      setSyncing(false);
    }
  }, [month, onLocked, onMonthsChanged]);

  // ── fetch on global month change ───────────────────────────────────────────
  useEffect(() => {
    let stale = false;
    (async () => { if (!stale) await loadMonth(); })().catch(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [loadMonth]);

  // Transaction actions from the drill-down ⋯ popover (spec 2026-07-28): this
  // is the read-only page's edit path — edit the transaction, never the
  // sheet. Close the popover, call the API, re-fetch so everything recomputes.
  const onTxnAction = useCallback<OnTxnAction>(
    async (id, action, opts) => {
      setOpenTxnMenu(null);
      const body =
        action === "category"
          ? { id, action, categoryId: opts?.categoryId }
          : { id, action, to: opts?.to, categoryId: opts?.categoryId };
      const res = await fetch("/api/transactions", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) { onLocked(); return; }
      if (res.ok) await loadMonth();
    },
    [onLocked, loadMonth],
  );

  // Categories modal actions — add (POST), rename (PATCH), delete (DELETE).
  // Each re-fetches on success so the modal's list is the saved list;
  // errors render inside the modal. Resolves true when the change landed.
  const catCall = useCallback(
    async (method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>): Promise<boolean> => {
      setModalBusy(true);
      setModalError(null);
      try {
        const res = await fetch("/api/categories", {
          method,
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 401) { onLocked(); return false; }
        const resBody = await res.json().catch(() => ({}));
        if (!res.ok) {
          setModalError(typeof resBody.error === "string" ? resBody.error : "Couldn't save");
          return false;
        }
        catsChanged.current = true;
        await loadMonth();
        return true;
      } catch {
        setModalError("Couldn't reach the app server");
        return false;
      } finally {
        setModalBusy(false);
      }
    },
    [onLocked, loadMonth],
  );

  // Closing the categories modal after an edit re-sorts transactions against
  // the new list: rules first, then the optional AI pass over whatever is
  // still Uncategorized. One pass per editing session, not one per change.
  const closeCats = useCallback(async () => {
    setCatsOpen(false);
    setModalError(null);
    if (!catsChanged.current) return;
    catsChanged.current = false;
    setSortNote("Sorting transactions into your categories…");
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sort" }),
      });
      if (res.status === 401) { onLocked(); return; }
      const body = await res.json().catch(() => ({}));
      await loadMonth();
      const n = (body.byRules ?? 0) + (body.ai?.categorized ?? 0);
      const status = body.ai?.status;
      setSortNote(
        !res.ok ? "Couldn't re-sort transactions — they stay where they are."
        : status === "no-key" ? `Categories saved.${n > 0 ? ` ${n} transaction${n === 1 ? "" : "s"} sorted by your rules.` : ""} AI sorting is off (no API key).`
        : status === "failed" || status === "refusal" ? "Categories saved. AI sorting didn't run this time — your rules still apply."
        : n > 0 ? `Categories saved. ${n} transaction${n === 1 ? "" : "s"} sorted.`
        : "Categories saved.",
      );
    } catch {
      setSortNote("Couldn't re-sort transactions — they stay where they are.");
    }
  }, [onLocked, loadMonth]);

  // Bulk re-route for a savings destination: every transaction in the row
  // through the same PUT the single-txn popover uses. Sequential — the
  // counts are small and the server recomputes once on the final re-fetch.
  const onMoveAllSaved = useCallback(
    async (row: CashflowRow, to: "income" | "disputed" | "expense", categoryId?: number) => {
      setModalBusy(true);
      try {
        for (const t of row.txns) {
          const res = await fetch("/api/transactions", {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: t.id, action: "move", to, categoryId }),
          });
          if (res.status === 401) { onLocked(); return; }
        }
        setEditSaved(null);
        await loadMonth();
      } finally {
        setModalBusy(false);
      }
    },
    [onLocked, loadMonth],
  );

  // Manual cash entry: POST, close the modal, re-fetch so totals recompute
  // server-side like every other write here. Errors render inside the modal.
  const onAddTxn = useCallback(
    async (input: { label: string; amount: number; date: string; categoryId?: number }) => {
      if (!addKind) return;
      setAddBusy(true);
      setAddError(null);
      try {
        const res = await fetch("/api/transactions", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: addKind, month, ...input }),
        });
        if (res.status === 401) { onLocked(); return; }
        const resBody = await res.json().catch(() => ({}));
        if (!res.ok) {
          setAddError(typeof resBody.error === "string" ? resBody.error : "Couldn't add");
          return;
        }
        setAddKind(null);
      } catch {
        setAddError("Couldn't reach the app server");
        return;
      } finally {
        setAddBusy(false);
      }
      // Outside the try: the row is saved by now, and a reload failure must
      // not surface as an "add" error in a modal that has already closed.
      await loadMonth();
    },
    [addKind, month, onLocked, loadMonth],
  );

  // One popover open at a time.
  const onToggleTxnMenu = useCallback((id: number) => {
    setOpenTxnMenu((cur) => (cur === id ? null : id));
  }, []);
  const onCloseTxnMenu = useCallback(() => {
    setOpenTxnMenu(null);
  }, []);

  // Rename a transaction's display label from its row popover.
  const onRenameTxn = useCallback(
    async (id: number, label: string) => {
      setOpenTxnMenu(null);
      const res = await fetch("/api/transactions", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "rename", label }),
      });
      if (res.status === 401) { onLocked(); return; }
      if (res.ok) await loadMonth();
    },
    [onLocked, loadMonth],
  );

  // Re-date a transaction (the ⋯ menu's Month row). The server can refuse —
  // an unsynced or imported month — and that reason has to reach the user,
  // or the edit would just seem to do nothing.
  const onSetTxnDate = useCallback(
    async (id: number, date: string) => {
      setOpenTxnMenu(null);
      setTxnError(null);
      const res = await fetch("/api/transactions", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "date", date }),
      });
      if (res.status === 401) { onLocked(); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setTxnError(typeof body.error === "string" ? body.error : "Couldn't change the date");
        return;
      }
      await loadMonth();
    },
    [onLocked, loadMonth],
  );

  useEffect(() => {
    if (!plusOpen) return;
    const onDown = (e: MouseEvent) => {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) setPlusOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [plusOpen]);

  const header = (
    <div className="mb-5 flex items-center justify-between">
      <h1 className="text-xl font-extrabold" style={{ color: INK }}>Cash Flow</h1>
      <MonthPicker month={month} onChange={onMonthChange} dataMonths={dataMonths} min={monthMin} max={monthMax}>
        <div ref={plusRef} className="relative">
          <button
            type="button"
            aria-label="Export"
            title="Export this month (.xlsx)"
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ border: `1px solid ${LINE}`, background: CARD, color: MUTED }}
            onClick={() => setPlusOpen((o) => !o)}
          >⋯</button>
          {plusOpen && (
            <div
              className="absolute right-0 z-20 p-2"
              style={{
                top: 38, background: CARD, border: `1px solid ${LINE}`,
                borderRadius: 14, boxShadow: "0 8px 30px rgba(16,17,20,.12)", width: 230,
              }}
            >
              {!notFound && (
                <button style={MENU_ITEM} {...menuItemHover}
                  onClick={() => { setPlusOpen(false); window.location.href = `/api/budget/export?month=${month}`; }}>
                  Export this month (.xlsx)
                </button>
              )}
            </div>
          )}
        </div>
      </MonthPicker>
    </div>
  );

  if (loading) {
    return <div>{header}<div className="p-10 text-sm" style={{ color: MUTED }}>Loading…</div></div>;
  }

  if (notFound || !data) {
    if (gatedTxnCount > 0) {
      return (
        <div>
          {header}
          <div className="rounded-2xl p-10 text-center" style={{ background: CARD, border: `1px solid ${LINE}` }}>
            <div className="text-sm" style={{ color: INK }}>This month has history waiting.</div>
            <div className="mx-auto mt-2 max-w-md text-sm" style={{ color: MUTED }}>
              {gatedTxnCount} transactions from your linked accounts are ready. Sync this month to
              build it — unsynced months never count against you.
            </div>
            <button
              type="button"
              className="mt-4 rounded-full px-5 py-2.5 text-[13px] font-semibold"
              style={{ background: INK, color: "#fff", cursor: syncing ? "default" : "pointer", opacity: syncing ? 0.6 : 1 }}
              disabled={syncing}
              onClick={onSyncMonth}
            >
              {syncing ? "Syncing…" : "Sync Month"}
            </button>
            {syncError && <div className="mt-2 text-xs" style={{ color: MUTED }}>{syncError}</div>}
          </div>
        </div>
      );
    }
    return (
      <div>
        {header}
        <div className="rounded-2xl p-10 text-center" style={{ background: CARD, border: `1px solid ${LINE}` }}>
          <div className="text-sm" style={{ color: INK }}>Nothing here yet.</div>
          <div className="mx-auto mt-2 max-w-md text-sm" style={{ color: MUTED }}>
            Cash Flow builds itself from your transactions — there&apos;s nothing to set up.
            Link an account under Connections and this month fills in on the next sync.
          </div>
        </div>
      </div>
    );
  }

  const rate = data.totalIncome > 0 ? pct(data.saved, data.totalIncome) : null;
  const { grade, gradeColor, gradeBg } = gradeFor(data.totalIncome, data.totalWants, data.saved);
  const needsRows = data.expenses.filter((e) => e.grp === "need");
  const businessRows = data.expenses.filter((e) => e.grp === "business");
  const wantsRows = data.expenses.filter((e) => e.grp !== "need" && e.grp !== "business");
  // Manual entries only on months that derive from transactions. A stored
  // (sheet-imported / pre-redesign) month never reads transactions — the row
  // would either never show or silently replace the stored numbers.
  const canAdd = data.source === "derived";

  return (
    <div>
      {header}

      {txnError && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-xs"
             style={{ background: SOFT, color: INK }}>
          <span>{txnError}</span>
          <button type="button" aria-label="Dismiss" style={{ color: MUTED, cursor: "pointer" }}
                  onClick={() => setTxnError(null)}><X size={14} /></button>
        </div>
      )}

      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <Tile label="Income" value={usd(data.totalIncome)} color={GOOD} />
        <Tile label="Expenses" value={usd(data.totalExpenses)} color={BAD} />
        {/* "Left over" = income − expenses (owner ruling 2026-07-28: the tile
            row must reconcile — income − expenses = saved — so this can't
            bind to the Savings card's total below). Renamed from "Saved" to
            "Left over" since a "Savings" card on the same page showing a
            different number made "Saved" read ambiguous. */}
        <Tile label="Left over" value={usd(data.saved)} color={data.saved < 0 ? BAD : INK} />
        <Tile label="Savings rate" value={rate === null ? "—" : `${rate}%`} bg={gradeBg}
              color={gradeColor} sub={grade === "—" ? undefined : grade} subColor={gradeColor} />
      </div>

      <div className="mb-4 rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${LINE}` }}>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-bold" style={{ color: INK }}>Income</h2>
          {canAdd && (
            <button type="button" style={EDIT_BTN} {...editBtnHover}
              onClick={() => { setAddError(null); setAddKind("income"); }}>Add</button>
          )}
        </div>
        {data.income.length === 0 && (
          <div className="py-3 text-sm" style={{ color: MUTED }}>No income this month.</div>
        )}
        {data.income.map((row) => (
          <Row key={row.label} row={row} total={data.totalIncome} valueColor={GOOD} area="income"
               open={openRow === `i:${row.label}`}
               onToggle={() => setOpenRow(openRow === `i:${row.label}` ? null : `i:${row.label}`)}
               openTxnMenu={openTxnMenu} onToggleTxnMenu={onToggleTxnMenu} onCloseTxnMenu={onCloseTxnMenu}
               onOpenPicker={setPicker} onRenameTxn={onRenameTxn} onSetTxnDate={onSetTxnDate} />
        ))}
      </div>

      <div className="rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${LINE}` }}>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-bold" style={{ color: INK }}>Expenses</h2>
          <div className="flex gap-2">
            {canAdd && (
              <button type="button" style={EDIT_BTN} {...editBtnHover}
                onClick={() => { setAddError(null); setAddKind("expense"); }}>Add</button>
            )}
            <button
              type="button"
              style={EDIT_BTN}
              {...editBtnHover}
              aria-haspopup="dialog"
              onClick={() => { setModalError(null); setSortNote(null); setCatsOpen(true); }}
            >
              Edit
            </button>
          </div>
        </div>
        {sortNote && <div role="status" className="mb-3 text-xs" style={{ color: MUTED }}>{sortNote}</div>}
        {data.expenses.length === 0 && (
          <div className="py-3 text-sm" style={{ color: MUTED }}>No expenses this month.</div>
        )}
        {needsRows.length > 0 && (
          <>
            <div className="text-[11px] mt-0 mb-1" style={{ color: MUTED }}>NEEDS</div>
            {needsRows.map((row) => (
              <Row key={row.label} row={row} total={data.totalExpenses} valueColor={BAD} area="expense"
                   open={openRow === `e:${row.label}`}
                   onToggle={() => setOpenRow(openRow === `e:${row.label}` ? null : `e:${row.label}`)}
                   openTxnMenu={openTxnMenu} onToggleTxnMenu={onToggleTxnMenu} onCloseTxnMenu={onCloseTxnMenu}
                   onOpenPicker={setPicker} onRenameTxn={onRenameTxn} onSetTxnDate={onSetTxnDate} />
            ))}
          </>
        )}
        {wantsRows.length > 0 && (
          <>
            <div className={`text-[11px] mb-1 ${needsRows.length > 0 ? "mt-4" : "mt-0"}`} style={{ color: MUTED }}>WANTS</div>
            {wantsRows.map((row) => (
              <Row key={row.label} row={row} total={data.totalExpenses} valueColor={BAD} area="expense"
                   open={openRow === `e:${row.label}`}
                   onToggle={() => setOpenRow(openRow === `e:${row.label}` ? null : `e:${row.label}`)}
                   openTxnMenu={openTxnMenu} onToggleTxnMenu={onToggleTxnMenu} onCloseTxnMenu={onCloseTxnMenu}
                   onOpenPicker={setPicker} onRenameTxn={onRenameTxn} onSetTxnDate={onSetTxnDate} />
            ))}
          </>
        )}
        {/* Business — its own section beside Needs and Wants (Alena
            2026-11-14): in Expenses, in neither the Needs nor Wants total */}
        {businessRows.length > 0 && (
          <>
            <div className={`text-[11px] mb-1 ${needsRows.length > 0 || wantsRows.length > 0 ? "mt-4" : "mt-0"}`} style={{ color: MUTED }}>BUSINESS</div>
            {businessRows.map((row) => (
              <Row key={row.label} row={row} total={data.totalExpenses} valueColor={BAD} area="expense"
                   open={openRow === `e:${row.label}`}
                   onToggle={() => setOpenRow(openRow === `e:${row.label}` ? null : `e:${row.label}`)}
                   openTxnMenu={openTxnMenu} onToggleTxnMenu={onToggleTxnMenu} onCloseTxnMenu={onCloseTxnMenu}
                   onOpenPicker={setPicker} onRenameTxn={onRenameTxn} onSetTxnDate={onSetTxnDate} />
            ))}
          </>
        )}
        {/* Disputed folder — negated charges stay visible for audit, no
            share bar, counted in no total (spec Alena 2026-07-28) */}
        {data.disputed && (
          <div className={data.expenses.length > 0 ? "mt-4" : "mt-0"}>
            <Row row={data.disputed} total={data.totalExpenses} valueColor={MUTED} area="disputed"
                 open={openRow === "d:Disputed"}
                 onToggle={() => setOpenRow(openRow === "d:Disputed" ? null : "d:Disputed")}
                 openTxnMenu={openTxnMenu} onToggleTxnMenu={onToggleTxnMenu} onCloseTxnMenu={onCloseTxnMenu}
                 onOpenPicker={setPicker} onRenameTxn={onRenameTxn} onSetTxnDate={onSetTxnDate} />
          </div>
        )}
        {/* Transfer folder — everything set aside as a transfer: the
            classifier's own (card payments, own-account moves, ATM/cash
            withdrawals) plus the user's moves. Visible so each can be
            re-filed, counted in no total (Alena 2026-11-14) */}
        {data.transfers && (
          <div className={data.expenses.length > 0 || data.disputed ? "mt-4" : "mt-0"}>
            <Row row={data.transfers} total={data.totalExpenses} valueColor={MUTED} area="transfer"
                 open={openRow === "t:Transfer"}
                 onToggle={() => setOpenRow(openRow === "t:Transfer" ? null : "t:Transfer")}
                 openTxnMenu={openTxnMenu} onToggleTxnMenu={onToggleTxnMenu} onCloseTxnMenu={onCloseTxnMenu}
                 onOpenPicker={setPicker} onRenameTxn={onRenameTxn} onSetTxnDate={onSetTxnDate} />
          </div>
        )}
      </div>

      {/* Savings — income that became investments (txn_class='saved'). Not
          the same number as the "Left over" tile above: that tile is
          income − expenses, this is money actively moved into savings/
          investment destinations — a different, deliberate number. */}
      <div className="mt-4 rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${LINE}` }}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold" style={{ color: INK }}>
            Savings
            {data.savedRows.length > 0 && (
              <span className="num ml-3 text-[13px] font-semibold" style={{ color: GOOD }}>{usd(data.totalSaved)}</span>
            )}
          </h2>
          <div className="flex gap-2">
            {canAdd && (
              <button type="button" style={EDIT_BTN} {...editBtnHover}
                onClick={() => { setAddError(null); setAddKind("saved"); }}>Add</button>
            )}
            <button
              type="button"
              style={EDIT_BTN}
              {...editBtnHover}
              onClick={() => { setEditingSavings((v) => !v); setEditSaved(null); setOpenRow(null); }}
            >
              {editingSavings ? "Done" : "Edit"}
            </button>
          </div>
        </div>
        {data.savedRows.length === 0 && (
          <div className="py-3 text-sm" style={{ color: MUTED }}>
            Nothing saved this month. Transfers into savings or investments land
            here automatically — or move any transaction here from its ⋯ menu.
          </div>
        )}
        {/* % base is INCOME, not the section total — "Acorns is 6% of what
            I earned", never a self-referential 100% (spec Alena 2026-07-28) */}
        {data.savedRows.map((row) => (
          <Row key={row.label} row={row} total={data.totalIncome} valueColor={GOOD} area="saved"
               open={openRow === `s:${row.label}`}
               onToggle={() => setOpenRow(openRow === `s:${row.label}` ? null : `s:${row.label}`)}
               openTxnMenu={openTxnMenu} onToggleTxnMenu={onToggleTxnMenu} onCloseTxnMenu={onCloseTxnMenu}
               onOpenPicker={setPicker} onRenameTxn={onRenameTxn} onSetTxnDate={onSetTxnDate}
               onEdit={editingSavings ? () => setEditSaved(row) : undefined} />
        ))}
      </div>

      {addKind && (
        <AddTxnModal
          key={addKind}
          kind={addKind}
          month={month}
          categories={data.categories}
          busy={addBusy}
          error={addError}
          onClose={() => setAddKind(null)}
          onAdd={onAddTxn}
        />
      )}
      {picker && (
        <TxnPickerModal
          key={picker.id}
          target={picker}
          categories={data.categories}
          onTxnAction={onTxnAction}
          onClose={() => setPicker(null)}
        />
      )}
      {catsOpen && (
        <CategoriesModal
          categories={data.categories}
          busy={modalBusy}
          error={modalError}
          onClose={() => void closeCats()}
          onAdd={(name, grp) => catCall("POST", { action: "add", name, grp })}
          onEdit={(id, patch) => catCall("PATCH", { id, ...patch })}
          onDelete={(id) => void catCall("DELETE", { id })}
        />
      )}
      {editSaved && (
        <SavedRowModal
          key={editSaved.label}
          row={editSaved}
          categories={data.categories}
          busy={modalBusy}
          onClose={() => setEditSaved(null)}
          onMoveAll={(to, categoryId) => onMoveAllSaved(editSaved, to, categoryId)}
        />
      )}
    </div>
  );
}
