"use client";

import { useEffect, useRef, useState } from "react";
import { INK, MUTED, SOFT, LINE, CARD } from "@/lib/colors";
import { monthLabel } from "@/lib/format";

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const navBtn: React.CSSProperties = {
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
};

interface MonthPickerProps {
  month: string;               // '2026-01'
  onChange: (month: string) => void;
  /** months that have data — rendered solid in the grid; others ghosted */
  dataMonths?: string[];
  /** navigation clamp (inclusive, 'YYYY-MM') — no free time-travel */
  min?: string;
  max?: string;
  /** optional trailing slot (e.g. Cash Flow's + menu) */
  children?: React.ReactNode;
}

/** Global month control: ‹ › steppers + label that opens a month/year grid.
 *  One click to any month — no more stepping 12 times to reach last year. */
export function MonthPicker({ month, onChange, dataMonths = [], min, max, children }: MonthPickerProps) {
  // 'YYYY-MM' compares correctly as a string
  const inRange = (m: string) => (!min || m >= min) && (!max || m <= max);
  const step = (delta: number) => {
    const next = addMonths(month, delta);
    if (inRange(next)) onChange(next);
  };
  const canPrev = inRange(addMonths(month, -1));
  const canNext = inRange(addMonths(month, 1));
  const [open, setOpen] = useState(false);
  const [gridYear, setGridYear] = useState(() => parseInt(month.split("-")[0], 10));
  const rootRef = useRef<HTMLDivElement>(null);

  // sync grid year when month changes from outside — render-phase derived
  // state (not an effect), per React docs, so no cascading render
  const [lastMonth, setLastMonth] = useState(month);
  if (month !== lastMonth) {
    setLastMonth(month);
    setGridYear(parseInt(month.split("-")[0], 10));
  }

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const dataSet = new Set(dataMonths);

  return (
    <div ref={rootRef} className="relative flex items-center gap-[10px]" style={{ marginLeft: "auto" }}>
      <button
        aria-label="Previous month"
        style={{ ...navBtn, opacity: canPrev ? 1 : 0.35, pointerEvents: canPrev ? "auto" : "none" }}
        disabled={!canPrev}
        onClick={() => step(-1)}
      >
        ‹
      </button>

      <button
        aria-label="Pick month"
        onClick={() => setOpen((v) => !v)}
        className="num"
        style={{
          all: "unset" as unknown as undefined,
          cursor: "pointer",
          fontWeight: 700,
          fontSize: "var(--text-body, 14px)",
          color: INK,
          padding: "4px 8px",
          borderRadius: 10,
          background: open ? SOFT : CARD,
          border: `1px solid ${LINE}`,
          boxShadow: "0 1px 2px rgba(16,17,20,.05)",
        }}
        onMouseEnter={(e) => { if (!open) (e.currentTarget as HTMLElement).style.background = SOFT; }}
        onMouseLeave={(e) => { if (!open) (e.currentTarget as HTMLElement).style.background = CARD; }}
      >
        {monthLabel(month)}
        <span style={{ fontSize: "var(--text-xs2, 12px)", color: MUTED, marginLeft: 4 }}>▾</span>
      </button>

      <button
        aria-label="Next month"
        style={{ ...navBtn, opacity: canNext ? 1 : 0.35, pointerEvents: canNext ? "auto" : "none" }}
        disabled={!canNext}
        onClick={() => step(1)}
      >
        ›
      </button>

      {children}

      {open && (
        <div
          className="absolute right-0 z-20"
          style={{
            top: 38,
            background: CARD,
            border: `1px solid ${LINE}`,
            borderRadius: 14,
            boxShadow: "0 8px 30px rgba(16,17,20,.12)",
            padding: 14,
            width: 252,
          }}
        >
          {/* year header */}
          <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
            <button aria-label="Previous year" style={{ ...navBtn, boxShadow: "none", background: "transparent" }}
              onClick={() => setGridYear((y) => y - 1)}>
              ‹
            </button>
            <b className="num" style={{ fontSize: "var(--text-body, 14px)", fontWeight: 700 }}>{gridYear}</b>
            <button aria-label="Next year" style={{ ...navBtn, boxShadow: "none", background: "transparent" }}
              onClick={() => setGridYear((y) => y + 1)}>
              ›
            </button>
          </div>
          {/* 12-month grid */}
          <div className="grid grid-cols-4 gap-1">
            {MONTHS.map((label, i) => {
              const key = `${gridYear}-${String(i + 1).padStart(2, "0")}`;
              const selected = key === month;
              const hasData = dataSet.has(key);
              const allowed = inRange(key);
              return (
                <button
                  key={key}
                  onClick={() => { if (allowed) { onChange(key); setOpen(false); } }}
                  disabled={!allowed}
                  className="num"
                  style={{
                    all: "unset" as unknown as undefined,
                    cursor: allowed ? "pointer" : "default",
                    textAlign: "center",
                    padding: "7px 0",
                    borderRadius: 8,
                    fontSize: "var(--text-xs2, 12px)",
                    fontWeight: 600,
                    background: selected ? INK : "transparent",
                    color: selected ? "#fff" : hasData ? INK : MUTED,
                    opacity: allowed ? 1 : 0.3,
                    pointerEvents: allowed ? "auto" : "none",
                  }}
                  onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLElement).style.background = SOFT; }}
                  onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  {label}
                  {/* data dot */}
                  <span
                    style={{
                      display: "block",
                      width: 4,
                      height: 4,
                      borderRadius: 99,
                      margin: "3px auto 0",
                      background: hasData ? (selected ? "#fff" : INK) : "transparent",
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
