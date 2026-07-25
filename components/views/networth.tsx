"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { usd, usd0 } from "@/lib/format";
import type { NetworthData } from "@/lib/types";
import { INK, MUTED, GOOD, BAD, SOFT, LINE } from "@/lib/colors";
import { CARD } from "@/lib/styles";

// Shared card shell (lib/styles) + this view's column layout
const VIEW_CARD = cn(CARD, "flex flex-col gap-0");

// SVG chart geometry
const SVG_W  = 720;
const SVG_H  = 190;
const X_LEFT = 40;
const X_RIGHT= 700;
const Y_BASE = 170;  // baseline (x-axis)
const Y_TOP  = 30;   // top of chart area

// ─── helpers ─────────────────────────────────────────────────────────────────

function scaledPoints(
  pts: { date: string; total: number }[]
): { x: number; y: number }[] {
  if (pts.length === 0) return [];
  if (pts.length === 1) {
    // Single point: center horizontally, mid-height
    return [{ x: (X_LEFT + X_RIGHT) / 2, y: (Y_BASE + Y_TOP) / 2 }];
  }
  const vals = pts.map((p) => p.total);
  const minV  = Math.min(...vals);
  const maxV  = Math.max(...vals);
  const rangeV = maxV - minV || 1; // avoid /0

  return pts.map((_, i) => {
    const x = X_LEFT + i * ((X_RIGHT - X_LEFT) / (pts.length - 1));
    const y = Y_BASE - ((pts[i].total - minV) / rangeV) * (Y_BASE - Y_TOP);
    return { x, y };
  });
}

/** 3 evenly-spaced y-grid labels derived from data min/max */
function gridLines(pts: { date: string; total: number }[]) {
  if (pts.length === 0) return [];
  const vals = pts.map((p) => p.total);
  const minV  = Math.floor(Math.min(...vals) / 1000) * 1000;
  const maxV  = Math.ceil(Math.max(...vals) / 1000) * 1000;
  const step  = (maxV - minV) / 2 || 10000;
  return [minV, minV + step, minV + 2 * step].map((v, i) => {
    const y = Y_BASE - (i / 2) * (Y_BASE - Y_TOP);
    const label =
      Math.abs(v) >= 1000
        ? `$${Math.round(v / 1000)}k`
        : `$${Math.round(v)}`;
    return { y, label };
  });
}

/** compact $ for deltas: $13.5k / $920 */
function usdCompactK(v: number): string {
  return Math.abs(v) >= 1000
    ? `$${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`
    : `$${Math.round(v)}`;
}

const MONTHS_S = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
/** scrub-tooltip date: "Jul 14" (+ 'YY when not current year) */
function scrubLabel(iso: string): string {
  const [y, m, d] = iso.split("-");
  const day = d ? ` ${parseInt(d)}` : "";
  const yr = parseInt(y) !== new Date().getFullYear() ? ` '${y.slice(2)}` : "";
  return `${MONTHS_S[parseInt(m) - 1]}${day}${yr}`;
}

/** x-axis date labels: first, middle, last */
function xLabels(pts: { date: string; total: number }[], scaled: { x: number; y: number }[]) {
  if (pts.length < 2) return [];
  // Short spans label with day precision ("Jul 5") so a young history never
  // renders as "Jul Jul Jul"; long spans stay month-level ("Jul '25").
  const spanDays =
    (new Date(pts[pts.length - 1].date).getTime() - new Date(pts[0].date).getTime()) / 86400000;
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-");
    const yr = parseInt(y) !== new Date().getFullYear() ? ` '${y.slice(2)}` : "";
    return spanDays <= 92 && d
      ? `${MONTHS_S[parseInt(m) - 1]} ${parseInt(d)}${yr}`
      : `${MONTHS_S[parseInt(m) - 1]}${yr}`;
  };
  const pairs: { x: number; label: string }[] = [];
  pairs.push({ x: scaled[0].x, label: fmt(pts[0].date) });
  if (pts.length > 2) {
    const mid = Math.floor((pts.length - 1) / 2);
    pairs.push({ x: scaled[mid].x, label: fmt(pts[mid].date) });
  }
  pairs.push({ x: scaled[scaled.length - 1].x, label: fmt(pts[pts.length - 1].date) });
  return pairs;
}

