"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Check, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { usd, usd0, monthLabel } from "@/lib/format";
import type { BudgetData } from "@/lib/types";
import { INK, MUTED, LINE, SOFT, GOOD, BAD, CARD } from "@/lib/colors";
import { CARD as CARD_SHELL } from "@/lib/styles";
import { MonthPicker } from "@/components/month-picker";
// GOOD = income · savings · money in. BAD = expenses · liabilities · money out.
// (product-designer skill: green/red are reserved for money direction only.)

// ─── Bar-chart geometry (mirror renderBudget) ──────────────────────────────────
const BW     = 30;
const GAP    = 17;
const X0     = 18;
const BASE_Y = 140;
const MAX_H  = 120;

// ─── Line row — ONE typographic standard for every money line ─────────────────
// label: 400 muted · value: 600 tabular in a semantic color · totals: 700 both.
// Green = money in (income/savings), red = money out (expenses), muted = zero.
interface LineProps {
  label: string;
  value: string;
  total?: boolean;
  flush?: boolean;
  /** semantic color for the value; zeros are auto-muted regardless */
  valueColor?: string;
  editMode?: boolean;
  numericValue?: number;
  onChangeValue?: (v: number) => void;
  /** when set (with editMode), the label becomes editable too */
  onChangeLabel?: (label: string) => void;
}

function Line({
  label,
  value,
  total,
  flush,
  valueColor,
  editMode,
  numericValue,
  onChangeValue,
  onChangeLabel,
}: LineProps) {
  const zero = numericValue !== undefined && numericValue === 0 && !total;
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 py-2 border-b text-sm2",
        "border-b-[var(--soft,#eef0f3)] last:border-b-0",
        total && "border-t border-t-[var(--line,#e3e5e9)] border-b-0",
        flush && "mt-auto",
      )}
      style={{
        borderBottomColor: total ? "transparent" : SOFT,
        borderTopColor: total ? LINE : undefined,
      }}
    >
      {editMode && onChangeLabel !== undefined ? (
        <input
          type="text"
          className="border border-border rounded px-1 py-0 flex-1 min-w-0 text-sm2"
          defaultValue={label}
          onChange={(e) => onChangeLabel(e.target.value)}
        />
      ) : (
        <span style={{ color: total ? INK : MUTED, fontWeight: total ? 700 : 400 }}>
          {label}
        </span>
      )}
      {editMode && onChangeValue !== undefined ? (
        <input
          type="number"
          step="0.01"
          className="num text-right border border-border rounded px-1 py-0 w-28 text-sm2"
          style={{ fontVariantNumeric: "tabular-nums" }}
          defaultValue={numericValue ?? 0}
          onChange={(e) => onChangeValue(parseFloat(e.target.value) || 0)}
        />
      ) : (
        <b
          className="num"
          style={{
            fontWeight: zero ? 400 : total ? 700 : 600,
            color: zero ? MUTED : valueColor ?? INK,
          }}
        >
          {value}
        </b>
      )}
    </div>
  );
}

// ─── Pencil edit / save button ─────────────────────────────────────────────────
function EditButton({
  editing,
  saving,
  onClick,
}: {
  editing: boolean;
  saving: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={editing ? "Save" : "Edit"}
      title={editing ? "Save changes" : "Edit items"}
      onClick={onClick}
      disabled={saving}
      style={{
        all: "unset" as unknown as undefined,
        cursor: "pointer",
        border: `1px solid ${editing ? GOOD : LINE}`,
        borderRadius: 10,
        padding: "4px 8px",
        color: editing ? GOOD : MUTED,
        background: "var(--card, #ffffff)",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: "var(--text-xs2, 12px)",
        fontWeight: 600,
        opacity: saving ? 0.5 : 1,
      }}
    >
      {editing ? (
        <>
          <Check size={13} strokeWidth={2.5} /> Save
        </>
      ) : (
        <Pencil size={13} strokeWidth={2} />
      )}
    </button>
  );
}

