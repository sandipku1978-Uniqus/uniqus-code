"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "./Modal";
import { toast } from "@/lib/toast";
import {
  fetchSupabaseStatus,
  fetchSupabaseProjects,
  supabaseOauthStartUrl,
  disconnectSupabaseApi,
  supabaseQueryApi,
  supabasePauseApi,
  supabaseRestoreApi,
  supabaseDeleteApi,
  type SupabaseStatus,
  type SupabaseProjectInfo,
  type SupabaseLinkInfo,
} from "@/lib/api";

/**
 * Databases tab on the projects page. Account-level view of the Supabase
 * databases the connected account owns — but no longer just a list: each
 * database opens an inspector with a live table browser (schema + row counts +
 * data preview), a SQL console, and pause/restore/delete controls, all through
 * the Management API the agent connector already uses (no extra OAuth scopes).
 * Provisioning still happens inside a project (supabase.provision_database).
 */

/** Deterministic hue per database ref — same tile language as projects/skills. */
function dbHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

function avatarColor(id: string): string {
  return `hsl(${dbHue(id)} 55% 28%)`;
}

function coverBackground(id: string): string {
  const h = dbHue(id);
  const h2 = (h + 42) % 360;
  return [
    `radial-gradient(130% 160% at 88% -30%, hsl(${h2} 72% 48% / 0.8), transparent 58%)`,
    `linear-gradient(118deg, hsl(${h} 58% 31%), hsl(${(h + 24) % 360} 54% 19%))`,
  ].join(", ");
}