// ─── sub-components ──────────────────────────────────────────────────────────

interface LineChartProps {
  points: { date: string; total: number }[];
  /** true after mount — triggers draw-in animation */
  animate: boolean;
  /** reports the snapshot under the pointer while scrubbing (null on leave) */
  onScrub?: (p: { date: string; total: number } | null) => void;
}

function LineChart({ points, animate, onScrub }: LineChartProps) {
  const polyRef = useRef<SVGPolylineElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dashOffset, setDashOffset] = useState<number | null>(null);
  // measured polyline length — held in state so render never reads the ref
  const [pathLen, setPathLen] = useState<number | null>(null);
  // scrub: pointer position snaps to the nearest snapshot (click or drag)
  const [hover, setHover] = useState<number | null>(null);

  const scaled  = scaledPoints(points);
  const grids   = gridLines(points);
  const xlabels = xLabels(points, scaled);

  const ptStr = scaled.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const lastPt = scaled[scaled.length - 1];

  // Polygon fill area (close path along baseline)
  const polyFill =
    scaled.length > 0
      ? ptStr +
        ` ${X_RIGHT.toFixed(1)},${Y_BASE} ${X_LEFT.toFixed(1)},${Y_BASE}`
      : "";

  // Measure polyline length then animate stroke-dashoffset 0→0 (draw-in).
  useEffect(() => {
    if (!polyRef.current || scaled.length <= 1) return;
    const len = polyRef.current.getTotalLength();
    // Set initial state (full dasharray, offset = len = hidden)
    setPathLen(len);
    setDashOffset(len);
    // Next frame: animate to 0
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setDashOffset(0));
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length]);

  const isAnimating = dashOffset !== null;

  const handleScrub = (e: React.PointerEvent<SVGSVGElement>) => {
    if (scaled.length < 2 || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * SVG_W;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < scaled.length; i++) {
      const dist = Math.abs(scaled[i].x - x);
      if (dist < bd) { bd = dist; best = i; }
    }
    setHover(best);
    onScrub?.(points[best]);
  };
  const clearScrub = () => {
    setHover(null);
    onScrub?.(null);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      width="100%"
      role="img"
      aria-label="Net worth line chart"
      className="mt-3 cursor-crosshair"
      style={{ touchAction: "none" }}
      onPointerMove={handleScrub}
      onPointerDown={handleScrub}
      onPointerLeave={clearScrub}
    >
      {/* Grid lines */}
      {grids.map(({ y, label }, i) => (
        <g key={i}>
          <line
            x1={X_LEFT} y1={y} x2={X_RIGHT} y2={y}
            stroke={i === 0 ? LINE : SOFT}
          />
          <text x={6} y={y + 4} fontSize={10} fill={MUTED}>{label}</text>
        </g>
      ))}

      {points.length > 1 ? (
        <>
          {/* Area fill */}
          <polygon points={polyFill} fill="#f0f1f3" />

          {/* Line */}
          <polyline
            ref={polyRef}
            points={ptStr}
            fill="none"
            stroke={INK}
            strokeWidth={2}
            strokeDasharray={isAnimating ? pathLen ?? undefined : undefined}
            strokeDashoffset={dashOffset ?? undefined}
            style={animate ? { transition: "stroke-dashoffset 0.9s ease-in-out" } : undefined}
          />
        </>
      ) : null}

      {/* End dot (or single-point dot) */}
      {lastPt && (
        <circle
          cx={lastPt.x}
          cy={lastPt.y}
          r={4}
          fill={INK}
          style={animate ? { transition: "cx 0.4s ease, cy 0.4s ease" } : undefined}
        />
      )}

      {/* X-axis labels */}
      {xlabels.map(({ x, label }, i) => (
        <text key={i} x={x} y={SVG_H - 4} fontSize={10} fill={MUTED}
          textAnchor={i === 0 ? "start" : i === xlabels.length - 1 ? "end" : "middle"}>
          {label}
        </text>
      ))}

      {/* Scrub guide + tooltip — snaps to nearest snapshot */}
      {hover !== null && scaled[hover] && points[hover] && (
        <g pointerEvents="none">
          <line
            x1={scaled[hover].x} y1={Y_TOP} x2={scaled[hover].x} y2={Y_BASE}
            stroke={MUTED} strokeDasharray="3 3"
          />
          <circle cx={scaled[hover].x} cy={scaled[hover].y} r={4.5} fill={INK} />
          <text
            x={Math.min(Math.max(scaled[hover].x, 80), SVG_W - 80)}
            y={16}
            textAnchor="middle"
            fontSize={12}
            fontWeight={600}
            fill={INK}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {scrubLabel(points[hover].date)} · {usd0(points[hover].total)}
          </text>
        </g>
      )}
    </svg>
  );
}

