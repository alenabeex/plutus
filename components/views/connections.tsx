"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { MoreHorizontal, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { usd0 } from "@/lib/format";
import type { ConnectionsData } from "@/lib/types";
import { CARD } from "@/lib/styles";

// ─── constants ───────────────────────────────────────────────────────────────
const INK   = "#16181d";
const MUTED = "#7a7f88";
const LINE  = "#e3e5e9";
const SOFT  = "#eef0f3";
const GOOD  = "#3e7c52";
const BAD   = "#b04a3f";

// ─── Plaid Link wrapper ───────────────────────────────────────────────────────
// Isolated so usePlaidLink only mounts when we have a token.

interface PlaidLinkActivatorProps {
  linkToken: string;
  onSuccess: (public_token: string, institutionName: string, institutionId: string | null) => void;
  onExit: () => void;
  /** called with the open() fn once ready */
  onReady: (open: () => void) => void;
}

function PlaidLinkActivator({ linkToken, onSuccess, onExit, onReady }: PlaidLinkActivatorProps) {
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (public_token, metadata) => {
      onSuccess(
        public_token,
        metadata.institution?.name ?? "Unknown",
        metadata.institution?.institution_id ?? null,
      );
    },
    onExit: () => onExit(),
  });

  useEffect(() => {
    if (ready) {
      onReady(() => open());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return null;
}

// ─── ConfirmRemoveDialog — one modal for every destructive remove ────────────
// Never confirm inline in a row: overlay + Cancel / Remove, backdrop + Esc cancel.
function ConfirmRemoveDialog({
  label,
  onCancel,
  onConfirm,
}: {
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(16,17,20,0.32)" }}
      onClick={onCancel}
    >
      <div className={CARD} style={{ width: 320 }} onClick={(e) => e.stopPropagation()}>
        <p className="text-num-md" style={{ fontWeight: 700, color: INK }}>
          Remove {label}?
        </p>
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            style={{
              all: "unset", cursor: "pointer", border: `1px solid ${LINE}`, borderRadius: 8,
              padding: "8px 12px", fontSize: 13, fontWeight: 600, color: MUTED, background: "#fff",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              all: "unset", cursor: "pointer", border: `1px solid ${BAD}`, borderRadius: 8,
              padding: "8px 12px", fontSize: 13, fontWeight: 600, color: "#fff", background: BAD,
            }}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ManualAssetRow ──────────────────────────────────────────────────────────

interface ManualAssetRowProps {
  id: number;
  label: string;
  value: number;
  isLast: boolean;
  onSaved: () => void;
  onLocked: () => void;
}

function ManualAssetRow({ id, label, value, isLast, onSaved, onLocked }: ManualAssetRowProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // per-row edit mode — entered from this row's ⋯ menu
  const [editing, setEditing] = useState(false);

  // uncontrolled input (defaultValue keyed to value) — reads on blur, no draft
  // state, so the row never fights the server value after a reload.
  const save = async (raw: string) => {
    setEditing(false); // blur/Enter always exits the row's edit mode
    const parsed = parseFloat(raw);
    if (isNaN(parsed) || parsed === value) return;
    const res = await fetch("/api/connections", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manualAssetId: id, value: parsed }),
    });
    if (res.status === 401) { onLocked(); return; }
    onSaved();
  };

  const remove = async () => {
    const res = await fetch("/api/connections", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manualAssetId: id }),
    });
    if (res.status === 401) { onLocked(); return; }
    onSaved();
  };

  return (
    <>
    {/* .line */}
    <div
      className="flex items-center justify-between gap-2 py-2 text-sm2 num"
      style={{
        borderBottom: isLast ? "none" : `1px solid ${SOFT}`,
      }}
    >
      <span style={{ color: MUTED, fontWeight: 400 }}>{label}</span>
      {editing ? (
        <span className="flex items-center gap-2">
          <input
            key={value}
            type="number"
            defaultValue={value}
            onBlur={(e) => save(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="py-1 px-2 text-sm2"
            style={{
              width: 90,
              border: `1px solid ${MUTED}`,
              borderRadius: 6,
              fontVariantNumeric: "tabular-nums",
              color: INK,
              background: "#fff",
            }}
          />
          <button
            aria-label={`Remove ${label}`}
            title="Remove"
            onClick={() => setConfirmRemove(true)}
            style={{
              all: "unset", cursor: "pointer", color: MUTED,
              display: "inline-flex", alignItems: "center", padding: 2,
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = BAD)}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = MUTED)}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </span>
      ) : (
        <span className="relative flex items-center gap-2">
          <b className="num" style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: GOOD }}>
            {usd0(value)}
          </b>
          {/* ⋯ row menu — delete without entering edit mode */}
          <button
            aria-label={`Options for ${label}`}
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              all: "unset", cursor: "pointer", color: MUTED,
              borderRadius: 8, padding: "4px 4px", display: "inline-flex", alignItems: "center",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = INK)}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = MUTED)}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <span
              className="absolute right-0 z-20 p-1"
              style={{
                top: 26, background: "#fff", border: `1px solid ${SOFT}`,
                borderRadius: 10, boxShadow: "0 8px 30px rgba(16,17,20,.12)",
              }}
            >
              <button
                onClick={() => { setMenuOpen(false); setEditing(true); }}
                style={{
                  all: "unset", cursor: "pointer", display: "block",
                  padding: "6px 14px", fontSize: 12, fontWeight: 600,
                  color: INK, borderRadius: 8, whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = SOFT)}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
              >
                Edit
              </button>
              <button
                onClick={() => { setMenuOpen(false); setConfirmRemove(true); }}
                style={{
                  all: "unset", cursor: "pointer", display: "block",
                  padding: "6px 14px", fontSize: 12, fontWeight: 600,
                  color: BAD, borderRadius: 8, whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = SOFT)}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
              >
                Remove…
              </button>
            </span>
          )}
        </span>
      )}
    </div>

    {/* remove-confirmation dialog — not inline, floats over the whole view */}
    {confirmRemove && (
      <ConfirmRemoveDialog
        label={label}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => { remove(); setConfirmRemove(false); }}
      />
    )}
    </>
  );
}