function relativeTime(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function prettyBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Map a Supabase project status to badge tone + label. */
function statusInfo(status?: string): { tone: "ok" | "warn" | "dim"; label: string } {
  if (status === "ACTIVE_HEALTHY") return { tone: "ok", label: "Healthy" };
  if (status === "INACTIVE" || status === "PAUSED" || status === "PAUSING")
    return { tone: "dim", label: status === "PAUSING" ? "Pausing…" : "Paused" };
  return { tone: "warn", label: (status ?? "unknown").replace(/_/g, " ").toLowerCase() };
}

function StatusBadge({ status }: { status?: string }) {
  const { tone, label } = statusInfo(status);
  const color =
    tone === "ok" ? "var(--conf-high)" : tone === "warn" ? "var(--conf-medium)" : "var(--text-dim)";
  return (
    <span className="db-status" style={{ color, borderColor: color }}>
      {label}
    </span>
  );
}

// ── SQL helpers (composed client-side, executed via the query proxy) ─────────

const TABLES_SQL = `select c.relname as name,
       pg_total_relation_size(c.oid) as bytes,
       greatest(c.reltuples, 0)::bigint as approx_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;`;

const columnsSql = (table: string): string =>
  `select c.column_name, c.data_type, c.is_nullable, c.column_default,
       exists (
         select 1 from information_schema.key_column_usage k
         join information_schema.table_constraints tc
           on tc.constraint_name = k.constraint_name and tc.table_schema = k.table_schema
         where tc.constraint_type = 'PRIMARY KEY'
           and k.table_schema = 'public'
           and k.table_name = c.table_name
           and k.column_name = c.column_name
       ) as is_pk
from information_schema.columns c
where c.table_schema = 'public' and c.table_name = '${table.replace(/'/g, "''")}'
order by c.ordinal_position;`;

const previewSql = (table: string): string =>
  `select * from "${table.replace(/"/g, '""')}" limit 50;`;

type Row = Record<string, unknown>;

function asRows(data: unknown): Row[] {
  return Array.isArray(data) ? (data.filter((r) => r && typeof r === "object") as Row[]) : [];
}

/** Generic result grid: columns from the union of the first rows' keys. */
function ResultsTable({ rows, maxRows = 200 }: { rows: Row[]; maxRows?: number }) {
  if (rows.length === 0) {
    return <p className="db-empty-note">No rows returned.</p>;
  }
  const cols: string[] = [];
  for (const r of rows.slice(0, 20)) {
    for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  }
  const shown = rows.slice(0, maxRows);
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "∅";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  return (
    <div className="db-results-wrap">
      <table className="db-results">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => {
                const text = cell(r[c]);
                const isNull = r[c] === null || r[c] === undefined;
                return (
                  <td key={c} className={isNull ? "null" : undefined} title={text.length > 60 ? text : undefined}>
                    {text.length > 200 ? `${text.slice(0, 200)}…` : text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxRows && (
        <p className="db-empty-note">Showing first {maxRows} of {rows.length} rows.</p>
      )}
    </div>
  );
}

// ── Detail modal ──────────────────────────────────────────────────────────────

interface TableInfo {
  name: string;
  bytes: number;
  approx_rows: number;
}

function DatabaseModal({
  db,
  link,
  onClose,
  onChanged,
}: {
  db: SupabaseProjectInfo;
  link: SupabaseLinkInfo | null;
  onClose: () => void;
  /** Called after pause/restore/delete so the grid refreshes. */
  onChanged: (deleted?: boolean) => void;
}) {
  const ref = db.ref ?? "";
  const healthy = db.status === "ACTIVE_HEALTHY";
  const paused = db.status === "INACTIVE" || db.status === "PAUSED";
  const [tab, setTab] = useState<"tables" | "sql">("tables");

  // Tables tab state. `selected` switches the pane to a single table's schema.
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [columns, setColumns] = useState<Row[] | null>(null);
  const [preview, setPreview] = useState<Row[] | null>(null);
  const [tableBusy, setTableBusy] = useState(false);

  // SQL console state.
  const [sql, setSql] = useState("");
  const [sqlRows, setSqlRows] = useState<Row[] | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlBusy, setSqlBusy] = useState(false);
  const [sqlMs, setSqlMs] = useState<number | null>(null);

  // Lifecycle actions.
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  useEffect(() => {
    if (!healthy || !ref) return;
    let abort = false;
    supabaseQueryApi(ref, TABLES_SQL)
      .then((r) => {
        if (abort) return;
        const rows = asRows(r.rows);
        setTables(
          rows.map((row) => ({
            name: String(row.name ?? ""),
            bytes: Number(row.bytes ?? 0),
            approx_rows: Number(row.approx_rows ?? 0),
          })),
        );
      })
      .catch((e) => {
        if (!abort) setTablesError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      abort = true;
    };
  }, [ref, healthy]);

  async function openTable(name: string) {
    if (tableBusy) return;
    setSelected(name);
    setColumns(null);
    setPreview(null);
    setTableBusy(true);
    try {
      const [colsRes, prevRes] = await Promise.all([
        supabaseQueryApi(ref, columnsSql(name)),
        supabaseQueryApi(ref, previewSql(name)),
      ]);
      setColumns(asRows(colsRes.rows));
      setPreview(asRows(prevRes.rows));
    } catch (e) {
      toast.error(`Couldn't inspect table: ${e instanceof Error ? e.message : String(e)}`);
      setSelected(null);
    } finally {
      setTableBusy(false);
    }
  }

  async function runSql() {
    const q = sql.trim();
    if (!q || sqlBusy) return;
    setSqlBusy(true);
    setSqlError(null);
    setSqlRows(null);
    const t0 = performance.now();
    try {
      const { rows } = await supabaseQueryApi(ref, q);
      setSqlMs(Math.round(performance.now() - t0));
      setSqlRows(asRows(rows));
    } catch (e) {
      setSqlError(e instanceof Error ? e.message : String(e));
    } finally {
      setSqlBusy(false);
    }
  }

  async function pauseOrRestore() {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      if (healthy) {
        await supabasePauseApi(ref);
        toast.success("Database pausing — this takes a minute");
      } else {
        await supabaseRestoreApi(ref);
        toast.success("Database restoring — this can take a few minutes");
      }
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }

  async function doDelete() {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await supabaseDeleteApi(ref);
      toast.success(`"${db.name ?? ref}" deleted`);
      onChanged(true);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }

  const meta = [
    db.region,
    db.database?.version ? `Postgres ${db.database.version}` : null,
    db.created_at ? `created ${relativeTime(db.created_at)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <Modal
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            {db.name ?? ref}
            <StatusBadge status={db.status} />
          </span>
        }
        subtitle={
          <>
            <code>{ref}</code>
            {meta ? <> · {meta}</> : null}
            {link ? <> · powers <strong>{link.project_name}</strong></> : null}
          </>
        }
        width={920}
        onClose={onClose}
        footer={
          <>
            <div className="modal-status">
              <a
                href={`https://supabase.com/dashboard/project/${ref}`}
                target="_blank"
                rel="noreferrer"
                className="db-ext-link"
              >
                Open in Supabase ↗
              </a>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-ghost"
                style={{ color: "var(--conf-low)" }}
                onClick={() => setConfirmDelete(true)}
                disabled={actionBusy}
              >
                Delete
              </button>
              {(healthy || paused) && (
                <button type="button" className="btn-secondary" onClick={() => void pauseOrRestore()} disabled={actionBusy}>
                  {actionBusy ? "Working…" : healthy ? "Pause" : "Restore"}
                </button>
              )}
              <button type="button" className="btn-primary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        }
      >
        {!healthy ? (
          <p className="db-empty-note" style={{ fontSize: 13 }}>
            {paused
              ? "This database is paused — restore it to browse tables or run SQL."
              : "This database isn't ready yet. Once it's healthy you can browse tables and run SQL here."}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 360 }}>
            <div className="dash-tabs" role="tablist" style={{ margin: 0, alignSelf: "flex-start" }}>
              <button type="button" role="tab" aria-selected={tab === "tables"} onClick={() => setTab("tables")}>
                Tables
              </button>
              <button type="button" role="tab" aria-selected={tab === "sql"} onClick={() => setTab("sql")}>
                SQL console
              </button>
            </div>

            {tab === "tables" ? (
              selected ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button type="button" className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setSelected(null)}>
                      ← All tables
                    </button>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      <code>{selected}</code>
                    </span>
                  </div>
                  {tableBusy ? (
                    <p className="db-empty-note">Loading schema + preview…</p>
                  ) : (
                    <>
                      {columns && (
                        <>
                          <div className="db-subhead">Columns</div>
                          <ResultsTable
                            rows={columns.map((c) => ({
                              column: `${c.is_pk === true || c.is_pk === "true" ? "🔑 " : ""}${String(c.column_name ?? "")}`,
                              type: c.data_type,
                              nullable: c.is_nullable,
                              default: c.column_default,
                            }))}
                          />
                        </>
                      )}
                      {preview && (
                        <>
                          <div className="db-subhead">First {preview.length} rows</div>
                          <ResultsTable rows={preview} />
                        </>
                      )}
                    </>
                  )}
                </div>
              ) : tablesError ? (
                <p className="db-empty-note" style={{ color: "var(--conf-medium)" }}>{tablesError}</p>
              ) : tables === null ? (
                <p className="db-empty-note">Loading tables…</p>
              ) : tables.length === 0 ? (
                <p className="db-empty-note">
                  No tables in the <code>public</code> schema yet. Ask the agent to create some, or use the SQL
                  console.
                </p>
              ) : (
                <div className="db-table-list">
                  {tables.map((t) => (
                    <button key={t.name} type="button" className="db-table-row" onClick={() => void openTable(t.name)}>
                      <span className="db-table-name">{t.name}</span>
                      <span className="db-table-meta">
                        ~{t.approx_rows.toLocaleString()} rows · {prettyBytes(t.bytes)}
                      </span>
                    </button>
                  ))}
                </div>
              )
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <textarea
                  className="db-sql-input"
                  value={sql}
                  onChange={(e) => setSql(e.target.value)}
                  spellCheck={false}
                  placeholder={"select * from users limit 10;"}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void runSql();
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button type="button" className="btn-primary" onClick={() => void runSql()} disabled={sqlBusy || !sql.trim()}>
                    {sqlBusy ? "Running…" : "Run"}
                  </button>
                  <span className="db-empty-note" style={{ margin: 0 }}>
                    ⌘⏎ to run · executes as <code>postgres</code> — destructive statements are real
                  </span>
                  {sqlRows !== null && sqlMs !== null && (
                    <span className="db-empty-note" style={{ margin: "0 0 0 auto" }}>
                      {sqlRows.length} row{sqlRows.length === 1 ? "" : "s"} · {sqlMs} ms
                    </span>
                  )}
                </div>
                {sqlError && (
                  <pre className="db-sql-error">{sqlError}</pre>
                )}
                {sqlRows !== null && <ResultsTable rows={sqlRows} />}
              </div>
            )}
          </div>
        )}
      </Modal>

      {confirmDelete && (
        <Modal
          title="Delete this database?"
          width={460}
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <span />
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setConfirmDelete(false)} disabled={actionBusy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => void doDelete()}
                  disabled={actionBusy || deleteText !== (db.name ?? ref)}
                >
                  {actionBusy ? "Deleting…" : "Delete forever"}
                </button>
              </div>
            </>
          }
        >
          <div style={{ display: "grid", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6 }}>
              This permanently deletes the Supabase project <strong>{db.name ?? ref}</strong> and{" "}
              <strong>all of its data</strong>. There is no undo.
              {link ? (
                <>
                  {" "}
                  It currently powers <strong>{link.project_name}</strong> — that app will lose its database.
                </>
              ) : null}
            </p>
            <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Type <code>{db.name ?? ref}</code> to confirm:
            </label>
            <input
              className="ds-name"
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              placeholder={db.name ?? ref}
            />
          </div>
        </Modal>
      )}
    </>
  );
}