// ─── donut chart ─────────────────────────────────────────────────────────────

interface DonutProps {
  allocation: NetworthData["allocation"];
  allocation30d: string;
  animate: boolean;
  /** hovered/selected group label — highlights its arc, center shows its share */
  focus: string | null;
  onFocus: (label: string | null) => void;
}

function DonutChart({ allocation, allocation30d, animate, focus, onFocus }: DonutProps) {
  const r = 60;
  const C = 2 * Math.PI * r;
  const total = allocation.reduce((s, a) => s + a.value, 0) || 1;
  const focused = focus ? allocation.find((a) => a.label === focus) : null;
  const focusedPct = focused ? Math.round((focused.value / total) * 1000) / 10 : 0;

  // Each arc starts where the previous ones end — derived per index, no mutation
  const arcs = allocation.map((a, i) => {
    const len = C * (a.value / total);
    const offset = allocation
      .slice(0, i)
      .reduce((s, x) => s + C * (x.value / total), 0);
    return (
      <circle
        key={a.label}
        cx={80}
        cy={80}
        r={r}
        fill="none"
        stroke={a.color}
        strokeWidth={focus === a.label ? 24 : 20}
        strokeDasharray={`${len.toFixed(1)} ${(C - len).toFixed(1)}`}
        strokeDashoffset={(-offset).toFixed(1)}
        opacity={focus && focus !== a.label ? 0.3 : 1}
        style={{
          cursor: "pointer",
          ...(animate ? { transition: "stroke-dasharray 0.5s ease, stroke-dashoffset 0.5s ease, opacity 0.15s ease, stroke-width 0.15s ease" } : {}),
        }}
        onMouseEnter={() => onFocus(a.label)}
        onMouseLeave={() => onFocus(null)}
      />
    );
  });

  return (
    <svg viewBox="0 0 160 160" width={140} height={140} role="img" aria-label="Allocation donut chart">
      <g transform="rotate(-90 80 80)">{arcs}</g>
      {focused ? (
        <>
          <text x={80} y={76} textAnchor="middle" fontSize={15} fontWeight={700} fill={INK}>
            {focusedPct}%
          </text>
          <text x={80} y={93} textAnchor="middle" fontSize={10} fill={MUTED}>
            {focused.label}
          </text>
        </>
      ) : (
        <>
          <text x={80} y={76} textAnchor="middle" fontSize={15} fontWeight={700} fill={INK}>
            {allocation30d}
          </text>
          <text x={80} y={93} textAnchor="middle" fontSize={10} fill={MUTED}>
            30-day
          </text>
        </>
      )}
    </svg>
  );
}

