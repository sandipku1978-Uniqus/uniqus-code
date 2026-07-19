# Gate 15 comprehensive bug audit

**Audit date:** 2026-07-14  
**Audited revision:** `bd5fd40aa64ab3927568688a0baca7e935f3f01c` on `main`  
**Production comparison:** `/opt/uniqus-code` on Hetzner was on the same revision during a read-only check.  
**Scope:** complete tracked application code under `apps/`, `services/`, `packages/`, and `infra/`, plus root build configuration, schema, tests, runtime wiring, and dependency state.  
**Change policy:** audit/report only. No product source, database, deployment, or runtime state was changed.

## 1. Repository structure and architecture

### 1.1 Top-level systems

| Area | Technology and role | Size observed | Test posture |
|---|---|---:|---|
| `apps/web` | Next.js 15, React 19, Zustand, Monaco, WorkOS AuthKit; marketing, authenticated workspace, settings, Vercel-facing route handlers | 124 source files, about 38.2k LOC | 2 standalone Vitest files / 4 tests; no package `test` script |
| `services/orchestrator` | Node/TypeScript raw HTTP + WebSocket service; auth, projects, collaboration, agent loop, provider adapters, Supabase, Vercel, Firecracker fleet, storage sync | 164 source files, about 47.0k LOC | 56 Vitest files; 469 passed, 1 skipped |
| `services/sandbox-agent` | Production Rust in-VM RPC agent plus a wire-compatible Node fallback | 2 implementation files, about 3.1k LOC | exercised indirectly from orchestrator tests; no direct Rust test suite |
| `packages/api-types` | Shared protocol types, model catalog, thinking-effort and permission enums | 1 large TypeScript file, about 1.8k LOC | no dedicated package tests |
| `infra/firecracker` | Host setup, networking, rootfs build, runtime provisioning | 4 shell scripts, about 0.5k LOC | host integration is manual |

There were 317 tracked files under the application/service/package/infra roots and roughly 338 non-ignored files repository-wide at audit time.

### 1.2 Commands and build surfaces

Root scripts:

- `npm run dev` -> `turbo run dev --parallel`
- `npm run agent` -> orchestrator CLI
- `npm run typecheck` -> Turbo typechecks

Web scripts are `dev`, `build`, `start`, and `typecheck`. The web package has no `test` script even though two test files exist. Orchestrator scripts are `start`, `dev`, `cli`, `build`, `typecheck`, and `test`. The Rust sandbox agent is built with Cargo and production targets Linux.

### 1.3 Routes and user-facing surfaces

The web application includes public marketing/docs pages (`/`, `/about`, `/blog/[slug]`, `/careers`, `/changelog`, `/community`, `/contact`, `/docs`, `/enterprise`, `/models`, `/pricing`, `/security`, `/status`, `/support`, `/templates`, `/workspaces`), authentication callbacks/login, `/projects`, `/projects/[id]`, and `/settings`. Next route handlers relay guest create/restore/convert/signout and regular signout operations.

The orchestrator exposes authenticated HTTP and WebSocket workflows for:

- project create/import/export/update/delete and organization placement;
- chat sessions, history, compaction, checkpoints, todos, comments, flows, and durable tasks;
- files, multipart uploads, knowledge, skills, design systems, assets, and secrets;
- preview servers, sharing, screenshots/interactions, deployment, GitHub, Vercel, Supabase, Figma, and general connectors;
- guest creation, restoration, conversion, inactivity cleanup, and abuse controls;
- agent execution across Anthropic, Google, OpenAI, and Z.ai;
- Firecracker boot/restore/pause/reclaim, host/guest synchronization, and Storage durability.

### 1.4 Data and authority model

Supabase Postgres stores users, organizations/members, projects/members, chat sessions/messages, deployments, tasks/comments/flows, design systems/skills, secrets metadata, connector state, usage, audit data, and checkpoint artifacts. The schema is maintained in `services/orchestrator/src/db/schema.sql` and is operator-applied rather than automatically migrated during deployment. Supabase Storage bucket `project_files` is the durable file store.

Project source can exist in three places at once:

1. the orchestrator host mirror;
2. the per-project Firecracker `/sandbox`, which is authoritative while the VM is live;
3. Supabase Storage, which is authoritative for rehydration after host loss.

Most of the highest-risk defects are broken transitions among these three replicas rather than isolated syntax errors.

### 1.5 Critical workflows mapped

- **Authenticated run:** WorkOS/guest cookie -> project/session authorization -> WebSocket -> task-aware model routing -> provider adapter -> tools -> VM/host changes -> strict VM pull -> Storage sync -> message/usage persistence.
- **Manual file edit:** explorer/editor state -> WebSocket or REST mutation -> VM/host mirror -> change broadcast -> Storage sync.
- **New/reopened project:** Storage hydrate -> dependency detection/install -> cold/golden/snapshot Firecracker path -> preview proxy.
- **Deploy:** strict VM pull -> local packaging -> Vercel create -> local deployment row -> detached status polling.
- **Guest lifecycle:** Turnstile + rate limit -> guest row/cookie -> activity touch -> optional conversion -> inactivity sweeper.
- **Collaboration:** project/org RBAC -> shared project resources -> independent chat sessions sharing one filesystem/VM.
- **External integration:** stored user/project credentials -> SSRF/permission gate -> provider API -> durable link/state update.

## 2. Validation performed

| Check | Result |
|---|---|
| `npx turbo run typecheck --force` | Passed, 2 tasks, 0 cached |
| Orchestrator full Vitest suite | Passed: 56 files, 469 tests; 1 skipped |
| Targeted `storage/sync.test.ts` + `firecracker/pull.test.ts` | Passed: 10/10 |
| Web standalone tests | Passed: 2 files, 4/4 tests |
| Orchestrator TypeScript build | Passed |
| Web production build | Passed from a clean isolated copy: compile and 33/33 static pages |
| Rust `cargo check --target x86_64-unknown-linux-gnu` | Passed; one unused-field warning |
| Native Windows Rust check | Inapplicable failure from Unix-only APIs; not a product defect |
| `npm audit --omit=dev` | 0 critical, 0 high, 3 moderate, 1 low |
| Local HTTP smoke | `/`, `/about`, `/login` returned 200; `/projects`, `/settings`, unauthenticated `/api/signout` produced expected auth redirects |
| In-app browser/visual smoke | Blocked: browser runtime initialization failed with `Cannot redefine property: process`; no visual certainty is claimed |
| Read-only production check | Service active; Firecracker v1.12.1; bridge sysctl `1`; `fcbr0 -> fcbr0 DROP` rule present; production and local Git SHAs matched |

Safe targeted reproductions also established:

- a non-UTF-8 buffer changes byte length and SHA after `Buffer -> utf8 string -> Buffer`, exactly matching the upload path in B02;
- a fake Storage service exposing 1,001 objects returned only 1,000 and received one `offset: 0` request, matching B10;
- valid UUIDs `554be509-fad7-428b-8976-0c20de0bcf09` and `e7ec957e-6ecf-4f2c-a774-0af77f52c89d` both map to `172.16.0.147`, matching B14;
- source-invariant checks confirmed no cancellation-to-controller path, no running-task lease recovery, teardown before the guest sweeper's final check, and external Supabase creation before durable intent/link writes.

The first in-place web build attempt failed with missing `/_document`/`/about` pages while an existing `next dev` process shared `.next`. A clean isolated build passed, so that result is recorded as test interference, not a product bug. WorkOS edge-runtime bundler warnings were also exercised through local auth redirects and are not classified as failures here.

## 3. Classification key

- **Confirmed / reproduced:** deterministic safe reproduction or test output demonstrated the failure.
- **Confirmed / traced:** every relevant branch and neutralizer was traced; trigger timing or external infrastructure was not exercised.
- **Highly likely / runtime validation:** defective code path is present, but provider, Linux, browser, or concurrent production behavior still needs a controlled live test.
- **Conditional:** only applies when the named feature/configuration is enabled.
- **Performance / maintainability:** real risk but not counted as a functional bug without a correctness trigger.

No Critical issue was proven active on the current production host. B15 would have Critical cross-tenant impact if its fail-open condition occurred, but the expected controls were present during the audit; effective peer isolation was not live-tested. It is ranked High and must be made fail-closed.

## 4. Prioritized bug table

| ID | Severity | Status | Title | Primary impact |
|---|---|---|---|---|
| B01 | High | Confirmed/traced | File operations split VM, host, Storage, and editor state | resurrection, stale preview, durable loss |
| B02 | High | Confirmed/reproduced | Binary uploads are UTF-8-corrupted in the live VM | corrupt media/assets, later host overwrite |
| B03 | High | Confirmed/traced | Async file switching edits the previously loaded file under the new tab | wrong-file overwrite |
| B04 | High | Confirmed/traced | Chat-session switch clears unsaved file buffers | user edit loss |
| B05 | High | Confirmed/traced | Rewind races active runs and dirty editor buffers | mixed or immediately undone restore |
| B06 | High | Confirmed/traced | Different chat sessions run concurrently on one VM | conflicting edits and history/filesystem mismatch |
| B07 | High | Confirmed/traced | Deleting an active chat leaves its run and sockets alive | cascaded history loss, failed persistence, spend |
| B08 | High | Confirmed/traced, conditional | Durable task cancel/restart/edit-lane lifecycle is broken | continued spend, stuck work, conflicting edits |
| B09 | High | Confirmed/traced | Guest sweeper destroys files before winning deletion race | converted/returning guest data loss |
| B10 | High | Confirmed/reproduced | Storage recursion truncates at 1,000 siblings | incomplete hydrate/delete/rename |
| B11 | High | Confirmed/traced | Supabase provisioning is non-idempotent | duplicate paid infrastructure/orphans |
| B12 | High | Confirmed/traced | Invalid CAPTCHA traffic consumes shared Vercel egress bucket | shared-bucket signup denial; blast radius topology-dependent |
| B13 | High | Confirmed/traced | Postgres and Git SSRF checks are DNS-rebindable | internal network connection oracle |
| B14 | High | Confirmed/reproduced | 16-bit deterministic VM IP allocation collides | ARP/proxy misrouting, possible cross-project routing |
| B15 | High | Confirmed latent; expected host controls present | Firecracker peer isolation setup fails open and never retries | conditional cross-tenant network exposure |
| B16 | High | Confirmed/traced | Stop/kill aborts host RPC but not guest command | mutations after reported cancellation |
| B17 | High | Confirmed/traced | Idle sweeper can pause an active long RPC | frozen builds, late continuation |
| B18 | High | Confirmed contract mismatch | Gemini replay mismatches function-call IDs | 400s or poisoned tool association |
| B19 | High | Confirmed/traced | `interact_preview` mutations are classified read-only | approval bypass / external side effects |
| B20 | High | Highly likely, conditional | VM mount/hydration failures return a healthy partial VM | missing/ghost files, false health |
| B21 | High | Confirmed/traced | Rapid org/workspace loads can display A and mutate B | wrong-scope administration |
| B22 | Medium-High | Confirmed/traced | Shared design systems/skills disappear for collaborators | inconsistent agent behavior by actor |
| B23 | Medium-High | Confirmed/traced | Deployment creation/status tracking is non-durable | duplicate deploys and stale status |
| B24 | Medium-High | Confirmed/traced | Destructive SQL confirmation is client-side/incomplete | destructive DDL without promised confirmation |
| B25-B44 | Medium/Low | Confirmed or noted below | Session, upload, persistence, preview, config, and memory defects | localized reliability/data-loss risks |

## 5. Confirmed and highly likely bugs

### B01 — File operations split VM, host, Storage, and editor state

- **Severity / confidence / status:** High; very high confidence; confirmed by complete code trace.
- **Affected code:** `apps/web/components/FileExplorer.tsx:169-177,182-237`; `apps/web/lib/store.ts:1488-1505,1721-1755`; `apps/web/components/CodeEditor.tsx:205-218,248-256`; `apps/web/lib/ws-client.ts:481-494`; `services/orchestrator/src/server.ts:3667-3783,4696-4715`; `services/orchestrator/src/firecracker/agentRpc.ts:132-167`; `services/orchestrator/src/firecracker/pull.ts:227-418`; `services/orchestrator/src/firecracker/fleet.ts:180-205,876-925,1295-1303`.
- **Trigger and reproduction:** boot a project VM; open `a.ts`; rename it to `b.ts` or delete it from Files; inspect preview/agent reads, type in the still-open tab, then run a turn/deploy/strict pull. The REST route changes the host and attempts Storage work but has no VM mkdir/rename/delete RPC. Tabs, selected path, debounce, pending buffer, and descendant paths are not migrated or pruned.
- **Expected:** one atomic namespace operation, immediately consistent in the running VM, host mirror, durable Storage, preview, and open editor state.
- **Actual:** the VM and preview retain `a.ts`; a pending save can recreate it. With a fresh pull baseline, VM `a.ts` is fetched while host-only `b.ts` is treated as deleted. Rename also swallows new-key upload failures and can delete the only durable old key before the new key exists.
- **Root cause / evidence:** separate uncoordinated mutation paths and no operation journal. `file_changed` refreshes only the tree; null file responses are ignored. Running/paused VMs are reused without host reconciliation, and push-only hydration does not remove guest extras.
- **Impact:** user-visible resurrection/deletion, stale builds, silent durable loss after host recycle, and agent edits against paths the user believes were moved.
- **Recommended patch:** add binary-safe `/fs/mkdir`, `/fs/rename`, and `/fs/remove` RPCs to both sandbox agents. Serialize per-project file mutations; commit VM first when live, mirror host, upload-and-verify new Storage keys, then delete old keys. Return a path mapping and atomically migrate/close `openFiles`, `editorTab`, `selectedFile`, `saveStatus`, `pendingEdits`, and debounce ownership. Update the pull baseline only after success; retain a retryable journal on partial failure.
- **Regression tests:** active-VM create-dir/rename/delete for open clean and dirty files and folder descendants; compare VM/host/Storage manifests immediately, after strict pull, after pause/resume, after orchestrator restart, and before deploy. Inject failure on the Nth Storage upload and prove old keys remain.

