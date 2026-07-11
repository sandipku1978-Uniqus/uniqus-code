"use client";

import { useCallback, useEffect, useState } from "react";
import type { OrgMember, Role } from "@uniqus/api-types";
import { roleAtLeast } from "@uniqus/api-types";
import {
  fetchOrgMembersApi,
  addOrgMemberApi,
  setOrgMemberRoleApi,
  removeOrgMemberApi,
} from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * Organization members (P3.1/P3.2). Org-scoped near-clone of MembersView:
 * invite a teammate by email + role, change a role, or remove someone. The
 * server enforces RBAC (admin+ to manage); the UI surfaces a clear error if
 * the caller lacks the role rather than hiding the controls. Same page chrome
 * as the other dashboard sub-pages (.dash-page + .coll-head + .metric-strip)
 * so this reads as part of the product, not a bolted-on admin screen.
 */

const ROLES: Role[] = ["admin", "editor", "viewer"];
const ALL_ROLES: Role[] = ["owner", ...ROLES];

const roleNote: Record<Role, string> = {
  owner: "full control, incl. delete",
  admin: "manage members + settings",
  editor: "build + run the agent",
  viewer: "read-only",
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

  const load = useCallback(async () => {
    try {
      const { members } = await fetchOrgMembersApi(orgId);
      setMembers(members);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load members");
      setMembers([]);
    }
  }, [orgId]);

  useEffect(() => {
    setMembers(null);
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

  async function changeRole(m: OrgMember, role: Role) {
    try {
      await setOrgMemberRoleApi(orgId, m.user_id, role);
      setMembers((prev) => prev?.map((x) => (x.user_id === m.user_id ? { ...x, role } : x)) ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't change role");
    }
  }

  async function remove(m: OrgMember) {
    try {
      await removeOrgMemberApi(orgId, m.user_id);
      setMembers((prev) => prev?.filter((x) => x.user_id !== m.user_id) ?? null);
      toast.success("Removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove");
    }
  }

  const total = members?.length ?? 0;
  const adminPlus = members?.filter((m) => roleAtLeast(m.role, "admin")).length ?? 0;
  const canBuild = members?.filter((m) => roleAtLeast(m.role, "editor")).length ?? 0;
  const viewers = members?.filter((m) => m.role === "viewer").length ?? 0;

  return (
    <div className="dash-page org-page">
      <header className="coll-head">
        <span className="page-eyebrow">Workspace</span>
        <h1>
          Manage <span className="grad">members</span>
        </h1>
        <p className="lede">
          Invite teammates by email, assign a role, and manage who can access this
          organization&apos;s projects.
        </p>
      </header>

      {members !== null && members.length > 0 && (
        <div className="metric-strip">
          <MemberMetric value={total} label={total === 1 ? "Member" : "Members"} />
          <MemberMetric value={adminPlus} label="Admins+" />
          <MemberMetric value={canBuild} label="Can build" />
          <MemberMetric value={viewers} label="Viewers" />
        </div>
      )}

      <div className="dash-card">
        <h2>Invite a teammate</h2>
        <p className="card-sub">
          They must already have a Uniqus account — add them by the email they signed up
          with.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="email"
            placeholder="teammate@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void invite();
            }}
            aria-label="Teammate email"
            style={{ flex: 1, minWidth: 200 }}
          />
          <select
            className="ui-select"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
            aria-label="Invite role"
            style={{ width: "auto" }}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button type="button" className="btn-primary" onClick={() => void invite()} disabled={busy || !email.trim()}>
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </div>

      {members === null ? (
        <div className="dash-card">
          <p className="card-sub" style={{ marginBottom: 0 }}>Loading members…</p>
        </div>
      ) : members.length === 0 ? (
        <div className="empty-state">No members yet. Invite a teammate above.</div>
      ) : (
        <div className="member-list">
          {members.map((m) => (
            <div key={m.user_id} className="member-row">
              <span className="member-avatar" aria-hidden="true">
                {initials(m.display_name, m.email)}
              </span>
              <div className="member-identity">
                <div className="member-name">{m.display_name || m.email || m.user_id}</div>
                {m.display_name && m.email && <div className="member-email">{m.email}</div>}
              </div>

              {m.role === "owner" ? (
                <span className="role-pill" title={roleNote.owner}>
                  owner
                </span>
              ) : (
                <>
                  <select
                    className="ui-select"
                    value={m.role}
                    title={roleNote[m.role]}
                    onChange={(e) => void changeRole(m, e.target.value as Role)}
                    aria-label={`Role for ${m.email ?? m.user_id}`}
                    style={{ width: "auto" }}
                  >
                    {ALL_ROLES.filter((r) => r !== "owner").map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-ghost"
                    aria-label={`Remove ${m.email ?? m.user_id}`}
                    title="Remove"
                    onClick={() => void remove(m)}
                    style={{ color: "var(--text-dim)", padding: "4px 8px" }}
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MemberMetric({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="metric-cell">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}
