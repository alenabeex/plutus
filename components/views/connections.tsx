"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { MoreHorizontal } from "lucide-react";
import { Card } from "@/components/ui/card";
import { AssetIcon } from "@/components/asset-icon";
import { usd0 } from "@/lib/format";
import type { ConnectionsData } from "@/lib/types";
import { CARD, MENU_ITEM, menuItemHover } from "@/lib/styles";
import {
  ASSET_ICON_KEYS,
  ASSET_ICON_LABELS,
  DEFAULT_ASSET_ICON,
  type AssetIconKey,
} from "@/lib/asset-icons";

// colors from the shared palette (lib/colors) — this file used to re-declare
// them locally; swapped to the import when WARN was added for the health dot
import { INK, MUTED, LINE, SOFT, GOOD, BAD, WARN } from "@/lib/colors";

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

// ─── ManualAssetDialog — add + edit, one modal ───────────────────────────────
// Both entry points use it: "+ Add manual asset" in the card header and a
// row's ⋯ → Edit. Icon, name and value are all set in one place, so an asset
// can never exist without the avatar its row draws.

interface ManualAssetDialogProps {
  /** existing asset when editing; omitted when adding */
  asset?: { id: number; label: string; value: number; icon: AssetIconKey };
  onSaved: () => void;
  onCancel: () => void;
  onLocked: () => void;
}

