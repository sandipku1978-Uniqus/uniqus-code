"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OrgMember, Role } from "@gate15/api-types";
import { roleAtLeast } from "@gate15/api-types";
import {
  fetchOrgMembersApi,
  addOrgMemberApi,
  setOrgMemberRoleApi,
  removeOrgMemberApi,
} from "@/lib/api";
import { toast } from "@/lib/toast";
import { OrgMetric, OrgMetricRail, OrgPageHeader, OrgStatePanel } from "./OrgPageChrome";
import Modal from "./Modal";

const ROLES: Role[] = ["admin", "editor", "viewer"];

const roleNote: Record<Role, string> = {
  owner: "full control, including deletion",
  admin: "manage members and settings",
  editor: "build and run the agent",
  viewer: "read-only access",
};

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const src = (name || email || "?").trim();
  return src.slice(0, 1).toUpperCase();
}

export default function OrgMembersView({
  orgId,
  effectiveRole,
}: {
  orgId: string;
  effectiveRole: Role | null;
}) {
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<OrgMember | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [membersOrgId, setMembersOrgId] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);
  const orgIdRef = useRef(orgId);
  orgIdRef.current = orgId;
  const canManage =
    membersOrgId === orgId && roleAtLeast(effectiveRole, "admin");

  const load = useCallback(async (signal?: AbortSignal) => {
    const generation = ++loadGenerationRef.current;
    setMembers(null);
    setMembersOrgId(null);
    setError(null);
    try {
      const { members } = await fetchOrgMembersApi(orgId, signal);
      if (signal?.aborted || generation !== loadGenerationRef.current) return;
      setMembers(members);
      setMembersOrgId(orgId);
    } catch (e) {
      if (signal?.aborted || generation !== loadGenerationRef.current) return;
      const message = e instanceof Error ? e.message : "Couldn't load members";
      setError(message);
      setMembers([]);
      toast.error(message);
    }
  }, [orgId]);

  useEffect(() => {
    const controller = new AbortController();
    setRemoveTarget(null);
    setRemoveError(null);
    void load(controller.signal);
    return () => {
      controller.abort();
      loadGenerationRef.current += 1;
    };
  }, [load]);

  async function invite() {
    const addr = email.trim();
    const targetOrgId = membersOrgId;
    if (!canManage || !targetOrgId || !addr || busy) return;
    setBusy(true);
    try {
      await addOrgMemberApi(targetOrgId, addr, inviteRole);
      if (orgIdRef.current !== targetOrgId) return;
      setEmail("");
      toast.success(`Added ${addr} as ${inviteRole}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't invite");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(member: OrgMember, role: Role) {
    const targetOrgId = membersOrgId;
    if (!canManage || !targetOrgId) return;
    try {
      await setOrgMemberRoleApi(targetOrgId, member.user_id, role);
      if (orgIdRef.current !== targetOrgId) return;
      setMembers((prev) =>
        prev?.map((item) => (item.user_id === member.user_id ? { ...item, role } : item)) ?? null,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't change role");
    }
  }

  async function remove(member: OrgMember) {
    const targetOrgId = membersOrgId;
    if (!canManage || !targetOrgId) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await removeOrgMemberApi(targetOrgId, member.user_id);
      if (orgIdRef.current !== targetOrgId) return;
      setMembers((prev) => prev?.filter((item) => item.user_id !== member.user_id) ?? null);
      toast.success("Member removed");
      setRemoveTarget(null);
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : "Couldn't remove member");
    } finally {
      setRemoving(false);
    }
  }

  const total = members?.length ?? 0;
  const adminPlus = members?.filter((member) => roleAtLeast(member.role, "admin")).length ?? 0;
  const canBuild = members?.filter((member) => roleAtLeast(member.role, "editor")).length ?? 0;
  const viewers = members?.filter((member) => member.role === "viewer").length ?? 0;
  const directoryStatus = error
    ? "Directory unavailable"
    : members === null
      ? "Syncing directory"
      : `${total} ${total === 1 ? "member" : "members"}`;

  return (
    <div className="dash-page org-page">
      <OrgPageHeader
        index="01"
        title="Manage"
        accent="members"
        context="Access directory"
        status={directoryStatus}
        statusTone={error ? "danger" : members === null ? "warn" : "live"}
        lede={
          <>
            {canManage
              ? "Add existing Gate 15 members by email, assign roles, and manage organization access."
              : `You have ${effectiveRole ?? "unknown"} access. Only organization admins and owners can change membership.`}
          </>
        }
      />

      {members !== null && !error && (
        <OrgMetricRail>
          <OrgMetric value={total} label={total === 1 ? "Member" : "Members"} />
          <OrgMetric value={adminPlus} label="Admins+" />
          <OrgMetric value={canBuild} label="Can build" />
          <OrgMetric value={viewers} label="Viewers" />
        </OrgMetricRail>
      )}

      <div className="org-members-layout">
        <section className="org-invite-panel">
          <div className="org-section-head">
            <span className="org-section-index">Access</span>
            <h2>Add an existing member</h2>
            <p>Use the email attached to their existing Gate 15 account.</p>
          </div>
          {canManage ? <div className="org-invite-form">
            <label>
              <span>Email address</span>
              <input
                type="email"
                placeholder="teammate@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void invite();
                }}
              />
            </label>
            <label>
              <span>Starting role</span>
              <select
                className="ui-select"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as Role)}
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <p className="org-role-note">{roleNote[inviteRole]}</p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void invite()}
              disabled={busy || !email.trim()}
            >
              {busy ? "Adding…" : "Add to organization"}
            </button>
          </div> : (
            <OrgStatePanel
              state="empty"
              title="Membership is read-only"
              body="Ask an organization admin or owner to add members or change roles."
            />
          )}
        </section>

        <section className="org-directory-panel">
          <div className="org-collection-head">
            <div>
              <span className="org-section-index">Directory</span>
              <h2>People &amp; access</h2>
            </div>
            {members !== null && !error && <span>{total} total</span>}
          </div>

          {error ? (
            <OrgStatePanel
              state="error"
              title="Members could not be loaded"
              body={error}
              onRetry={() => void load()}
            />
          ) : members === null ? (
            <OrgStatePanel
              state="loading"
              title="Syncing the directory"
              body="Fetching members and access roles for this organization."
            />
          ) : members.length === 0 ? (
            <OrgStatePanel
              state="empty"
              title="The directory is empty"
              body="Add the first teammate with the invite panel."
            />
          ) : (
            <div className="member-list">
              <div className="member-list-head" aria-hidden="true">
                <span>Member</span>
                <span>Access</span>
              </div>
              {members.map((member) => (
                <div key={member.user_id} className="member-row">
                  <span className="member-avatar" aria-hidden="true">
                    {initials(member.display_name, member.email)}
                  </span>
                  <div className="member-identity">
                    <div className="member-name">
                      {member.display_name || member.email || member.user_id}
                    </div>
                    {member.display_name && member.email && (
                      <div className="member-email">{member.email}</div>
                    )}
                  </div>

                  <div className="member-actions">
                    {member.role === "owner" || !canManage ? (
                      <span className="role-pill" title={roleNote[member.role]}>
                        {member.role}
                      </span>
                    ) : (
                      <>
                        <select
                          className="ui-select"
                          value={member.role}
                          title={roleNote[member.role]}
                          onChange={(event) => void changeRole(member, event.target.value as Role)}
                          aria-label={`Role for ${member.email ?? member.user_id}`}
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="member-remove"
                          aria-label={`Remove ${member.email ?? member.user_id}`}
                          title="Remove member"
                          onClick={() => {
                            setRemoveError(null);
                            setRemoveTarget(member);
                          }}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      {removeTarget && (
        <Modal
          title={`Remove ${removeTarget.display_name || removeTarget.email || "member"}?`}
          subtitle="They will lose access to every project in this organization immediately."
          width={460}
          onClose={() => !removing && setRemoveTarget(null)}
          footer={
            <div className="modal-actions">
              <button type="button" className="btn-secondary" disabled={removing} onClick={() => setRemoveTarget(null)}>
                Cancel
              </button>
              <button type="button" className="btn-danger" disabled={removing} onClick={() => void remove(removeTarget)}>
                {removing ? "Removing…" : "Remove access"}
              </button>
            </div>
          }
        >
          <p>This does not delete their account or project history.</p>
          {removeError && <p className="proj-dialog-error" role="alert">{removeError}</p>}
        </Modal>
      )}
    </div>
  );
}