// ── Tab root ──────────────────────────────────────────────────────────────────

export default function DatabasesView({ isGuest }: { isGuest: boolean }) {
  const [status, setStatus] = useState<SupabaseStatus | null>(null);
  const [projects, setProjects] = useState<SupabaseProjectInfo[] | null>(null);
  const [links, setLinks] = useState<SupabaseLinkInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const loadProjects = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchSupabaseProjects()
      .then((r) => {
        setProjects(Array.isArray(r.projects) ? r.projects : []);
        setLinks(Array.isArray(r.links) ? r.links : []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isGuest) return;
    fetchSupabaseStatus()
      .then((s) => {
        setStatus(s);
        if (s.connected) loadProjects();
      })
      .catch(() => setStatus({ connected: false, org_id: null, org_name: null, connected_at: null }));
  }, [isGuest, loadProjects]);

  async function disconnect() {
    try {
      await disconnectSupabaseApi();
      setStatus({ connected: false, org_id: null, org_name: null, connected_at: null });
      setProjects(null);
      setConfirmDisconnect(false);
      toast.success("Supabase disconnected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  const returnTo =
    typeof window !== "undefined" ? window.location.origin + "/projects" : "/projects";
  const linkFor = (ref?: string): SupabaseLinkInfo | null =>
    (ref && links.find((l) => l.ref === ref)) || null;
  const openDb = openRef ? (projects ?? []).find((p) => p.ref === openRef) ?? null : null;

  if (isGuest) {
    return (
      <div className="dash-page" style={{ maxWidth: 880 }}>
        <span className="page-eyebrow">Storage</span>
        <h1>Databases</h1>
        <div className="dash-card">
          <p className="card-sub" style={{ marginBottom: 0 }}>
            Sign in with an account to connect Supabase and create databases.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-page ds-page">
      <span className="page-eyebrow">Storage</span>
      <h1>Databases</h1>
      <p className="lede">
        Postgres databases provisioned through your connected Supabase account. Browse tables, run SQL, and
        pause or delete databases — or open a project and ask the agent to “create a database”.
      </p>

      {status === null ? (
        <div className="dash-card">
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>Checking connection…</p>
        </div>
      ) : !status.connected ? (
        <div className="dash-card skills-empty">
          <div className="skills-empty-plus" aria-hidden="true">🗄</div>
          <h2>Connect Supabase</h2>
          <p>
            Connect your Supabase account and the agent can provision a real Postgres database per project —
            keys wired automatically. You get a table browser, SQL console, and lifecycle controls right here.
          </p>
          <a href={supabaseOauthStartUrl(returnTo)} className="btn-primary" style={{ textDecoration: "none" }}>
            Connect Supabase
          </a>
        </div>
      ) : (
        <>
          <div className="section-title">
            <div className="head">
              <span className="eyebrow">{status.org_name ?? "Connected"}</span>
              <h2>Your databases</h2>
            </div>
            <span className="sub" style={{ display: "inline-flex", gap: 12, alignItems: "center" }}>
              {projects !== null && (
                <span>
                  {projects.length} database{projects.length === 1 ? "" : "s"}
                </span>
              )}
              <button type="button" onClick={loadProjects} disabled={loading} className="btn-ghost" style={{ fontSize: 11.5, padding: "2px 8px" }}>
                {loading ? "Refreshing…" : "Refresh"}
              </button>
              <button type="button" onClick={() => setConfirmDisconnect(true)} className="btn-ghost" style={{ fontSize: 11.5, padding: "2px 8px" }}>
                Disconnect
              </button>
            </span>
          </div>

          {error ? (
            <div className="dash-card">
              <p style={{ margin: 0, fontSize: 13, color: "var(--conf-medium)" }}>{error}</p>
            </div>
          ) : projects === null ? (
            <div className="proj-grid" aria-hidden="true">
              {[0, 1].map((i) => (
                <div key={i} className="proj proj-tile">
                  <div className="proj-cover" style={{ background: "var(--bg-surface-active)" }} />
                  <div className="proj-tile-head">
                    <span className="proj-avatar" style={{ background: "var(--bg-surface-active)" }} />
                  </div>
                  <div className="proj-tile-link">
                    <h3 style={{ color: "transparent" }}>·</h3>
                    <p className="desc" />
                    <div className="meta" />
                  </div>
                </div>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="dash-card skills-empty">
              <div className="skills-empty-plus" aria-hidden="true">🗄</div>
              <h2>No databases yet</h2>
              <p>
                Open a project and ask the agent to “create a database” — it provisions a Supabase Postgres
                instance and wires the keys into the project automatically. It’ll show up here.
              </p>
            </div>
          ) : (
            <div className="proj-grid">
              {projects.map((p) => {
                const key = p.ref ?? p.id ?? p.name ?? "";
                const link = linkFor(p.ref);
                return (
                  <div key={key} className="proj proj-tile">
                    <div className="proj-cover" style={{ background: coverBackground(key) }} aria-hidden="true" />
                    <div className="proj-tile-head">
                      <span className="proj-avatar" style={{ background: avatarColor(key) }}>
                        {(p.name ?? p.ref ?? "·").trim().charAt(0).toUpperCase()}
                      </span>
                      <StatusBadge status={p.status} />
                    </div>
                    <button type="button" className="proj-tile-link skill-tile-btn" onClick={() => p.ref && setOpenRef(p.ref)}>
                      <h3>{p.name ?? p.ref ?? "(unnamed)"}</h3>
                      <p className="desc db-mono">
                        {p.ref}
                        {p.region ? ` · ${p.region}` : ""}
                      </p>
                      <div className="meta">
                        <span>
                          {link ? (
                            <span className="tile-chip live" title={`Linked to ${link.project_name}`}>
                              ◆ {link.project_name}
                            </span>
                          ) : (
                            "not linked to a project"
                          )}
                        </span>
                        {p.created_at && <span title={`Created ${relativeTime(p.created_at)}`}>{relativeTime(p.created_at)}</span>}
                      </div>
                    </button>
                  </div>
                );
              })}
              <div className="proj proj-tile skill-new-tile" style={{ cursor: "default" }}>
                <span className="skill-new-plus" aria-hidden="true">+</span>
                <span className="skill-new-label">New database</span>
                <span className="skill-new-sub">
                  Open a project and ask the agent to “create a database” — it provisions and wires the keys
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {openDb && (
        <DatabaseModal
          db={openDb}
          link={linkFor(openDb.ref)}
          onClose={() => setOpenRef(null)}
          onChanged={() => loadProjects()}
        />
      )}

      {confirmDisconnect && (
        <Modal
          title="Disconnect Supabase?"
          width={440}
          onClose={() => setConfirmDisconnect(false)}
          footer={
            <>
              <span />
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setConfirmDisconnect(false)}>
                  Cancel
                </button>
                <button type="button" className="btn-danger" onClick={() => void disconnect()}>
                  Disconnect
                </button>
              </div>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6 }}>
            Your databases and their data stay untouched on Supabase — this only removes uniqus&apos;s access.
            The agent won&apos;t be able to provision or query databases until you reconnect.
          </p>
        </Modal>
      )}
    </div>
  );
}
