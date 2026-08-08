"use client";

import { useEffect, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { usd, usd0 } from "@/lib/format";
import type { SubscriptionsData } from "@/lib/types";
import { INK, MUTED, BAD, SOFT, LINE, CARD } from "@/lib/colors"; // BAD = recurring charges, money out
import { CARD as CARD_SHELL } from "@/lib/styles";
import { MonthPicker } from "@/components/month-picker";

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Walk a month string forward or back by delta months */
// ─── CalendarGrid ─────────────────────────────────────────────────────────────

interface CalendarGridProps {
  data: SubscriptionsData;
  /** bumped on each month change to re-trigger chip animations */
  animKey: number;
}

const DOWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function CalendarGrid({ data, animKey }: CalendarGridProps) {
  const cells: React.ReactNode[] = [];

  // blank leading cells
  for (let i = 0; i < data.firstDow; i++) {
    cells.push(
      <div
        key={`blank-${i}`}
        className="text-[11px] p-2"
        style={{
          minHeight: 80,
          borderRight: `1px solid ${SOFT}`,
          borderBottom: `1px solid ${SOFT}`,
          background: "#fafbfc",
          color: MUTED,
        }}
      />
    );
  }

  // day cells
  for (let day = 1; day <= data.daysInMonth; day++) {
    const events = data.events[day] ?? [];
    // nth-child(7n) = no right border on last column
    const col = (data.firstDow + day - 1) % 7;
    const isLastCol = col === 6;

    cells.push(
      <div
        key={`day-${day}-${animKey}`}
        className="text-[11px] p-2"
        style={{
          minHeight: 80,
          borderRight: isLastCol ? "none" : `1px solid ${SOFT}`,
          borderBottom: `1px solid ${SOFT}`,
          color: MUTED,
        }}
      >
        {day}
        {events.map((e, i) => (
          <span
            key={i}
            className="num text-[11px] mt-1 px-2 py-1"
            style={{
              border: `1px ${e.bill ? "dashed" : "solid"} ${LINE}`,
              borderRadius: 7,
              color: INK,
              background: e.bill ? SOFT : CARD,
              display: "block",
              fontVariantNumeric: "tabular-nums",
              // fade/slide-in animation — each chip staggers by index
              animation: `sub-chip-in 0.22s ease ${i * 0.04}s both`,
            }}
          >
            {e.name}
          </span>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* CSS keyframes injected once */}
      <style>{`
        @keyframes sub-chip-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* .cal — 7-col grid card */}
      <div
        className="rounded-2xl"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          background: CARD,
          overflow: "hidden",
          boxShadow: "0 1px 2px rgba(16,17,20,.05)",
          border: `1px solid rgba(16,17,20,.03)`,
        }}
      >
        {/* .dow headers */}
        {DOWS.map((dow) => (
          <div
            key={dow}
            className="text-[11px] p-2"
            style={{
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: MUTED,
              textAlign: "center",
              borderBottom: `1px solid ${LINE}`,
              fontWeight: 600,
            }}
          >
            {dow}
          </div>
        ))}

        {cells}
      </div>
    </>
  );
}

// ─── Right-column cards ───────────────────────────────────────────────────────

// unified line standard: label 400 muted · value 600 semantic · totals 700
function LineRow({
  label,
  value,
  bold,
  last,
  valueColor,
}: {
  label: string;
  value: React.ReactNode;
  bold?: boolean;
  /** last row in its card — no bottom divider */
  last?: boolean;
  valueColor?: string;
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 py-2 text-[13px]"
      style={{
        borderBottom: bold || last ? "none" : `1px solid ${SOFT}`,
        borderTop: bold ? `1px solid ${LINE}` : undefined,
      }}
    >
      <span style={{ color: bold ? INK : MUTED, fontWeight: bold ? 700 : 400 }}>{label}</span>
      <b className="num whitespace-nowrap" style={{ fontWeight: bold ? 700 : 600, color: valueColor ?? INK }}>{value}</b>
    </div>
  );
}

function ThisMonthCard({ tm }: { tm: SubscriptionsData["thisMonth"] }) {
  return (
    <Card
      className={CARD_SHELL}
    >
      <h2 className="text-lg font-bold mb-3" style={{ fontWeight: 700, color: INK }}>
        This Month
      </h2>
      <LineRow label="Subscriptions" value={usd(tm.subs)} valueColor={BAD} />
      <LineRow label="Bills" value={usd(tm.bills)} valueColor={BAD} last />
    </Card>
  );
}

function AnnualFeesCard({ fees }: { fees: SubscriptionsData["annualFees"] }) {
  return (
    <Card
      className={CARD_SHELL}
    >
      <h2 className="text-lg font-bold mb-3" style={{ fontWeight: 700, color: INK }}>
        Annual Fees
      </h2>
      {fees.map((f) => (
        <div
          key={f.label}
          className="flex items-center justify-between gap-2 py-2 text-[13px]"
          style={{
            borderBottom: `1px solid ${SOFT}`,
          }}
        >
          <span style={{ color: MUTED, fontWeight: 400 }}>{f.label}</span>
          <b className="num whitespace-nowrap" style={{ fontWeight: 600, color: BAD }}>{usd0(f.fee)} · {f.when}</b>
        </div>
      ))}
    </Card>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

interface SubscriptionsViewProps {
  month: string;
  onMonthChange: (m: string) => void;
  dataMonths: string[];
  monthMin?: string;
  monthMax?: string;
  onLocked: () => void;
}

export default function SubscriptionsView({ month, onMonthChange, dataMonths, monthMin, monthMax, onLocked }: SubscriptionsViewProps) {
  const [data, setData] = useState<SubscriptionsData | null>(null);
  const [animKey, setAnimKey] = useState(0);

  const load = useCallback(
    (m: string) => {
      // keep previous month's data on screen while the new one loads —
      // avoids a flash AND satisfies react-hooks/set-state-in-effect
      fetch(`/api/subscriptions?month=${m}`, { credentials: "same-origin" })
        .then((res) => {
          if (res.status === 401) { onLocked(); return null; }
          return res.json() as Promise<SubscriptionsData>;
        })
        .then((d) => {
          if (!d) return;
          setData(d);
          setAnimKey((k) => k + 1);
        })
        .catch(() => {/* leave loading state */});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => { load(month); }, [month, load]);

  if (!data) {
    return <div className="text-muted-foreground p-10">Loading…</div>;
  }

  return (
    <div>
      {/* .vhead */}
      <div className="flex items-center gap-3 mb-4">
        <h1
          className="text-xl font-extrabold"
          style={{ letterSpacing: "-0.01em", color: INK }}
        >
          Subscriptions
        </h1>

        {/* future month = projection, not history — say so */}
        {month > new Date().toISOString().slice(0, 7) && (
          <span className="text-xs" style={{ color: MUTED }}>projected</span>
        )}

        {/* global month picker — shared with Cash Flow */}
        <MonthPicker month={month} onChange={onMonthChange} dataMonths={dataMonths} min={monthMin} max={monthMax} />
      </div>

      {/* Calendar full width; summary cards row beneath */}
      <div className="grid gap-4">
        <CalendarGrid data={data} animKey={animKey} />

        {/* Bottom row: This Month | Annual Fees */}
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "repeat(2, 1fr)", alignItems: "start" }}
        >
          <ThisMonthCard tm={data.thisMonth} />
          <AnnualFeesCard fees={data.annualFees} />
        </div>
      </div>
    </div>
  );
}
