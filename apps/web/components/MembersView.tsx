"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectMember, Role } from "@gate15/api-types";
import { roleAtLeast } from "@gate15/api-types";
import {
  fetchProjectMembersApi,
  addProjectMemberApi,
  setProjectMemberRoleApi,
  removeProjectMemberApi,
} from "@/lib/api";
import { toast } from "@/lib/toast";
import Modal from "./Modal";

/**
 * Project collaborators (P3.2). Invite a teammate by email + role, change a
 * role, or remove someone. The server enforces RBAC (admin+ to manage); the UI
 * surfaces a clear error if the caller lacks the role rather than hiding the
 * controls. House design language: hairline-divided editorial rows, mono micro-
 * labels, magenta the only accent, status carried by a labelled pill.
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

export default function MembersView({
  projectId,
  effectiveRole,
}: {
  projectId: string;
  effectiveRole: Role | null;
}) {
  const [members, setMembers] = useState<ProjectMember[] | null>(null);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ProjectMember | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const canManage = roleAtLeast(effectiveRole, "admin");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { members } = await fetchProjectMembersApi(projectId);
      setMembers(members);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load members");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite() {
    const addr = email.trim();
    if (!canManage || !addr || busy) return;
    setBusy(true);
    try {
      await addProjectMemberApi(projectId, addr, inviteRole);
      setEmail("");
      toast.success(`Added ${addr} as ${inviteRole}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add member");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(m: ProjectMember, role: Role) {
    if (!canManage) return;
    try {
      await setProjectMemberRoleApi(projectId, m.user_id, role);
      setMembers((prev) => prev?.map((x) => (x.user_id === m.user_id ? { ...x, role } : x)) ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't change role");
    }
  }

  async function remove(m: ProjectMember) {
    if (!canManage) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await removeProjectMemberApi(projectId, m.user_id);
      setMembers((prev) => prev?.filter((x) => x.user_id !== m.user_id) ?? null);
      toast.success("Removed");
      setRemoveTarget(null);
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : "Couldn't remove member");
    } finally {
      setRemoving(false);
    }
  }

  const eyebrow: React.CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--fs-2xs)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--text-dim)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={eyebrow}>● Collaborators</span>
        {members && (
          <span style={{ ...eyebrow, fontVariantNumeric: "tabular-nums" }}>
            {members.length} {members.length === 1 ? "person" : "people"}
          </span>
        )}
      </div>

      {/* Existing-account add row. The API does not send invitations. */}
      {canManage ? <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label className="sr-only" htmlFor="project-member-email">
          Existing Gate 15 member email
        </label>
        <input
          id="project-member-email"
          name="memberEmail"
          type="email"
          className="ui-input"
          placeholder="teammate@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void invite();
          }}
          style={{
            flex: 1,
            background: "var(--bg-elev)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-md)",
            color: "var(--text-primary)",
            padding: "8px 10px",
            fontSize: "var(--fs-md)",
          }}
        />
        <select
          className="ui-select"
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value as Role)}
          aria-label="Member role"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button type="button" className="btn-primary" onClick={() => void invite()} disabled={busy || !email.trim()}>
          {busy ? "Adding…" : "Add existing member"}
        </button>
      </div> : (
        <div className="async-error" role="status">
          <p>Collaborator access is read-only for your {effectiveRole ?? "current"} role.</p>
          <span>Ask a project admin or owner to add members or change roles.</span>
        </div>
      )}

      {/* Member list — hairline-divided editorial rows */}
      {loadError ? (
        <div className="async-error" role="alert">
          <p>We couldn&rsquo;t load collaborators. Existing access may still be there.</p>
          <code>{loadError}</code>
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : members === null ? (
        <div style={{ ...eyebrow }}>Loading…</div>
      ) : members.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--border-default)",
            borderRadius: "var(--radius-lg)",
            padding: 24,
            textAlign: "center",
            color: "var(--text-dim)",
            fontSize: "var(--fs-sm)",
          }}
        >
          No collaborators yet. Add an existing Gate 15 member by email above.
        </div>
      ) : (
        <div
          style={{
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
            background: "var(--bg-surface)",
          }}
        >
          {members.map((m, i) => (
            <div
              key={m.user_id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderTop: i === 0 ? "none" : "1px solid var(--border-light)",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 28,
                  height: 28,
                  flex: "0 0 auto",
                  borderRadius: "var(--radius-full)",
                  display: "grid",
                  placeItems: "center",
                  background: "var(--bg-surface-active)",
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-sm)",
                }}
              >
                {initials(m.display_name, m.email)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: "var(--text-primary)",
                    fontSize: "var(--fs-md)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.display_name || m.email || m.user_id}
                </div>
                {m.display_name && m.email && (
                  <div style={{ color: "var(--text-dim)", fontSize: "var(--fs-xs)" }}>{m.email}</div>
                )}
              </div>

              {m.role === "owner" || !canManage ? (
                <span
                  title={roleNote[m.role]}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--fs-2xs)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--accent-text)",
                    background: "color-mix(in srgb, var(--brand-ember) 12%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--brand-ember) 30%, transparent)",
                    borderRadius: "var(--radius-full)",
                    padding: "3px 10px",
                  }}
                >
                  {m.role}
                </span>
              ) : (
                <>
                  <select
                    className="ui-select"
                    value={m.role}
                    title={roleNote[m.role]}
                    onChange={(e) => void changeRole(m, e.target.value as Role)}
                    aria-label={`Role for ${m.email ?? m.user_id}`}
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
                    onClick={() => {
                      setRemoveError(null);
                      setRemoveTarget(m);
                    }}
                    style={{ color: "var(--text-dim)", padding: "4px 8px" }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {removeTarget && (
        <Modal
          title={`Remove ${removeTarget.display_name || removeTarget.email || "member"}?`}
          subtitle="They will lose access to this project immediately."
          width={440}
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
