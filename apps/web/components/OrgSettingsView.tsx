"use client";

import { useCallback, useEffect, useState } from "react";
import type { Organization, Role } from "@uniqus/api-types";
import { roleAtLeast } from "@uniqus/api-types";
import {
  fetchOrgApi,
  renameOrgApi,
  setOrgBudgetApi,
  deleteOrgApi,
  leaveOrgApi,
} from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * Organization settings (P3.1/P3.5) — the workspace's own admin surface: rename,
 * a shared monthly spend cap, and a danger zone (leave / delete). RBAC is fetched
 * with the org so we can disable controls the caller can't use rather than letting
 * them fail server-side: admin+ may rename + set budget, only an owner may delete,
 * anyone may leave (the server blocks the sole owner). House design language:
 * hairline cards, mono micro-labels, magenta the only accent.
 */

const eyebrow: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--fs-2xs)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text-dim)",
};

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  background: "var(--bg-surface)",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  maxWidth: 640,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "var(--bg-elev)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  color: "var(--text-primary)",
  padding: "8px 10px",
  fontSize: "var(--fs-md)",
};

export default function OrgSettingsView({
  orgId,
  onRenamed,
  onRemoved,
}: {
  orgId: string;
  /** Notify the parent so the switcher's org list reflects the new name. */
  onRenamed: (name: string) => void;
  /** Fired after a successful leave/delete so the parent drops back to Personal. */
  onRemoved: () => void;
}) {
  const [org, setOrg] = useState<Organization | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [budget, setBudget] = useState("");
  const [savingBudget, setSavingBudget] = useState(false);

  const [confirm, setConfirm] = useState<null | "leave" | "delete">(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { org, role } = await fetchOrgApi(orgId);
      setOrg(org);
      setRole(role);
      setName(org.name);
      setBudget(org.monthly_budget_usd == null ? "" : String(org.monthly_budget_usd));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load organization");
    }
  }, [orgId]);

  useEffect(() => {
    setOrg(null);
    setConfirm(null);
    void load();
  }, [load]);

  const canManage = roleAtLeast(role, "admin");
  const isOwner = role === "owner";

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || savingName || !org) return;
    if (trimmed === org.name) return;
    setSavingName(true);
    try {
      await renameOrgApi(orgId, trimmed);
      setOrg({ ...org, name: trimmed });
      onRenamed(trimmed);
      toast.success("Organization renamed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't rename");
    } finally {
      setSavingName(false);
    }
  }

  async function saveBudget() {
    if (savingBudget || !org) return;
    const trimmed = budget.trim();
    let value: number | null;
    if (trimmed === "") {
      value = null;
    } else {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) {
        toast.error("Enter a non-negative amount, or leave blank for no cap");
        return;
      }
      value = n;
    }
    setSavingBudget(true);
    try {
      await setOrgBudgetApi(orgId, value);
      setOrg({ ...org, monthly_budget_usd: value });
      toast.success(value == null ? "Budget cleared" : `Monthly cap set to $${value}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save budget");
    } finally {
      setSavingBudget(false);
    }
  }

  async function doLeave() {
    if (busy) return;
    setBusy(true);
    try {
      await leaveOrgApi(orgId);
      toast.success("You left the organization");
      onRemoved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't leave");
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (busy) return;
    setBusy(true);
    try {
      await deleteOrgApi(orgId);
      toast.success("Organization deleted");
      onRemoved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete");
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div style={{ ...eyebrow, color: "var(--text-muted)" }}>
        {loadError}
      </div>
    );
  }
  if (!org) return <div style={eyebrow}>Loading…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={eyebrow}>● Settings</span>
        <span style={eyebrow}>{org.name}</span>
      </div>

      {/* Name */}
      <div style={cardStyle}>
        <span style={eyebrow}>Organization name</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            className="ui-input"
            style={inputStyle}
            value={name}
            disabled={!canManage}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName();
            }}
            aria-label="Organization name"
          />
          <button
            type="button"
            className="btn-primary"
            onClick={() => void saveName()}
            disabled={!canManage || savingName || !name.trim() || name.trim() === org.name}
          >
            {savingName ? "Saving…" : "Save"}
          </button>
        </div>
        {!canManage && (
          <div style={{ color: "var(--text-dim)", fontSize: "var(--fs-xs)" }}>
            Only an admin or owner can change settings.
          </div>
        )}
      </div>

      {/* Budget */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={eyebrow}>● Monthly budget</span>
          <span style={eyebrow}>
            {org.monthly_budget_usd == null ? "No cap" : `$${org.monthly_budget_usd} / month`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span aria-hidden style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-md)" }}>
            $
          </span>
          <input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            className="ui-input"
            style={inputStyle}
            placeholder="No cap"
            value={budget}
            disabled={!canManage}
            onChange={(e) => setBudget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveBudget();
            }}
            aria-label="Monthly budget in USD"
          />
          <button
            type="button"
            className="btn-primary"
            onClick={() => void saveBudget()}
            disabled={!canManage || savingBudget}
          >
            {savingBudget ? "Saving…" : "Save"}
          </button>
        </div>
        <div style={{ color: "var(--text-dim)", fontSize: "var(--fs-xs)" }}>
          Leave blank for no cap. Caps the org&apos;s combined agent spend per calendar month;
          runs pause once it&apos;s reached.
        </div>
      </div>

      {/* Danger zone */}
      <div style={{ ...cardStyle, borderColor: "color-mix(in srgb, #ef4444 35%, var(--border-default))" }}>
        <span style={{ ...eyebrow, color: "#ef4444" }}>● Danger zone</span>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--text-primary)", fontSize: "var(--fs-md)" }}>Leave organization</div>
            <div style={{ color: "var(--text-dim)", fontSize: "var(--fs-xs)" }}>
              You&apos;ll lose access to its shared projects. Projects you own move back to Personal.
            </div>
          </div>
          {confirm === "leave" ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn-ghost" onClick={() => setConfirm(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn-danger" onClick={() => void doLeave()} disabled={busy}>
                {busy ? "Leaving…" : "Confirm leave"}
              </button>
            </div>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => setConfirm("leave")}>
              Leave
            </button>
          )}
        </div>

        {isOwner && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              borderTop: "1px solid var(--border-light)",
              paddingTop: 12,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "var(--text-primary)", fontSize: "var(--fs-md)" }}>Delete organization</div>
              <div style={{ color: "var(--text-dim)", fontSize: "var(--fs-xs)" }}>
                Removes the org and its membership. Its projects are kept and return to their owners&apos; Personal space.
              </div>
            </div>
            {confirm === "delete" ? (
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setConfirm(null)} disabled={busy}>
                  Cancel
                </button>
                <button type="button" className="btn-danger" onClick={() => void doDelete()} disabled={busy}>
                  {busy ? "Deleting…" : "Delete forever"}
                </button>
              </div>
            ) : (
              <button type="button" className="btn-danger" onClick={() => setConfirm("delete")}>
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
