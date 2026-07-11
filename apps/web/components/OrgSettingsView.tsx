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
 * anyone may leave (the server blocks the sole owner). Same page chrome as the
 * other dashboard sub-pages (.dash-page + .coll-head + .dash-card).
 */

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
      <div className="dash-page org-page">
        <span className="page-eyebrow">Workspace</span>
        <h1>Settings</h1>
        <div className="dash-card">
          <p className="card-sub" style={{ marginBottom: 0 }}>{loadError}</p>
        </div>
      </div>
    );
  }
  if (!org) {
    return (
      <div className="dash-page org-page">
        <span className="page-eyebrow">Workspace</span>
        <h1>Settings</h1>
        <div className="dash-card">
          <p className="card-sub" style={{ marginBottom: 0 }}>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-page org-page">
      <header className="coll-head">
        <span className="page-eyebrow">Workspace</span>
        <h1>
          Organization <span className="grad">settings</span>
        </h1>
        <p className="lede">
          Rename <strong>{org.name}</strong>, cap its monthly agent spend, or leave/delete
          it.
        </p>
      </header>

      {/* Name */}
      <div className="dash-card">
        <h2>Organization name</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={name}
            disabled={!canManage}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName();
            }}
            aria-label="Organization name"
            style={{ flex: 1, minWidth: 0 }}
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
          <p className="card-sub" style={{ marginBottom: 0, marginTop: 10 }}>
            Only an admin or owner can change settings.
          </p>
        )}
      </div>

      {/* Budget */}
      <div className="dash-card">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <h2 style={{ margin: 0 }}>Monthly budget</h2>
          <span className="page-eyebrow" style={{ margin: 0 }}>
            {org.monthly_budget_usd == null ? "No cap" : `$${org.monthly_budget_usd} / month`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <span aria-hidden style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono-stack)", fontSize: 13 }}>
            $
          </span>
          <input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            placeholder="No cap"
            value={budget}
            disabled={!canManage}
            onChange={(e) => setBudget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveBudget();
            }}
            aria-label="Monthly budget in USD"
            style={{ flex: 1, minWidth: 0 }}
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
        <p className="card-sub" style={{ marginBottom: 0, marginTop: 10 }}>
          Leave blank for no cap. Caps the org&apos;s combined agent spend per calendar month;
          runs pause once it&apos;s reached.
        </p>
      </div>

      {/* Danger zone */}
      <div className="dash-card danger">
        <h2>Danger zone</h2>

        <div className="danger-row">
          <div>
            <div className="t">Leave organization</div>
            <div className="d">
              You&apos;ll lose access to its shared projects. Projects you own move back to
              Personal.
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
          <div className="danger-row">
            <div>
              <div className="t">Delete organization</div>
              <div className="d">
                Removes the org and its membership. Its projects are kept and return to
                their owners&apos; Personal space.
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
