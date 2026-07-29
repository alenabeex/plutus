"use client";

// Cash Flow — read-only analytics (spec 2026-07-27). Numbers derive from
// transactions; the page never writes. Drill-down (expand a row to its
// transactions) replaces editing: wrong number → fix the transaction's
// category, not the sheet. Sheet-imported months render from stored JSON
// with no drill-down (txns are empty).
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown, ChevronRight, Pencil, X,
  Banknote, PiggyBank, Flag, Tag, HelpCircle,
  ShoppingCart, Utensils, Ticket, Wrench, Home, PawPrint, Gift, Fuel,
  Plane, ShoppingBag, GraduationCap, Smartphone, Receipt, Zap, Wifi,
  Shield, HeartPulse, Building2, Bitcoin,
  type LucideIcon,
} from "lucide-react";
import { MonthPicker } from "@/components/month-picker";
import { CARD, LINE, SOFT, MUTED, INK, GOOD, BAD } from "@/lib/colors";
import { usd, gradeFor } from "@/lib/format";
import type { CashflowData, CashflowRow, CashflowTxn } from "@/lib/types";

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
      <div className="text-xs2 mb-1" style={{ color: MUTED }}>{label}</div>
      <div className="num text-num-lg font-extrabold" style={{ color: color ?? INK }}>{value}</div>
      {sub && <div className="text-xs2 mt-0.5" style={{ color: subColor ?? MUTED }}>{sub}</div>}
    </div>
  );
}

// Every Cash Flow area a transaction can live in. `area` drives which move
// targets the popover offers — you can move a txn anywhere but where it
// already is. Disputed is a real area (the folder at the bottom of
// Expenses), so a disputed txn can be moved back out the same way.
export type CashflowArea = "income" | "expense" | "saved" | "disputed";

export interface TxnActionOpts {
  categoryId?: number;
  to?: CashflowArea;
}
export type OnTxnAction = (
  id: number,
  action: "category" | "move",
  opts?: TxnActionOpts,
) => void;

