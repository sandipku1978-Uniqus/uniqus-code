"use client";

import { useCallback, useEffect, useState } from "react";
import type { OrgMember, Role } from "@uniqus/api-types";
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
 * the caller lacks the role rather than hiding the controls. House design
 * language: hairline-divided editorial rows, mono micro-labels, magenta the
 * only accent, status carried by a labelled pill.
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
        <span style={eyebrow}>● Members</span>
        {members && (
          <span style={{ ...eyebrow, fontVariantNumeric: "tabular-nums" }}>
            {members.length} {members.length === 1 ? "person" : "people"}
          </span>
        )}
      </div>

      {/* Invite row */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
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
          aria-label="Invite role"
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
      <div style={{ color: "var(--text-dim)", fontSize: "var(--fs-xs)", marginTop: -8 }}>
        Teammates must already have a Uniqus account — add them by the email they signed up with.
      </div>

      {/* Member list — hairline-divided editorial rows */}
      {members === null ? (
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
          No members yet. Invite a teammate by email above.
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

              {m.role === "owner" ? (
                <span
                  title={roleNote.owner}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--fs-2xs)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--brand-magenta)",
                    background: "color-mix(in srgb, var(--brand-magenta) 12%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--brand-magenta) 30%, transparent)",
                    borderRadius: "var(--radius-full)",
                    padding: "3px 10px",
                  }}
                >
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
