"use client";

// Cash Flow — read-only analytics (spec 2026-07-27). Numbers derive from
// transactions; the page never writes. Drill-down (expand a row to its
// transactions) replaces editing: wrong number → fix the transaction's
// category, not the sheet. Sheet-imported months render from stored JSON
// with no drill-down (txns are empty).
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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

// Actions popover for one transaction — anchored to its own ⋯ button so
// each txn row owns its outside-click-close listener independently (same
// idiom as the header's Export popover / plusRef, just one instance per
// row instead of one for the whole view). Two sections: "Move to a
// different category" (expense rows only — a pill showing the txn's
// current category expands the pick list inline) and "Dispute charge"
// (always present).
function TxnRow({
  t, rowLabel, categories, isOpen, categoryPickerOpen,
  onToggle, onClose, onToggleCategoryPicker, onTxnAction,
}: {
  t: CashflowTxn;
  rowLabel: string;
  categories: { id: number; name: string; grp: "need" | "want" }[];
  isOpen: boolean;
  categoryPickerOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onToggleCategoryPicker: () => void;
  onTxnAction: (id: number, action: "category" | "dispute", categoryId?: number) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isOpen, onClose]);

  // categories=[] for income-side rows (categories are an expense concept)
  // — same signal the view already uses elsewhere to keep income/expense
  // rows apart.
  const isExpense = categories.length > 0;
  const chipCats = categories.filter((c) => c.name !== rowLabel);

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
            {isExpense && (
              <div className="mb-1.5">
                <div className="mb-1.5 text-sm2" style={{ color: INK }}>Move to a different category</div>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs2"
                  style={{ border: `1px solid ${LINE}`, color: MUTED, cursor: "pointer" }}
                  onClick={onToggleCategoryPicker}
                >
                  {rowLabel}
                  <ChevronDown size={12} aria-hidden />
                </button>
                {categoryPickerOpen && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {chipCats.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="rounded-full px-2.5 py-1 text-xs2"
                        style={{ border: `1px solid ${LINE}`, color: MUTED }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = SOFT)}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                        onClick={() => onTxnAction(t.id, "category", c.id)}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              className="text-sm2"
              style={{
                all: "unset" as unknown as undefined,
                display: "block", width: "100%", boxSizing: "border-box",
                padding: "9px 12px", borderRadius: 10, cursor: "pointer", color: BAD,
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = SOFT)}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
              onClick={() => onTxnAction(t.id, "dispute")}
            >
              Dispute charge
            </button>
          </div>
        )}
      </div>
      <span className="w-[15px]" aria-hidden />
    </div>
  );
}

