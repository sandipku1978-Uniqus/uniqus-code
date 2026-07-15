"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Organization, Role } from "@gate15/api-types";
import { roleAtLeast } from "@gate15/api-types";
import {
  fetchOrgApi,
  renameOrgApi,
  setOrgBudgetApi,
  deleteOrgApi,
  leaveOrgApi,
} from "@/lib/api";
import { toast } from "@/lib/toast";
import { OrgPageHeader, OrgStatePanel } from "./OrgPageChrome";

export default function OrgSettingsView({
  orgId,
  onRenamed,
  onRemoved,
}: {
  orgId: string;
  onRenamed: (name: string) => void;
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
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadedOrgId, setLoadedOrgId] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);
  const orgIdRef = useRef(orgId);
  orgIdRef.current = orgId;

  const load = useCallback(async (signal?: AbortSignal) => {
    const generation = ++loadGenerationRef.current;
    setOrg(null);
    setRole(null);
    setLoadedOrgId(null);
    setLoadError(null);
    try {
      const { org, role } = await fetchOrgApi(orgId, signal);
      if (signal?.aborted || generation !== loadGenerationRef.current) return;
      setOrg(org);
      setRole(role);
      setLoadedOrgId(orgId);
      setName(org.name);
      setBudget(org.monthly_budget_usd == null ? "" : String(org.monthly_budget_usd));
    } catch (e) {
      if (signal?.aborted || generation !== loadGenerationRef.current) return;
      setLoadError(e instanceof Error ? e.message : "Couldn't load organization");
    }
  }, [orgId]);

  useEffect(() => {
    const controller = new AbortController();
    setConfirm(null);
    void load(controller.signal);
    return () => {
      controller.abort();
      loadGenerationRef.current += 1;
    };
  }, [load]);

  useEffect(() => setDeleteConfirmation(""), [confirm]);

  const canManage = loadedOrgId === orgId && roleAtLeast(role, "admin");
  const isOwner = loadedOrgId === orgId && role === "owner";

  async function saveName() {
    const trimmed = name.trim();
    const targetOrgId = loadedOrgId;
    if (!trimmed || savingName || !org || !targetOrgId || targetOrgId !== orgId || trimmed === org.name) return;
    setSavingName(true);
    try {
      await renameOrgApi(targetOrgId, trimmed);
      if (orgIdRef.current !== targetOrgId) return;
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
    const targetOrgId = loadedOrgId;
    if (savingBudget || !org || !targetOrgId || targetOrgId !== orgId) return;
    const trimmed = budget.trim();
    let value: number | null;
    if (trimmed === "") {
      value = null;
    } else {
      const amount = Number(trimmed);
      if (!Number.isFinite(amount) || amount < 0) {
        toast.error("Enter a non-negative amount, or leave blank for no cap");
        return;
      }
      value = amount;
    }
    setSavingBudget(true);
    try {
      await setOrgBudgetApi(targetOrgId, value);
      if (orgIdRef.current !== targetOrgId) return;
      setOrg({ ...org, monthly_budget_usd: value });
      toast.success(value == null ? "Budget cleared" : `Monthly cap set to $${value}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save budget");
    } finally {
      setSavingBudget(false);
    }
  }

  async function doLeave() {
    const targetOrgId = loadedOrgId;
    if (busy || !targetOrgId || targetOrgId !== orgId) return;
    setBusy(true);
    try {
      await leaveOrgApi(targetOrgId);
      if (orgIdRef.current !== targetOrgId) return;
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
    const targetOrgId = loadedOrgId;
    if (busy || !targetOrgId || targetOrgId !== orgId) return;
    setBusy(true);
    try {
      await deleteOrgApi(targetOrgId);
      if (orgIdRef.current !== targetOrgId) return;
      toast.success("Organization deleted");
      onRemoved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete");
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  const roleLabel = role ? `${role[0].toUpperCase()}${role.slice(1)} access` : "Checking access";
  const headerStatus = loadError ? "Settings unavailable" : org ? roleLabel : "Loading settings";
  const headerTone = loadError ? "danger" : org ? (canManage ? "live" : "dim") : "warn";

  return (
    <div className="dash-page org-page">
      <OrgPageHeader
        index="03"
        title="Organization"
        accent="settings"
        context="Workspace controls"
        status={headerStatus}
        statusTone={headerTone}
        lede={
          <>
            Control the workspace identity, monthly spend policy, and your relationship to
            {org ? ` ${org.name}` : " this organization"}.
          </>
        }
      />

      {loadError ? (
        <OrgStatePanel
          state="error"
          title="Settings could not be loaded"
          body={loadError}
          onRetry={() => void load()}
        />
      ) : !org ? (
        <OrgStatePanel
          state="loading"
          title="Loading workspace controls"
          body="Checking your role and the organization's current policy."
        />
      ) : (
        <>
          <div className="org-settings-layout">
            <div className="org-settings-sheet">
              <section className="org-settings-section">
                <div className="org-section-head">
                  <span className="org-section-index">Identity</span>
                  <h2>Organization name</h2>
                  <p>This name appears in the workspace switcher and on shared projects.</p>
                </div>
                <div className="org-setting-form">
                  <label htmlFor="org-settings-name">Workspace name</label>
                  <div className="org-field-action">
                    <input
                      id="org-settings-name"
                      value={name}
                      disabled={!canManage}
                      onChange={(event) => setName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void saveName();
                      }}
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void saveName()}
                      disabled={!canManage || savingName || !name.trim() || name.trim() === org.name}
                    >
                      {savingName ? "Saving…" : "Save name"}
                    </button>
                  </div>
                </div>
              </section>

              <section className="org-settings-section">
                <div className="org-section-head">
                  <span className="org-section-index">Spend policy</span>
                  <h2>Monthly agent budget</h2>
                  <p>
                    A best-effort guard for starting new runs. Concurrent runs can finish over
                    the target, and recently incurred cost can take time to appear.
                  </p>
                </div>
                <div className="org-setting-form">
                  <div className="org-setting-label-row">
                    <label htmlFor="org-settings-budget">Monthly guard in USD</label>
                    <span>{org.monthly_budget_usd == null ? "No guard" : `$${org.monthly_budget_usd} / month`}</span>
                  </div>
                  <div className="org-field-action org-money-field">
                    <span aria-hidden="true">$</span>
                    <input
                      id="org-settings-budget"
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      placeholder="No guard"
                      value={budget}
                      disabled={!canManage}
                      onChange={(event) => setBudget(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void saveBudget();
                      }}
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void saveBudget()}
                      disabled={!canManage || savingBudget}
                    >
                      {savingBudget ? "Saving…" : "Save budget"}
                    </button>
                  </div>
                  <p className="org-field-note">
                    Leave blank for monitoring only. This guard is not a guaranteed billing cap.
                  </p>
                </div>
              </section>
            </div>

            <aside className="org-permission-panel">
              <span className="org-section-index">Your access</span>
              <strong className="org-permission-role">{role ?? "member"}</strong>
              <p>
                {canManage
                  ? "You can update organization identity, budget, and member access."
                  : "You can view organization policy, but an admin or owner must change it."}
              </p>
              <ul>
                <li>
                  <span className={`org-permission-mark ${canManage ? "yes" : "no"}`} aria-hidden="true" />
                  <span>Edit workspace settings</span>
                  <strong>{canManage ? "Allowed" : "Not allowed"}</strong>
                </li>
                <li>
                  <span className={`org-permission-mark ${canManage ? "yes" : "no"}`} aria-hidden="true" />
                  <span>Manage monthly budget</span>
                  <strong>{canManage ? "Allowed" : "Not allowed"}</strong>
                </li>
                <li>
                  <span className={`org-permission-mark ${isOwner ? "yes" : "no"}`} aria-hidden="true" />
                  <span>Delete organization</span>
                  <strong>{isOwner ? "Allowed" : "Not allowed"}</strong>
                </li>
              </ul>
            </aside>
          </div>

          <section className="org-danger-panel">
            <div className="org-danger-head">
              <span className="org-section-index">Danger zone</span>
              <h2>Destructive actions</h2>
              <p>These changes affect workspace access, not the underlying project history.</p>
            </div>

            <div className="org-danger-actions">
              <div className="danger-row">
                <div>
                  <div className="t">Leave organization</div>
                  <div className="d">
                    You&apos;ll immediately lose access to every organization project.
                    No projects move to Personal.
                  </div>
                </div>
                {confirm === "leave" ? (
                  <div className="org-confirm-actions">
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
                      All organization projects move to your Personal workspace;
                      every other member loses access.
                    </div>
                  </div>
                  {confirm === "delete" ? (
                    <div className="org-confirm-actions">
                      <label className="sr-only" htmlFor="delete-org-confirmation">
                        Type the organization name to confirm deletion
                      </label>
                      <input
                        id="delete-org-confirmation"
                        value={deleteConfirmation}
                        onChange={(event) => setDeleteConfirmation(event.target.value)}
                        placeholder={`Type “${org.name}”`}
                        autoComplete="off"
                      />
                      <button type="button" className="btn-ghost" onClick={() => setConfirm(null)} disabled={busy}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() => void doDelete()}
                        disabled={busy || deleteConfirmation.trim() !== org.name}
                      >
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
          </section>
        </>
      )}
    </div>
  );
}
