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
import type { CashflowData, CashflowRow } from "@/lib/types";

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

function Row({ row, total, open, onToggle, valueColor, categories, openTxnMenu, onToggleTxnMenu, onTxnAction }: {
  row: CashflowRow; total: number; open: boolean; onToggle: () => void; valueColor: string;
  categories: { id: number; name: string; grp: "need" | "want" }[];
  openTxnMenu: number | null;
  onToggleTxnMenu: (id: number) => void;
  onTxnAction: (id: number, action: "category" | "dispute", categoryId?: number) => void;
}) {
  const drillable = row.txns.length > 0;
  const share = pct(row.value, total);
  // Category chips exclude the category this row already belongs to. Empty
  // for income rows (categories prop passed as [] there) and for the
  // "Uncategorized" bucket (no real category shares that name, so nothing
  // is excluded and every category is offered).
  const chipCats = categories.filter((c) => c.name !== row.label);
  const chipStyle: React.CSSProperties = { border: `1px solid ${LINE}`, color: MUTED };
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
            <div key={t.id}>
              {/* px-1 mirrors the parent row button's padding so amounts flush-align */}
              <div className="flex items-center gap-3 px-1 py-1 text-xs2" style={{ color: MUTED }}>
                <div className="flex min-w-0 flex-1 justify-between">
                  <span className="truncate">{t.date.slice(5)} · {t.label}</span>
                  <span className="num">{usd(t.value)}</span>
                </div>
                <div className="w-9 text-right">
                  <button
                    type="button"
                    aria-label="Actions for this transaction"
                    style={{ color: MUTED, cursor: "pointer" }}
                    onClick={() => onToggleTxnMenu(t.id)}
                  >⋯</button>
                </div>
                <span className="w-[15px]" aria-hidden />
              </div>
              {openTxnMenu === t.id && (
                <div className="flex flex-wrap gap-1.5 py-1">
                  {chipCats.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="rounded-full px-2.5 py-1 text-xs2"
                      style={chipStyle}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = SOFT)}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                      onClick={() => onTxnAction(t.id, "category", c.id)}
                    >
                      {c.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="rounded-full px-2.5 py-1 text-xs2"
                    style={{ ...chipStyle, borderColor: `${BAD}66`, color: BAD }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = SOFT)}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                    onClick={() => onTxnAction(t.id, "dispute")}
                  >
                    Disputed charge
                  </button>
                </div>
              )}
            </div>
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
  }

  // Fetch for the current month — also called after a transaction action
  // (recategorize/dispute) so totals, sections, and grade recompute
  // server-side. No client math for any of it.
  const loadMonth = useCallback(async () => {
    const res = await fetch(`/api/budget?month=${month}`, { credentials: "same-origin" });
    if (res.status === 401) { onLocked(); return; }
    if (res.status === 404) {
      setData(null); setNotFound(true); setLoading(false); onMonthsChanged();
      return;
    }
    if (!res.ok) { setLoading(false); return; }
    const d: CashflowData = await res.json();
    setData(d); setNotFound(false); setLoading(false);
    onMonthsChanged();
  }, [month, onLocked, onMonthsChanged]);

  // ── fetch on global month change ───────────────────────────────────────────
  useEffect(() => {
    let stale = false;
    (async () => { if (!stale) await loadMonth(); })().catch(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [loadMonth]);

  // Transaction actions from the drill-down ⋯ menu (spec 2026-07-28): this is
  // the read-only page's one write path — edit the transaction, never the
  // sheet. Close the menu, call the API, re-fetch so everything recomputes.
  const onTxnAction = useCallback(
    async (id: number, action: "category" | "dispute", categoryId?: number) => {
      setOpenTxnMenu(null);
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
               categories={[]} openTxnMenu={openTxnMenu} onToggleTxnMenu={(id) => setOpenTxnMenu(openTxnMenu === id ? null : id)}
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
                   categories={data.categories} openTxnMenu={openTxnMenu} onToggleTxnMenu={(id) => setOpenTxnMenu(openTxnMenu === id ? null : id)}
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
                   categories={data.categories} openTxnMenu={openTxnMenu} onToggleTxnMenu={(id) => setOpenTxnMenu(openTxnMenu === id ? null : id)}
                   onTxnAction={onTxnAction} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