### B02 — Binary uploads are UTF-8-corrupted in the live VM

- **Severity / confidence / status:** High; very high confidence; confirmed with a byte-level reproduction.
- **Affected code:** `apps/web/components/ChatPanel.tsx:667-750,806-822,1320-1326`; `apps/web/lib/api.ts:999-1015`; `services/orchestrator/src/server.ts:3260-3328`; `services/orchestrator/src/firecracker/agentRpc.ts:140-146,340-352`; `services/orchestrator/src/firecracker/pull.ts:295-386`.
- **Trigger and reproduction:** attach a PNG, JPEG, PDF, font, audio file, ZIP, or any payload containing invalid UTF-8. The host receives the exact `Buffer`; VM mirroring calls `item.content.toString("utf-8")` and the text RPC. A sample 9-byte buffer became 15 bytes after the same round trip.
- **Expected:** byte-identical host, VM, and Storage content.
- **Actual:** invalid bytes become UTF-8 replacement characters without throwing. The catch cannot detect corruption. The guest can later be pulled over the pristine host copy and persisted.
- **Root cause / evidence:** arbitrary MIME types are accepted but the generic text writer is used even though `fcAgent.pushFile` already implements binary-safe transfer.
- **Impact:** immediate broken previews and generated apps, misleading host-side asset reads, and eventual durable corruption.
- **Recommended patch:** replace the VM mirror call with `await fcAgent.pushFile(vm, path, item.content)` (or the shared `writeFileBinary` abstraction), with no MIME heuristic.
- **Regression tests:** upload non-UTF-8 fixtures for common media types; compare SHA-256 on host and guest, decode the guest image/PDF, strict-pull, recycle the VM, and compare again.

### B03 — Async file switching edits the previously loaded file under the new tab

- **Severity / confidence / status:** High; high confidence; confirmed by deterministic client-state trace.
- **Affected code:** `apps/web/components/FileExplorer.tsx:126-130`; `apps/web/components/EditorPreviewArea.tsx:260-279`; `apps/web/components/CodeEditor.tsx:193-200,248-273`; `apps/web/lib/ws-client.ts:464-479`; `apps/web/lib/store.ts:1454-1456,1488-1492`.
- **Trigger and reproduction:** load A, click B while delaying or dropping B's `file_content`, and type while the B tab is visibly active. `openFile(B)` changes only `editorTab`; `selectedFile` and global `fileContent` remain A until a response arrives. An out-of-order response can similarly restore a stale path.
- **Expected:** B displays a loading/read-only state until content specifically correlated to B arrives; typing can never target another path.
- **Actual:** the active tab says B while Monaco still renders and saves A. This is wrong-file corruption (the user intends B but overwrites A); a missing response leaves the mismatch indefinitely.
- **Root cause / evidence:** a single global `{selectedFile,fileContent}` is not keyed by tab/path, request responses have no generation/current-tab guard, and the dirty guard only protects the response's own path.
- **Impact:** silent overwrite of a valid file during ordinary rapid navigation or slow/offline VM reads.
- **Recommended patch:** store content/loading/error and dirty buffer per path. Set the requested path synchronously but render Monaco only once that path's response generation matches; otherwise show loading. Ignore stale responses and bind saves to the Monaco model's immutable path.
- **Regression tests:** controlled B/C response reordering, missing response, slow response plus typing, and dirty A -> B switching; assert no bytes are sent for a path whose matching model was not loaded.

### B04 — Switching chat sessions clears unsaved project-file edits

- **Severity / confidence / status:** High; high confidence; confirmed by lifecycle trace.
- **Affected code:** `apps/web/components/ChatSessionDropdown.tsx:59-66,197-250`; `apps/web/components/Workspace.tsx:206-215`; `apps/web/lib/store.ts:1657-1708`; `apps/web/components/CodeEditor.tsx:205-218`; `apps/web/lib/store.ts:1721-1767`.
- **Trigger and reproduction:** leave an edit dirty while disconnected or while the agent is busy, then switch `?session=`. Workspace resets the store and clears `pendingEdits`/`saveStatus`. CodeEditor cleanup calls `flushSave` fire-and-forget, but `flushSave` intentionally defers while busy and becomes a no-op after the buffer is cleared.
- **Expected:** project files survive a chat-only context switch; navigation is blocked until save ACK, or the dirty buffer moves intact to the new socket.
- **Actual:** unsaved bytes disappear from memory without a durable write.
- **Root cause / evidence:** project-scoped editor state is reset as if it were session-scoped and navigation has no save barrier. `reset()` clears `pendingEdits`; the editor cleanup's competing or subsequent `flushSave(path)` then has no buffer to persist. Correctness does not depend on assuming a fixed React cleanup order.
- **Impact:** direct user work loss.
- **Recommended patch:** separate project editor state from chat state. Before reconnect, flush and await ACKs, retain offline buffers, or show an explicit discard prompt. Do not clear buffers in session-only reset.
- **Regression tests:** dirty, saving, disconnected, and busy edits across A -> B -> A session transitions and browser reconnect.

### B05 — Rewind races active runs and dirty editor buffers

- **Severity / confidence / status:** High; high confidence; confirmed by concurrent-path trace.
- **Affected code:** `apps/web/components/Workspace.tsx:330-376`; `apps/web/components/CheckpointsModal.tsx:73-89,114,200-258`; `services/orchestrator/src/server.ts:1952-1992`; `apps/web/lib/ws-client.ts:592-599`; `apps/web/lib/store.ts:1638-1655,1721-1767`; `services/orchestrator/src/agent/checkpoints.ts:256-296`.
- **Trigger and reproduction:** type an unsaved change to an existing tracked file and immediately Rewind, or invoke Rewind during an agent command/edit. The REST restore has no project run lock and does not coordinate browser save ACKs. The surviving debounce or active tool can write after checkout.
- **Expected:** the advertised pre-restore checkpoint includes the user's current state, and a successful rewind establishes one authoritative state before work resumes.
- **Actual:** client-only bytes are absent from the pre-restore checkpoint, then can overwrite the restored file after the 200; a live run can concurrently create a mixed tree.
- **Root cause / evidence:** checkpoint Git serialization covers only checkpoint commits/checkouts, not agent tools, editor buffers, VM pulls, or Storage sync. `session_reset` leaves pending edits intact.
- **Impact:** a restore that appears successful is immediately or partially undone and may not be reversible as advertised.
- **Recommended patch:** acquire a project-wide mutation lock; reject/stop active runs; force clients to ACK-save or explicitly discard dirty buffers; perform host/VM reconciliation and awaited Storage convergence; then broadcast an authoritative file-state epoch that invalidates stale debounces.
- **Regression tests:** dirty tracked-file rewind, disconnected buffer rewind, active `edit_file`/command rewind, and two-client rewind. Verify the chosen state for checkpoint-managed/tracked paths on host/VM/Storage after strict pull and reconnect. Note: untracked post-checkpoint retention is intentionally documented in `checkpoints.ts:20-23` and is not the sole basis of this finding.

### B06 — Different chat sessions can run concurrently against one project VM

- **Severity / confidence / status:** High; high confidence; confirmed architecture defect with timing-dependent outcome.
- **Affected code:** `apps/web/components/ChatSessionDropdown.tsx:59-84,197-250`; `services/orchestrator/src/server.ts:433-502,4854-4897`; shared VM/file paths throughout `handleConnection` and `runSession`.
- **Trigger and reproduction:** start a turn in session A, switch/open session B, and start another turn. The registry key is `${projectId}:${sessionId}`, so same-session duplication is blocked but project-wide mutation is not.
- **Expected:** one mutation lane per shared project filesystem, or isolated worktrees/VMs with an explicit merge model.
- **Actual:** provider loops and tool calls can concurrently edit/run/pull the same VM while persisting independent histories that each assume a coherent sequence.
- **Root cause / evidence:** session isolation was implemented for conversation state but incorrectly reused as execution isolation despite shared project state.
- **Impact:** lost updates, interleaved commands, interleaved or misattributed checkpoint history, and histories that claim mutually inconsistent results. The per-project Git commit queue serializes commits themselves but does not serialize the two runs or their VM mutations.
- **Recommended patch:** add a project-wide run queue/lease for mutating turns; optionally allow read-only concurrency. Durable tasks must use the same lane. Surface queued status per session.
- **Regression tests:** two sockets/two sessions issuing conflicting edits and commands; prove serialization, deterministic history, and final manifest.

### B07 — Deleting an active chat leaves its run and sockets alive

- **Severity / confidence / status:** High; high confidence; confirmed by DB/run-registry trace.
- **Affected code:** `apps/web/components/ChatSessionDropdown.tsx:108-133,243-250`; `services/orchestrator/src/server.ts:2035-2062,433-502,6644-6658`; `services/orchestrator/src/db/chatSessions.ts:180-189`; `services/orchestrator/src/db/schema.sql:251-253,1111-1115`.
- **Trigger and reproduction:** delete a session during a model/tool run, especially from another collaborator tab. DELETE removes only the DB row. Messages and checkpoint artifacts cascade. The in-memory run, old socket, and other clients are not rejected/aborted/notified.
- **Expected:** 409 while active, or coordinated abort/wait, socket revocation, and transactional delete.
- **Actual:** history disappears while spend/file edits continue; final `appendMessages` can fail against the deleted session FK. `touchSession` merely updates zero rows. The append catch path logs after the run already continued and provides no reliable client notification.
- **Root cause / evidence:** the HTTP lifecycle endpoint never consults `runs`, `sessions`, or session-scoped broadcasters.
- **Impact:** lost durable conversation/proof artifacts, continued cost, and confusing zombie UI.
- **Recommended patch:** centralize `deleteChatSession`: lock session, reject or abort and await the run, wake interactive waits, close/broadcast all matching sockets, delete transactionally, and create/select a fallback only afterward.
- **Regression tests:** active/idle deletion with two users and two sockets; assert no post-delete provider/tool work, no FK failure, and all clients move to a valid session.

### B08 — Durable task cancel/restart/edit-lane lifecycle is broken

- **Severity / confidence / status:** High; very high confidence; confirmed when `UNIQUS_TASK_WORKER=1`.
- **Affected code:** `services/orchestrator/src/collabRoutes.ts:26-30,195-207`; `services/orchestrator/src/db/agentTasks.ts:87-106`; `services/orchestrator/src/db/schema.sql:1153-1176`; `services/orchestrator/src/server.ts:801-819,6848-7252`, especially `7180-7184,7191-7228`.
- **Trigger and reproduction:** cancel a long task, restart after claim, or run a background task while an interactive turn edits the same project.
- **Expected:** cancellation aborts execution; a crash leaves a reclaimable lease; exactly one worker owns a task; all project mutations share one lane.
- **Actual:** cancel updates status only while its controller keeps running. A claimed row has no owner/lease/heartbeat and stays `running` forever after process death. Interactive and task agents can edit concurrently.
- **Root cause / evidence:** controller registry is not exposed to the route; claim state is a terminal-looking status rather than a renewable lease; worker and interactive execution are separate twins.
- **Impact:** continued provider spend and file mutations after “Canceled,” stuck tasks, and conflicting edits.
- **Recommended patch:** DB transaction/RPC using `FOR UPDATE SKIP LOCKED` with `worker_id`, `lease_expires_at`, `heartbeat_at`, and `attempt`; cancellation CASes queued/running -> canceled and aborts the matching controller; shutdown requeues or expires leases; use B06's project mutation lane.
- **Regression tests:** long mocked tool canceled mid-call; forced process death/restart; two workers racing; interactive + task conflict; assert bounded usage and no post-cancel writes.

### B09 — Guest sweeper destroys files before winning the deletion race

- **Severity / confidence / status:** High; very high confidence; confirmed by ordered source invariant.
- **Affected code:** `services/orchestrator/src/guest/sweeper.ts:84-124`; `services/orchestrator/src/server.ts:1045-1049`; `services/orchestrator/src/auth/guest.ts:234-246`; `services/orchestrator/src/db/projects.ts:460-471`; `services/orchestrator/src/db/users.ts:563-573`.
- **Trigger and reproduction:** pause the sweeper after eligibility/project snapshot; return as the guest or convert/merge the account; resume teardown. Storage/VM/local files are removed before the final eligibility recheck.
- **Expected:** activity or conversion wins atomically, or cleanup owns an exclusive deletion claim before any irreversible action.
- **Actual:** the final check preserves the now-active/converted DB row after its project data has already been destroyed. Activity touch is fire-and-forget, increasing the window.
- **Root cause / evidence:** check -> destructive side effects -> recheck is not a lock. Conversion also reassigns projects and marks the user in separate operations.
- **Impact:** catastrophic data loss for a legitimate returning or newly registered user.
- **Recommended patch:** transactionally claim `deleting` with a version; make touch/convert atomically cancel or wait on that claim; write an idempotent cleanup outbox; only finalize rows after cleanup. Never destroy a project whose ownership/version changed since the claim.
- **Regression tests:** barrier-controlled touch and merge races at every teardown boundary; verify project bytes, VM, ownership, and row state.

### B10 — Storage recursion truncates at 1,000 siblings