function ManualAssetDialog({ asset, onSaved, onCancel, onLocked }: ManualAssetDialogProps) {
  const editing = asset !== undefined;
  const [icon, setIcon] = useState<AssetIconKey>(asset?.icon ?? DEFAULT_ASSET_ICON);
  const [label, setLabel] = useState(asset?.label ?? "");
  const [draft, setDraft] = useState(asset ? String(asset.value) : "");
  const [saving, setSaving] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    setTimeout(() => labelRef.current?.focus(), 0);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const valid = label.trim().length > 0 && draft.trim() !== "" && !isNaN(parseFloat(draft));

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const res = await fetch("/api/connections", {
      method: editing ? "PUT" : "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        editing
          ? { manualAssetId: asset!.id, label: label.trim(), value: parseFloat(draft), icon }
          : { label: label.trim(), value: parseFloat(draft), icon },
      ),
    });
    if (res.status === 401) { onLocked(); return; }
    onSaved();
  };

  const fieldStyle = {
    width: "100%",
    border: `1px solid ${LINE}`,
    borderRadius: 8,
    color: INK,
    background: "#fff",
  } as const;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(16,17,20,0.32)" }}
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={editing ? `Edit ${asset!.label}` : "Add manual asset"}
    >
      <div className={CARD} style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
        <p className="text-num-md mb-4" style={{ fontWeight: 700, color: INK }}>
          {editing ? "Edit asset" : "Add manual asset"}
        </p>

        {/* icon picker — the row's avatar, chosen up front */}
        <p className="text-xs2 mb-2" style={{ color: MUTED, fontWeight: 600 }}>Icon</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {ASSET_ICON_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              aria-label={ASSET_ICON_LABELS[k]}
              aria-pressed={icon === k}
              title={ASSET_ICON_LABELS[k]}
              onClick={() => setIcon(k)}
              style={{ all: "unset", cursor: "pointer", display: "inline-flex" }}
            >
              <AssetIcon icon={k} size={36} selected={icon === k} />
            </button>
          ))}
        </div>

        {/* name */}
        <p className="text-xs2 mb-2" style={{ color: MUTED, fontWeight: 600 }}>Name</p>
        <input
          ref={labelRef}
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder="Bitcoin"
          className="py-2 px-3 text-sm2 mb-4"
          style={fieldStyle}
        />

        {/* value */}
        <p className="text-xs2 mb-2" style={{ color: MUTED, fontWeight: 600 }}>Value</p>
        <input
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder="0"
          className="py-2 px-3 text-sm2 num"
          style={{ ...fieldStyle, fontVariantNumeric: "tabular-nums" }}
        />

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
            onClick={save}
            disabled={!valid || saving}
            style={{
              all: "unset",
              cursor: valid && !saving ? "pointer" : "default",
              opacity: valid && !saving ? 1 : 0.5,
              border: `1px solid ${INK}`, borderRadius: 8,
              padding: "8px 12px", fontSize: 13, fontWeight: 600, color: "#fff", background: INK,
            }}
          >
            {editing ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ManualAssetRow ──────────────────────────────────────────────────────────
// Same anatomy as an institution row: avatar · title + category · value · ⋯.

interface ManualAssetRowProps {
  id: number;
  label: string;
  value: number;
  icon: AssetIconKey;
  isLast: boolean;
  onSaved: () => void;
  onLocked: () => void;
}

function ManualAssetRow({ id, label, value, icon, isLast, onSaved, onLocked }: ManualAssetRowProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // ⋯ → Edit opens the same modal the header's add button uses
  const [editing, setEditing] = useState(false);

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
    {/* .acct — mirrors the institution row anatomy */}
    <div
      className="flex items-center gap-3 py-2"
      style={{
        borderBottom: isLast ? "none" : `1px solid ${SOFT}`,
      }}
    >
      {/* .ava — the asset's chosen icon stands in for an institution logo */}
      <AssetIcon icon={icon} />
      {/* .who — title, then its category */}
      <span className="min-w-0">
        <b className="text-body" style={{ display: "block", fontWeight: 600, color: INK }}>
          {label}
        </b>
        <span className="text-xs2" style={{ color: MUTED }}>{ASSET_ICON_LABELS[icon]}</span>
      </span>
      <span className="relative flex items-center gap-2 ml-auto">
        <b className="num" style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: GOOD }}>
          {usd0(value)}
        </b>
        {/* ⋯ row menu */}
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
              style={{ ...MENU_ITEM, whiteSpace: "nowrap" }}
              {...menuItemHover}
            >
              Edit…
            </button>
            <button
              onClick={() => { setMenuOpen(false); setConfirmRemove(true); }}
              style={{ ...MENU_ITEM, color: BAD, whiteSpace: "nowrap" }}
              {...menuItemHover}
            >
              Remove…
            </button>
          </span>
        )}
      </span>
    </div>

    {/* edit modal — same one the header's add button opens */}
    {editing && (
      <ManualAssetDialog
        asset={{ id, label, value, icon }}
        onSaved={() => { setEditing(false); onSaved(); }}
        onCancel={() => setEditing(false)}
        onLocked={onLocked}
      />
    )}

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
  // Per-row Re-sync — keyed by institution name (the same key remove/revoke
  // use, since a row carries no numeric item id to the client). Only one
  // menu is open at a time, so only one row can be mid-sync at a time.
  const [resyncing, setResyncing] = useState<string | null>(null);
  const [resyncError, setResyncError] = useState<string | null>(null);

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
    if (res.ok) {
      setData(await res.json() as ConnectionsData);
    } else {
      // A failed remove used to do silently nothing — the row just sat
      // there. Surface the error and re-fetch so the list shows server truth.
      const err = (await res.json().catch(() => null)) as { error?: string } | null;
      window.alert(`Couldn't remove ${name}: ${err?.error ?? `HTTP ${res.status}`}`);
      load();
    }
  };

  // Pulls fresh Plaid data for just this institution (POST /api/plaid/sync,
  // scoped by the institution key), then re-fetches the list so last-synced
  // + health dot/reason update in place. Menu stays open while syncing so
  // the label can show progress; only closes on success. Demo installs (no
  // Plaid keys) 503 "plaid-not-configured" — treated as success here too,
  // same as the button this replaced.
  const resyncInstitution = async (name: string) => {
    setResyncing(name);
    setResyncError(null);
    try {
      const res = await fetch("/api/plaid/sync", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ institution: name }),
      });
      if (res.status === 401) { onLocked(); return; }
      const body = await res.json().catch(() => ({}));
      if (res.ok || body.error === "plaid-not-configured") {
        setMenuFor(null);
        load();
        return;
      }
      setResyncError(name);
    } catch {
      setResyncError(name);
    } finally {
      setResyncing(null);
    }
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
                    {/* why the dot isn't green — visible, not hover-only */}
                    {inst.health !== "good" && (
                      <span
                        className="text-xs2 truncate"
                        style={{ color: inst.health === "stale" ? WARN : BAD, maxWidth: 220 }}
                      >
                        {inst.healthReason}
                      </span>
                    )}
                    {/* last-synced date, then the health dot after it */}
                    <span className="num text-xs2" style={{ color: MUTED }}>
                      {inst.last}
                    </span>
                    {/* .dot — green fresh · amber stale/never · red re-auth */}
                    <span
                      className="shrink-0 inline-block rounded-full"
                      title={inst.healthReason}
                      style={{
                        width: 8,
                        height: 8,
                        background: inst.health === "good" ? GOOD : inst.health === "stale" ? WARN : BAD,
                      }}
                    />
                    {inst.health === "error" && (
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
                        {/* Re-sync — only for rows that are actually Plaid-linked.
                            Placeholder rows (health="stale", healthReason="Not
                            linked", set when zero items exist yet) have nothing
                            to sync. */}
                        {inst.healthReason !== "Not linked" && (
                          <button
                            onClick={() => resyncInstitution(inst.name)}
                            disabled={resyncing === inst.name}
                            style={{
                              ...MENU_ITEM,
                              cursor: resyncing === inst.name ? "default" : "pointer",
                              color: resyncError === inst.name ? BAD : INK,
                              whiteSpace: "nowrap",
                            }}
                            onMouseEnter={(e) => {
                              if (resyncing !== inst.name) (e.currentTarget as HTMLElement).style.background = SOFT;
                            }}
                            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                          >
                            {resyncing === inst.name
                              ? "Syncing…"
                              : resyncError === inst.name
                                ? "Re-sync failed — try again"
                                : "Re-sync"}
                          </button>
                        )}
                        <button
                          onClick={() => { setMenuFor(null); setConfirmDelete(inst.name); }}
                          style={{ ...MENU_ITEM, color: BAD, whiteSpace: "nowrap" }}
                          {...menuItemHover}
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
            {/* header: title left, + Add manual asset top-right — same as Linked Institutions */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-num-md" style={{ fontWeight: 700, color: INK }}>
                Manual Assets
              </h2>
              <button
                onClick={() => setAddingAsset(true)}
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
                + Add manual asset
              </button>
            </div>

            {data.manualAssets.map((m, i) => (
              <ManualAssetRow
                key={m.id}
                id={m.id}
                label={m.label}
                value={m.value}
                icon={m.icon}
                isLast={i === data.manualAssets.length - 1}
                onSaved={load}
                onLocked={onLocked}
              />
            ))}

            {/* empty state — the card can't be a blank box under its header */}
            {data.manualAssets.length === 0 && (
              <p className="text-xs2 py-2" style={{ color: MUTED }}>
                Nothing here yet — add anything Plaid can&apos;t see: crypto, a car, property.
              </p>
            )}

            {/* add modal */}
            {addingAsset && (
              <ManualAssetDialog
                onSaved={() => { setAddingAsset(false); load(); }}
                onCancel={() => setAddingAsset(false)}
                onLocked={onLocked}
              />
            )}
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
