"use client";

import { useCallback, useEffect, useState } from "react";
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

export default function OrgMembersView({ orgId }: { orgId: string }) {
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMembers(null);
    setError(null);
    try {
      const { members } = await fetchOrgMembersApi(orgId);
      setMembers(members);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn't load members";
      setError(message);
      setMembers([]);
      toast.error(message);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite() {
    const addr = email.trim();
    if (!addr || busy) return;
    setBusy(true);
    try {
      await addOrgMemberApi(orgId, addr, inviteRole);
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
    try {
      await setOrgMemberRoleApi(orgId, member.user_id, role);
      setMembers((prev) =>
        prev?.map((item) => (item.user_id === member.user_id ? { ...item, role } : item)) ?? null,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't change role");
    }
  }

  async function remove(member: OrgMember) {
    try {
      await removeOrgMemberApi(orgId, member.user_id);
      setMembers((prev) => prev?.filter((item) => item.user_id !== member.user_id) ?? null);
      toast.success("Member removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove member");
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
            Invite teammates by email, assign a role, and manage who can access this
            organization&apos;s projects.
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
            <span className="org-section-index">Invite</span>
            <h2>Add a teammate</h2>
            <p>Use the email attached to their existing Gate 15 account.</p>
          </div>
          <div className="org-invite-form">
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
          </div>
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
                    {member.role === "owner" ? (
                      <span className="role-pill" title={roleNote.owner}>
                        owner
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
                          onClick={() => void remove(member)}
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
    </div>
  );
}
