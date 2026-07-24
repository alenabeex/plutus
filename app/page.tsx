"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import NetworthView from "@/components/views/networth";
import BudgetView from "@/components/views/budget";
import SubscriptionsView from "@/components/views/subscriptions";
import ConnectionsView from "@/components/views/connections";

const NAV = [
  { id: "home", label: "Net Worth" },
  { id: "budget", label: "Cash Flow" },
  { id: "subs", label: "Subscriptions" },
  { id: "conn", label: "Connections" },
] as const;
type ViewId = (typeof NAV)[number]["id"];

type PinState = "checking" | "needs-setup" | "locked" | "unlocked";

/** current calendar month, '2026-07' */
const nowMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};


export default function Home() {
  const [view, setView] = useState<ViewId>("home");
  const [pinState, setPinState] = useState<PinState>("checking");

  // Global month — Cash Flow and Subscriptions share it, so switching tabs
  // never silently jumps you to a different month.
  const [month, setMonth] = useState<string>(nowMonth());
  // Months that have cash-flow sheets (for the picker's data dots)
  const [dataMonths, setDataMonths] = useState<string[]>([]);

  const refreshMonths = useCallback(() => {
    fetch("/api/budget", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j: { months?: string[] }) => {
        if (Array.isArray(j.months)) setDataMonths(j.months);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (pinState === "unlocked") refreshMonths();
  }, [pinState, refreshMonths]);

  useEffect(() => {
    const initial = window.location.hash.slice(1) as ViewId;
    // one-time URL-hash restore on mount; can't be a lazy initializer because
    // the server render has no window and the markup must hydrate cleanly
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (NAV.some((n) => n.id === initial)) setView(initial);
    fetch("/api/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status" }),
    })
      .then((r) => r.json())
      .then((s: { set: boolean; unlocked: boolean }) =>
        setPinState(!s.set ? "needs-setup" : s.unlocked ? "unlocked" : "locked"),
      )
      .catch(() => setPinState("locked"));
  }, []);

  const pick = (id: ViewId) => {
    setView(id);
    history.replaceState(null, "", "#" + id);
  };
  const onLocked = useCallback(() => setPinState("locked"), []);

  // navigation clamp: earliest data month ↔ TODAY's month. No future months.
  const monthMin = dataMonths.length && dataMonths[0] < nowMonth() ? dataMonths[0] : nowMonth();
  const monthMax = nowMonth();

  if (pinState !== "unlocked") {
    return (
      <PinGate
        state={pinState}
        onUnlocked={() => setPinState("unlocked")}
        onNeedsUnlock={() => setPinState("locked")}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f2f3f5] text-[#16181d]">
      {/* Horizontal top bar at every width (per Alena 2026-07-22 —
          reverted from the sidebar experiment): brand above a
          scrollable tab row. */}
      <aside className="top-0 z-10 flex flex-col border-b border-[#e3e5e9] bg-[#f2f3f5] px-4 py-3">
        <div className="px-3 pb-0 text-h1 font-extrabold tracking-tight">
          Plutus
        </div>
        <nav
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pt-2"
          aria-label="Main"
        >
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => pick(n.id)}
              aria-pressed={view === n.id}
              className={cn(
                "shrink-0 cursor-pointer rounded-xl px-3 py-2.5 text-left text-body font-semibold",
                view === n.id
                  ? "bg-[#16181d] text-white"
                  : "text-[#7a7f88] hover:bg-[#e9eaee] hover:text-[#16181d]",
              )}
            >
              {n.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 max-w-[1140px] flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-9">
        {view === "home" && <NetworthView onLocked={onLocked} />}
        {view === "budget" && (
          <BudgetView
            month={month}
            onMonthChange={setMonth}
            dataMonths={dataMonths}
            monthMin={monthMin}
            monthMax={monthMax}
            onMonthsChanged={refreshMonths}
            onLocked={onLocked}
          />
        )}
        {view === "subs" && (
          <SubscriptionsView
            month={month}
            onMonthChange={setMonth}
            dataMonths={dataMonths}
            monthMin={monthMin}
            monthMax={monthMax}
            onLocked={onLocked}
          />
        )}
        {view === "conn" && <ConnectionsView onLocked={onLocked} />}
      </main>
    </div>
  );
}

/* PIN gate — plan T1.4: no data renders before PIN. */
function PinGate({
  state,
  onUnlocked,
  onNeedsUnlock,
}: {
  state: PinState;
  onUnlocked: () => void;
  onNeedsUnlock: () => void;
}) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setup = state === "needs-setup";

  // mode flipped (e.g. setup → locked because a PIN already exists):
  // clear the fields but keep any explanatory message on screen.
  // Render-phase derived reset — no effect, no cascading render.
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    setPin("");
    setConfirm("");
    setBusy(false);
  }

  async function submit() {
    setError(null);
    if (!/^\d{6}$/.test(pin)) return setError("PIN must be 6 digits");
    if (setup && pin !== confirm) return setError("PINs don't match");
    setBusy(true);
    try {
      const r = await fetch("/api/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: setup ? "set" : "unlock", pin }),
      });
      const body = await r.json();
      if (body.ok || (setup && r.ok)) return onUnlocked();
      if (setup && typeof body.error === "string" && body.error.includes("already set")) {
        // a PIN exists from an earlier attempt — switch to the unlock screen
        setError("A PIN is already set — enter it to unlock");
        onNeedsUnlock();
        return;
      }
      setError(
        body.retryInMs
          ? `Too many attempts — wait ${Math.ceil(body.retryInMs / 1000)}s`
          : typeof body.error === "string"
            ? body.error
            : setup
              ? "Couldn't set PIN"
              : "Wrong PIN",
      );
    } catch {
      setError("Couldn't reach the app server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f2f3f5] text-[#16181d]">
      <Card className="w-[320px] rounded-2xl border-none p-6 shadow-sm">
        <div className="text-h2 font-bold">
          {state === "checking"
            ? "Plutus"
            : setup
              ? "Create a 6-digit PIN"
              : "Enter PIN"}
        </div>
        {state !== "checking" && (
          <div className="mt-4 flex flex-col gap-3">
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && !setup && submit()}
              className="num rounded-lg border border-[#e3e5e9] px-3 py-2 text-center text-num-md tracking-[.4em]"
              aria-label="PIN"
            />
            {setup && (
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                className="num rounded-lg border border-[#e3e5e9] px-3 py-2 text-center text-num-md tracking-[.4em]"
                aria-label="Confirm PIN"
                placeholder="confirm"
              />
            )}
            {error && <div className="text-xs2 text-[#b04a3f]">{error}</div>}
            <Button onClick={submit} disabled={busy} className="w-full">
              {setup ? "Set PIN" : "Unlock"}
            </Button>
            <div className="text-xs2 text-[#7a7f88]">
              Locks itself after 15 minutes idle.
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