// ─── Variable bar chart ────────────────────────────────────────────────────────
function VarBarChart({ cats }: { cats: { label: string; value: number }[] }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // defer one frame so CSS transition fires
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [cats]);

  const max = Math.max(...cats.map((c) => c.value), 1);

  return (
    <svg
      viewBox="0 0 640 170"
      width="100%"
      role="img"
      aria-label="Wants expenses bar chart"
    >
      <line x1="10" y1="140" x2="630" y2="140" stroke={LINE} />
      {cats.map((c, i) => {
        const x = X0 + i * (BW + GAP);
        const fullH = c.value > 0 ? Math.max(4, (c.value / max) * MAX_H) : 2;
        const animH = ready ? fullH : 2;
        const animY = ready ? BASE_Y - fullH : BASE_Y - 2;
        const fill = c.value > 0 ? BAD : "#d7d9de"; // expenses = money out = red
        const short = c.label.split(/[ /]/)[0].slice(0, 6);
        return (
          <g key={i}>
            <rect
              x={x}
              y={animY}
              width={BW}
              height={animH}
              fill={fill}
              rx={3}
              style={{ transition: "y 0.5s ease, height 0.5s ease" }}
            />
            <text
              x={x}
              y={152}
              fontSize={10}
              fill={MUTED}
            >
              {short}
            </text>
            {/* every bar shows its price; zeros stay unlabeled (grey stub reads as zero) */}
            {c.value > 0 && (
              <text
                x={x + BW / 2}
                y={BASE_Y - fullH - 6}
                textAnchor="middle"
                fontSize={10}
                fill={BAD}
                fontWeight={600}
              >
                {usd0(c.value)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Edit-state helpers ────────────────────────────────────────────────────────
type EditableIncome = { label: string; value: number }[];
type EditableFixed = { label: string; value: number }[];
type EditableVariable = { label: string; value: number }[];

// ─── Main component ────────────────────────────────────────────────────────────
interface BudgetViewProps {
  month: string;
  onMonthChange: (m: string) => void;
  dataMonths: string[];
  monthMin?: string;
  monthMax?: string;
  onMonthsChanged: () => void;
  onLocked: () => void;
}

export default function BudgetView({ month, onMonthChange, dataMonths, monthMin, monthMax, onMonthsChanged, onLocked }: BudgetViewProps) {
  const [data, setData] = useState<BudgetData | null>(null);
  // month has no sheet yet (404) — offer to create it
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  // "+" menu open state
  const [plusOpen, setPlusOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);

  // Edit mode per card: "income" | "expenses" | null
  const [editCard, setEditCard] = useState<"income" | "expenses" | null>(null);

  // Mutable copies while editing
  const editIncome = useRef<EditableIncome>([]);
  const editTaxSetAside = useRef<number>(0);
  const editFixed = useRef<EditableFixed>([]);
  const editVariable = useRef<EditableVariable>([]);

  const [saving, setSaving] = useState(false);

  // start editing income — extracted so "+ create" can auto-open it
  const startEditIncomeFor = useCallback((d: BudgetData) => {
    editIncome.current = d.income.map((i) => ({ ...i }));
    editTaxSetAside.current = d.taxSetAside;
    setEditCard("income");
  }, []);

  // month changed → reset loading/edit state during render (not in the
  // effect) so the lint-checked effect below only fetches
  const [fetchedMonth, setFetchedMonth] = useState<string | null>(null);
  if (fetchedMonth !== month) {
    setFetchedMonth(month);
    setLoading(true);
    setEditCard(null);
  }

  // ── fetch on global month change ───────────────────────────────────────────
  useEffect(() => {
    let stale = false;
    fetch(`/api/budget?month=${month}`, { credentials: "same-origin" })
      .then(async (res) => {
        if (stale) return;
        if (res.status === 401) { onLocked(); return; }
        if (res.status === 404) { setData(null); setNotFound(true); setLoading(false); return; }
        if (!res.ok) { setLoading(false); return; }
        const d: BudgetData = await res.json();
        if (stale) return;
        setData(d);
        setNotFound(false);
        setLoading(false);
      })
      .catch(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [month, onLocked]);

  // close + menu on outside click
  useEffect(() => {
    if (!plusOpen) return;
    const onDown = (e: MouseEvent) => {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) setPlusOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [plusOpen]);

  // ── create month (copy mode — carries fixed bills forward). Creates the
  //    VIEWED month if it has no sheet; otherwise the next month after the
  //    latest. Auto-opens income edit.
  const createMonth = useCallback(async (mode: "copy") => {
    setPlusOpen(false);
    const res = await fetch("/api/budget", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "new", mode, ...(notFound ? { month } : {}) }),
    });
    if (res.status === 401) { onLocked(); return; }
    if (!res.ok) return;
    const d: BudgetData = await res.json();
    setData(d);
    setNotFound(false);
    onMonthsChanged();
    if (d.month !== month) onMonthChange(d.month);
    startEditIncomeFor(d); // a fresh month's first job: enter income
  }, [month, notFound, onLocked, onMonthChange, onMonthsChanged, startEditIncomeFor]);

  // ── edit helpers ───────────────────────────────────────────────────────────
  function startEditIncome(d: BudgetData) {
    startEditIncomeFor(d);
  }

  function startEditExpenses(d: BudgetData) {
    editFixed.current = d.fixed.map((f) => ({ ...f }));
    editVariable.current = d.variable.map((v) => ({ ...v }));
    setEditCard("expenses");
  }

  async function saveIncome() {
    if (!data || saving) return;
    setSaving(true);
    const res = await fetch("/api/budget", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: data.month,
        income: editIncome.current,
        taxSetAside: editTaxSetAside.current,
      }),
    });
    setSaving(false);
    if (res.status === 401) { onLocked(); return; }
    if (res.status === 409) {
      // closed month — revert
      setEditCard(null);
      return;
    }
    if (!res.ok) { setEditCard(null); return; }
    const updated: BudgetData = await res.json();
    setData(updated);
    setEditCard(null);
  }

  async function saveExpenses() {
    if (!data || saving) return;
    setSaving(true);
    const res = await fetch("/api/budget", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: data.month,
        fixed: editFixed.current,
        variable: editVariable.current,
      }),
    });
    setSaving(false);
    if (res.status === 401) { onLocked(); return; }
    if (res.status === 409) {
      setEditCard(null);
      return;
    }
    if (!res.ok) { setEditCard(null); return; }
    const updated: BudgetData = await res.json();
    setData(updated);
    setEditCard(null);
  }

  // ── header (always rendered — picker must work even on empty months) ──────
  const menuItem: React.CSSProperties = {
    all: "unset" as unknown as undefined,
    cursor: "pointer",
    display: "block",
    padding: "8px 14px",
    fontSize: "var(--text-sm2, 13px)",
    color: INK,
    fontWeight: 600,
    borderRadius: 8,
    width: "calc(100% - 28px)",
  };

  const header = (
    <div className="flex items-center gap-3 mb-4">
      <h1 className="text-h1 font-extrabold" style={{ letterSpacing: "-0.01em", color: INK }}>
        Cash Flow
      </h1>
      <MonthPicker month={month} onChange={onMonthChange} dataMonths={dataMonths} min={monthMin} max={monthMax}>
        {/* + menu */}
        <div ref={plusRef} className="relative">
          <button
            aria-label="Export"
            title="Export this month (.xlsx)"
            onClick={() => setPlusOpen((v) => !v)}
            style={{
              all: "unset" as unknown as undefined,
              cursor: "pointer",
              background: CARD,
              borderRadius: 10,
              width: 30,
              height: 30,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: MUTED,
              boxShadow: "0 1px 2px rgba(16,17,20,.05)",
            }}
          >
            <MoreHorizontal size={15} strokeWidth={2.5} />
          </button>
          {plusOpen && (
            <div
              className="absolute right-0 z-20 p-2"
              style={{
                top: 38,
                background: CARD,
                border: `1px solid ${LINE}`,
                borderRadius: 14,
                boxShadow: "0 8px 30px rgba(16,17,20,.12)",
                width: 230,
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

  // ── loading / empty month states ───────────────────────────────────────────
  if (loading) {
    return (
      <div>
        {header}
        <div className="text-muted-foreground p-10">Loading…</div>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div>
        {header}
        <div
          className={cn(CARD_SHELL, "py-10 px-5 text-center")}
        >
          <div className="text-h2 mb-1" style={{ fontWeight: 700 }}>
            No sheet for {monthLabel(month)} yet
          </div>
          <div className="text-sm2 mb-4" style={{ color: MUTED }}>
            Fixed bills carry forward from last month automatically.
          </div>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => createMonth("copy")}
              style={{
                all: "unset" as unknown as undefined, cursor: "pointer",
                border: `1px solid ${LINE}`, borderRadius: 10, padding: "8px 14px",
                fontSize: "var(--text-sm2, 13px)", fontWeight: 600, background: "#fff", color: INK,
              }}
            >
              Start this month
            </button>
          </div>
        </div>
      </div>
    );
  }

  const d = data;
  const s = d.savings;

  return (
    <div>
      {header}

      {/* ── Income · Expenses · Savings — static summary band ────────────────── */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4 items-start mb-4">
        {/* ── Income summary ──────────────────────────────────────────────── */}
        <div className={cn(CARD_SHELL, "flex items-center justify-between gap-3 min-w-0")}>
          <h2 className="text-num-md font-bold" style={{ color: INK }}>
            Income
          </h2>
          <span className="num text-num-md font-extrabold whitespace-nowrap" style={{ color: GOOD }}>
            {usd(d.totalIncome)}
          </span>
        </div>

        {/* ── Expenses summary ────────────────────────────────────────────── */}
        <div className={cn(CARD_SHELL, "flex items-center justify-between gap-3 min-w-0")}>
          <h2 className="text-num-md font-bold" style={{ color: INK }}>
            Expenses
          </h2>
          <span className="num text-num-md font-extrabold whitespace-nowrap" style={{ color: BAD }}>
            {usd(d.totalFixed + d.totalVariable)}
          </span>
        </div>

        {/* ── Savings summary ─────────────────────────────────────────────── */}
        <div className={cn(CARD_SHELL, "flex items-center justify-between gap-3 min-w-0")}>
          <h2 className="text-num-md font-bold" style={{ color: INK }}>
            Savings
          </h2>
          <span
            className="num text-num-md font-extrabold whitespace-nowrap"
            style={{ color: s.amount >= 0 ? GOOD : BAD }}
          >
            {usd(s.amount)}
          </span>
        </div>
      </div>

      {/* ── Income · Expenses · Savings — full-width itemized cards ──────────── */}
      <div className="flex flex-col gap-4 mb-4">
        {/* ── Income card ─────────────────────────────────────────────────── */}
        <div className={cn(CARD_SHELL, "flex flex-col")}>
          {/* title + pencil — total lives in the summary band */}
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-num-md font-bold" style={{ color: INK }}>
              Income
            </h2>
            <EditButton
              editing={editCard === "income"}
              saving={saving}
              onClick={() =>
                editCard === "income" ? saveIncome() : startEditIncome(d)
              }
            />
          </div>

          {/* income items — money in = green */}
          {d.income.map((item, i) => (
            <Line
              key={i}
              label={item.label}
              value={usd(item.value)}
              valueColor={GOOD}
              numericValue={item.value}
              editMode={editCard === "income"}
              onChangeValue={(v) => {
                editIncome.current[i] = { ...editIncome.current[i], value: v };
              }}
              onChangeLabel={(l) => {
                editIncome.current[i] = { ...editIncome.current[i], label: l };
              }}
            />
          ))}

          {/* tax set-aside — a reserve, stays neutral */}
          <Line
            label="Tax set-aside (Mail to IRS)"
            value={usd(d.taxSetAside)}
            numericValue={d.taxSetAside}
            editMode={editCard === "income"}
            onChangeValue={(v) => {
              editTaxSetAside.current = v;
            }}
          />
        </div>

        {/* ── Expenses card ────────────────────────────────────────────────── */}
        <div className={cn(CARD_SHELL, "flex flex-col")}>
          {/* title + pencil — total lives in the summary band */}
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-num-md font-bold" style={{ color: INK }}>
              Expenses
            </h2>
            <EditButton
              editing={editCard === "expenses"}
              saving={saving}
              onClick={() =>
                editCard === "expenses" ? saveExpenses() : startEditExpenses(d)
              }
            />
          </div>

          {/* Needs (fixed) */}
          <div
            className="text-label mt-4 mb-1"
            style={{
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: MUTED,
              fontWeight: 600,
            }}
          >
            Needs
          </div>

          {d.fixed.map((item, i) => (
            <Line
              key={i}
              label={item.label}
              value={usd(item.value)}
              valueColor={BAD}
              numericValue={item.value}
              editMode={editCard === "expenses"}
              onChangeValue={(v) => {
                editFixed.current[i] = { ...editFixed.current[i], value: v };
              }}
              onChangeLabel={(l) => {
                editFixed.current[i] = { ...editFixed.current[i], label: l };
              }}
            />
          ))}

          {/* Total Needs */}
          <Line
            label="Total Needs"
            value={usd(d.totalFixed)}
            valueColor={BAD}
            total
          />

          {/* Wants (variable) */}
          <div
            className="text-label mt-4 mb-1"
            style={{
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: MUTED,
              fontWeight: 600,
            }}
          >
            Wants
          </div>

          {d.variable.map((item, i) => (
            <Line
              key={i}
              label={item.label}
              value={usd(item.value)}
              valueColor={BAD}
              numericValue={item.value}
              editMode={editCard === "expenses"}
              onChangeValue={(v) => {
                editVariable.current[i] = {
                  ...editVariable.current[i],
                  value: v,
                };
              }}
              onChangeLabel={(l) => {
                editVariable.current[i] = {
                  ...editVariable.current[i],
                  label: l,
                };
              }}
            />
          ))}

          {/* Total Wants */}
          <Line
            label="Total Wants"
            value={usd(d.totalVariable)}
            valueColor={BAD}
            total
          />
        </div>

        {/* ── Savings card — derived, no pencil; total lives in the summary band ── */}
        <div className={cn(CARD_SHELL, "flex flex-col")}>
          {/* title left · result verdict top-right */}
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-num-md font-bold" style={{ color: INK }}>
              Savings
            </h2>
            <span className="text-num-md" style={{ fontWeight: 800, color: s.gradeColor }}>
              {s.grade}
            </span>
          </div>

          {/* Cash / Invested — same line standard as everywhere else */}
          <div className="mt-2">
            <Line
              label="Cash"
              value={`${s.cashPct}% · ${usd(s.cashAmt)}`}
              valueColor={s.cashAmt > 0 ? GOOD : INK}
            />
            <Line
              label="Invested (IRA · Acorns · HSA · 401k)"
              value={`${s.investedPct}% · ${usd(s.investedAmt)}`}
              valueColor={s.investedAmt > 0 ? GOOD : INK}
            />
          </div>
        </div>
      </div>

      {/* ── Wants by Category — full width ───────────────────────────────── */}
      <div
        className={cn(CARD_SHELL, "mt-4")}
      >
        <h2 className="text-num-md mb-3" style={{ fontWeight: 700 }}>
          Wants by Category
        </h2>
        <VarBarChart cats={d.variable} />
      </div>
    </div>
  );
}
