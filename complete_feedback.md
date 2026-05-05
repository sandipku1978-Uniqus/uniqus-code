
# Review of Backend Codebase / raw underlying code.

::code-comment{title="[P1] Credentialed CORS reflects any origin" body="The API reflects the request Origin while also allowing credentials. Combined with cookie auth and state-changing POST/DELETE routes, this needs a strict origin allowlist and CSRF/origin checks, including WebSocket upgrades." file="C:/Users/thech/OneDrive/Desktop/general projects/uniqus-code/services/orchestrator/src/server.ts" start=164 end=169 priority=1 confidence=0.86}

::code-comment{title="[P1] Weak sandbox path check" body="`readSandboxFile` uses `full.startsWith(rootDir)`, which can be bypassed by sibling paths with the same prefix. Reuse the stricter sandbox path resolver pattern that checks `root + path.sep`." file="C:/Users/thech/OneDrive/Desktop/general projects/uniqus-code/services/orchestrator/src/server.ts" start=1020 end=1024 priority=1 confidence=0.84}

::code-comment{title="[P2] Busy auto-save can strand edits" body="When the agent is busy, `flushSave` marks the file dirty and returns, but there is no retry when the agent goes idle. A user can believe auto-save will resume while edits remain only in client state." file="C:/Users/thech/OneDrive/Desktop/general projects/uniqus-code/apps/web/lib/store.ts" start=345 end=353 priority=2 confidence=0.9}

::code-comment{title="[P2] Disconnected sends are silently dropped" body="`send` no-ops when the socket is not open. Chat submit still appends the user message and sets busy before calling it, so a disconnect can leave the UI stuck waiting for a message the server never received." file="C:/Users/thech/OneDrive/Desktop/general projects/uniqus-code/apps/web/lib/ws-client.ts" start=77 end=80 priority=2 confidence=0.88}

::code-comment{title="[P2] File tabs do not drive editor content" body="The active file tab is computed, but `CodeEditor` receives no path and reads `selectedFile` from global state. Clicking an already-open tab changes the active tab styling without necessarily loading or showing that file." file="C:/Users/thech/OneDrive/Desktop/general projects/uniqus-code/apps/web/components/EditorPreviewArea.tsx" start=123 end=125 priority=2 confidence=0.87}

::code-comment{title="[P2] Import rollback is missing" body="GitHub import creates the project before cloning, but the catch block only returns an error despite the rollback comment. Failed imports leave stale project rows/directories; ZIP import has the same pattern." file="C:/Users/thech/OneDrive/Desktop/general projects/uniqus-code/services/orchestrator/src/server.ts" start=280 end=299 priority=2 confidence=0.91}

**Key Findings**
- The biggest risks are backend/security-oriented: public preview URLs, permissive credentialed CORS, no visible CSRF/origin enforcement, and one weak file-read sandbox boundary.
- GitHub import accepts arbitrary clone URLs and has no clone size cap. That can become SSRF/local-file/network access or disk exhaustion if this is multi-user production-facing.
- Preview tab close only removes the tab locally, while a DELETE stop-server API exists but is unused. That can leave dev servers running until restart/run/agent cleanup.
- Production defaults are fragile: web API defaults to `http://<hostname>:8787` and WS defaults to `ws://<hostname>:8787`, which will fail under HTTPS unless env vars are always set.
- The repo currently tracks `.next` and `apps/web/tsconfig.tsbuildinfo`; `.gitignore` does not ignore `.next/` or `*.tsbuildinfo`, which explains the noisy generated-file status.

**Link/Route Map**
- Marketing `/`: logo routes to `/`; nav anchors route to in-page sections; signed-out CTAs route to `/login`; signed-in CTAs route to `/projects`; “Talk to sales” and footer links are `href="#"` no-ops.
- Dashboard `/projects`: project cards route to `/projects/:id`; sign out routes to `/api/signout`; sidebar items like Home, All projects, Recent, Deployments, Datasets are static divs, not links.
- Workspace `/projects/:id`: Run calls `POST /api/projects/:id/run`; file tree uses WS `request_tree` and `request_file`; chat uses WS `user_message`; preview opens `${ORCHESTRATOR_URL}/preview/:serverId/`.

**Checks**
- TypeScript passed for both workspaces using no-write flags: `@uniqus/web` and `@uniqus/orchestrator`.
- I did not run builds or app scripts that could touch `.next`.
- No lint/test scripts are present beyond typecheck, so edge-case confidence is from static review rather than runtime tests.

# Review of UI/UX

I did a read-only review from the app source. I did not create, edit, or remove files. The app was not running on `4242`, `3000`, or `8787`, and I avoided starting Next dev because that could mutate `.next`, so this is a source-grounded UX review rather than a live visual/browser pass.

**Overall Take**

