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
    if (!trimmed || savingName || !org || trimmed === org.name) return;
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
      const amount = Number(trimmed);
      if (!Number.isFinite(amount) || amount < 0) {
        toast.error("Enter a non-negative amount, or leave blank for no cap");
        return;
      }
      value = amount;
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
                  <p>Runs pause when combined organization spend reaches this ceiling.</p>
                </div>
                <div className="org-setting-form">
                  <div className="org-setting-label-row">
                    <label htmlFor="org-settings-budget">Monthly cap in USD</label>
                    <span>{org.monthly_budget_usd == null ? "No cap" : `$${org.monthly_budget_usd} / month`}</span>
                  </div>
                  <div className="org-field-action org-money-field">
                    <span aria-hidden="true">$</span>
                    <input
                      id="org-settings-budget"
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      placeholder="No cap"
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
                  <p className="org-field-note">Leave blank to monitor spend without enforcing a cap.</p>
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
                    You&apos;ll lose access to shared projects. Projects you own return to Personal.
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
                      Membership is removed; projects remain and return to their owners.
                    </div>
                  </div>
                  {confirm === "delete" ? (
                    <div className="org-confirm-actions">
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
          </section>
        </>
      )}
    </div>
  );
}