// Actions popover for one transaction — anchored to its own ⋯ button so
// each txn row owns its outside-click-close listener independently (same
// idiom as the header's Export popover / plusRef, just one instance per
// row instead of one for the whole view). One control (spec Alena
// 2026-07-28): title "Category", a pill showing where the txn currently
// lives (Income / Saved / Disputed / its category), whose chevron expands
// EVERY destination — all categories first, then Income, Saved, and
// Disputed last (red). Disputed is just another destination: it files the
// txn into the Disputed folder at the bottom of Expenses instead of
// deleting it from view. No standalone action links.
function TxnRow({
  t, rowLabel, area, categories, isOpen, categoryPickerOpen,
  onToggle, onClose, onToggleCategoryPicker, onTxnAction,
}: {
  t: CashflowTxn;
  rowLabel: string;
  area: CashflowArea;
  categories: { id: number; name: string; grp: "need" | "want" }[];
  isOpen: boolean;
  categoryPickerOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onToggleCategoryPicker: () => void;
  onTxnAction: OnTxnAction;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

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

  const isExpense = area === "expense";
  const chipCats = isExpense ? categories.filter((c) => c.name !== rowLabel) : categories;
  const pill: React.CSSProperties = {
    border: `1px solid ${LINE}`, color: MUTED, cursor: "pointer",
  };
  // Where the txn lives right now — the pill's face
  const currentLabel =
    area === "income" ? "Income"
    : area === "saved" ? "Savings"
    : area === "disputed" ? "Disputed"
    : rowLabel;
  const chip = (label: string, onClick: () => void, color?: string) => (
    <button
      key={label}
      type="button"
      className="rounded-full px-2.5 py-1 text-xs2"
      style={{ border: `1px solid ${LINE}`, color: color ?? MUTED, cursor: "pointer" }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = SOFT)}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-3 px-1 py-1 text-xs2" style={{ color: MUTED }}>
      <div className="flex min-w-0 flex-1 justify-between">
        <span className="truncate">{t.date.slice(5)} · {t.label}</span>
        <span className="num">{usd(t.value)}</span>
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
              borderRadius: 14, boxShadow: "0 8px 30px rgba(16,17,20,.12)", width: 240,
            }}
          >
            <div className="text-left">
              <div className="mb-1.5 text-sm2 font-semibold" style={{ color: INK }}>Category</div>
              {/* Current location, chevron expands the full destination list */}
              <button
                type="button"
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs2"
                style={pill}
                aria-expanded={categoryPickerOpen}
                aria-haspopup="listbox"
                onClick={onToggleCategoryPicker}
              >
                {currentLabel}
                <ChevronDown size={12} aria-hidden />
              </button>
              {categoryPickerOpen && (
                <div className="mt-1.5 flex flex-wrap gap-1.5" role="listbox" aria-label="Move to">
                  {chipCats.map((c) =>
                    chip(c.name, () =>
                      // same-area category change keeps the rule-learning path;
                      // cross-area lands as an expense in that category
                      isExpense
                        ? onTxnAction(t.id, "category", { categoryId: c.id })
                        : onTxnAction(t.id, "move", { to: "expense", categoryId: c.id }),
                    ),
                  )}
                  {area !== "income" && chip("Income", () => onTxnAction(t.id, "move", { to: "income" }))}
                  {area !== "saved" && chip("Savings", () => onTxnAction(t.id, "move", { to: "saved" }))}
                  {area !== "disputed" && chip("Disputed", () => onTxnAction(t.id, "move", { to: "disputed" }), BAD)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <span className="w-[15px]" aria-hidden />
    </div>
  );
}

// Row icon — a real glyph in the Net Worth-style avatar circle (T8.1: Net
// Worth is the view template every view matches). Keyword-matched so renamed
// or custom categories still land on something sensible; Tag is the fallback.
const ICON_RULES: [RegExp, LucideIcon][] = [
  [/rent|housing|mortgage|apartment/i, Building2],
  [/utilit|electric|power/i, Zap],
  [/phone|internet|wifi/i, Wifi],
  [/insurance/i, Shield],
  [/medical|health|doctor|dental/i, HeartPulse],
  [/app|subs/i, Smartphone],
  [/grocer/i, ShoppingCart],
  [/eat|restaurant|dining|food/i, Utensils],
  [/event|ent\b|entertain/i, Ticket],
  [/mainten|repair/i, Wrench],
  [/gas|fuel/i, Fuel],
  [/pet/i, PawPrint],
  [/gift/i, Gift],
  [/travel|parking|flight|hotel/i, Plane],
  [/shop|personal/i, ShoppingBag],
  [/education|training|course|school/i, GraduationCap],
  [/interest|fee|violation/i, Receipt],
  [/crypto|coin|bitcoin/i, Bitcoin],
  [/home|house|misc|maint/i, Home],
  [/uncategorized/i, HelpCircle],
];

function rowIcon(label: string, area: CashflowArea): LucideIcon {
  if (area === "income") return Banknote;
  if (area === "disputed") return Flag;
  const matched = ICON_RULES.find(([re]) => re.test(label))?.[1];
  // saved destinations keyword-match too (Crypto → Bitcoin), piggy bank otherwise
  if (area === "saved") return matched ?? PiggyBank;
  return matched ?? Tag;
}

function Row({
  row, total, open, onToggle, valueColor, area, categories,
  openTxnMenu, categoryPickerOpen, onToggleTxnMenu, onCloseTxnMenu, onToggleCategoryPicker, onTxnAction,
  onEdit,
}: {
  row: CashflowRow; total: number; open: boolean; onToggle: () => void; valueColor: string;
  area: CashflowArea;
  categories: { id: number; name: string; grp: "need" | "want" }[];
  openTxnMenu: number | null;
  categoryPickerOpen: boolean;
  onToggleTxnMenu: (id: number) => void;
  onCloseTxnMenu: () => void;
  onToggleCategoryPicker: () => void;
  onTxnAction: OnTxnAction;
  /** edit mode: clicking the row opens the category modal instead of drilling */
  onEdit?: () => void;
}) {
  const drillable = row.txns.length > 0;
  const share = pct(row.value, total);
  // The Disputed folder shows no share bar or % — its amounts are negated,
  // so a share of expenses would be a lie (spec Alena 2026-07-28).
  const noBar = area === "disputed";
  // rowIcon returns one of a fixed set of static lucide components, so this
  // is a lookup, not a component created during render — createElement keeps
  // the react-hooks/static-components lint honest about that.
  const icon = createElement(rowIcon(row.label, area), { size: 17 });
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
            <div className="flex justify-between text-sm2" style={{ color: INK }}>
              <span className="truncate">{row.label}</span>
              <span className="num font-semibold" style={{ color: valueColor }}>{usd(row.value)}</span>
            </div>
            {!noBar && (
              <div className="mt-1.5 h-1 rounded-full" style={{ background: SOFT }}>
                <div className="h-1 rounded-full" style={{ width: `${share}%`, background: valueColor }} />
              </div>
            )}
          </div>
          {!noBar && <span className="num w-9 text-right text-xs2" style={{ color: MUTED }}>{share}%</span>}
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
        <div className="mb-2 ml-3 border-l-2 pl-3" style={{ borderColor: LINE }}>
          {row.txns.map((t) => (
            <TxnRow
              key={t.id}
              t={t}
              rowLabel={row.label}
              area={area}
              categories={categories}
              isOpen={openTxnMenu === t.id}
              categoryPickerOpen={categoryPickerOpen}
              onToggle={() => onToggleTxnMenu(t.id)}
              onClose={onCloseTxnMenu}
              onToggleCategoryPicker={onToggleCategoryPicker}
              onTxnAction={onTxnAction}
            />
          ))}
          {area === "expense" && (
            <div className="py-1 text-xs2" style={{ color: MUTED }}>
              Wrong category? Fix it on the transaction.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Category modal (spec Alena 2026-07-28): rename + delete live here, not on
// the row. Standard modal manners: backdrop click and Escape close, the name
// field autofocuses, Enter saves, delete is two-step inside the modal.
function CategoryModal({
  cat, onClose, onRename, onDelete, busy, error,
}: {
  cat: { id: number; name: string };
  onClose: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [name, setName] = useState(cat.name);
  const [deleteArmed, setDeleteArmed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dirty = name.trim() !== cat.name && name.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      style={{ background: "rgba(16,17,20,.45)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit category ${cat.name}`}
        className="w-[320px] rounded-2xl p-6"
        style={{ background: CARD, boxShadow: "0 20px 60px rgba(16,17,20,.25)" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-h2 font-bold" style={{ color: INK }}>Edit category</h2>
          <button
            type="button"
            aria-label="Close"
            style={{ color: MUTED, cursor: "pointer" }}
            onClick={onClose}
          ><X size={16} /></button>
        </div>
        <input
          type="text"
          autoFocus
          value={name}
          maxLength={40}
          aria-label="Category name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && dirty && !busy) onRename(name.trim()); }}
          className="w-full rounded-lg px-3 py-2 text-body"
          style={{ border: `1px solid ${LINE}`, color: INK }}
        />
        {error && <div className="mt-2 text-xs2" style={{ color: BAD }}>{error}</div>}
        <button
          type="button"
          className="mt-4 w-full rounded-full py-2.5 text-sm2 font-semibold"
          style={{
            background: INK, color: "#fff",
            cursor: dirty && !busy ? "pointer" : "default",
            opacity: dirty && !busy ? 1 : 0.5,
          }}
          disabled={!dirty || busy}
          onClick={() => onRename(name.trim())}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="mt-2 w-full rounded-full py-2.5 text-sm2 font-semibold"
          style={{
            border: `1px solid ${deleteArmed ? BAD : LINE}`,
            background: deleteArmed ? "#fdf3f2" : "transparent",
            color: BAD, cursor: "pointer",
          }}
          disabled={busy}
          onClick={() => (deleteArmed ? onDelete() : setDeleteArmed(true))}
        >
          {deleteArmed ? "Really delete? Transactions become Uncategorized" : "Delete category"}
        </button>
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
  categories: { id: number; name: string; grp: "need" | "want" }[];
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
        className="w-[320px] rounded-2xl p-6"
        style={{ background: CARD, boxShadow: "0 20px 60px rgba(16,17,20,.25)" }}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-h2 font-bold" style={{ color: INK }}>{row.label}</h2>
          <button
            type="button"
            aria-label="Close"
            style={{ color: MUTED, cursor: "pointer" }}
            onClick={onClose}
          ><X size={16} /></button>
        </div>
        <div className="mb-4 text-xs2" style={{ color: MUTED }}>
          {row.txns.length} transaction{row.txns.length === 1 ? "" : "s"} · {usd(row.value)} —
          move all of them to:
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="rounded-full px-2.5 py-1 text-xs2" style={chipStyle}
            disabled={busy} onClick={() => onMoveAll("income")}>Income</button>
          {categories.map((c) => (
            <button key={c.id} type="button" className="rounded-full px-2.5 py-1 text-xs2" style={chipStyle}
              disabled={busy} onClick={() => onMoveAll("expense", c.id)}>{c.name}</button>
          ))}
          <button type="button" className="rounded-full px-2.5 py-1 text-xs2"
            style={{ ...chipStyle, color: BAD }}
            disabled={busy} onClick={() => onMoveAll("disputed")}>Disputed</button>
        </div>
        {busy && <div className="mt-3 text-xs2" style={{ color: MUTED }}>Moving…</div>}
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
  // Whether the currently-open txn popover has its category pick-list
  // expanded — one popover open at a time, so one boolean is enough.
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  // >0 when the requested month has real settled transactions but isn't
  // synced yet (spec 2026-07-28's backfill gate) — the notFound render forks
  // on this to offer "Sync Month" instead of the generic empty state.
  const [gatedTxnCount, setGatedTxnCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  // Expenses-card edit mode (spec Alena 2026-07-28): in edit mode a category
  // row opens the category modal, where rename and delete live.
  const [editing, setEditing] = useState(false);
  const [editCat, setEditCat] = useState<{ id: number; name: string } | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  // Savings-card edit mode: a destination row opens a modal that bulk-moves
  // all of its transactions somewhere else (destinations are merchant
  // groupings, so "edit" means re-route the money, not rename a label).
  const [editingSavings, setEditingSavings] = useState(false);
  const [editSaved, setEditSaved] = useState<CashflowRow | null>(null);

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
    setCategoryPickerOpen(false);
    setGatedTxnCount(0);
    setSyncError(null);
    setEditing(false);
    setEditCat(null);
    setEditingSavings(false);
    setEditSaved(null);
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
  // is the read-only page's one write path — edit the transaction, never the
  // sheet. Close the popover, call the API, re-fetch so everything recomputes.
  const onTxnAction = useCallback<OnTxnAction>(
    async (id, action, opts) => {
      setOpenTxnMenu(null);
      setCategoryPickerOpen(false);
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

  // Category modal actions — rename (PATCH) and delete (DELETE). Both close
  // the modal and re-fetch on success; errors render inside the modal.
  const modalCall = useCallback(
    async (method: "PATCH" | "DELETE", body: Record<string, unknown>) => {
      setModalBusy(true);
      setModalError(null);
      try {
        const res = await fetch("/api/categories", {
          method,
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 401) { onLocked(); return; }
        const resBody = await res.json().catch(() => ({}));
        if (!res.ok) {
          setModalError(typeof resBody.error === "string" ? resBody.error : "Couldn't save");
          return;
        }
        setEditCat(null);
        await loadMonth();
      } catch {
        setModalError("Couldn't reach the app server");
      } finally {
        setModalBusy(false);
      }
    },
    [onLocked, loadMonth],
  );

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

  // One popover open at a time: toggling a different txn's ⋯ button (or
  // closing the current one) always collapses any expanded category list.
  const onToggleTxnMenu = useCallback((id: number) => {
    setOpenTxnMenu((cur) => (cur === id ? null : id));
    setCategoryPickerOpen(false);
  }, []);
  const onCloseTxnMenu = useCallback(() => {
    setOpenTxnMenu(null);
    setCategoryPickerOpen(false);
  }, []);
  const onToggleCategoryPicker = useCallback(() => {
    setCategoryPickerOpen((v) => !v);
  }, []);

  useEffect(() => {
    if (!plusOpen) return;
    const onDown = (e: MouseEvent) => {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) setPlusOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [plusOpen]);

  const menuItem: React.CSSProperties = {
    all: "unset" as unknown as undefined,
    display: "block", width: "100%", boxSizing: "border-box",
    padding: "9px 12px", borderRadius: 10, fontSize: 13, color: INK, cursor: "pointer",
  };

  const header = (
    <div className="mb-5 flex items-center justify-between">
      <h1 className="text-h1 font-extrabold" style={{ color: INK }}>Cash Flow</h1>
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
                <button style={menuItem}
                  onClick={() => { setPlusOpen(false); window.location.href = `/api/budget/export?month=${month}`; }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = SOFT)}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}>
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
    return <div>{header}<div className="p-10 text-body" style={{ color: MUTED }}>Loading…</div></div>;
  }

  if (notFound || !data) {
    if (gatedTxnCount > 0) {
      return (
        <div>
          {header}
          <div className="rounded-2xl p-10 text-center" style={{ background: CARD, border: `1px solid ${LINE}` }}>
            <div className="text-body" style={{ color: INK }}>This month has history waiting.</div>
            <div className="mx-auto mt-2 max-w-md text-body" style={{ color: MUTED }}>
              {gatedTxnCount} transactions from your linked accounts are ready. Sync this month to
              build it — unsynced months never count against you.
            </div>
            <button
              type="button"
              className="mt-4 rounded-full px-5 py-2.5 text-sm2 font-semibold"
              style={{ background: INK, color: "#fff", cursor: syncing ? "default" : "pointer", opacity: syncing ? 0.6 : 1 }}
              disabled={syncing}
              onClick={onSyncMonth}
            >
              {syncing ? "Syncing…" : "Sync Month"}
            </button>
            {syncError && <div className="mt-2 text-xs2" style={{ color: MUTED }}>{syncError}</div>}
          </div>
        </div>
      );
    }
    return (
      <div>
        {header}
        <div className="rounded-2xl p-10 text-center" style={{ background: CARD, border: `1px solid ${LINE}` }}>
          <div className="text-body" style={{ color: INK }}>Nothing here yet.</div>
          <div className="mx-auto mt-2 max-w-md text-body" style={{ color: MUTED }}>
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
  const wantsRows = data.expenses.filter((e) => e.grp !== "need");

  return (
    <div>
      {header}

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
        <h2 className="text-num-md font-bold mb-3" style={{ color: INK }}>Income</h2>
        {data.income.length === 0 && (
          <div className="py-3 text-body" style={{ color: MUTED }}>No income this month.</div>
        )}
        {data.income.map((row) => (
          <Row key={row.label} row={row} total={data.totalIncome} valueColor={GOOD} area="income"
               open={openRow === `i:${row.label}`}
               onToggle={() => setOpenRow(openRow === `i:${row.label}` ? null : `i:${row.label}`)}
               categories={data.categories} openTxnMenu={openTxnMenu} categoryPickerOpen={categoryPickerOpen}
               onToggleTxnMenu={onToggleTxnMenu} onCloseTxnMenu={onCloseTxnMenu} onToggleCategoryPicker={onToggleCategoryPicker}
               onTxnAction={onTxnAction} />
        ))}
      </div>

      <div className="rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${LINE}` }}>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-num-md font-bold" style={{ color: INK }}>Expenses</h2>
          <button
            type="button"
            style={EDIT_BTN}
            {...editBtnHover}
            onClick={() => { setEditing((v) => !v); setEditCat(null); setOpenRow(null); }}
          >
            {editing ? "Done" : "Edit"}
          </button>
        </div>
        {data.expenses.length === 0 && (
          <div className="py-3 text-body" style={{ color: MUTED }}>No expenses this month.</div>
        )}
        {needsRows.length > 0 && (
          <>
            <div className="text-label mt-0 mb-1" style={{ color: MUTED }}>NEEDS</div>
            {needsRows.map((row) => {
              const cat = data.categories.find((c) => c.name === row.label);
              return (
                <Row key={row.label} row={row} total={data.totalExpenses} valueColor={BAD} area="expense"
                     open={openRow === `e:${row.label}`}
                     onToggle={() => setOpenRow(openRow === `e:${row.label}` ? null : `e:${row.label}`)}
                     categories={data.categories} openTxnMenu={openTxnMenu} categoryPickerOpen={categoryPickerOpen}
                     onToggleTxnMenu={onToggleTxnMenu} onCloseTxnMenu={onCloseTxnMenu} onToggleCategoryPicker={onToggleCategoryPicker}
                     onTxnAction={onTxnAction}
                     onEdit={editing && cat ? () => { setModalError(null); setEditCat(cat); } : undefined} />
              );
            })}
          </>
        )}
        {wantsRows.length > 0 && (
          <>
            <div className={`text-label mb-1 ${needsRows.length > 0 ? "mt-4" : "mt-0"}`} style={{ color: MUTED }}>WANTS</div>
            {wantsRows.map((row) => {
              const cat = data.categories.find((c) => c.name === row.label);
              return (
                <Row key={row.label} row={row} total={data.totalExpenses} valueColor={BAD} area="expense"
                     open={openRow === `e:${row.label}`}
                     onToggle={() => setOpenRow(openRow === `e:${row.label}` ? null : `e:${row.label}`)}
                     categories={data.categories} openTxnMenu={openTxnMenu} categoryPickerOpen={categoryPickerOpen}
                     onToggleTxnMenu={onToggleTxnMenu} onCloseTxnMenu={onCloseTxnMenu} onToggleCategoryPicker={onToggleCategoryPicker}
                     onTxnAction={onTxnAction}
                     onEdit={editing && cat ? () => { setModalError(null); setEditCat(cat); } : undefined} />
              );
            })}
          </>
        )}
        {/* Disputed folder — negated charges stay visible for audit, no
            share bar, counted in no total (spec Alena 2026-07-28) */}
        {data.disputed && (
          <div className={needsRows.length > 0 || wantsRows.length > 0 ? "mt-4" : "mt-0"}>
            <Row row={data.disputed} total={data.totalExpenses} valueColor={MUTED} area="disputed"
                 open={openRow === "d:Disputed"}
                 onToggle={() => setOpenRow(openRow === "d:Disputed" ? null : "d:Disputed")}
                 categories={data.categories} openTxnMenu={openTxnMenu} categoryPickerOpen={categoryPickerOpen}
                 onToggleTxnMenu={onToggleTxnMenu} onCloseTxnMenu={onCloseTxnMenu} onToggleCategoryPicker={onToggleCategoryPicker}
                 onTxnAction={onTxnAction} />
          </div>
        )}
      </div>

      {/* Savings — income that became investments (txn_class='saved'). Not
          the same number as the "Left over" tile above: that tile is
          income − expenses, this is money actively moved into savings/
          investment destinations — a different, deliberate number. */}
      <div className="mt-4 rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${LINE}` }}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-num-md font-bold" style={{ color: INK }}>
            Savings
            {data.savedRows.length > 0 && (
              <span className="num ml-3 text-sm2 font-semibold" style={{ color: GOOD }}>{usd(data.totalSaved)}</span>
            )}
          </h2>
          <button
            type="button"
            style={EDIT_BTN}
            {...editBtnHover}
            onClick={() => { setEditingSavings((v) => !v); setEditSaved(null); setOpenRow(null); }}
          >
            {editingSavings ? "Done" : "Edit"}
          </button>
        </div>
        {data.savedRows.length === 0 && (
          <div className="py-3 text-body" style={{ color: MUTED }}>
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
               categories={data.categories} openTxnMenu={openTxnMenu} categoryPickerOpen={categoryPickerOpen}
               onToggleTxnMenu={onToggleTxnMenu} onCloseTxnMenu={onCloseTxnMenu} onToggleCategoryPicker={onToggleCategoryPicker}
               onTxnAction={onTxnAction}
               onEdit={editingSavings ? () => setEditSaved(row) : undefined} />
        ))}
      </div>

      {editCat && (
        <CategoryModal
          key={editCat.id}
          cat={editCat}
          busy={modalBusy}
          error={modalError}
          onClose={() => setEditCat(null)}
          onRename={(name) => modalCall("PATCH", { id: editCat.id, name })}
          onDelete={() => modalCall("DELETE", { id: editCat.id })}
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