This is a strong, serious builder shell. It feels more “AI engineering workbench” than “toy builder,” which is a good direction if the target user is a founder, engineer, consultant, or enterprise buyer. The Replit influence is clear in the chat/editor/files/terminal/preview concept, but the product’s real differentiation is not Replit-style playfulness; it is the agent workflow, plan review, import flow, and trust posture.

The biggest UX gap: the shell looks capable, but several key surfaces are still too quiet, too hidden, or too implied. A builder product needs to make state, progress, control, and recovery painfully obvious.

**What’s Working Well**

- The dark workbench aesthetic is cohesive and professional.
- The three-pane workspace model makes conceptual sense: chat, files, editor/preview, terminal.
- Plan mode is a genuinely strong differentiator.
- Monaco integration, autosave, dirty state, preview tabs, and tool-call cards give the app a “real IDE” foundation.
- The marketing page has a confident tone and avoids generic AI sparkle.
- The project import options, blank/zip/GitHub, are exactly right for this category.

**Main UX Issues**

- The workspace may feel empty at first because files and terminal default off. For a Replit-inspired builder, I’d show the file tree by default or provide a stronger first-run layout.
- The `Run` button is underspecified. Users need visible server state: stopped, starting, running on port, failed, restart available.
- “Terminal” currently behaves more like a log viewer. If users cannot type commands, calling it “Terminal” overpromises.
- The file explorer is functional but thin: no file icons, create/rename/delete, search, context menu, or quick-open.
- The preview panel needs error, loading, device size, and server-down states. Reload/open-tab alone is bare minimum.
- Chat blocks are good, but tool cards are very compressed. They need duration, clearer progress, and better expansion affordances.
- While the agent is busy, the composer disables input except Stop. For builder UX, users often want to steer, queue, or interrupt.
- Project picker sidebar items like Recent, Deployments, and Datasets look interactive but appear non-functional. That creates dead-end friction.
- The GitHub/zip import flow needs progress, validation, and a more polished file picker/dropzone.
- The native `confirm()` for clearing chat breaks the otherwise polished UI.

**Visual Design**

The visual system is tasteful: warm dark surfaces, restrained borders, compact type, and a clear purple/magenta brand accent. It feels closer to Linear plus Replit than Replit itself. I like that.

That said, the palette may be too muted in functional areas. Some microcopy and inactive labels likely have contrast issues. The brand gradient is used on primary buttons, avatars, and the status bar; I’d reduce it in utility surfaces so important operational states stand out more than brand decoration.

**Marketing Page**

The hero and IDE mock are effective, but the page leans text-heavy after the first viewport. The fake IDE preview helps, but I would add one or two more concrete product visuals or workflow captures.

Also, claims like “SOC 2 II,” “42 sec median,” and “audit-grade” are high-trust claims. If they are real, make them feel evidenced. If aspirational, soften them. The “Talk to sales” link currently appears dead, which hurts trust.

**Dashboard / Project Picker**

The import modes are good. The problem is hierarchy: project name, repo URL, branch, PAT, and upload states are packed into a compact form without enough sense of process. For GitHub clone especially, I’d make it feel like a guided import: repo URL first, optional advanced fields, then progress.

There is also a small styling issue: one input style references `var(--bg-elev)`, but the design tokens define no `--bg-elev`. It probably falls back visually, but that kind of inconsistency can make forms feel slightly off.

**Workspace**

This is the core product, and the bones are good. The topbar, resizable panels, status bar, tabs, and preview routing all fit the category.

But the user needs more control affordances: run history, server status, stop server, restart, open logs, sync state, branch/source state, and recovery from agent changes. Right now it says “builder,” but it does not yet fully say “you are safe and in control.”

**Accessibility / Responsiveness**

The global focus style is a good start. But many icon buttons rely on `title` instead of explicit accessible labels. The project tabs use `role="tab"`, but there is no full tab/tabpanel keyboard model. The file explorer is visually a tree but semantically just nested buttons.

Mobile is the biggest unknown/risk. Marketing has breakpoints, but the dashboard and IDE workspace likely need a deliberate mobile/tablet model: single-pane tabs, bottom navigation, and mode switching.

**Highest-Priority Improvements**

1. Make the workspace immediately useful: show files by default, improve empty states, and expose run/server status.
2. Rename or upgrade Terminal: either make it interactive or call it Logs.
3. Add import progress and polish the GitHub/zip create flow.
4. Improve agent control: queue/interrupt messages, richer tool progress, clear recovery/undo path.
5. Add basic IDE affordances: file search, file actions, quick open, preview error/device controls.
6. Clean up non-functional nav, dead links, undefined tokens, and accessibility labels.

My honest read: this is a very promising shell with good taste. The next UX leap is not making it prettier; it is making every important system state legible. Builder tools live or die on whether users feel momentum and control at the same time.