// ─── account row (rename by double-clicking the name — Plaid-sourced accounts
// only; manual assets keep their own name-edit path in Connections) ─────────

function AccountRow({
  item,
  valColor,
  isLast,
  onSaved,
  onLocked,
}: {
  item: NetworthData["groups"][number]["items"][number];
  valColor: string;
  isLast: boolean;
  onSaved: () => void;
  onLocked: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const renamable = item.kind !== "manual";
  // When two accounts share a name the last four moves up beside the name,
  // where it does the disambiguating — so the subtitle drops it rather than
  // printing the same four digits twice on one row.
  const maskInName = Boolean(item.ambiguous && item.mask);
  const subMask = !maskInName && item.mask ? `···${item.mask}` : "";

  const save = async (raw: string) => {
    setEditing(false);
    const nickname = raw.trim();
    if (nickname === item.name) return;
    const res = await fetch("/api/networth", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: item.id, nickname: nickname || null }),
    });
    if (res.status === 401) { onLocked(); return; }
    onSaved();
  };

  return (
    /* .acct */
    <div
      className="flex items-center gap-3 py-2"
      style={{
        borderBottom: isLast ? "none" : `1px solid ${SOFT}`,
      }}
    >
      {/* .ava — institution logo from Plaid when present, else initials */}
      {item.logo ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={`data:image/png;base64,${item.logo}`}
          alt=""
          aria-hidden
          className="shrink-0"
          style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", background: SOFT }}
        />
      ) : (
        <span
          className="flex items-center justify-center shrink-0 text-label"
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: SOFT,
            fontWeight: 700,
            color: MUTED,
          }}
          aria-hidden
        >
          {item.code}
        </span>
      )}
      {/* .who — title + subtitle, one line each, truncate overflow */}
      <span className="min-w-0 flex-1">
        {editing ? (
          <input
            key={item.name}
            type="text"
            autoFocus
            defaultValue={item.name}
            onBlur={(e) => save(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
            className="block w-full py-0.5 px-1.5 text-body font-semibold"
            style={{
              border: `1px solid ${MUTED}`,
              borderRadius: 6,
              color: INK,
              background: "#fff",
            }}
          />
        ) : (
          <b
            className="block text-body font-semibold truncate"
            style={{ color: INK, cursor: renamable ? "text" : undefined }}
            title={renamable ? "Double-click to rename" : undefined}
            onDoubleClick={renamable ? () => setEditing(true) : undefined}
          >
            {item.name}
            {maskInName ? (
              <span style={{ color: MUTED, fontWeight: 400 }}>{` ···${item.mask}`}</span>
            ) : null}
          </b>
        )}
        {item.sub || subMask ? (
          <span className="block text-xs2 truncate" style={{ color: MUTED }}>
            {[item.sub, subMask].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </span>
      {/* .val */}
      <span
        className="num text-body text-right font-semibold"
        style={{ color: valColor, fontWeight: item.value === 0 ? 400 : 600 }}
      >
        {usd(item.value)}
      </span>
    </div>
  );
}

// ─── account group (subhead + rows) ─────────────────────────────────────────

function AccountGroup({
  group,
  onSaved,
  onLocked,
}: {
  group: NetworthData["groups"][number];
  onSaved: () => void;
  onLocked: () => void;
}) {
  return (
    <div>
      {/* .subhead */}
      <div
        className="text-label mt-4 mb-1"
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: MUTED,
          fontWeight: 600,
        }}
      >
        {group.name}
      </div>

      {group.items.map((item, i) => (
        <AccountRow
          key={item.id}
          item={item}
          // semantic direction: assets green, liabilities red, zero muted
          valColor={item.value === 0 ? MUTED : group.type === "liability" ? BAD : GOOD}
          isLast={i === group.items.length - 1}
          onSaved={onSaved}
          onLocked={onLocked}
        />
      ))}
    </div>
  );
}

// ─── umbrella card (Assets / Liabilities) ────────────────────────────────────

function UmbrellaCard({
  label,
  type,
  total,
  groups,
  onSaved,
  onLocked,
}: {
  label: string;
  type: "asset" | "liability";
  total: number;
  groups: NetworthData["groups"];
  onSaved: () => void;
  onLocked: () => void;
}) {
  const filtered = groups.filter((g) => g.type === type);
  const pos = type === "asset";
  return (
    <Card className={VIEW_CARD}>
      {/* .spread header */}
      <div className="flex items-center justify-between mb-1">
        <h2
          className="text-num-md font-bold"
          style={{ color: INK }}
        >
          {label}
        </h2>
        {/* .amt */}
        <span
          className="num text-num-md font-extrabold"
          style={{ color: pos ? GOOD : BAD }}
        >
          {usd(total)}
        </span>
      </div>

      {filtered.map((g) => (
        <AccountGroup key={g.name} group={g} onSaved={onSaved} onLocked={onLocked} />
      ))}
    </Card>
  );
}

// ─── main view ───────────────────────────────────────────────────────────────

const RANGES = ["1M", "6M", "1Y", "All"] as const;
type Range = (typeof RANGES)[number];
const RANGE_DAYS: Record<Exclude<Range, "All">, number> = { "1M": 30, "6M": 183, "1Y": 365 };
// Captured at module load so render stays pure — range cutoffs are day-granular,
// so drift within a session is invisible.
const LOADED_AT_MS = Date.now();
const RANGE_PERIOD: Record<Range, string> = {
  "1M": "this month", "6M": "past 6 months", "1Y": "past year", All: "all time",
};

export default function NetworthView({ onLocked }: { onLocked: () => void }) {
  const [data, setData] = useState<NetworthData | null>(null);
  const [animated, setAnimated] = useState(false);
  const [range, setRange] = useState<Range>("All");
  // chart scrub — while set, the hero shows this snapshot instead of today
  const [scrub, setScrub] = useState<{ date: string; total: number } | null>(null);
  const [allocFocus, setAllocFocus] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/networth", { credentials: "same-origin" })
      .then((res) => {
        if (res.status === 401) { onLocked(); return null; }
        return res.json() as Promise<NetworthData>;
      })
      .then((d) => {
        if (!d) return;
        setData(d);
        // Trigger animations after data arrives
        requestAnimationFrame(() => setAnimated(true));
      })
      .catch(() => {/* network error — leave loading state */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!data) {
    return (
      <div className="text-muted-foreground p-10">Loading…</div>
    );
  }

  // Filter snapshots to the selected range (client-side — API returns all)
  const allPoints = data.chart.points;
  let points = allPoints;
  if (range !== "All") {
    const cutoff = new Date(LOADED_AT_MS - RANGE_DAYS[range] * 86400000)
      .toISOString()
      .slice(0, 10);
    const filtered = allPoints.filter((p) => p.date >= cutoff);
    points = filtered.length > 0 ? filtered : allPoints.slice(-1);
  }

  // Delta over the visible range: first vs last visible snapshot
  const first = points[0];
  const last = points[points.length - 1];
  const deltaAbs = points.length > 1 ? last.total - first.total : 0;
  const deltaPct =
    points.length > 1 && first.total !== 0
      ? Math.round((deltaAbs / first.total) * 1000) / 10
      : 0;
  const hasDelta = points.length > 1 && deltaAbs !== 0;
  const up = deltaAbs >= 0;

  return (
    <div>
      {/* Top grid: chart card + allocation card — stacks under lg */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[1.7fr_1fr]">
        {/* ── hero / chart card ── */}
        <Card className={VIEW_CARD}>
          {/* .spread */}
          <div className="flex items-start justify-between gap-2">
            <div>
              {/* label swaps to the scrubbed date while sliding the chart */}
              <div className="text-xs2" style={{ color: MUTED }}>
                {scrub ? scrubLabel(scrub.date) : "Total Net Worth"}
              </div>
              {/* hero number — follows the scrub position */}
              <div
                className="num text-display font-extrabold"
                style={{
                  letterSpacing: "-0.02em",
                  color: INK,
                  lineHeight: 1.15,
                }}
              >
                {usd((scrub ?? data).total)}
              </div>
              {/* delta — one line, single semantic color; recolors + recomputes per range */}
              <div className="flex items-baseline gap-2 text-sm2">
                {hasDelta ? (
                  <span className="num font-semibold" style={{ color: up ? GOOD : BAD }}>
                    {usdCompactK(Math.abs(deltaAbs))}{" "}
                    <span className="text-xs2 font-normal">
                      ({up ? "+" : "−"}{Math.abs(deltaPct)}% {RANGE_PERIOD[range]})
                    </span>
                  </span>
                ) : points.length > 1 ? (
                  <span style={{ color: MUTED }}>— flat {RANGE_PERIOD[range]}</span>
                ) : (
                  <span style={{ color: MUTED }}>— not enough history {range === "All" ? "yet" : `for ${range}`}</span>
                )}
              </div>
            </div>
            {/* range picker */}
            <span className="flex items-center gap-1 shrink-0">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  aria-pressed={r === range}
                  className="text-xs2"
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    padding: "3px 8px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: r === range ? 700 : 500,
                    color: r === range ? "#fff" : MUTED,
                    background: r === range ? INK : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (r !== range) (e.currentTarget as HTMLButtonElement).style.background = SOFT;
                  }}
                  onMouseLeave={(e) => {
                    if (r !== range) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  }}
                >
                  {r}
                </button>
              ))}
            </span>
          </div>

          <LineChart points={points} animate={animated} onScrub={setScrub} />
        </Card>

        {/* ── allocation card ── */}
        <Card className={VIEW_CARD}>
          <h2
            className="text-num-md font-bold mb-3"
            style={{ color: INK }}
          >
            Allocation
          </h2>
          <div className="flex items-center gap-4">
            <DonutChart
              allocation={data.allocation}
              allocation30d={data.allocation30d}
              animate={animated}
              focus={allocFocus}
              onFocus={setAllocFocus}
            />
            {/* .leg — hover a row to highlight its slice */}
            <div className="flex flex-col gap-2 flex-1">
              {data.allocation.map((a) => (
                /* .l */
                <div
                  key={a.label}
                  className="flex items-center gap-2 text-sm2"
                  style={{
                    cursor: "default",
                    borderRadius: 6,
                    padding: "2px 4px",
                    margin: "-2px -4px",
                    background: allocFocus === a.label ? SOFT : "transparent",
                    opacity: allocFocus && allocFocus !== a.label ? 0.45 : 1,
                    transition: "opacity 0.15s ease, background 0.15s ease",
                  }}
                  onMouseEnter={() => setAllocFocus(a.label)}
                  onMouseLeave={() => setAllocFocus(null)}
                >
                  {/* .dot */}
                  <span
                    className="shrink-0 rounded-full"
                    style={{ width: 8, height: 8, background: a.color, display: "inline-block" }}
                    aria-hidden
                  />
                  <span style={{ color: INK }}>{a.label}</span>
                  <b className="num ml-auto font-semibold" style={{ color: INK }}>
                    {usd(a.value)}
                  </b>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Bottom grid: Assets + Liabilities umbrella cards — stacks under sm */}
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 mt-4">
        <UmbrellaCard
          label="Assets"
          type="asset"
          total={data.assets}
          groups={data.groups}
          onSaved={load}
          onLocked={onLocked}
        />
        <UmbrellaCard
          label="Liabilities"
          type="liability"
          total={data.liabilities}
          groups={data.groups}
          onSaved={load}
          onLocked={onLocked}
        />
      </div>
    </div>
  );
}