function Row({
  row, total, open, onToggle, valueColor, categories,
  openTxnMenu, categoryPickerOpen, onToggleTxnMenu, onCloseTxnMenu, onToggleCategoryPicker, onTxnAction,
}: {
  row: CashflowRow; total: number; open: boolean; onToggle: () => void; valueColor: string;
  categories: { id: number; name: string; grp: "need" | "want" }[];
  openTxnMenu: number | null;
  categoryPickerOpen: boolean;
  onToggleTxnMenu: (id: number) => void;
  onCloseTxnMenu: () => void;
  onToggleCategoryPicker: () => void;
  onTxnAction: (id: number, action: "category" | "dispute", categoryId?: number) => void;
}) {
  const drillable = row.txns.length > 0;
  const share = pct(row.value, total);
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-1 py-2.5 text-left"
        style={{ cursor: drillable ? "pointer" : "default" }}
        onClick={drillable ? onToggle : undefined}
        aria-expanded={drillable ? open : undefined}
        aria-label={drillable ? `${row.label}: ${usd(row.value)} — show transactions` : undefined}
        disabled={!drillable}
      >
        <div className="min-w-0 flex-1">
          <div className="flex justify-between text-sm2" style={{ color: INK }}>
            <span className="truncate">{row.label}</span>
            <span className="num font-semibold" style={{ color: valueColor }}>{usd(row.value)}</span>
          </div>
          <div className="mt-1.5 h-1 rounded-full" style={{ background: SOFT }}>
            <div className="h-1 rounded-full" style={{ width: `${share}%`, background: valueColor }} />
          </div>
        </div>
        <span className="num w-9 text-right text-xs2" style={{ color: MUTED }}>{share}%</span>
        {drillable ? (
          open
            ? <ChevronDown size={15} style={{ color: MUTED }} aria-hidden />
            : <ChevronRight size={15} style={{ color: MUTED }} aria-hidden />
        ) : (
          <span className="w-[15px]" aria-hidden />
        )}
      </button>
      {drillable && open && (
        <div className="mb-2 ml-3 border-l-2 pl-3" style={{ borderColor: LINE }}>
          {row.txns.map((t) => (
            <TxnRow
              key={t.id}
              t={t}
              rowLabel={row.label}
              categories={categories}
              isOpen={openTxnMenu === t.id}
              categoryPickerOpen={categoryPickerOpen}
              onToggle={() => onToggleTxnMenu(t.id)}
              onClose={onCloseTxnMenu}
              onToggleCategoryPicker={onToggleCategoryPicker}
              onTxnAction={onTxnAction}
            />
          ))}
          <div className="py-1 text-xs2" style={{ color: MUTED }}>
            Wrong category? Fix it on the transaction.
          </div>
        </div>
      )}
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
  const onTxnAction = useCallback(
    async (id: number, action: "category" | "dispute", categoryId?: number) => {
      setOpenTxnMenu(null);
      setCategoryPickerOpen(false);
      const body = action === "category" ? { id, action, categoryId } : { id, action };
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
        <Tile label="Saved" value={usd(data.saved)} color={data.saved < 0 ? BAD : INK} />
        <Tile label="Savings rate" value={rate === null ? "—" : `${rate}%`} bg={gradeBg}
              color={gradeColor} sub={grade === "—" ? undefined : grade} subColor={gradeColor} />
      </div>

      <div className="mb-4 rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${LINE}` }}>
        <h2 className="text-num-md font-bold mb-3" style={{ color: INK }}>Income</h2>
        {data.income.length === 0 && (
          <div className="py-3 text-body" style={{ color: MUTED }}>No income this month.</div>
        )}
        {data.income.map((row) => (
          <Row key={row.label} row={row} total={data.totalIncome} valueColor={GOOD}
               open={openRow === `i:${row.label}`}
               onToggle={() => setOpenRow(openRow === `i:${row.label}` ? null : `i:${row.label}`)}
               categories={[]} openTxnMenu={openTxnMenu} categoryPickerOpen={categoryPickerOpen}
               onToggleTxnMenu={onToggleTxnMenu} onCloseTxnMenu={onCloseTxnMenu} onToggleCategoryPicker={onToggleCategoryPicker}
               onTxnAction={onTxnAction} />
        ))}
      </div>

      <div className="rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${LINE}` }}>
        <h2 className="text-num-md font-bold mb-3" style={{ color: INK }}>Expenses</h2>
        {data.expenses.length === 0 && (
          <div className="py-3 text-body" style={{ color: MUTED }}>No expenses this month.</div>
        )}
        {needsRows.length > 0 && (
          <>
            <div className="text-label mt-0 mb-1" style={{ color: MUTED }}>NEEDS</div>
            {needsRows.map((row) => (
              <Row key={row.label} row={row} total={data.totalExpenses} valueColor={BAD}
                   open={openRow === `e:${row.label}`}
                   onToggle={() => setOpenRow(openRow === `e:${row.label}` ? null : `e:${row.label}`)}
                   categories={data.categories} openTxnMenu={openTxnMenu} categoryPickerOpen={categoryPickerOpen}
                   onToggleTxnMenu={onToggleTxnMenu} onCloseTxnMenu={onCloseTxnMenu} onToggleCategoryPicker={onToggleCategoryPicker}
                   onTxnAction={onTxnAction} />
            ))}
          </>
        )}
        {wantsRows.length > 0 && (
          <>
            <div className={`text-label mb-1 ${needsRows.length > 0 ? "mt-4" : "mt-0"}`} style={{ color: MUTED }}>WANTS</div>
            {wantsRows.map((row) => (
              <Row key={row.label} row={row} total={data.totalExpenses} valueColor={BAD}
                   open={openRow === `e:${row.label}`}
                   onToggle={() => setOpenRow(openRow === `e:${row.label}` ? null : `e:${row.label}`)}
                   categories={data.categories} openTxnMenu={openTxnMenu} categoryPickerOpen={categoryPickerOpen}
                   onToggleTxnMenu={onToggleTxnMenu} onCloseTxnMenu={onCloseTxnMenu} onToggleCategoryPicker={onToggleCategoryPicker}
                   onTxnAction={onTxnAction} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
