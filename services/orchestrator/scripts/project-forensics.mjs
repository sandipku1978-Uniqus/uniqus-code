// Read-only forensic dump for ONE project. Pulls every project-scoped table,
// the full message transcript, and reconstructs the final code tree by replaying
// write_file/edit_file in order. Never writes to the DB; never emits secret
// VALUES (only names). Safe to run against production.
//
// Creds: Supabase dashboard → Project Settings → API (Project URL + service_role).
// Run from services/orchestrator (so @supabase/supabase-js resolves):
//
//   bash:        SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//                  node scripts/project-forensics.mjs <projectId> [outDir]
//   PowerShell:  $env:SUPABASE_URL="..."; $env:SUPABASE_SERVICE_ROLE_KEY="...";
//                  node scripts/project-forensics.mjs <projectId> [outDir]
import { createClient } from "@supabase/supabase-js";
import { promises as fs } from "node:fs";
import path from "node:path";

const projectId = process.argv[2];
const outDir = process.argv[3] || `forensics-${(projectId || "out").slice(0, 8)}`;
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!projectId || !url || !key) {
  console.error(
    "usage: SUPABASE_URL=.. SUPABASE_SERVICE_ROLE_KEY=.. node scripts/project-forensics.mjs <projectId> [outDir]",
  );
  process.exit(1);
}
const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

await fs.mkdir(outDir, { recursive: true });
const save = (name, data) => fs.writeFile(path.join(outDir, name), JSON.stringify(data, null, 2));

// Paginate past PostgREST's per-request row cap.
async function all(table, filter) {
  const rows = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    let q = db.from(table).select("*").range(from, from + size - 1);
    for (const [k, v] of Object.entries(filter || {})) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) {
      console.warn(`! ${table}: ${error.message}`);
      break;
    }
    rows.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return rows;
}

const proj = (await db.from("projects").select("*").eq("id", projectId).maybeSingle()).data;
if (!proj) {
  console.error(`project ${projectId} not found`);
  process.exit(1);
}
await save("project.json", proj);

const owner = (
  await db
    .from("users")
    .select(
      "id,email,display_name,account_type,custom_prompt,default_skills,github_login,vercel_user_login,supabase_org_name,figma_handle,created_at",
    )
    .eq("id", proj.owner_id)
    .maybeSingle()
).data;
const byok = await all("account_provider_keys", { user_id: proj.owner_id });
await save("owner.json", { ...owner, byok_providers: byok.map((k) => k.provider) });

// Every project-scoped table (full rows).
const tables = [
  "chat_sessions", "messages", "usage_events", "checkpoint_artifacts",
  "deployments", "project_flows", "comments", "audit_events",
  "agent_tasks", "project_members",
];
const data = {};
for (const t of tables) {
  data[t] = await all(t, { project_id: projectId });
  await save(`${t}.json`, data[t]);
}

// Secrets: NAMES ONLY — values are AES-encrypted and must never be dumped.
const secrets = await all("project_secrets", { project_id: projectId });
await save(
  "secret_names.json",
  secrets.map((s) => ({ name: s.name, env: s.env, description: s.description, created_at: s.created_at })),
);

// Reconstruct the final file tree + a readable transcript from the messages.
const msgs = (data.messages || []).slice().sort((a, b) => Number(a.id) - Number(b.id));
const vfs = new Map(); // path -> content (final state)
const writeLog = [];
const transcript = [];
const blocksOf = (c) =>
  Array.isArray(c) ? c : typeof c === "string" ? [{ type: "text", text: c }] : [];

for (const m of msgs) {
  const parts = [];
  for (const b of blocksOf(m.content)) {
    if (b.type === "text") {
      parts.push(b.text || "");
    } else if (b.type === "tool_use") {
      parts.push(`[tool_use ${b.name}] ${JSON.stringify(b.input ?? {}).slice(0, 2000)}`);
      const p = b.input?.path;
      if (b.name === "write_file" && typeof p === "string") {
        vfs.set(p, b.input.content ?? "");
        writeLog.push({ id: m.id, at: m.created_at, tool: "write_file", path: p });
      } else if (b.name === "edit_file" && typeof p === "string") {
        const cur = vfs.get(p);
        const entry = { id: m.id, at: m.created_at, tool: "edit_file", path: p };
        if (cur == null) entry.warn = "no prior write_file in transcript — edit not applied";
        else if (typeof b.input.old_string !== "string") entry.warn = "edit missing old_string";
        else {
          const idx = cur.indexOf(b.input.old_string);
          if (idx < 0) entry.warn = "old_string not found (file diverged from transcript)";
          else
            vfs.set(
              p,
              cur.slice(0, idx) + (b.input.new_string ?? "") + cur.slice(idx + b.input.old_string.length),
            );
        }
        writeLog.push(entry);
      } else if (b.name === "delete_file" && typeof p === "string") {
        vfs.delete(p);
        writeLog.push({ id: m.id, at: m.created_at, tool: "delete_file", path: p });
      }
    } else if (b.type === "tool_result") {
      const txt =
        typeof b.content === "string"
          ? b.content
          : Array.isArray(b.content)
            ? b.content.map((x) => (x.type === "text" ? x.text : `[${x.type}]`)).join("\n")
            : "";
      parts.push(`[tool_result${b.is_error ? " ERROR" : ""}] ${(txt || "").slice(0, 2000)}`);
    } else if (b.type === "image") {
      parts.push("[image]");
    }
  }
  transcript.push(`\n### #${m.id} · ${m.role} · ${m.created_at}\n\n${parts.join("\n\n")}`);
}

// Write the reconstructed final code tree (best-effort; the authoritative copy
// is the repo / Storage / live deploy — edits whose old_string diverged are
// flagged in write_log.json).
for (const [p, content] of vfs) {
  const safe = p
    .replace(/^[/\\]+/, "")
    .split(/[\\/]+/)
    .filter((s) => s && s !== "..")
    .join(path.sep);
  if (!safe) continue;
  const dest = path.join(outDir, "reconstructed", safe);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}
await save("write_log.json", writeLog);
await fs.writeFile(
  path.join(outDir, "transcript.md"),
  `# ${proj.name} — transcript (${msgs.length} messages)\n${transcript.join("\n")}\n`,
);

const summary = {
  project: proj.name,
  id: projectId,
  owner: owner?.email,
  created_at: proj.created_at,
  counts: Object.fromEntries(Object.entries(data).map(([t, r]) => [t, r.length])),
  models_from_usage: [...new Set((data.usage_events || []).map((u) => `${u.provider}/${u.model}`))],
  reconstructed_files: vfs.size,
  edits_not_applied: writeLog.filter((w) => w.warn).length,
  deploy_targets: {
    vercel: proj.vercel_project_name,
    github: proj.github_repo_full_name,
    supabase: proj.supabase_project_ref,
  },
};
await save("SUMMARY.json", summary);
console.log(JSON.stringify(summary, null, 2));
console.log(`\nForensic dump written → ${path.resolve(outDir)}`);
console.log(
  "  reconstructed/  = final code tree (replayed)\n  transcript.md   = full conversation\n  *.json          = every table, raw",
);