- **Severity / confidence / status:** High; very high confidence; directly reproduced with a fake Supabase Storage endpoint.
- **Affected code:** `services/orchestrator/src/storage/client.ts:120-142`; consumers in `services/orchestrator/src/storage/sync.ts:87-119`, `services/orchestrator/src/server.ts:3628-3629,3743-3753,3769-3780`, and `services/orchestrator/src/guest/sweeper.ts:45-46`.
- **Trigger and reproduction:** create 1,001 objects at one prefix. `storageListAll` calls `list({limit:1000,offset:0})` once and recurses only through returned directories. The safe mock returned exactly 1,000 of 1,001 with one request.
- **Expected:** exhaustive stable pagination at every prefix.
- **Actual:** omitted objects do not hydrate, rename, or delete. A fresh empty host makes them appear lost; cleanup leaks them.
- **Root cause / evidence:** recursion was implemented without pagination. Supabase documents `offset` pagination in its [Storage list API](https://supabase.com/docs/reference/javascript/storage-from-list).
- **Impact:** silent data omission and privacy-retention leaks in large directories.
- **Recommended patch:** page with stable sort and increasing offset until a short page; deduplicate path entries and batch removals. Prefer a testable iterator.
- **Regression tests:** 1,001 and 2,001 siblings, nested prefixes where each level crosses a page, hydrate/delete/rename/guest cleanup, and duplicate/empty-page defense.

### B11 — Supabase provisioning is non-idempotent

- **Severity / confidence / status:** High; very high confidence; confirmed by ordering/concurrency trace.
- **Affected code:** `services/orchestrator/src/connectors/supabase.ts:256-315`; `services/orchestrator/src/db/projects.ts:437-451`; `services/orchestrator/src/connectors/index.ts:104-170`.
- **Trigger and reproduction:** issue two concurrent provision calls after both read `linkedRef = null`, or fail the DB write/network after external 201 but before password/link persistence.
- **Expected:** one durable provisioning operation that callers join/resume; ambiguous external success is reconciled without another create.
- **Actual:** two real projects can be created. A partial failure can orphan the first and lose its generated password; retry creates another.
- **Root cause / evidence:** external creation precedes durable intent and the link update is neither locked nor CAS-protected.
- **Impact:** duplicate paid resources, unusable databases, operational cleanup, and confusing project linkage.
- **Recommended patch:** transactionally insert a per-project provisioning intent before the API call; serialize/join attempts; persist the generated secret material encrypted before create; use provider idempotency if the current API supports it; reconcile ambiguous outcomes before retry. Do not rely on an in-memory lock.
- **Regression tests:** barrier at the null-link read, failure after mocked 201, process restart between 201 and link write, and concurrent instances; assert exactly one remote create/ref.

### B12 — Invalid CAPTCHA traffic consumes a shared Vercel egress bucket

- **Severity / confidence / status:** High; high confidence; confirmed route topology and ordering.
- **Affected code:** `services/orchestrator/src/server.ts:958-968,1198-1241`; `apps/web/lib/orchestrator-server.ts:9-21`; `apps/web/app/api/guest/route.ts:19-23`; `apps/web/app/api/guest/restore/route.ts:21-25`.
- **Trigger and reproduction:** send 30 invalid Turnstile requests through the public web route to fill the bucket; the 31st request from the same observed TCP peer is blocked before verification. How many legitimate clients share that peer depends on Vercel's production egress topology.
- **Expected:** invalid CAPTCHA traffic cannot consume a global legitimate-user quota; direct endpoint abuse remains cheaply bounded.
- **Actual:** anonymous invalid tokens poison a shared TCP-peer bucket before CAPTCHA validation and can deny signup/restore to unrelated users that Vercel routes through the same observed peer.
- **Root cause / evidence:** the route acknowledges one shared egress address but still keys the pre-CAPTCHA limit solely to it; relay carries no authenticated client identity.
- **Impact:** low-cost guest acquisition outage for the affected shared egress bucket; a globally shared blast radius was not proven.
- **Recommended patch:** use two layers: a generous direct-peer circuit breaker before verification, then consume the real signup quota only after valid CAPTCHA. Rate-limit at Vercel edge by actual client, and cryptographically authenticate any client-identity hint sent to the orchestrator; never trust arbitrary X-Forwarded-For on the direct endpoint.
- **Regression tests:** 30 invalid relay tokens followed by a valid different client; signed-identity tampering; direct endpoint flood; Turnstile outage/fail-closed behavior.

### B13 — Postgres and Git SSRF checks are DNS-rebindable

- **Severity / confidence / status:** High; high confidence; confirmed TOCTOU code path, network exploit not executed.
- **Affected code:** `services/orchestrator/src/connectors/ssrfGuard.ts:124-149,185-264`; `services/orchestrator/src/connectors/postgres.ts:31-70`; `services/orchestrator/src/server.ts:1601-1640,2741-2768,3826-3851,8439-8460`; `services/orchestrator/src/import.ts:184-205`.
- **Trigger and reproduction:** use an attacker-controlled hostname that resolves publicly during `assertPublicHost` and to loopback/private/metadata/fleet IP during `pg` or `git clone` resolution. Git may also follow a redirect outside the application's per-hop `safeFetch` guard.
- **Expected:** the exact vetted address is the only address dialed, while TLS still validates the original hostname; every redirect is revalidated.
- **Actual:** vetted IPs are discarded and non-HTTP clients independently resolve the hostname later. The HTTP connector already has connect-time pinning, proving the intended neutralizer exists only there.
- **Root cause / evidence:** DNS validation and socket connection are separated without binding the result to the dial.
- **Impact:** authenticated blind internal port/service oracle and possible access to reachable internal services. Credentialed GitHub paths are more restricted, but anonymous arbitrary HTTPS clone remains affected.
- **Recommended patch:** return a vetted resolution object from the guard and configure the client/socket to connect to that IP while preserving original SNI/Host and certificate validation. For Git, either allowlist supported hosts and fetch pinned archives or use a hardened proxy with per-hop validation. Reject if any re-resolution changes to a blocked address.
- **Regression tests:** alternating DNS, multi-address answer with one private IP, public redirect to private, IPv4-mapped IPv6, original-host certificate validation, and successful public Postgres/Git controls.

### B14 — Deterministic 16-bit VM IP allocation collides without detection

- **Severity / confidence / status:** High; very high confidence; allocator collision reproduced, live ARP behavior still needs a disposable host test.
- **Affected code:** `services/orchestrator/src/firecracker/fleet.ts:1571-1604`; preview/RPC routing by `VmHandle.ip`.
- **Trigger and reproduction:** two simultaneous projects whose first two SHA-256 bytes normalize to the same host address. Valid UUIDs `554be509-fad7-428b-8976-0c20de0bcf09` and `e7ec957e-6ecf-4f2c-a774-0af77f52c89d` both map to `172.16.0.147`. They receive different MACs/TAPs, and there is no active-IP registry/probe.
- **Expected:** unique host address per concurrently active VM, with collision detection before boot.
- **Actual:** colliding VMs are configured with one IP. The code comment itself places the birthday region near 256 projects and defers collision handling.
- **Root cause / evidence:** only 16 hash bits are used as allocation state; determinism was substituted for IPAM.
- **Impact:** ARP flapping, RPC/preview failures, and potentially one project's same-port preview traffic reaching another VM. Project-specific bearer tokens generally turn misrouted agent RPC into authentication failure rather than cross-project RPC access; preview traffic lacks that neutralizer.
- **Recommended patch:** persisted per-host IPAM with a unique constraint/lock and deterministic first candidate plus probing. Reserve gateway/bootstrap/broadcast addresses and fail boot if address ownership cannot be proven.
- **Regression tests:** concurrent boot of a deterministic UUID collision pair, restart persistence, stale lease reclamation, and same-port proxy routing to the correct tenant.

### B15 — Firecracker peer-isolation setup fails open and never retries

- **Severity / confidence / status:** High; very high confidence in latent defect. **Current production had the expected controls present, but effective peer isolation was not live-tested:** sysctl was `1`, the `fcbr0 -> fcbr0 DROP` rule was first in FORWARD, Firecracker was v1.12.1, and service was active.
- **Affected code:** `services/orchestrator/src/firecracker/fleet.ts:1607-1661`; `infra/firecracker/host-net.sh:50-54`.
- **Trigger and reproduction:** missing `br_netfilter`, rejected sysctl, insufficient capability, flushed/reordered iptables rules, or transient setup failure before the first VM boot.
- **Expected:** no tenant VM boots until effective peer isolation is verified; drift is detected and reasserted.
- **Actual:** `isolationChecked = true` is set before setup. `modprobe`/`sysctl` exit codes are ignored, iptables failure only warns, boot continues, and the process never retries. Host setup also suppresses bridge-netfilter failure.
- **Root cause / evidence:** security control is modeled as best-effort initialization, not a required invariant.
- **Impact:** if the host control drifts/fails, VMs can reach arbitrary peer preview/dev ports. Agent bearer auth limits RPC takeover but not tenant app traffic.
- **Recommended patch:** make setup fail closed; verify the effective sysctl and exact rule/order after installation; check before every first/periodic boot; expose a health metric and page on drift. Host setup must abort on failure.
- **Regression tests:** mock each command failure and require `ensureVm` rejection; Linux namespace test proving VM A cannot reach VM B's app port; rule-flush test proving automatic reassertion before another boot.

### B16 — Stop/kill aborts the host RPC but not the guest command

- **Severity / confidence / status:** High; high confidence; confirmed in both sandbox agents, actual rootfs process test pending.
- **Affected code:** `services/orchestrator/src/firecracker/agentRpc.ts:203-232,529-572`; `services/sandbox-agent/src/main.rs:555-620,1613-1624`; `services/sandbox-agent/src/agent.mjs:355-389,909-955`; `services/orchestrator/src/agent/background.ts:182-191`.
- **Trigger and reproduction:** run `sleep 5; touch late`, press Stop or call `kill_background` before completion.
- **Expected:** cancellation terminates the entire guest process group and acknowledges only after it is gone.
- **Actual:** host abort destroys its HTTP socket. The synchronous guest handler has no disconnect-to-kill signal and continues until normal completion or its own timeout. `kill_background` explicitly stops tracking VM work and reports it exited without killing it.
- **Root cause / evidence:** guest execution has no durable job ID or kill endpoint; transport cancellation is mistaken for process cancellation.
- **Impact:** files, network calls, installs, and server state can change after the UI says stopped/killed; later work races the survivor.
- **Recommended patch:** implement asynchronous guest jobs with IDs, status, logs, and process-group kill; on abort issue kill and await acknowledgement. Keep a recoverable registry until confirmed dead.
- **Regression tests:** delayed mutation, child/grandchild process, host disconnect, timeout, repeated kill, and both Rust/Node agents; assert no late file or process.

### B17 — Idle sweeper can pause an active long RPC

- **Severity / confidence / status:** High; high confidence; confirmed timing relation.
- **Affected code:** `services/orchestrator/src/firecracker/agentRpc.ts:529`; `services/orchestrator/src/agent/background.ts:24`; `services/orchestrator/src/firecracker/fleet.ts:1455-1467`.
- **Trigger and reproduction:** start one legitimate guest RPC lasting more than the five-minute idle threshold; the allowed VM background timeout is ten minutes. VM activity is touched once at RPC start, not during execution.
- **Expected:** active operations hold a VM lease/refcount and cannot be paused.
- **Actual:** the sweeper sees an old timestamp, pauses the running VM mid-command, host eventually times out, and the guest may continue later after resume.
- **Root cause / evidence:** last-touch is used as a proxy for active work; no operation lease exists.
- **Impact:** long builds/installations freeze, fail, or produce delayed side effects.
- **Recommended patch:** increment/decrement active-operation leases around in-flight RPCs and background jobs; skip pause/snapshot while those leases exist. Do not lease merely because a preview server is registered: actual preview HTTP/WebSocket traffic already refreshes activity through `proxy.ts:225-230`. A heartbeat is secondary, not a substitute for exact ownership.
- **Regression tests:** fake-clock an in-flight RPC across the idle boundary; abort/crash cleanup must release the lease; inactive VMs must still pause.

### B18 — Gemini replay mismatches function-call IDs

- **Severity / confidence / status:** High; high confidence; confirmed against current official Google contract, live credentialed call pending.
- **Affected code:** `services/orchestrator/src/agent/providers/google.ts:700-754`; `services/orchestrator/src/agent/providers/conversion.test.ts:403+`.
- **Trigger and reproduction:** replay a Gemini 3 tool turn, particularly parallel calls or provider switching. Assistant `functionCall` is reconstructed without `id`; the matching `functionResponse` receives the canonical ID.
- **Expected:** the same real call ID appears on call and response; both are omitted only for genuinely synthetic/id-less legacy calls.
- **Actual:** an unmatched response ID is emitted, and an existing test codifies it.
- **Root cause / evidence:** canonical Anthropic `tool_use.id` is preserved for results but dropped when translating the assistant call back to Gemini. Current [Google GenerateContent function-calling guidance](https://ai.google.dev/gemini-api/docs/generate-content/function-calling) explicitly says Gemini 3 returns IDs and responses must map them.
- **Impact:** provider request rejection/400 or incorrect result association for parallel calls.
- **Recommended patch:** attach `id: b.id` to replayed real Gemini `functionCall`; record provenance so synthetic `gem_*` IDs omit both sides. Update the currently inverted conversion expectation.
- **Regression tests:** same-model, cross-provider, legacy id-less, synthetic ID, parallel calls, and one live Gemini 3 round trip.

### B19 — `interact_preview` mutations are classified read-only

- **Severity / confidence / status:** High; very high confidence; confirmed permission-policy mismatch.
- **Affected code:** `services/orchestrator/src/agent/permissions.ts:30-65`; `services/orchestrator/src/agent/tools.ts:385-419`; interaction implementation and permission tests.
- **Trigger and reproduction:** in default “ask before edits” mode, issue `interact_preview` actions such as navigate, click, fill/type, select, or press Enter against a preview/arbitrary allowed URL.
- **Expected:** observation/assert/screenshot-only actions may be read; mutating interactions require execute/dangerous approval based on destination/action.
- **Actual:** the entire tool is in `READ_ONLY_TOOLS`, so form submission and external side effects bypass the promised approval boundary. `run_flow` is correctly dangerous, confirming inconsistency.
- **Root cause / evidence:** risk is classified by tool name instead of action payload.
- **Impact:** unauthorized-by-policy mutation of the generated preview or public/unauthenticated endpoints. `interact_preview` starts a fresh headless Chromium context and does not inherit the user's signed-in browser cookies, so authenticated third-party purchases/account mutations were not established.
- **Recommended patch:** classify each action before execution: screenshot/assert/wait/scroll as read; navigate/click/type/fill/select/press as execute or dangerous, with arbitrary/non-preview origins escalated. Summarize the action set in the approval card.
- **Regression tests:** every action type under every permission mode, mixed action lists, preview vs arbitrary origin, and no double-gating for assertion-only flows.

### B20 — VM mount/hydration failures return a healthy partial VM

- **Severity / confidence / status:** High; high confidence; the mount false-health path is conditional on golden restore, while silent hydration caps/errors affect cold and golden paths; Linux fault injection pending.
- **Affected code:** `services/sandbox-agent/src/main.rs:285`; `services/sandbox-agent/src/agent.mjs:127`; `services/orchestrator/src/firecracker/fleet.ts:465-470,836-925,1295-1341`.
- **Trigger and reproduction:** force `/sandbox` mount failure, exceed 5,000 files or 200 MiB during hydration, fail a push, or reuse an ext4 containing paths absent from the authoritative host.
- **Expected:** configure fails if the disk is not mounted; hydration either fully reconciles the declared source set or returns an explicit actionable failure.
- **Actual:** both agents ignore the mount command's success/failure result and acknowledge success. (The request's `mount_sandbox` Boolean is honored.) Fleet health checks only agent reachability. Hydration silently caps, errors are suppressed on cold/golden paths, and it never removes stale guest source paths.
- **Root cause / evidence:** health is transport-only and `hydrateInto` is best-effort push, not verified reconciliation.
- **Impact:** nominally healthy VMs with missing/ghost files; stale guest paths can later overwrite the host/Storage.
- **Recommended patch:** make mount failure an error and verify `/proc/self/mountinfo` source. Replace hydration with manifest reconciliation for source paths while preserving explicit cache directories; return counts/hashes and fail on caps instead of silently truncating.
- **Regression tests:** mount failure, wrong image, 5,001 files, >200 MiB, Nth push failure, host-deleted file, and exact manifest verification before registering the VM.

### B21 — Rapid org/workspace loads can display A and mutate B

- **Severity / confidence / status:** High; high confidence; confirmed missing generation guards with timing-dependent response order.
- **Affected code:** `apps/web/components/ProjectPicker.tsx:435-460,487-492`; `apps/web/components/OrgMembersView.tsx:36-52`; `apps/web/components/OrgSettingsView.tsx:35-52`; `apps/web/components/OrgUsageView.tsx:22-35`.
- **Trigger and reproduction:** rapidly switch organization/workspace A -> B while delaying A's request so it resolves last. Views intentionally remain mounted and have no AbortController/request generation.
- **Expected:** only the current scope's response can populate the view; mutations target the same scope represented by rendered data.
- **Actual:** A data can be rendered while props/actions use B's `orgId`, so a later role/settings action can mutate B based on A's visible row/value.
- **Root cause / evidence:** async response ownership is not tied to the scope that initiated it.
- **Impact:** incorrect administrative changes and cross-workspace UI disclosure to a user already switching among authorized orgs. Server-side membership/role checks still block an unauthorized cross-org action; they do not stop an admin of both orgs from making an authorized-but-wrong-org mutation from stale UI.
- **Recommended patch:** abort or generation-tag every scoped load, key view roots by org ID, and require mutation payloads to carry/rendered entity org ID with server validation.
- **Regression tests:** controlled reverse response ordering for picker/members/settings/usage, then attempt mutation; assert UI/data/action scopes always match.

### B22 — Shared design systems and library skills disappear for collaborators

- **Severity / confidence / status:** Medium-High; very high confidence; confirmed query mismatch.
- **Affected code:** `services/orchestrator/src/server.ts:2698-2711,2825-2834,5816-5834`; `services/orchestrator/src/db/designSystems.ts:37-55`; `services/orchestrator/src/db/skillLibraries.ts:95-126`.
- **Trigger and reproduction:** admin A attaches an A-owned design system/skill to a shared/org project; editor B runs a turn.
- **Expected:** project configuration is stable for all authorized project actors.
- **Actual:** every turn resolves the globally stored IDs with the acting user's `user_id`; B receives null/empty prompt additions. An editor cannot attach artifacts; if admin B (or B after promotion to admin) replaces the attachment with B's artifact, A then loses it.
- **Root cause / evidence:** attachment ownership and artifact-library ownership are conflated.
- **Impact:** non-reproducible agent output, brand/rule violations, and collaboration that changes behavior by user.
- **Recommended patch:** create project/org attachment rows or immutable snapshots authorized through the project, while retaining source ownership for library management.
- **Regression tests:** A attach/B run/A run, role changes, source artifact deletion/versioning, and org transfer.

### B23 — Deployment creation and status tracking are non-durable

- **Severity / confidence / status:** Medium-High; high confidence; confirmed ordering/process-lifecycle defect.
- **Affected code:** `services/orchestrator/src/deploy.ts:301-338`; `services/orchestrator/src/server.ts:2902-2919,2931-2965`.
- **Trigger and reproduction:** fail DB insert after Vercel returns 201, or restart the orchestrator while detached polling tracks a `QUEUED`/`BUILDING` deployment.
- **Expected:** a durable local operation exists before/reconciles remote creation; nonterminal rows converge after restart or webhook.
- **Actual:** a real deploy runs while API returns error; retry can create an orphan/duplicate. Polling exists only in one in-process closure, so restart leaves stale status indefinitely.
- **Root cause / evidence:** remote side effect precedes durable intent and polling is not a durable worker.
- **Impact:** duplicate production deploys, misleading “building” state, and operational cleanup.
- **Recommended patch:** persist an operation/idempotency key first, persist remote ID immediately, and reconcile all nonterminal rows on startup/background worker or verified Vercel webhook.
- **Regression tests:** fail after mocked 201; process restart mid-build; duplicated callback/poll; remote canceled/failed state convergence.

### B24 — Destructive SQL confirmation is client-side and incomplete

- **Severity / confidence / status:** Medium-High; high confidence; confirmed bypasses.
- **Affected code:** direct database console `apps/web/components/DatabasesView.tsx:260-295,469-527`, `apps/web/lib/api.ts:664-669`, `services/orchestrator/src/server.ts:2495-2510`; agent connector `services/orchestrator/src/connectors/supabase.ts:15-30,351-413`.
- **Trigger and reproduction:** use `DROP INDEX`, `DROP FUNCTION`, `DROP TYPE`, `DROP TRIGGER`, `DROP POLICY`, procedural `DO`, dynamic SQL, comment-separated or multi-statement variants. The web path relies on narrow UI classification and server forwards SQL directly; the connector blacklist also misses forms despite promising `confirm:true`.
- **Expected:** the server independently enforces an explicit confirmation for every destructive/unknown statement; bypass mode semantics are clear.
- **Actual:** destructive SQL executes without the promised second confirmation. General connector permission is partial mitigation only for the agent path and does not protect the database console.
- **Root cause / evidence:** blacklist regex rather than parsing/provably-safe classification, and confirmation state is not an authenticated server invariant.
- **Impact:** accidental database destruction and misleading safety UX.
- **Recommended patch:** server-side parser/AST classification; require a short-lived operation hash/confirmation token for anything not provably read-only or additive-safe. Treat multi-statement/procedural/dynamic SQL as destructive/unknown by default.
- **Regression tests:** comprehensive DDL/DML/procedural/comment/multi-statement corpus through both UI API and connector.

### B25 — Upload completion can target a newer project/session socket

- **Severity / confidence / status:** Medium; high confidence; confirmed stale-closure/global-socket race.
- **Affected code:** `apps/web/components/ChatPanel.tsx:667-761`; module-global socket behavior in `apps/web/lib/ws-client.ts`.
- **Trigger and reproduction:** start a delayed attachment upload, switch session or project, then let upload resolve. The handler captured the old project for upload but checks stale `connected` and calls `send()` on the current global socket.
- **Expected:** upload/send is canceled on context change or remains bound to the originating project/session/socket generation.
- **Actual:** on a session switch, the asset remains in the same project but is posted to the wrong conversation. On a project switch, old-project attachment metadata/path is sent into a new project where the asset is absent.
- **Root cause / evidence:** async work owns no context generation and send target is looked up late.
- **Impact:** broken multimodal turn, wrong-session transcript, and disclosure of old attachment name/metadata within the user's other context.
- **Recommended patch:** capture project ID, session ID, and socket generation; use AbortController; before sending compare live store/socket identity and otherwise retain the upload as an unsent draft in the origin.
- **Regression tests:** delayed upload with session/project navigation, reconnect, abort, and retry.

### B26 — Retry, Resend, and Regenerate strip attachments and selected-element context

- **Severity / confidence / status:** Medium; very high confidence; confirmed payload trace.
- **Affected code:** `apps/web/components/ChatPanel.tsx:602-655,1698-1701,1900-1952`.
- **Trigger and reproduction:** submit an attachment-only turn or element-picker request, cause failure, and click Retry/Regenerate/Resend.
- **Expected:** replay the validated original turn context or clearly ask the user to reattach.
- **Actual:** handlers pass only `item.content`. An attachment-only turn becomes the sentence “Use the attached file(s).” with no structured paths; selected element context also disappears. Literal `@path` text can sometimes be reconstructed from the current tree, but structured attachment/element metadata is not replayed.
- **Root cause / evidence:** action API accepts a string rather than the original user item/context envelope.
- **Impact:** repeated failure, wrong model output, and wasted tokens.
- **Recommended patch:** make retry actions accept the original item, revalidate its asset paths against the current project, replay attachments/selected element, and echo the same envelope. If a path no longer exists, surface a blocking reattach state.
- **Regression tests:** attachment-only, multiple files, selected element, missing path, and editable resend.

### B27 — Project/knowledge deletion can leave private Storage bytes forever

- **Severity / confidence / status:** Medium; high confidence; confirmed lifecycle gap.
- **Affected code:** `services/orchestrator/src/server.ts:2685-2694,3610-3640`; storage listing behavior in B10.
- **Trigger and reproduction:** inject a transient Storage failure during project or knowledge deletion, or delete a prefix truncated by B10.
- **Expected:** deletion remains in a retryable tombstone state until all durable bytes and compute artifacts are gone.
- **Actual:** the DB row/metadata is removed first, cleanup failures are swallowed, API returns success, and no orphan-GC/outbox source remains.
- **Root cause / evidence:** destructive cleanup is best-effort after deleting the only durable ownership record.
- **Impact:** privacy/data-retention violation and unbounded orphan storage.
- **Recommended patch:** deletion tombstone/outbox with idempotent retries and observable status; only hard-delete ownership metadata after cleanup or retain a minimal GC key.
- **Regression tests:** transient/permanent Storage failure, >1,000 keys, VM/local failure, service restart, and eventual complete erasure.

### B28 — Multipart upload is partially committed but returns all-or-nothing failure

- **Severity / confidence / status:** Medium; high confidence; confirmed sequential commit path.
- **Affected code:** `services/orchestrator/src/server.ts:3231-3340`.
- **Trigger and reproduction:** upload several files and fail a host write, Storage sync, or later persistence step on file N. VM mirroring failure is a related divergence path but is caught/swallowed and can return success rather than this batch-level 500.
- **Expected:** atomic batch, idempotent retry, or explicit per-file outcomes.
- **Actual:** earlier host/VM/Storage files remain, current host write may remain, response is 500, and retry uses fresh random prefixes that duplicate successful files.
- **Root cause / evidence:** no staging transaction, batch ID, rollback, or result ledger.
- **Impact:** hidden partial state, duplicate assets, and prompts referring to only part of a batch.
- **Recommended patch:** stage under an operation ID, validate all files, commit with per-file durable state and idempotency; either roll back or return exact partial results and a resume token.
- **Regression tests:** failure at every stage/file, retry same idempotency key, and browser navigation during batch.

### B29 — Checkpoint restore acknowledges before durable Storage convergence

- **Severity / confidence / status:** Medium; very high confidence; confirmed fire-and-forget path.
- **Affected code:** `services/orchestrator/src/server.ts:1955-1992`.
- **Trigger and reproduction:** make `syncChanges()` fail or restart immediately after restore returns 200.
- **Expected:** 200 means the selected restored content is durable, or response returns a trackable pending job.
- **Actual:** Storage sync is voided and errors are swallowed. Later hydration can restore the pre-rewind Storage version over the host.
- **Root cause / evidence:** durability is detached from acknowledgement.
- **Impact:** apparently successful rewind disappears after host/VM recycle.
- **Recommended patch:** await sync under the B05 mutation lock, or persist a restore operation/outbox and return 202 until converged. Surface failure and retry.
- **Regression tests:** Storage failure/restart after restore followed by empty-host hydration; restored tracked files must remain authoritative.

### B30 — Concurrent OAuth refreshes can overwrite rotated credentials

- **Severity / confidence / status:** Medium; medium-high confidence; highly likely, provider rotation semantics need controlled validation.
- **Affected code:** `services/orchestrator/src/supabase.ts:308-335`; `services/orchestrator/src/figma.ts:243-268`; `services/orchestrator/src/db/users.ts:216-230,324-351`.
- **Trigger and reproduction:** two concurrent requests see an expired token and refresh the same credential; one response/failure arrives after the winner.
- **Expected:** one refresh per user/provider; writes are conditional on the token/version that was refreshed.
- **Actual:** unconditional updates permit a stale loser to overwrite a winner if the provider issues independently rotated token pairs or rejects reuse of the same refresh token; Figma's failure path can then clear credentials based on the stale snapshot. The race is confirmed, while destructive rotation behavior remains provider-specific runtime validation.
- **Root cause / evidence:** no singleflight, row/advisory lock, or CAS/version.
- **Impact:** intermittent disconnect/login loops under concurrency.
- **Recommended patch:** per-user/provider singleflight plus DB CAS on token version; never clear credentials based on a stale snapshot. Re-read after conflict.
- **Regression tests:** two refresh successes in reverse order, winner + invalid_grant loser, multi-instance race, and provider-specific token reuse behavior.

### B31 — Organization budget is a soft, race-prone gate

- **Severity / confidence / status:** Medium if presented as a hard cap; otherwise informational product-contract risk.
- **Affected code:** `services/orchestrator/src/server.ts:6816-6845,6716-6737`; `services/orchestrator/src/db/usage.ts:122-149`.
- **Trigger and reproduction:** start several runs concurrently just below the cap or cause the aggregate query/usage persistence to fail.
- **Expected:** a marketed hard budget reserves allowance atomically and fails closed.
- **Actual:** every run can pass the same preflight snapshot; aggregate errors return zero and post-spend persistence is best-effort.
- **Root cause / evidence:** preflight observation rather than atomic reservation/accounting.
- **Impact:** spend exceeds configured limits and users receive a false cost-control promise.
- **Recommended patch:** atomic reservation/settlement ledger with conservative estimates and release/refund, or relabel the feature explicitly as a soft alert/guard.
- **Regression tests:** N concurrent runs at boundary, DB error, failed/refused run settlement, and retry idempotency.

### B32 — Nonterminal errors and Force Stop falsely advertise an idle run

- **Severity / confidence / status:** Medium; high confidence; confirmed client state behavior.
- **Affected code:** `apps/web/lib/ws-client.ts:671-676`; examples of auxiliary server errors at `services/orchestrator/src/server.ts:4696-4699,4725-4726`; `apps/web/components/ChatPanel.tsx:763-794`.
- **Trigger and reproduction:** receive a generic `error` for an auxiliary request while a run continues, or wait nine seconds after Stop and click Force Stop.
- **Expected:** only authoritative terminal `complete`/run-state events clear busy; cancellation has a visible `terminating` state.
- **Actual:** every error calls `setBusy(false)`. Force Stop sends abort and immediately clears busy while admitting the agent may still finish. The same-session server registry prevents a true second run, so a newly entered prompt can instead be misclassified as steering for the still-active old run.
- **Root cause / evidence:** transport/activity errors and run terminal state share one untyped event/state transition.
- **Impact:** misleading UI, duplicate user actions, and prompts applied to the wrong run.
- **Recommended patch:** add error scope/terminal fields and a run ID; reducer clears busy only for a terminal event matching the active run. Force Stop stays `terminating` until server acknowledgement/reconnect truth.
- **Regression tests:** auxiliary file/reset error during a run, slow abort, lost abort, reconnect while terminating, and new prompt gating.

### B33 — Drafts collide across chat sessions

- **Severity / confidence / status:** Medium; very high confidence; confirmed storage-key design.
- **Affected code:** `apps/web/components/LandingPrompt.tsx:20-29`; `apps/web/components/ChatPanel.tsx:174-189,330-360`.
- **Trigger and reproduction:** type a draft in chat A, switch to B in the same project, edit/clear it, then return to A.
- **Expected:** independent drafts per conversation.
- **Actual:** the localStorage key contains only project ID, so A appears in B and either session overwrites/clears the other.
- **Root cause / evidence:** session identity omitted from persisted state key.
- **Impact:** text loss and accidental sending in the wrong chat.
- **Recommended patch:** key by project + resolved session ID, with a one-time migration for the default/legacy project-only key.
- **Regression tests:** A/B/default sessions, new-session creation, legacy migration, and project switch.

### B34 — Reconnect can retain stale todos when the server list is empty

- **Severity / confidence / status:** Medium; high confidence; confirmed asymmetric empty-state protocol.
- **Affected code:** `apps/web/lib/store.ts:1638-1655`; `apps/web/lib/ws-client.ts:322-369`; `services/orchestrator/src/server.ts:5417-5421`.
- **Trigger and reproduction:** have todos, clear them elsewhere, then reconnect the same mounted session. The reconnect path retains client todos and the server sends initial todos only when nonempty. A normal session switch performs a fuller Workspace reset and is not the required trigger.
- **Expected:** the server always sends authoritative `[]`, or session start clears before replay.
- **Actual:** old todos remain displayed indefinitely.
- **Root cause / evidence:** empty collections are treated as “no event” rather than state.
- **Impact:** false task status and actions against already-cleared items.
- **Recommended patch:** always emit `todos_updated`, including `[]`, during session initialization; optionally clear on `session_started` before replay.
- **Regression tests:** nonempty -> externally empty -> reconnect and session switch.

### B35 — Unanchored citation replacement corrupts code containing `[n]`

- **Severity / confidence / status:** Medium; high confidence; confirmed transformation path.
- **Affected code:** `apps/web/lib/citations.ts:34-72,97-104`.
- **Trigger and reproduction:** GLM/unanchored citation mode emits ordinary code such as `arr[1]` inside inline or fenced code.
- **Expected:** only citation tokens outside code ranges become links.
- **Actual:** global replacement rewrites `[1]` in code, while code-range protection is applied only to the anchored path.
- **Root cause / evidence:** two citation strategies have inconsistent protected-range handling.
- **Impact:** syntactically/semantically corrupted code shown to users.
- **Recommended patch:** tokenize/protect Markdown code spans/fences for every citation strategy and only replace tokens in prose nodes.
- **Regression tests:** inline code, fenced code, arrays, footnotes, real citations adjacent to code, and malformed fences.

### B36 — Preview sharing carries stale server state and hides revoke failure

- **Severity / confidence / status:** Medium; high confidence; confirmed React/state and error path.
- **Affected code:** `apps/web/components/EditorPreviewArea.tsx:266-269,456-457`; `apps/web/components/PreviewPanel.tsx:391-457,932-947,1297-1377`.
- **Trigger and reproduction:** create a share for server A, switch to server B without remount, or make revoke fail.
- **Expected:** share state is keyed per server; failed revoke retains the link/token and offers retry with a warning.
- **Actual:** the same PreviewPanel instance can show A's link on B. Revoke errors are swallowed and local state clears, while the public URL can remain valid for up to two hours with no retry path.
- **Root cause / evidence:** state not reset/keyed by `server.id`; optimistic revoke has no rollback/error state.
- **Impact:** user may copy the wrong preview or believe access was revoked when it was not.
- **Recommended patch:** key/map share state by server ID; await revoke, clear only on success, retain token and show retry on failure; disable duplicate create clicks.
- **Regression tests:** A/B tab switch, failed/slow/duplicate revoke, server exit, and token expiry.

### B37 — Unsaved offline edits do not trigger unload protection

- **Severity / confidence / status:** Medium; very high confidence; confirmed guard omission.
- **Affected code:** `apps/web/components/ChatPanel.tsx:521-533`; `apps/web/lib/store.ts:1721-1739`.
- **Trigger and reproduction:** edit while disconnected so `pendingEdits` is memory-only, then reload/close the page while no agent/install is active.
- **Expected:** beforeunload warning for dirty/saving/error buffers.
- **Actual:** unload warning checks agent/install activity only; bytes disappear.
- **Root cause / evidence:** data-loss guard is owned by ChatPanel rather than a central workspace-dirty selector.
- **Impact:** user edit loss during connectivity problems.
- **Recommended patch:** central `hasUnsavedWork` selector covering pending edits, saving/error state, and pending/in-flight attachments/uploads; install one workspace-level beforeunload handler. Text drafts are already localStorage-backed and need only persistence-timing validation.
- **Regression tests:** offline dirty, saving, save error, clean, and agent-only states.

### B38 — Skills and Secrets async operations can erase later keystrokes

- **Severity / confidence / status:** Medium; high confidence; confirmed stale-submission behavior.
- **Affected code:** `apps/web/components/SkillsModal.tsx:102-117,140-157,241-260`; `apps/web/components/SecretsModal.tsx:63-98,156-228`.
- **Trigger and reproduction:** edit an input while save/load is in flight. Skills closes after saving the earlier snapshot; pack fetch replaces interim edits. Secret save clears whatever value is current when the earlier request resolves.
- **Expected:** inputs are disabled, or response applies only if the current generation/value still matches the submitted snapshot.
- **Actual:** later user text is silently closed, overwritten, or cleared.
- **Root cause / evidence:** async completion mutates current state without generation/submitted-value check.
- **Impact:** discarded secret/skill edits and a misleading saved state. The submitted request still uses its captured snapshot; this finding does not assert rotation of a different secret.
- **Recommended patch:** capture a mutation generation and submitted snapshot; disable conflicting actions or preserve later dirty values and show saved/unsaved state.
- **Regression tests:** type during slow save/fetch, failure/retry, modal close/reopen, and multiple secret rows.

### B39 — A nonexistent file below a symlinked parent escapes path guards

- **Severity / confidence / status:** Medium; high confidence; confirmed resolver logic, conditional impact. Production VM impact is limited by VM isolation/arbitrary shell capability; host fallback is the dangerous case.
- **Affected code:** host `services/orchestrator/src/agent/sandbox.ts:86-92,503-524,532-546`; Rust `services/sandbox-agent/src/main.rs:477-492,746-771`; Node `services/sandbox-agent/src/agent.mjs:303-310,384-392`.
- **Trigger and reproduction:** create `out -> /tmp/outside`, then use a file-write API on `out/new.txt`. Whole-path canonicalization fails on ENOENT and code falls back to lexical containment; Node realpaths only an existing final path.
- **Expected:** every existing ancestor is resolved beneath sandbox and symlinks cannot redirect creation outside.
- **Actual:** the new child can be created through the symlink outside the declared root.
- **Root cause / evidence:** final-path realpath cannot protect creation and no dirfd/component walk is used.
- **Impact:** host-sandbox arbitrary file write within orchestrator OS permissions; guest escape from `/sandbox` into other VM paths.
- **Recommended patch:** Linux `openat2(RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS)` or safe dirfd component traversal; at minimum canonicalize nearest existing ancestor immediately before open and use no-follow flags.
- **Regression tests:** missing final component through one/nested symlink, existing symlink target, rename race, Windows fallback semantics, and all three implementations.

### B40 — Custom Firecracker subnet settings are internally inconsistent

- **Severity / confidence / status:** Medium; very high confidence; confirmed configuration defect, conditional on non-default network settings.
- **Affected code:** `infra/firecracker/host-net.sh:28+`; `services/orchestrator/src/firecracker/fleet.ts:93-95,135,339,608,760,1589-1604`.
- **Trigger and reproduction:** configure a non-default bridge gateway/netmask/CIDR, such as `/24` or another private range.
- **Expected:** host bridge, guest kernel arguments, allocator, gateway, bootstrap address, and routes derive from one validated CIDR.
- **Actual:** `BRIDGE_NETMASK` is unused; allocator and multiple guest arguments hardcode `172.16.*` and `/16`, so host and guests disagree. `FIRECRACKER_BOOTSTRAP_IP` is configurable, but allocator reservation at `fleet.ts:1595-1597` hardcodes default `172.16.255.254`, so a custom bootstrap address can also be assigned to a project.
- **Root cause / evidence:** partial environment configurability layered over hardcoded protocol values.
- **Impact:** unreachable VMs, broken routing, or unintended route reachability in custom deployments.
- **Recommended patch:** parse one `FIRECRACKER_CIDR` and derive all addresses/prefixes/reservations; reject inconsistent legacy overrides.
- **Regression tests:** default `/16`, alternate `/24`, alternate RFC1918 range, invalid/conflicting settings, and golden/cold restore.

### B41 — VM `stop_server` reports success after an RPC failure

- **Severity / confidence / status:** Medium; very high confidence; confirmed fire-and-forget behavior.
- **Affected code:** `services/orchestrator/src/agent/sandbox.ts:1220-1231`.
- **Trigger and reproduction:** make guest stop RPC fail/time out.
- **Expected:** caller receives failure and server registry remains retryable until guest termination is confirmed.
- **Actual:** error is swallowed and host registry is immediately deleted; guest server can keep running while its handle/proxy entry is lost.
- **Root cause / evidence:** synchronous public API wraps an unawaited async side effect.
- **Impact:** leaked server/process, inaccessible stop control, and port/resource conflict.
- **Recommended patch:** make stop async; await acknowledged process-tree death; only remove registry on success or explicit forced VM teardown.
- **Regression tests:** failed, delayed, duplicate, and successful stop; registry and process state must agree.

### B42 — Host-mode command output is bounded only after process exit

- **Severity / confidence / status:** Medium-Low; high confidence; confirmed, conditional on explicit host sandbox mode.
- **Affected code:** `services/orchestrator/src/agent/sandbox.ts:865+`.
- **Trigger and reproduction:** run a chatty/infinite command in host-backed mode.
- **Expected:** stdout/stderr are drained into bounded head/tail buffers throughout execution.
- **Actual:** strings grow without bound and are truncated only at close. Rust/Node VM agents already use the safer pattern.
- **Root cause / evidence:** post-hoc truncation rather than streaming cap.
- **Impact:** orchestrator memory exhaustion in host fallback/dev configuration.
- **Recommended patch:** reuse bounded stream buffer logic from the VM agents and record dropped-byte counts.
- **Regression tests:** multi-megabyte and infinite producers under a memory bound, including abort.

### B43 — `waitForPort` and checkpoint queues retain resources

- **Severity / confidence / status:** Low; high confidence; confirmed memory-retention defects.
- **Affected code:** `services/orchestrator/src/agent/sandbox.ts:951+`; `services/orchestrator/src/agent/checkpoints.ts:145-158,359+`.
- **Trigger and reproduction:** signal-backed host `start_server` port polling adds one abort listener per 250 ms whose normal timer path does not remove it; polling without an `AbortSignal` does not. Separately, many created/deleted projects leave one settled Promise per project in `commitQueues`.
- **Expected:** common settle cleanup removes listeners; settled per-project queue entries are identity-checked and deleted.
- **Actual:** listeners/closures accumulate only for the lifetime of the same signal-backed wait/run and can trigger `MaxListenersExceededWarning` plus transient retention. The `commitQueues` keys are the process-lifetime per-project retention.
- **Root cause / evidence:** cleanup exists only on abort/disk deletion does not clear in-memory registry.
- **Impact:** transient listener growth/warnings during long waits plus gradual process-lifetime map growth across projects.
- **Recommended patch:** central `settle()` removes listener/timer on every path; queue `.finally()` deletes only if it is still the current tail, and project deletion explicitly clears it.
- **Regression tests:** fake timers/listener counts; thousands of completed/deleted project queues return map size to zero.

### B44 — Image viewer keeps the previous image visible while the next loads

- **Severity / confidence / status:** Low; high confidence; confirmed UI state defect.
- **Affected code:** `apps/web/components/EditorPreviewArea.tsx:30-72`.
- **Trigger and reproduction:** switch image paths while the next fetch is slow/fails.
- **Expected:** clear to loading immediately and cancel stale fetch.
- **Actual:** the previous image remains live and visible under the new tab until the replacement succeeds or the component unmounts. The URL-cleanup effect depends on `url`, not `path`, so path change alone does not revoke it.
- **Root cause / evidence:** the path effect never clears `url`. Its existing `cancelled` flag does prevent a stale earlier response from winning; lack of AbortController wastes resources but is not the correctness defect.
- **Impact:** misleading asset preview.
- **Recommended patch:** `setUrl(null)` at path change. Abort the prior fetch for efficiency while retaining the existing stale-response guard.
- **Regression tests:** rapid A/B switch, B failure, unmount, and object URL revoke accounting.

## 6. Performance problems and maintainability risks

These are real risks but are not promoted to functional bugs without the stated trigger:

| Area | Evidence | Risk | Recommended action |
|---|---|---|---|
| HTTP connector response cap | `services/orchestrator/src/connectors/http.ts:121-145` calls `res.text()` before any cap; parsed JSON is never truncated | attacker/large API response consumes memory and context | stream with hard byte cap; cap serialized JSON |
| Postgres row limit | `services/orchestrator/src/connectors/postgres.ts:60-82` materializes all rows before slicing; negative limit is not validated | large query memory blow-up; ineffective negative limit | validate `0..5000`; cursor/stream or SQL-side wrapper |
| ZIP and knowledge buffering | `services/orchestrator/src/server.ts:3146-3195,3367-3410` | 250 MB ZIP and aggregate knowledge uploads can multiply process memory | stream to bounded temp files; aggregate/concurrency quotas |
| Collaboration payloads | `services/orchestrator/src/collabRoutes.ts:132-193,213-248` | fields inherit global 10 MB JSON cap | domain-specific length/count limits |
| `server.ts` concentration | more than 8k lines coordinating auth, files, runs, deploys, persistence | transaction/lifecycle invariants are difficult to share/test | extract project mutation, session lifecycle, deployment, and task services |
| Rust/Node sandbox parity | endpoints are hand-mirrored | silent behavioral drift | protocol contract tests run against both implementations |

## 7. Dependency findings

`npm audit --omit=dev` reported no Critical or High advisories. It reported:

- Moderate: Next's nested `postcss@8.4.31`, GHSA-qx2v-qp2m-jg93 (unescaped `</style>` in affected transformation contexts).
- Moderate: `protobufjs@7.6.1` through `@google/genai`, GHSA-f38q-mgvj-vph7.
- Low: `esbuild@0.27.7` through development tooling, Windows dev-server arbitrary file read advisory.

These are dependency risks, not proven application exploits in this audit. Upgrade the direct parents, rerun build/provider conversion tests, and validate whether Gate 15 processes attacker-controlled CSS/protobuf messages through the affected code before assigning application severity.

## 8. Proposed patch sketches

These are illustrative shapes, not applied changes.

### 8.1 Binary-safe upload (B02)

```diff
- await fcAgent.writeFile(vm, relPath, item.content.toString("utf-8"));
+ await fcAgent.pushFile(vm, relPath, item.content);
```

### 8.2 Gemini call/result identity (B18)

```diff
  const functionCall = {
+   ...(isRealGeminiId(b.id) ? { id: b.id } : {}),
    name: b.name,
    args: b.input ?? {},
  };
```

The same provenance predicate must control `functionResponse.id`; a synthetic canonical ID must not be sent on either side.

### 8.3 Storage pagination (B10)

```ts
for (let offset = 0; ; offset += PAGE_SIZE) {
  const page = await bucket.list(prefix, {
    limit: PAGE_SIZE,
    offset,
    sortBy: { column: "name", order: "asc" },
  });
  yield* page.data;
  if (page.data.length < PAGE_SIZE) break;
}
```

Recursive traversal should operate on this iterator and tests must mock multiple pages at every depth.

### 8.4 Run/session deletion guard (B07)

```ts
const key = runKey(projectId, sessionId);
const active = runs.get(key);
if (active) return json(res, 409, { error: "stop the running chat before deleting it" });
await withSessionLifecycleLock(projectId, sessionId, async () => {
  closeSessionSockets(projectId, sessionId);
  await deleteSession(projectId, sessionId);
});
```

If product behavior chooses “delete and cancel,” abort/wake and await terminal cleanup inside the lock instead of returning 409.

### 8.5 Fail-closed VM isolation (B15)

```ts
await mustSucceed("modprobe", ["br_netfilter"]);
await mustSucceed("sysctl", ["-w", "net.bridge.bridge-nf-call-iptables=1"]);
await ensureDropRuleFirst();
await verifyIsolationInvariant();
isolationChecked = true; // only after effective verification
```

### 8.6 Durable task lease (B08)

Add `worker_id`, `lease_expires_at`, `heartbeat_at`, and `attempt`. Claim with a single SQL transaction/RPC using `FOR UPDATE SKIP LOCKED`; every terminal update must match task ID + worker ID + unexpired lease. Cancellation writes terminal state and aborts the local controller if owned.

### 8.7 Path-keyed editor model (B03/B04)

Replace global `fileContent` with `files[path] = {content, requestGeneration, loadState, saveState, pending}`. A response applies only when its generation matches the current request for that path. Monaco receives a model URI/path and never saves under `editorTab` alone.

## 9. Bugs requiring runtime validation

| Candidate | What is already established | Required controlled validation |
|---|---|---|
| B14 VM IP collision | exact valid UUID collision; no uniqueness guard | boot pair in disposable network namespace; verify ARP and proxy target |
| B15 VM isolation fail-open | failure path confirmed; current host rule/sysctl present | fault-inject modprobe/sysctl/iptables; peer-connectivity test and drift recheck |
| B16 guest cancellation | both agents lack disconnect/kill linkage | delayed mutation on production-equivalent Rust rootfs |
| B18 Gemini IDs | payload mismatch + official contract | live Gemini 3 sequential and parallel tool calls after fix |
| B20 mount/hydration | ignored mount result, caps, swallowed failures | Linux/Firecracker mount/push/cap fault injection |
| B30 OAuth refresh | unconditional concurrent writes | provider-specific rotated-token concurrency tests |
| B31 budget semantics | race/fail-open established | decide whether product promises hard cap; load test at boundary |
| Auth cookie bounce | stale `wos-session` plus valid guest cookie is plausible from `projects`/`settings` server-page cookie-presence checks | browser test with deliberately stale WorkOS cookie |
| Download object URL timing | immediate revoke in `apps/web/lib/api.ts:275-295,835-855` | Firefox/WebKit download matrix before classifying |

## 10. Inspected issues ruled out or deliberately not classified

- Current production Firecracker version and expected isolation configuration elements were present. Effective peer isolation was not live-tested; B15 is a latent fail-open defect, not a claim of current exposure.
- Checkpoint restore is explicitly non-destructive for files added after a checkpoint in `checkpoints.ts:20-23`; retained untracked files alone were not classified as a bug. B05 concerns concurrent overwrites and unsaved state; B29 concerns durability.
- Preview traffic refreshes VM activity. B17 is limited to a single long RPC that receives no intermediate touch.
- Host-backed command abort tree-kills correctly; B16 is VM-backed execution.
- Rust and Node VM command output are bounded; B42 is host mode only.
- Mandatory agent bearer authentication mitigates agent-RPC takeover, not peer preview-port access.
- `run_flow` is correctly dangerous; B19 is specifically direct `interact_preview` action classification.
- No current-contract defect was confirmed in Anthropic, OpenAI, or Z.ai translation after source/tests. The confirmed provider contract issue is B18.
- HTTP `safeFetch` pins DNS and revalidates redirects. B13 is limited to Postgres and external Git.
- Turnstile is verified at the orchestrator trust boundary and fails closed once configured. B12 concerns limiter ordering/shared relay identity.
- Organization last-owner DB triggers, transactional org lifecycle safeguards, same-session run locking, conditional queued-task claim, sensitive-path reads, multipart Content-Type handling, WebSocket stale-close guards, and same-path dirty response guards were inspected and found to have relevant neutralizers.
- Native Windows Cargo errors were platform mismatch. Linux target check passed.
- The initial web build failure was shared `.next` interference; a clean production build passed.

## 11. Most fragile parts of the codebase

1. **Project file authority and synchronization.** Host, live VM, Storage, editor buffers, checkpoints, deploy pulls, and cold hydration lack one transaction/epoch model. B01, B02, B05, B10, B20, B27-B29 all meet here.
2. **Execution lifecycle.** Interactive session runs, durable tasks, background commands, server processes, cancellation, and VM idling use separate registries and terminal-state rules (B06-B08, B16-B17, B32, B41).
3. **Firecracker networking/boot health.** Allocation, isolation, mount, hydration, and custom subnet values need host-level invariant tests (B14-B15, B20, B40).
4. **Async client state ownership.** Global socket/store state and untagged requests make path/session/org navigation races easy (B03-B04, B21, B25, B32-B38, B44).
5. **External side-effect idempotency.** Supabase provisioning, deployment, OAuth refresh, and deletion cleanup perform remote/destructive actions without durable intent/reconciliation (B11, B23, B27, B30).
6. **Policy by regex/tool name.** SQL confirmation and preview permissions make safety promises at too coarse a layer (B19, B24).

## 12. Missing test coverage

- No web component/integration tests for editor tabs, dirty buffers, session switching, org switching, upload navigation, modal races, preview share, or run-state reducers.
- No browser E2E suite covering auth middleware, WorkOS/guest cookie transitions, responsive/mobile behavior, downloads, Monaco, multi-tab collaboration, or Turnstile relay limits.
- No host/VM/Storage contract suite asserting identical manifests across manual operations, agent edits, uploads, pulls, rewinds, pause/resume, restart, and deploy.
- No >1,000-object Storage fixtures or cleanup outbox tests.
- No durable-task process-death, lease, cancellation, multi-worker, or interactive-lane tests.
- No sandbox-agent contract suite running the same RPC behavior against Rust and Node.
- No Linux namespace/Firecracker CI for peer isolation, IP allocation, mount failure, hydration caps, cancellation, and idle leases.
- Provider conversion tests are strong in count but one currently asserts malformed Gemini ID behavior; no credentialed canary matrix validates current API shapes.
- No concurrency/fault-injection harness for Supabase provisioning, deploy creation, OAuth refresh, guest conversion/sweep, and Storage deletion.
- Schema is manually applied; there is no automated clean-schema migration test or deployed-schema drift check.

## 13. Recommended regression test program

Immediate named suites:

1. `projectFileConsistency.integration.test.ts`: VM/host/Storage/editor manifest through create/rename/delete/upload/pull/restart/deploy.
2. `editorNavigation.test.tsx`: delayed/out-of-order file responses, dirty buffers, session/project switches, unload.
3. `runLifecycle.integration.test.ts`: two sessions, deletion, terminal errors, force stop, durable task cancel/restart.
4. `guestLifecycle.race.test.ts`: Turnstile limiter ordering, return/convert/sweep barriers.
5. `externalIdempotency.test.ts`: provision/deploy/delete crash points and retries.
6. `sandboxAgent.contract.test.ts`: run once against Rust and Node images.
7. `firecrackerHost.integration.sh`: CIDR derivation, collision pair, peer denial, mount failure, hydration cap, active-RPC lease.
8. `providerLiveCanary`: one sequential/parallel tool turn per selectable model, with payload snapshots redacted.
9. `orgScopeRace.test.tsx`: reverse response ordering followed by mutation.
10. `sqlConfirmation.test.ts`: parser corpus through direct console and agent connector.

## 14. Immediate fixes, in order

1. B02 binary-safe upload: tiny change, direct data-corruption stop.
2. B01 file operation transaction + client path migration: stop resurrection/loss before more UI work.
3. B03/B04 editor path models and save barriers.
4. B06/B07/B08 one project mutation lane and correct cancellation/session lifecycle.
5. B09 guest deletion claim before destructive cleanup.
6. B10 exhaustive Storage pagination, then rerun all deletion/hydration paths.
7. B11 provisioning intent/idempotency and B23 deploy reconciliation.
8. B13 DNS pinning for Postgres/Git.
9. B14 IPAM and B15 fail-closed invariant verification.
10. B16/B17 guest job control and active-operation leases.
11. B18 provider ID fix and live canary.
12. B19/B24 enforce permission/confirmation on the server.

## 15. Thirty-day reliability improvement plan

### Days 1-3 — Stop active corruption and permission bypass

- Ship B02, B18, and B19 with focused tests.
- Add Storage pagination B10 and audit every caller with >1,000 fixtures.
- Temporarily reject rename/delete/rewind while a project VM/run is active if the full B01/B05 transaction cannot safely land in the same window; this is a narrow safety gate, not a “coming soon” replacement, and must be removed as soon as the mirrored operation ships.

### Days 4-8 — Establish one project mutation protocol

- Implement VM mkdir/rename/delete, client path migrations, pull-baseline epochs, and upload-verify-delete Storage ordering.
- Add project-wide mutation queue shared by chat sessions, durable tasks, file ops, checkpoint restore, and deploy pulls.
- Move editor buffers to path-keyed models and add navigation/save barriers.

### Days 9-13 — Make lifecycle work durable

- Add task leases/heartbeats/recovery/cancel controller plumbing.
- Make session deletion/run termination transactional.
- Implement guest deletion claim + cleanup outbox and general project/knowledge deletion tombstones.

### Days 14-18 — Harden Firecracker invariants

- Add persisted IPAM, fail-closed isolation verification, canonical CIDR derivation, mount verification, exact hydration reporting, and active RPC leases.
- Run Linux namespace/Firecracker fault-injection suite on a disposable host before Hetzner rollout.

### Days 19-23 — External side-effect reconciliation

- Add durable provisioning/deployment operations with idempotency and startup reconciliation.
- Add OAuth refresh singleflight/CAS and hard-vs-soft budget product decision.
- Pin Postgres/Git connections and test DNS rebinding/redirects.

### Days 24-27 — Browser/client race coverage

- Add Playwright or equivalent E2E for Monaco/file navigation, multi-session/multi-tab collaboration, org scope, uploads, retry context, preview share, unload, downloads, and auth cookies.
- Fix B21/B25/B26/B32-B38/B44 from failing tests.

### Days 28-30 — Operational gates

- Add pre-deploy schema drift, dependency audit, clean web build, Rust Linux check, provider canary, and Firecracker host invariant checks.
- Publish dashboards/alerts for orphan cleanup, stuck leases, nonterminal deploy age, VM IP uniqueness, isolation drift, hydrate caps/failures, and persistence failures.
- Run a fault-injection game day: DB/Storage/provider outage, orchestrator restart mid-run/deploy/task, and VM agent loss.

## 16. Remaining areas that could not be tested

- Visual and interactive browser behavior was not directly verified because the in-app browser runtime failed to initialize. HTTP/build/type tests do not establish layout, mobile, accessibility, Monaco event, download, or multi-tab behavior.
- No authenticated WorkOS, Vercel, Supabase Management, Figma, GitHub, OpenAI, Anthropic, Z.ai, or Gemini credentials were used. External side effects were not created.
- No database destructive/race tests ran against production Supabase; DB findings used source, schema, mocks, and ordering invariants.
- No real Firecracker VM was booted or fault-injected from the Windows workspace. Production was inspected read-only; networking and service were not changed.
- No live peer-connectivity, colliding-VM, golden-mount-failure, guest-command-cancel, or >200 MiB hydration test ran.
- Native Rust execution/tests were not available on Windows; only the Linux target check passed.
- Cross-browser Firefox/WebKit, slow/mobile networks, offline service behavior, and DST/locale/currency flows lack an E2E harness. No separate confirmed date/currency defect was found by static inspection.
- Production load, memory profiling, and multi-instance orchestrator behavior were not exercised.

## 17. Executive summary

The codebase compiles cleanly and its existing orchestrator suite is healthy, but the tests substantially under-cover the product's real failure boundaries. This audit identified **24 High or Medium-High findings**, **20 additional Medium/Low findings**, and several bounded performance/maintainability risks after deduplication. The most serious confirmed theme is not provider logic or basic auth: it is inconsistent authority and lifecycle across browser state, the host mirror, the running Firecracker filesystem, Supabase Storage, database rows, and in-process registries.

The first reliability tranche should fix binary upload corruption, transactional file operations, editor/save races, project-wide run serialization, guest cleanup locking, Storage pagination, and durable external-operation intent. Firecracker's current production host had the expected version and isolation configuration during the read-only check, but effective peer isolation was not live-tested; the runtime code still fails open on future drift and its 16-bit allocator has a reproduced collision. Both need host-invariant engineering rather than monitoring alone.

There is no evidence from this audit that the current production host is presently missing the expected VM peer-isolation configuration, and no Critical issue was proven active. Effective peer isolation still needs a live connectivity probe. There is enough confirmed High-severity data-integrity and lifecycle risk that file synchronization and concurrent execution should be treated as the immediate release-quality program before expanding adjacent product surface.

## 18. Resolution register (2026-07-14)

This register supersedes the pre-remediation status language in the original findings above. It covers all 44 numbered findings, all six performance/maintainability rows, and all three dependency findings. "Fixed" means the underlying path was changed and at least a targeted automated or static check passed. Items that require the production-equivalent Linux/Firecracker environment to establish the invariant are deliberately not marked fixed.

### Numbered findings

- **B01 - Fixed.** Files changed: `services/orchestrator/src/server.ts`, `services/orchestrator/src/projectMutationLane.ts`, `services/orchestrator/src/firecracker/agentRpc.ts`, both sandbox agents, `packages/api-types/src/index.ts`, `apps/web/lib/store.ts`, and `apps/web/components/FileExplorer.tsx`. The server now serializes namespace mutations, changes the live VM and host/Storage coherently, returns path mappings, and the client atomically migrates or removes tree, tab, selected-file, pending-save, and editor state. Checks: orchestrator/web typechecks plus sandbox I/O and mutation-lane tests. Remaining limitation: no live VM/host/Storage fault-injection E2E was available.
- **B02 - Fixed.** File changed: `services/orchestrator/src/server.ts`. Project uploads now send the original `Buffer` through `fcAgent.pushFile` instead of converting arbitrary bytes to UTF-8. Checks: orchestrator typecheck and sandbox I/O tests. Remaining limitation: no production-rootfs binary round-trip was run.
- **B03 - Fixed.** Files changed: `packages/api-types/src/index.ts`, `services/orchestrator/src/server.ts`, `apps/web/lib/ws-client.ts`, `apps/web/lib/store.ts`, `apps/web/components/FileExplorer.tsx`, `apps/web/components/EditorPreviewArea.tsx`, and `apps/web/components/CodeEditor.tsx`. File requests carry request IDs and path ownership; stale responses are ignored, dirty path-keyed buffers win, and Monaco models are keyed to their real path. Checks: `apps/web/lib/fileLoadState.test.ts` (3 tests) and web typecheck. Remaining limitation: no browser Monaco race E2E.
- **B04 - Fixed.** Files changed: `apps/web/components/Workspace.tsx`, `apps/web/lib/store.ts`, and `apps/web/lib/ws-client.ts`. A chat-session change now resets chat state only and preserves project-scoped pending edits, save states, and open files; reconnect flushes the retained buffers. Checks: `fileLoadState.test.ts` and web typecheck. Remaining limitation: multi-session browser navigation was not exercised live.
- **B05 - Fixed.** Files changed: `apps/web/components/Workspace.tsx`, `apps/web/components/CheckpointsModal.tsx`, `apps/web/lib/ws-client.ts`, `packages/api-types/src/index.ts`, and `services/orchestrator/src/server.ts`. Restore is blocked during active work, flushes dirty editors and awaits acknowledgements, uses the project mutation lane, and broadcasts an authoritative checkpoint reset. Checks: web/orchestrator typechecks, `unsavedWork.test.ts`, and `projectMutationLane.test.ts`. Remaining limitation: no live multi-client rewind test.
- **B06 - Fixed.** Files changed: `services/orchestrator/src/projectMutationLane.ts`, its test, `services/orchestrator/src/server.ts`, and `services/orchestrator/src/agent/background.ts`. Foreground sessions, background tasks, file operations, restore, and deletion now share a per-project mutation lease. Checks: 2 mutation-lane tests and orchestrator typecheck. Remaining limitation: the lane is process-local; durable task leases cover worker recovery, but a future multi-orchestrator topology would need distributed project locking.
- **B07 - Fixed.** Files changed: `services/orchestrator/src/collabRoutes.ts`, `services/orchestrator/src/server.ts`, and task/session lifecycle code. Chat deletion now cancels an owned active run/task and closes matching sockets before removing the session, with compare-and-set task cancellation. Checks: collaboration/security tests and orchestrator typecheck. Remaining limitation: no live WebSocket deletion race E2E.
- **B08 - Fixed.** Files changed: `services/orchestrator/src/db/schema.sql`, `services/orchestrator/src/db/agentTasks.ts`, `services/orchestrator/src/collabRoutes.ts`, and `services/orchestrator/src/server.ts`. Tasks now have a non-null creator and atomic leased claim/renew/finish/requeue/cancel lifecycle with heartbeat and restart recovery; disabled workers return 503 instead of accepting stuck work. Checks: `schema.reliability.test.ts` and orchestrator typecheck. Remaining limitation: schema deployment and a live worker process-death drill remain manual.
- **B09 - Fixed.** Files changed: `services/orchestrator/src/db/schema.sql`, `services/orchestrator/src/db/users.ts`, `services/orchestrator/src/auth/guest.ts`, and `services/orchestrator/src/guest/sweeper.ts`. Conversion and expiry cleanup first win an exclusive lifecycle claim; failed teardown retains retryable state rather than deleting files before ownership is established. Checks: schema reliability/auth tests and orchestrator typecheck. Remaining limitation: no live expiry-versus-conversion fault injection.
- **B10 - Fixed.** Files changed: `services/orchestrator/src/storage/client.ts` and `services/orchestrator/src/storage/client.test.ts`. Recursive listing now paginates each directory in stable 1,000-object pages. Checks: multi-page root/nested pagination tests and orchestrator typecheck. Remaining limitation: no live Supabase bucket with more than 1,000 siblings was used.
- **B11 - Fixed.** Files changed: `services/orchestrator/src/db/schema.sql`, `services/orchestrator/src/db/projects.ts`, `services/orchestrator/src/connectors/supabase.ts`, and `services/orchestrator/src/supabase.ts`. Provisioning intent and password are persisted before the remote create; an ambiguous create requires exact `resume_project_ref` rather than a blind duplicate retry. Checks: connector tests and orchestrator typecheck. Remaining limitation: live Supabase ambiguous-response reconciliation needs credentials.
- **B12 - Fixed.** Files changed: `services/orchestrator/src/server.ts`, `services/orchestrator/src/auth/turnstile.ts`, and its test. A generous direct-peer circuit breaker runs before CAPTCHA, while the 30-per-window signup/restore quota is consumed only after a valid Turnstile result; token action, hostname, and length are also verified. Checks: `turnstile.test.ts` (12 tests). Remaining limitation: buckets remain process-local and peer-scoped, but invalid tokens can no longer exhaust the valid-user quota.
- **B13 - Fixed.** Files changed: `services/orchestrator/src/connectors/postgres.ts`, `services/orchestrator/src/connectors/ssrfGuard.ts`, their tests, `services/orchestrator/src/server.ts`, and `services/orchestrator/src/import.ts`. Postgres resolves once, pins the socket lookup, preserves the original TLS hostname, and verifies the connected peer; the GitHub-only clone surface now exact-allows HTTPS `github.com` without credentials or custom ports. Checks: Postgres (2), SSRF (15), and import (25) tests. Remaining limitation: no live public PostgreSQL/TLS credential test.
- **B14 - Fixed.** Files changed: `services/orchestrator/src/firecracker/networkConfig.ts`, its test, `services/orchestrator/src/firecracker/fleet.ts`, `infra/firecracker/host-net.sh`, systemd configuration, and the Firecracker README. Allocation now uses persistent, locked, collision-probing IPAM with stale-lock recovery and release rather than a UUID-derived 16-bit address. Checks: network configuration/IPAM tests, `bash -n`, and orchestrator typecheck. Remaining limitation: concurrent boots on the production Linux bridge still need an operational smoke test.
- **B15 - Needs Manual Validation.** Fix implemented in `services/orchestrator/src/firecracker/fleet.ts` and `infra/firecracker/host-net.sh`: every boot re-verifies effective bridge netfilter and a first peer-drop rule, fails closed when it cannot prove/reassert them, and installs dedicated IPv4/IPv6 deny chains. Checks: all Firecracker shell scripts pass `bash -n` and TypeScript compiles. Required validation: disposable Linux namespace/host fault injection for module, sysctl, rule flush/order, IPv6, and peer connectivity.
- **B16 - Fixed.** Files changed: `services/orchestrator/src/agent/sandbox.ts`, `services/orchestrator/src/agent/background.ts`, `services/orchestrator/src/firecracker/agentRpc.ts`, and both sandbox agents. Commands have IDs, `/exec/kill` terminates the guest process group, and abort waits for termination instead of only abandoning the host RPC. Checks: Node syntax check, Linux-target Cargo check, sandbox/background tests, and orchestrator typecheck. Remaining limitation: a real VM process-tree kill drill is still desirable.
- **B17 - Fixed.** Files changed: `services/orchestrator/src/firecracker/fleet.ts` and `services/orchestrator/src/firecracker/agentRpc.ts`. Every guest RPC acquires an active-operation lease and the idle sweeper skips leased VMs. Checks: orchestrator typecheck and Firecracker unit tests. Remaining limitation: no real long-running RPC versus idle-sweep timing test.
- **B18 - Fixed.** Files changed: `services/orchestrator/src/agent/providers/google.ts` and `services/orchestrator/src/agent/providers/conversion.test.ts`. Gemini replay preserves genuine provider function-call IDs and omits synthetic canonical IDs from both call and response replay. Checks: provider conversion tests and orchestrator typecheck against the current documented Gemini shape. Remaining limitation: no credentialed Gemini canary.
- **B19 - Fixed.** Files changed: `services/orchestrator/src/agent/permissions.ts` and `services/orchestrator/src/agent/permissions.test.ts`. `interact_preview` is now classified from its action: observation/assert/wait/scroll remain read-only, while click/fill/type/select/press/navigate escalate, including dangerous external navigation. Checks: permission suite (17 tests). Remaining limitation: none known in the reported classification path.
- **B20 - Needs Manual Validation.** Fix implemented in `services/orchestrator/src/firecracker/fleet.ts`, `services/orchestrator/src/firecracker/agentRpc.ts`, `services/orchestrator/src/firecracker/pull.ts`, and both sandbox agents. Mount setup verifies `/proc/self/mountinfo`, hydration fails on caps/push errors, stale source paths are reconciled away, cache exclusions are preserved, and a partial boot is cleaned up rather than registered healthy. Checks: pull/sandbox tests, Node syntax check, Linux-target Cargo check, and orchestrator typecheck. Required validation: real Firecracker wrong-image/mount-failure, cap, Nth-push-failure, and exact-manifest fault injection.
- **B21 - Fixed.** Files changed: `apps/web/lib/api.ts`, `apps/web/components/ProjectPicker.tsx`, `apps/web/components/OrgMembersView.tsx`, `apps/web/components/OrgSettingsView.tsx`, and `apps/web/components/OrgUsageView.tsx`. Scoped requests are abortable/generation-owned; rendered data records its org scope, and mutations refuse to run unless that scope matches the current org. Checks: web typecheck. Remaining limitation: controlled reverse-response browser E2E is not available.
- **B22 - Fixed.** Files changed: `services/orchestrator/src/db/designSystems.ts`, `services/orchestrator/src/db/skillLibraries.ts`, `services/orchestrator/src/agent/skills.ts`, and `services/orchestrator/src/server.ts`. Attached resources are resolved by stable attachment ID after project authorization, not by the current actor's ownership. Checks: skills tests and orchestrator typecheck. Remaining limitation: no live collaborator flow.
- **B23 - Fixed.** Files changed: `services/orchestrator/src/db/schema.sql`, `services/orchestrator/src/db/deployments.ts`, `services/orchestrator/src/deploy.ts`, `services/orchestrator/src/vercel.ts`, and `services/orchestrator/src/server.ts`. A durable local `CREATING` intent and unique operation key precede the Vercel POST; remote deployments carry reconciliation metadata and an unfinished-deployment scanner resumes status after restart. Checks: deployment reconciliation tests (2) and orchestrator typecheck. Remaining limitation: no live Vercel crash-window test.
- **B24 - Fixed.** Files changed: `services/orchestrator/src/security/sqlSafety.ts`, its test, `services/orchestrator/src/server.ts`, `services/orchestrator/src/connectors/supabase.ts`, `apps/web/lib/api.ts`, and `apps/web/components/DatabasesView.tsx`. The server structurally classifies SQL, defaults unknown/destructive/procedural/multi-statement operations to confirmation, and requires a short-lived one-shot HMAC token bound to the exact SQL and scope. Checks: SQL safety suite (25 tests), web/orchestrator typechecks. Remaining limitation: the scanner is intentionally conservative rather than a complete PostgreSQL parser.
- **B25 - Fixed.** Files changed: `apps/web/lib/ws-client.ts`, `apps/web/lib/api.ts`, and `apps/web/components/ChatPanel.tsx`. Uploads capture socket generation and project/session draft ownership, abort on navigation, never send through a later global socket, and retain completed uploads with the originating draft. Checks: web typecheck. Remaining limitation: no browser navigation/reconnect upload E2E.
- **B26 - Fixed.** File changed: `apps/web/components/ChatPanel.tsx`. Retry, Resend, Regenerate, and Edit replay the complete user envelope, including attachments, file references, and selected element; missing paths block replay and request reattachment. Checks: web typecheck. Remaining limitation: no component test harness for attachment-only turns.
- **B27 - Fixed.** Files changed: `services/orchestrator/src/db/schema.sql`, `services/orchestrator/src/db/cleanupJobs.ts`, `services/orchestrator/src/server.ts`, `services/orchestrator/src/guest/sweeper.ts`, `services/orchestrator/src/storage/client.ts`, Firecracker fleet/index code, and checkpoints. Deletion writes a durable cleanup outbox before metadata removal, retries after restart, strictly relists/verifies Storage and VM/local/checkpoint cleanup, and returns `202 cleanup_pending` until verified. Checks: schema reliability/storage tests and orchestrator typecheck. Remaining limitation: destructive production Storage/host E2E was not run.
- **B28 - Fixed.** Files changed: `services/orchestrator/src/projectUploadCommit.ts`, its test, `services/orchestrator/src/server.ts`, `apps/web/lib/api.ts`, and `apps/web/components/ChatPanel.tsx`. Each file commits host -> VM -> Storage with reverse rollback after any attempted-stage failure; the API returns exact per-file successes/failures with rollback status (207 for partial results), and the client retains only failed local files for retry while keeping successful attachments. Checks: upload commit suite (5 tests) and both typechecks. Remaining limitation: incomplete remote rollback is explicitly reported, but live Storage/VM failure injection and browser navigation are still manual.
- **B29 - Fixed.** Files changed: `services/orchestrator/src/server.ts` and `services/orchestrator/src/projectMutationLane.ts`. Checkpoint restore holds the project mutation lane, rejects active work, waits for VM/host/Storage convergence, and returns 503 instead of 200 when durability cannot be established. Checks: mutation-lane/checkpoint tests and orchestrator typecheck. Remaining limitation: no live Storage outage/restart restore drill.
- **B30 - Fixed.** Files changed: `services/orchestrator/src/db/schema.sql`, `services/orchestrator/src/db/users.ts`, `services/orchestrator/src/supabase.ts`, `services/orchestrator/src/figma.ts`, and `services/orchestrator/src/oauthRefresh.test.ts`. Refresh uses in-process singleflight plus a database generation compare-and-set; losers use the stored winner and stale `invalid_grant` cannot clear newer credentials. Checks: OAuth refresh suite (3 tests) and orchestrator typecheck. Remaining limitation: live provider rotation behavior was not exercised.
- **B31 - Fixed.** Files changed: `services/orchestrator/src/db/usage.ts`, `services/orchestrator/src/server.ts`, and organization settings/usage UI copy. The product now consistently describes the mechanism as a best-effort soft monthly guard and explicitly warns that concurrent runs/accounting lag can overshoot; behavior is preserved rather than promising a hard cap. Checks: web/orchestrator typechecks. Remaining limitation: a true hard cap would require a distributed reservation/settlement design and was not the selected product contract.
- **B32 - Fixed.** Files changed: `packages/api-types/src/index.ts`, `services/orchestrator/src/server.ts`, `apps/web/lib/ws-client.ts`, and `apps/web/components/ChatPanel.tsx`. Error events identify terminal run failures, auxiliary errors no longer clear busy state, and repeated Stop remains terminating until authoritative server/reconnect state. Checks: web/orchestrator typechecks. Remaining limitation: no slow/lost-abort browser E2E.
- **B33 - Fixed.** Files changed: `apps/web/components/LandingPrompt.tsx` and `apps/web/components/ChatPanel.tsx`. Draft keys now include project plus resolved session, with one-time migration of the legacy default-session key. Checks: web typecheck. Remaining limitation: localStorage-disabled mode still cannot persist text across reload by design.
- **B34 - Fixed.** File changed: `services/orchestrator/src/server.ts`. Reconnect always sends authoritative `todos_updated`, including an empty array, so stale client todos clear. Checks: orchestrator typecheck. Remaining limitation: no live reconnect UI test.
- **B35 - Fixed.** Files changed: `apps/web/lib/citations.ts` and `apps/web/lib/citations.test.ts`. Inline/fenced code is token-protected for every citation strategy, so unanchored `[n]` replacement occurs only in prose. Checks: citation regression suite and web typecheck. Remaining limitation: malformed Markdown remains rendered on a best-effort basis, but code spans/fences are protected.
- **B36 - Fixed.** Files changed: `apps/web/components/EditorPreviewArea.tsx` and `apps/web/components/PreviewPanel.tsx`. Preview panels remount per project/server, duplicate create/revoke actions are disabled, and revoke clears the token/link only after success; failures retain a retryable live URL and show an error. Checks: web typecheck. Remaining limitation: no slow/failing share API component E2E.
- **B37 - Fixed.** Files changed: `apps/web/lib/store.ts`, `apps/web/components/ChatPanel.tsx`, and `apps/web/lib/unsavedWork.test.ts`. `beforeunload` now covers dirty/saving/error buffers plus pending/in-flight attachments; text drafts remain localStorage-backed. Checks: unsaved-work suite (5 tests) and web typecheck. Remaining limitation: browsers control the exact unload prompt UI.
- **B38 - Fixed.** Files changed: `apps/web/components/SkillsModal.tsx`, `apps/web/components/SkillsView.tsx`, and `apps/web/components/SecretsModal.tsx`. Save/load generation and submitted-snapshot guards prevent stale completions from replacing later edits, while conflicting inputs/actions are disabled during mutation. Checks: web typecheck. Remaining limitation: no slow-network modal component E2E.
- **B39 - Fixed.** Files changed: `services/orchestrator/src/agent/sandbox.ts`, `services/orchestrator/src/server.ts`, both sandbox agents, and `services/orchestrator/src/agent/sandboxIo.test.ts`. Write/create paths canonicalize the nearest existing ancestor immediately before the operation and use no-follow semantics so a missing final path cannot escape through a symlinked parent. Checks: symlink regression test, Node syntax check, Linux-target Cargo check, and orchestrator typecheck. Remaining limitation: an `openat2`/dirfd implementation would harden against adversarial rename races further.
- **B40 - Fixed.** Files changed: `services/orchestrator/src/firecracker/networkConfig.ts`, its test, `services/orchestrator/src/firecracker/fleet.ts`, `infra/firecracker/host-net.sh`, systemd configuration, and the README. One validated private `FIRECRACKER_CIDR` now derives gateway, netmask, guest/bootstrap addresses, prefix, reservations, and NAT; conflicting legacy overrides are rejected. Checks: network suite (6 tests), `bash -n`, and orchestrator typecheck. Remaining limitation: alternate CIDRs need a live Linux host smoke test.
- **B41 - Fixed.** Files changed: `services/orchestrator/src/agent/sandbox.ts`, `services/orchestrator/src/firecracker/agentRpc.ts`, `services/orchestrator/src/firecracker/client.ts`, `services/orchestrator/src/firecracker/fleet.ts`, and `services/orchestrator/src/server.ts`. VM `stop_server` now awaits the guest RPC and removes registry state only after confirmed success, leaving failed stops retryable. Checks: orchestrator tests/typecheck. Remaining limitation: no live guest RPC failure injection.
- **B42 - Fixed.** Files changed: `services/orchestrator/src/agent/sandbox.ts` and `services/orchestrator/src/agent/sandboxIo.test.ts`. Host-mode stdout/stderr now use bounded head/tail buffers while the process runs and report omitted bytes. Checks: a 2 MB producer regression plus orchestrator typecheck. Remaining limitation: no long-duration host-mode memory profile.
- **B43 - Fixed.** Files changed: `services/orchestrator/src/agent/sandbox.ts` and `services/orchestrator/src/agent/checkpoints.ts`. `waitForPort` has one settle path that removes timers/listeners on every outcome, and completed checkpoint queue tails delete themselves only when identity still matches. Checks: orchestrator tests/typecheck. Remaining limitation: no process-lifetime heap profile across thousands of projects.
- **B44 - Fixed.** File changed: `apps/web/components/EditorPreviewArea.tsx`. A path change immediately clears the old object URL, aborts the old fetch, ignores aborted completion, and revokes both replaced and late-created URLs. Checks: web typecheck. Remaining limitation: no DOM/object-URL accounting component test.

### Performance and maintainability rows

- **P01 HTTP connector response cap - Fixed.** Files changed: `services/orchestrator/src/connectors/http.ts` and `services/orchestrator/src/connectors/ssrfGuard.test.ts`. Responses are streamed through a 32 KB hard cap, the reader is cancelled at the cap, and truncated bodies are not parsed back into unbounded JSON. Checks: SSRF/stream-cap suite (15 tests). Remaining limitation: no production load profile.
- **P02 Postgres row limit - Fixed.** File changed: `services/orchestrator/src/connectors/postgres.ts`. Requested rows are normalized to 1..5,000 (default 200), row events retain only the cap, and statement/query timeouts bound execution. Checks: Postgres tests, orchestrator typecheck. Remaining limitation: no live large-result database test.
- **P03 ZIP and knowledge buffering - Fixed.** Files changed: `services/orchestrator/src/server.ts`, `services/orchestrator/src/import.ts`, and `services/orchestrator/src/import.test.ts`. Hard per-file/count/aggregate caps now bound project ZIP (50 MB), knowledge (25 MB/file, 10 files, 50 MB total), design analysis (25 MB/file, 60 MB total), design ZIP (100 MB/one file), and archive entry/count/uncompressed expansion. Checks: import suite (25 tests), including oversize and zip-bomb cases. Remaining limitation: data is still buffered within those hard caps, so peak-memory/concurrency load testing is advisable.
- **P04 Collaboration payloads - Fixed.** Files changed: `services/orchestrator/src/collabRoutes.ts` and `services/orchestrator/src/collabRoutes.security.test.ts`. Email, comments/targets, task fields, flow fields, step counts, and serialized flow size now have domain-specific caps well below the global JSON limit. Checks: collaboration security suite (8 tests) and orchestrator typecheck. Remaining limitation: no production rate/load test.
- **P05 `server.ts` concentration - False Positive.** The row is a valid architectural observation but line count alone is not a reproducible correctness, security, or performance defect. A broad extraction would violate this remediation's targeted-change constraint; the invariants that required isolation were extracted into focused modules such as `projectMutationLane.ts`, `projectUploadCommit.ts`, `networkConfig.ts`, `cleanupJobs.ts`, `publicError.ts`, and `sqlSafety.ts`. No remaining functional claim from this row is unaddressed.
- **P06 Rust/Node sandbox parity - Needs Manual Validation.** Mirrored endpoints were updated in both `services/sandbox-agent/src/main.rs` and `services/sandbox-agent/src/agent.mjs`; the Node agent passes syntax checks and the Rust agent passes a Linux-target Cargo check. Required validation: run one protocol contract suite against both live implementations; the repository still lacks that cross-implementation harness.

### Dependency findings

- **D01 Next/PostCSS advisory - Fixed.** Files changed: root/web manifests and `package-lock.json`. Next is 15.5.20 and PostCSS resolves to 8.5.19 through the root override. Checks: clean `npm ci`, dependency tree inspection, zero-advisory `npm audit --json`, web production build, and web typecheck. Remaining limitation: future lockfile changes are guarded by the new `.github/workflows/security.yml` audit job.
- **D02 protobufjs through `@google/genai` - Fixed.** Files changed: manifests and `package-lock.json`. `@google/genai` is 2.11.0 and `protobufjs` is 7.6.5. Checks: clean install, dependency tree inspection, zero-advisory audit, provider/orchestrator checks. Remaining limitation: no live Gemini credentialed canary.
- **D03 esbuild development advisory - Fixed.** Files changed: manifests and `package-lock.json`. esbuild resolves to 0.28.1. Checks: clean install, zero-advisory audit, typechecks, and web production build. Remaining limitation: the advisory affected development tooling; CI now re-runs the audit to catch regressions.

### Bug-report disposition summary

- Total findings reviewed: **53** (44 numbered, 6 performance/maintainability, 3 dependency).
- Fixed: **49**.
- Already Resolved: **0**.
- False Positive: **1** (`server.ts` line-count concentration as a standalone defect).
- Blocked: **0**.
- Needs Manual Validation: **3** (B15 effective Firecracker isolation, B20 real mount/hydration invariants, P06 live Rust/Node protocol parity).
- Remaining risk is concentrated in production-equivalent Linux/Firecracker, external-provider crash windows/canaries, browser race E2E, and load/fault-injection coverage; each fixed item above records its narrower validation limit.
