"use client";

// Cash Flow — read-only analytics (spec 2026-07-27). Numbers derive from
// transactions; the page never writes. Drill-down (expand a row to its
// transactions) replaces editing: wrong number → fix the transaction's
// category, not the sheet. Sheet-imported months render from stored JSON
// with no drill-down (txns are empty).
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { MonthPicker } from "@/components/month-picker";
import { CARD, LINE, SOFT, MUTED, INK, GOOD, BAD } from "@/lib/colors";
import { usd } from "@/lib/format";
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

function Tile({ label, value, bg, color }: { label: string; value: string; bg?: string; color?: string }) {
  return (
    <div
      className="flex-1 rounded-2xl p-4"
      style={{ background: bg ?? CARD, border: `1px solid ${LINE}` }}
    >
      <div className="text-xs2 mb-1" style={{ color: MUTED }}>{label}</div>
      <div className="num text-num-lg font-extrabold" style={{ color: color ?? INK }}>{value}</div>
    </div>
  );
}

function AllocationBar({ needs, wants, income }: { needs: number; wants: number; income: number }) {
  if (income <= 0) return null;
  const needsPct = pct(needs, income);
  const wantsPct = pct(wants, income);
  const savedPct = Math.max(0, 100 - needsPct - wantsPct);
  const seg = [
    { label: `Needs ${needsPct}%`, w: needsPct, color: INK },
    { label: `Wants ${wantsPct}%`, w: wantsPct, color: MUTED },
    { label: `Saved ${savedPct}%`, w: savedPct, color: GOOD },
  ].filter((s) => s.w > 0);
  return (
    <div className="mb-6">
      <div className="text-xs2 mb-2" style={{ color: MUTED }}>Where this month&apos;s income went</div>
      <div className="flex h-3 overflow-hidden rounded-full" role="img"
           aria-label={seg.map((s) => s.label).join(", ")}>
        {seg.map((s) => (
          <div key={s.label} style={{ width: `${s.w}%`, background: s.color }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4">
        {seg.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs2" style={{ color: MUTED }}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Row({ row, total, open, onToggle, valueColor }: {
  row: CashflowRow; total: number; open: boolean; onToggle: () => void; valueColor: string;
}) {
  const drillable = row.txns.length > 0;
  const share = pct(row.value, total);
  return (
    <div style={{ borderTop: `1px solid ${LINE}` }}>
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
            <div className="h-1 rounded-full" style={{ width: `${share}%`, background: MUTED }} />
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
            <div key={t.id} className="flex justify-between py-1 pr-8 text-xs2" style={{ color: MUTED }}>
              <span className="truncate">{t.date.slice(5)} · {t.label}</span>
              <span className="num">{usd(t.value)}</span>
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

  const [plusOpen, setPlusOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);

  // month changed → reset loading/drill-down state during render (not in the
  // effect) so the lint-checked effect below only fetches
  const [fetchedMonth, setFetchedMonth] = useState<string | null>(null);
  if (fetchedMonth !== month) {
    setFetchedMonth(month);
    setLoading(true);
    setOpenRow(null);
  }

  // ── fetch on global month change ───────────────────────────────────────────
  useEffect(() => {
    let stale = false;
    fetch(`/api/budget?month=${month}`, { credentials: "same-origin" })
      .then(async (res) => {
        if (stale) return;
        if (res.status === 401) { onLocked(); return; }
        if (res.status === 404) {
          setData(null); setNotFound(true); setLoading(false); onMonthsChanged();
          return;
        }
        if (!res.ok) { setLoading(false); return; }
        const d: CashflowData = await res.json();
        if (stale) return;
        setData(d); setNotFound(false); setLoading(false);
        onMonthsChanged();
      })
      .catch(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [month, onLocked, onMonthsChanged]);

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

  return (
    <div>
      {header}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Tile label="Income" value={usd(data.totalIncome)} color={GOOD} />
        <Tile label="Expenses" value={usd(data.totalExpenses)} color={BAD} />
        <Tile label="Saved" value={usd(data.saved)} />
        <Tile label="Savings rate" value={rate === null ? "—" : `${rate}%`} bg={SOFT} color={GOOD} />
      </div>

      <AllocationBar needs={data.totalNeeds} wants={data.totalWants} income={data.totalIncome} />

      <div className="mb-4 rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${LINE}` }}>
        <h2 className="text-num-md font-bold mb-3" style={{ color: INK }}>Expenses by category</h2>
        {data.expenses.length === 0 && (
          <div className="py-3 text-body" style={{ color: MUTED }}>No expenses this month.</div>
        )}
        {data.expenses.map((row) => (
          <Row key={row.label} row={row} total={data.totalExpenses} valueColor={BAD}
               open={openRow === `e:${row.label}`}
               onToggle={() => setOpenRow(openRow === `e:${row.label}` ? null : `e:${row.label}`)} />
        ))}
      </div>

      <div className="rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${LINE}` }}>
        <h2 className="text-num-md font-bold mb-3" style={{ color: INK }}>Income</h2>
        {data.income.length === 0 && (
          <div className="py-3 text-body" style={{ color: MUTED }}>No income this month.</div>
        )}
        {data.income.map((row) => (
          <Row key={row.label} row={row} total={data.totalIncome} valueColor={GOOD}
               open={openRow === `i:${row.label}`}
               onToggle={() => setOpenRow(openRow === `i:${row.label}` ? null : `i:${row.label}`)} />
        ))}
      </div>
    </div>
  );
}
