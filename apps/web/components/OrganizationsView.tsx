"use client";

import { useCallback, useEffect, useState } from "react";
import type { Organization } from "@uniqus/api-types";
import { fetchOrgsApi, createOrgApi, setOrgBudgetApi } from "@/lib/api";
import { toast } from "@/lib/toast";
import OrgMembersView from "./OrgMembersView";

/**
 * Organizations (P3.1/P3.5) — account-level "Teams" surface. Left: the user's
 * orgs as selectable rows plus an inline create form. Right: the selected org's
 * members (OrgMembersView) and a monthly-budget card. House design language:
 * hairline-divided editorial rows, mono micro-labels, magenta the only accent.
 * Self-contained: the only mount side effect is fetching the org list.
 */

const eyebrow: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--fs-2xs)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text-dim)",
};

function BudgetCard({ org, onSaved }: { org: Organization; onSaved: (o: Organization) => void }) {
  // Empty string ⇒ no cap (null). Re-seed when switching orgs.
  const [value, setValue] = useState<string>(
    org.monthly_budget_usd == null ? "" : String(org.monthly_budget_usd),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(org.monthly_budget_usd == null ? "" : String(org.monthly_budget_usd));
  }, [org.id, org.monthly_budget_usd]);

  async function save() {
    if (saving) return;
    const trimmed = value.trim();
    let budget: number | null;
    if (trimmed === "") {
      budget = null;
    } else {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) {
        toast.error("Enter a non-negative amount, or leave blank for no cap");
        return;
      }
      budget = n;
    }
    setSaving(true);
    try {
      await setOrgBudgetApi(org.id, budget);
      onSaved({ ...org, monthly_budget_usd: budget });
      toast.success(budget == null ? "Budget cleared" : `Monthly cap set to $${budget}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save budget");
    } finally {
      setSaving(false);
    }
  }

  const current =
    org.monthly_budget_usd == null ? "No cap" : `$${org.monthly_budget_usd} / month`;

  return (
    <div
      style={{
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-surface)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        maxWidth: 640,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={eyebrow}>● Monthly budget</span>
        <span style={{ ...eyebrow }}>{current}</span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span
          aria-hidden
          style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-md)" }}
        >
          $
        </span>
        <input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          className="ui-input"
          placeholder="No cap"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
          aria-label="Monthly budget in USD"
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
        <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <div style={{ color: "var(--text-dim)", fontSize: "var(--fs-xs)" }}>
        Leave blank for no cap. Caps the org's combined agent spend per calendar month.
      </div>
    </div>
  );
}

export default function OrganizationsView() {
  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const { orgs } = await fetchOrgsApi();
      setOrgs(orgs);
      setSelectedId((prev) => {
        if (prev && orgs.some((o) => o.id === prev)) return prev;
        return orgs[0]?.id ?? null;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load organizations");
      setOrgs([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const { org } = await createOrgApi(name);
      setNewName("");
      setOrgs((prev) => [...(prev ?? []), org]);
      setSelectedId(org.id);
      toast.success(`Created ${org.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create organization");
    } finally {
      setCreating(false);
    }
  }

  function handleSaved(updated: Organization) {
    setOrgs((prev) => prev?.map((o) => (o.id === updated.id ? updated : o)) ?? null);
  }

  const selected = orgs?.find((o) => o.id === selectedId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={eyebrow}>● Organizations</span>
        {orgs && (
          <span style={{ ...eyebrow, fontVariantNumeric: "tabular-nums" }}>
            {orgs.length} {orgs.length === 1 ? "team" : "teams"}
          </span>
        )}
      </div>

      {orgs === null ? (
        <div style={{ ...eyebrow }}>Loading…</div>
      ) : orgs.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--border-default)",
            borderRadius: "var(--radius-lg)",
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            maxWidth: 480,
          }}
        >
          <div style={{ color: "var(--text-primary)", fontSize: "var(--fs-md)" }}>
            You don't belong to any organization yet.
          </div>
          <div style={{ color: "var(--text-dim)", fontSize: "var(--fs-sm)" }}>
            Create one to share projects, manage teammates by role, and set a shared monthly budget.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              className="ui-input"
              placeholder="Organization name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
              }}
              aria-label="Organization name"
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
            <button
              type="button"
              className="btn-primary"
              onClick={() => void create()}
              disabled={creating || !newName.trim()}
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          {/* Left: org list + create form */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              flex: "0 0 260px",
              minWidth: 240,
            }}
          >
            <div
              style={{
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-lg)",
                overflow: "hidden",
                background: "var(--bg-surface)",
              }}
            >
              {orgs.map((o, i) => {
                const active = o.id === selectedId;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setSelectedId(o.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 14px",
                      borderTop: i === 0 ? "none" : "1px solid var(--border-light)",
                      borderLeft: active
                        ? "2px solid var(--brand-magenta)"
                        : "2px solid transparent",
                      background: active ? "var(--bg-surface-active)" : "transparent",
                      color: "var(--text-primary)",
                      cursor: "pointer",
                      font: "inherit",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "var(--fs-md)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {o.name}
                      </div>
                      <div style={{ ...eyebrow }}>
                        {o.monthly_budget_usd == null ? "No cap" : `$${o.monthly_budget_usd}/mo`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Inline create form */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="text"
                className="ui-input"
                placeholder="New organization"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void create();
                }}
                aria-label="New organization name"
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "var(--bg-elev)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--text-primary)",
                  padding: "8px 10px",
                  fontSize: "var(--fs-md)",
                }}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() => void create()}
                disabled={creating || !newName.trim()}
              >
                {creating ? "…" : "Create"}
              </button>
            </div>
          </div>

          {/* Right: selected org detail */}
          <div style={{ flex: 1, minWidth: 320, display: "flex", flexDirection: "column", gap: 20 }}>
            {selected ? (
              <>
                <h2
                  style={{
                    margin: 0,
                    color: "var(--text-primary)",
                    fontSize: "var(--fs-md)",
                    fontWeight: 600,
                  }}
                >
                  {selected.name}
                </h2>
                <OrgMembersView orgId={selected.id} />
                <BudgetCard org={selected} onSaved={handleSaved} />
              </>
            ) : (
              <div style={{ ...eyebrow }}>Select an organization.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