// ─── NewManualAssetRow ───────────────────────────────────────────────────────

interface NewManualAssetRowProps {
  onSaved: () => void;
  onCancel: () => void;
  onLocked: () => void;
}

function NewManualAssetRow({ onSaved, onCancel, onLocked }: NewManualAssetRowProps) {
  const [label, setLabel] = useState("");
  const [draft, setDraft] = useState("");
  const labelRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => labelRef.current?.focus(), 0);
  }, []);

  const valid = label.trim().length > 0 && draft.trim() !== "" && !isNaN(parseFloat(draft));

  const save = async () => {
    if (!valid) return;
    const res = await fetch("/api/connections", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim(), value: parseFloat(draft) }),
    });
    if (res.status === 401) { onLocked(); return; }
    onSaved();
  };

  return (
    <div className="py-2">
      {/* label + value inputs */}
      <div className="flex items-center justify-between gap-2 num">
        <input
          ref={labelRef}
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter") valueRef.current?.focus();
          }}
          placeholder="Label"
          className="py-1 px-2 text-sm2"
          style={{
            flex: 1,
            minWidth: 0,
            border: `1px solid ${MUTED}`,
            borderRadius: 6,
            color: INK,
            background: "#fff",
          }}
        />
        <input
          ref={valueRef}
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="0"
          className="py-1 px-2 text-sm2"
          style={{
            width: 90,
            border: `1px solid ${MUTED}`,
            borderRadius: 6,
            fontVariantNumeric: "tabular-nums",
            color: INK,
            background: "#fff",
          }}
        />
      </div>
      {/* Cancel / Add */}
      <div className="flex items-center justify-end gap-2 mt-2">
        <button
          onClick={onCancel}
          style={{
            all: "unset",
            cursor: "pointer",
            border: `1px solid ${SOFT}`,
            borderRadius: 10,
            padding: "4px 12px",
            fontSize: 12,
            color: MUTED,
            fontWeight: 600,
            background: "#fff",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = SOFT)}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#fff")}
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!valid}
          style={{
            all: "unset",
            cursor: valid ? "pointer" : "default",
            opacity: valid ? 1 : 0.5,
            border: `1px solid ${LINE}`,
            borderRadius: 10,
            padding: "4px 12px",
            fontSize: 12,
            fontWeight: 600,
            background: "#fff",
            color: INK,
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ─── main view ───────────────────────────────────────────────────────────────

export default function ConnectionsView({ onLocked }: { onLocked: () => void }) {
  const [data, setData] = useState<ConnectionsData | null>(null);
  // Plaid link flow
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [plaidOpen, setPlaidOpen] = useState<(() => void) | null>(null);
  // Re-link: which institution item_id is being re-linked (by index)
  const [relinkIndex, setRelinkIndex] = useState<number | null>(null);
  // Temporary button label override when Plaid not configured
  const [btnOverride, setBtnOverride] = useState<string | null>(null);
  const overrideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Inline "+ Add manual asset" entry state
  const [addingAsset, setAddingAsset] = useState(false);
  // Manual Assets card edit mode — toggled by the header pencil
  // Institution row menu / delete confirm (keyed by institution name)
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const deleteInstitution = async (name: string) => {
    setConfirmDelete(null);
    setMenuFor(null);
    const res = await fetch("/api/connections", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ institution: name }),
    });
    if (res.status === 401) { onLocked(); return; }
    if (res.ok) setData(await res.json() as ConnectionsData);
  };

  const load = useCallback(() => {
    fetch("/api/connections", { credentials: "same-origin" })
      .then((res) => {
        if (res.status === 401) { onLocked(); return null; }
        return res.json() as Promise<ConnectionsData>;
      })
      .then((d) => { if (d) setData(d); })
      .catch(() => {/* leave loading state */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  // After Plaid Link widget is ready, open it immediately
  useEffect(() => {
    if (plaidOpen) {
      plaidOpen();
    }
  }, [plaidOpen]);

  const requestLinkToken = async (forRelinkIndex?: number) => {
    if (overrideTimer.current) clearTimeout(overrideTimer.current);
    setBtnOverride(null);

    const res = await fetch("/api/plaid/link-token", {
      method: "POST",
      credentials: "same-origin",
    });

    if (res.status === 401) { onLocked(); return; }

    if (res.status === 503) {
      // Plaid not configured
      const override = "Add Plaid keys to Keychain first";
      setBtnOverride(override);
      overrideTimer.current = setTimeout(() => setBtnOverride(null), 4000);
      return;
    }

    const json = await res.json() as { link_token: string };
    if (typeof forRelinkIndex === "number") setRelinkIndex(forRelinkIndex);
    else setRelinkIndex(null);
    setLinkToken(json.link_token);
  };

  const handlePlaidSuccess = async (public_token: string, institutionName: string, institutionId: string | null) => {
    setLinkToken(null);
    setPlaidOpen(null);
    setRelinkIndex(null);

    const res = await fetch("/api/plaid/exchange", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ public_token, institution: institutionName, institution_id: institutionId }),
    });
    if (res.status === 401) { onLocked(); return; }
    load();
  };

  const handlePlaidExit = () => {
    setLinkToken(null);
    setPlaidOpen(null);
    setRelinkIndex(null);
  };

  if (!data) {
    return <div className="text-muted-foreground p-10">Loading…</div>;
  }

  return (
    <div>
      {/* Mount Plaid Link activator when we have a token */}
      {linkToken && (
        <PlaidLinkActivator
          linkToken={linkToken}
          onSuccess={handlePlaidSuccess}
          onExit={handlePlaidExit}
          onReady={(open) => setPlaidOpen(() => open)}
        />
      )}

      {/* .vhead */}
      <div className="flex items-center gap-3 mb-4">
        <h1
          className="text-h1 font-extrabold"
          style={{ letterSpacing: "-0.01em", color: INK }}
        >
          Connections
        </h1>
      </div>

      {/* Stacked, one card per line */}
      <div className="grid gap-4">
        {/* ── Linked Institutions card ── */}
        <Card className={CARD}>
          {/* header: title left, + Link account top-right */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-num-md" style={{ fontWeight: 700, color: INK }}>
              Linked Institutions
            </h2>
            <button
              onClick={() => requestLinkToken()}
              title={btnOverride ? "Add Plaid keys to Keychain first — see app README for instructions" : undefined}
              style={{
                all: "unset",
                cursor: "pointer",
                border: `1px solid ${LINE}`,
                borderRadius: 10,
                padding: "6px 12px",
                fontSize: 13,
                fontWeight: 600,
                background: "#fff",
                color: INK,
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = SOFT)}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#fff")}
            >
              {btnOverride ?? "+ Link account"}
            </button>
          </div>

          {/* Institution rows */}
          {data.institutions.map((inst, i) => {
            const isLast = i === data.institutions.length - 1;
            return (
              /* .acct */
              <div
                key={`${inst.code}-${i}`}
                className="flex items-center gap-3 py-2"
                style={{
                  borderBottom: isLast ? "none" : `1px solid ${SOFT}`,
                }}
              >
                {/* .ava — institution logo from Plaid when present, else initials */}
                {inst.logo ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={`data:image/png;base64,${inst.logo}`}
                    alt=""
                    aria-hidden
                    className="shrink-0"
                    style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", background: SOFT }}
                  />
                ) : (
                  <span
                    className="flex items-center justify-center shrink-0 num text-label"
                    aria-hidden
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: "50%",
                      background: SOFT,
                      fontWeight: 700,
                      color: MUTED,
                    }}
                  >
                    {inst.code}
                  </span>
                )}
                {/* .who */}
                <span className="min-w-0">
                  <b className="text-body" style={{ display: "block", fontWeight: 600, color: INK }}>
                    {inst.name}
                  </b>
                  <span className="text-xs2" style={{ color: MUTED }}>{inst.sub}</span>
                </span>
                {/* right side: dot + last-sync/Re-link + ⋯ — remove confirms in a dialog, never inline */}
                {confirmDelete === inst.name && (
                  <ConfirmRemoveDialog
                    label={inst.name}
                    onCancel={() => setConfirmDelete(null)}
                    onConfirm={() => { deleteInstitution(inst.name); setConfirmDelete(null); }}
                  />
                )}
                {(
                  <span className="relative flex items-center gap-2 ml-auto">
                    {/* .dot */}
                    <span
                      className="shrink-0 inline-block rounded-full"
                      title={inst.status === "healthy" ? "Healthy" : "Needs re-auth"}
                      style={{
                        width: 8,
                        height: 8,
                        background: inst.status === "healthy" ? GOOD : BAD,
                      }}
                    />
                    {inst.status === "healthy" ? (
                      <span className="num text-xs2" style={{ color: MUTED }}>
                        {inst.last}
                      </span>
                    ) : (
                      <button
                        onClick={() => requestLinkToken(i)}
                        style={{
                          all: "unset",
                          cursor: "pointer",
                          border: `1px solid ${SOFT}`,
                          borderRadius: 10,
                          padding: "4px 10px",
                          fontSize: 12,
                          color: MUTED,
                          fontWeight: 600,
                          background: "#fff",
                        }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = SOFT)}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#fff")}
                      >
                        Re-link
                      </button>
                    )}
                    {/* ⋯ row menu */}
                    <button
                      aria-label={`Options for ${inst.name}`}
                      onClick={() => setMenuFor(menuFor === inst.name ? null : inst.name)}
                      style={{
                        all: "unset", cursor: "pointer", color: MUTED,
                        borderRadius: 8, padding: "4px 4px", display: "inline-flex", alignItems: "center",
                      }}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = INK)}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = MUTED)}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    {menuFor === inst.name && (
                      <span
                        className="absolute right-0 z-20 p-1"
                        style={{
                          top: 26, background: "#fff", border: `1px solid ${SOFT}`,
                          borderRadius: 10, boxShadow: "0 8px 30px rgba(16,17,20,.12)",
                        }}
                      >
                        <button
                          onClick={() => { setMenuFor(null); setConfirmDelete(inst.name); }}
                          style={{
                            all: "unset", cursor: "pointer", display: "block",
                            padding: "6px 14px", fontSize: 12, fontWeight: 600,
                            color: BAD, borderRadius: 8, whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = SOFT)}
                          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                        >
                          Remove…
                        </button>
                      </span>
                    )}
                  </span>
                )}
              </div>
            );
          })}

        </Card>

        {/* ── Manual Assets card ── */}
        <Card className={CARD}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-num-md" style={{ fontWeight: 700, color: INK }}>
                Manual Assets
              </h2>
            </div>

            {data.manualAssets.map((m, i) => (
              <ManualAssetRow
                key={m.id}
                id={m.id}
                label={m.label}
                value={m.value}
                isLast={i === data.manualAssets.length - 1}
                onSaved={load}
                onLocked={onLocked}
              />
            ))}

            {/* + Add manual asset */}
            <div className="mt-2">
              {addingAsset ? (
                <NewManualAssetRow
                  onSaved={() => { setAddingAsset(false); load(); }}
                  onCancel={() => setAddingAsset(false)}
                  onLocked={onLocked}
                />
              ) : (
                <button
                  onClick={() => setAddingAsset(true)}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    border: `1px solid ${SOFT}`,
                    borderRadius: 10,
                    padding: "4px 10px",
                    fontSize: 12,
                    color: MUTED,
                    fontWeight: 600,
                    background: "#fff",
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = SOFT)}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#fff")}
                >
                  + Add manual asset
                </button>
              )}
            </div>
          </Card>

          {/* Security card */}
          <Card className={CARD}>
            <h2 className="text-num-md mb-3" style={{ fontWeight: 700, color: INK }}>
              Security
            </h2>
            <div className="text-xs2 gap-2" style={{ display: "flex", flexDirection: "column" }}>
              {data.security.map((s, i) => (
                <span
                  key={i}
                  // strings come from our own API (SECURITY_STRINGS constant, no user input)
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: `· ${s}` }}
                />
              ))}
            </div>
          </Card>
      </div>
    </div>
  );
}
