# Gate 15 comprehensive UI/UX audit

**Audit date:** 14 July 2026  
**Repository:** Gate 15 monorepo  
**Primary surface:** <code>apps/web</code>  
**Target:** WCAG 2.2 AA, Nielsen usability heuristics, WAI-ARIA Authoring Practices, current Next.js accessibility guidance, responsive web conventions, and Gate 15's own design language  
**Audit type:** Live public-surface review plus source-level review of every route, reusable UI component, protected workflow, state, and role path

> This is a product and engineering audit, not a formal WCAG conformance certification. “Confirmed” means reproduced in the running app, proven by the current implementation, or both. Items marked “risk” or “opportunity” require the stated validation before being treated as a defect.

## 1. Application map: routes, screens, technologies, design system, and components

### 1.1 Technologies found

| Area | Implementation |
|---|---|
| Web framework | Next.js App Router and React 19: <code>apps/web/package.json:5-26</code> |
| Styling | Tailwind CSS 3.4 plus a large custom token/component layer; no third-party UI kit or Tailwind plugins: <code>apps/web/tailwind.config.ts:13-64</code>, <code>apps/web/app/globals.css:8-173</code> |
| Typography | Archivo for interface/content and JetBrains Mono for technical metadata: <code>apps/web/app/layout.tsx:1-20</code> |
| Client state | Zustand persistence for theme, density, model, active workspace, workspace view, and panel layout: <code>apps/web/lib/store.ts:32-498</code> |
| Complex UI | Monaco editor, resizable panels, React Markdown, and GFM: <code>apps/web/package.json:12-24</code> |
| Authentication | WorkOS AuthKit for standard accounts; iron-session for guest sessions; Cloudflare Turnstile for guest creation and restore |
| Product APIs | Next route handlers relay to the orchestrator; project execution, deploy, collaboration, provider keys, integrations, and guest enforcement live primarily under <code>services/orchestrator</code> |

There are **21 page entry files** and **62 TSX component files** under the web application.

### 1.2 Design system found

Gate 15 uses a bespoke “ember and signal” system rather than a packaged component library:

- Cold industrial dark and light surfaces, ember orange as the single active accent, signal yellow as a sparse highlight, and red/amber/green semantic confidence colors.
- Archivo and JetBrains Mono with a documented whole-pixel type ramp.
- Compact machined radii, restrained elevation, a hazard-rule motif, and 120/200/300 ms motion tokens.
- Global dark/light themes, comfortable/compact density, reduced-motion handling, focus tokens, and semantic contrast ramps.
- Shared buttons, inputs, selects, modal, popover, tooltip, toast, skeleton, and coachmark patterns are mostly implemented in <code>apps/web/app/globals.css</code> and <code>apps/web/components</code>.

Canonical guidance: <code>docs/design-language.md</code>. Live tokens: <code>apps/web/app/globals.css:8-173</code>. Reduced motion: <code>apps/web/app/globals.css:6813-6823</code>.

### 1.3 Route and page inventory

| Route | User-facing screen | Primary source |
|---|---|---|
| <code>/</code> | Landing page, primary brief composer, product story, plans, models, workspace mock, trust content, closing composer | <code>apps/web/app/page.tsx:20-190</code> |
| <code>/pricing</code> | Solo/Team/Enterprise tiers, comparison, FAQ | <code>apps/web/app/(marketing)/pricing/page.tsx:120-241</code> |
| <code>/models</code> | Auto mode, model/provider catalog, reasoning controls, comparison | <code>apps/web/app/(marketing)/models/page.tsx:222-540</code> |
| <code>/workspaces</code> | Workspace architecture and private-machine narrative | <code>apps/web/app/(marketing)/workspaces/page.tsx:119-356</code> |
| <code>/enterprise</code> | Enterprise controls, collaboration, security, contact CTAs | <code>apps/web/app/(marketing)/enterprise/page.tsx:230-352</code> |
| <code>/security</code> | Security model, architecture diagram, trust FAQ | <code>apps/web/app/(marketing)/security/page.tsx:159-282</code> |
| <code>/templates</code> | Public template gallery and categories | <code>apps/web/app/(marketing)/templates/page.tsx:14-94</code> |
| <code>/docs</code> | Creation, workspace, agent, run, files, config, ship, recovery, prompts, troubleshooting | <code>apps/web/app/(marketing)/docs/page.tsx:261-682</code> |
| <code>/changelog</code> | Release history and commit links | <code>apps/web/app/(marketing)/changelog/page.tsx:880-927</code> |
| <code>/about</code> | Company rationale, principles, infrastructure, careers/contact CTAs | <code>apps/web/app/(marketing)/about/page.tsx:117-226</code> |
| <code>/careers</code> | Roles and email-based application flow | <code>apps/web/app/(marketing)/careers/page.tsx:150-251</code> |
| <code>/blog</code> | Featured article and article grid | <code>apps/web/app/(marketing)/blog/page.tsx:10-76</code> |
| <code>/blog/[slug]</code> | Static article detail and not-found handling | <code>apps/web/app/(marketing)/blog/[slug]/page.tsx:5-68</code> |
| <code>/contact</code> | Contact form and alternative contact methods | <code>apps/web/app/(marketing)/contact/page.tsx:93-155</code>, <code>apps/web/components/ContactForm.tsx:10-149</code> |
| <code>/support</code> | Support topics, docs, contact escalation | <code>apps/web/app/(marketing)/support/page.tsx:349-414</code> |
| <code>/community</code> | Discord, templates, community channels | <code>apps/web/app/(marketing)/community/page.tsx:160-218</code> |
| <code>/status</code> | System status and operational history | <code>apps/web/app/(marketing)/status/page.tsx:24-104</code> |
| <code>/login</code> | WorkOS sign-in entry, guest creation, guest restore | <code>apps/web/app/login/page.tsx:7-43</code>, <code>apps/web/components/GuestLoginActions.tsx:19-322</code> |
| <code>/projects</code> | Authenticated/guest dashboard and guest conversion | <code>apps/web/app/projects/page.tsx:7-48</code> |
| <code>/projects/[id]</code> | Main build workspace | <code>apps/web/app/projects/[id]/page.tsx:6-29</code> |
| <code>/settings</code> | Account, integrations, appearance, models, prompts, skills, provider keys | <code>apps/web/app/settings/page.tsx:13-38</code> |

The marketing subroutes share <code>apps/web/app/(marketing)/layout.tsx:7-65</code>. The root landing page is outside that route group and duplicates its own navigation.

There are no local <code>/signup</code>, <code>/forgot-password</code>, <code>/billing</code>, or checkout pages. WorkOS appears to own signup/password recovery; billing is not represented by an equivalent product surface.

### 1.4 In-app screens that are not routes

<code>ProjectPicker</code> implements eleven dashboard destinations through local component state rather than routes:

- Home, Templates, All projects, Recent
- Databases, Design Systems, Skills, Knowledge
- Organization Members, Organization Usage, Organization Settings

Evidence: view union/default at <code>apps/web/components/ProjectPicker.tsx:368-397</code>, navigation at <code>:911-1184</code>, view dispatch at <code>:1202-1237</code>.

The dashboard also contains the brief/ZIP/GitHub project creator, model/design-system/plan choices, project loading/empty/error states, project tiles and actions, search/filter/sort, recent activity, resource editors, organization administration, and rename/icon/delete/repository/organization dialogs.

The project workspace contains:

- Desktop Preview/Code shell: <code>Workspace.tsx:531-573</code>
- Run, deploy, GitHub, skills, secrets, rewind, collaborators, comments, and tasks: <code>Workspace.tsx:317-628</code>
- Six mobile panes—Chat, Code, Preview, Activity, Files, Logs: <code>Workspace.tsx:775-852</code>
- Plan review/document takeover: <code>Workspace.tsx:1205-1260</code>
- Live Preview, Agent Preview, Activity stage tabs: <code>Workspace.tsx:1275-1345</code>
- Multi-session streaming chat, tools, plans, attachments, permissions, model, effort, voice, stop/send: <code>ChatPanel.tsx:833-1467,1960-2230</code>
- Monaco editor/tabs, file tree CRUD/search/drag/context actions, terminal/logs
- Responsive preview, URL navigation, runtime errors, element picker, annotations, screenshots, sharing
- Deploy/Vercel, GitHub, members, comments, durable agent tasks, checkpoints, secrets, and skills

Settings is one local screen with Account, GitHub, Supabase, Figma, Appearance, Default model, Custom prompts/default skills, and BYOK provider keys: <code>apps/web/components/SettingsView.tsx:253-492</code>.

### 1.5 Reusable component inventory

| Family | Components |
|---|---|
| Public chrome | <code>BrandLockup</code>, <code>MarketingNav</code>, <code>NavExploreMenu</code>, <code>SiteFooter</code>, <code>LandingPrompt</code> |
| Authentication/guest | <code>GuestLoginActions</code>, <code>GuestBanner</code>, <code>Turnstile</code> |
| Shared primitives | <code>Modal</code>, <code>Popover</code>, <code>Tooltip</code>, <code>Toaster</code>, <code>Skeleton</code>, <code>Coachmark</code>, <code>MicButton</code> |
| Dashboard/resources | <code>ProjectPicker</code>, <code>WorkspaceSwitcher</code>, <code>TemplatesView</code>, <code>DatabasesView</code>, <code>DesignSystemsView</code>, <code>SkillsView</code>, <code>KnowledgeView</code>, organization views |
| Workspace | <code>Workspace</code>, <code>ChatPanel</code>, <code>ChatSessionDropdown</code>, <code>EditorPreviewArea</code>, <code>PreviewPanel</code>, <code>AgentPreviewPanel</code>, <code>PreviewAnnotator</code>, <code>ActivityMonitor</code>, <code>CodeEditor</code>, <code>FileExplorer</code>, <code>TerminalPanel</code>, plan/todo/subagent views |
| Shipping/collaboration | <code>DeployButton</code>, <code>GithubRepoButton</code>, <code>MembersView</code>, <code>CommentsView</code>, <code>TasksView</code>, <code>CheckpointsModal</code>, <code>SecretsModal</code>, <code>SkillsModal</code> |
| Settings | <code>SettingsView</code>, <code>AppearanceCard</code>, <code>CustomPromptsCard</code>, <code>ProviderKeysCard</code>, <code>ModelPicker</code>, <code>PermissionModePicker</code> |

### 1.6 Roles and permission model

| Role | Effective experience |
|---|---|
| Anonymous | Marketing and login; protected routes redirect to WorkOS |
| Guest | Personal projects and recovery; no organization, provider integration, GitHub, or publishing capabilities |
| Standard personal account | Persistent projects, integrations, deploy/GitHub, resource libraries, organizations |
| Project viewer/editor/admin/owner | Shared hierarchy exists server-side; viewer reads, editor comments/tasks/flows, admin manages membership |
| Organization member/admin/owner | Admins manage identity/budgets/membership; owner handles ownership/destruction |

The shared hierarchy is defined at <code>packages/api-types/src/index.ts:1651-1666</code> and enforced in <code>services/orchestrator/src/collabRoutes.ts:57-459</code>. A major audit theme is that the UI does not consistently receive or apply those effective capabilities before showing controls.

### 1.7 Primary user journeys

1. Marketing discovery → brief or sign-in → guest or WorkOS account.
2. Guest creation/restore → save recovery code → create/build → convert to a standard account.
3. Create a project from a brief with attachments, model, design system, and plan mode.
4. Import existing code from ZIP or GitHub.
5. Core build loop: prompt → plan approval → agent activity → code/preview → correction.
6. Run/debug/inspect/annotate the generated app.
7. Publish to Vercel and hand off to GitHub.
8. Recover through reconnect, checkpoints, rewind, or route error states.
9. Collaborate through project/org members, comments, tasks, and roles.
10. Configure account appearance, models, prompts, skills, provider keys, and integrations.
11. Manage databases, design systems, skills, and knowledge.
12. Rename, disconnect, unlink, remove, leave, delete, and restore.

## 2. Audit method and coverage

### 2.1 Live review

The repository service was launched with <code>notes/start-local-dev.py --no-browser</code>. A standalone Playwright/Microsoft Edge session was used after the in-app browser runtime failed to initialize.

Public routes reviewed live at **1440×900**, **768×1024**, and **390×844**:

<code>/</code>, <code>/pricing</code>, <code>/models</code>, <code>/workspaces</code>, <code>/templates</code>, <code>/changelog</code>, <code>/about</code>, <code>/enterprise</code>, <code>/careers</code>, <code>/blog</code>, <code>/contact</code>, <code>/docs</code>, <code>/security</code>, <code>/support</code>, <code>/community</code>, <code>/status</code>, and <code>/login</code>.

Observed strengths:

- No horizontal page overflow at any of the three viewports on any tested public route.
- Public page reflow, spacing, and visual hierarchy are generally coherent and on-brand.
- Focus rings are visible on standard links and buttons.
- Native contact-field required validation focuses the first invalid field.
- Dark neutral text ramps, light-theme text tokens, reduced motion, and pre-paint theme/density hydration are unusually deliberate.
- Shared <code>Modal</code> implements focus trapping, Escape, scroll lock, stacked dialogs, and focus restoration.
- Workspace source includes reconnect/offline feedback and keeps mobile panes mounted to preserve editor/chat/preview state.

Protected routes <code>/projects</code>, <code>/projects/example</code>, and <code>/settings</code> redirected to WorkOS. The hosted page was visually reviewed, but Cloudflare Turnstile remained in “Verifying you’re human…” and prevented guest entry, as anticipated. Protected screens were therefore audited from current source, component state machines, API contracts, and permission enforcement rather than represented as visually confirmed.

### 2.2 Automated and manual accessibility checks

Axe-core 4.10.3 was run on the live public routes. Results:

| Route | Axe findings |
|---|---|
| <code>/</code> | Heading order (1), complementary landmark not top-level (2), main landmark not top-level (1), duplicate main (1), landmark uniqueness (2), nested interactive (1 serious) |
| <code>/models</code> | Heading order (1) |
| <code>/changelog</code> | Heading order (1) |
| <code>/blog</code> | Heading order (1) |
| <code>/status</code> | Missing page-level heading (1) |
| Other tested public routes | No axe violations in the default dark state |

Manual checks included keyboard Tab order, focus visibility, control naming, semantic structure, touch target dimensions, horizontal overflow, native form validation, responsive navigation, and source review of focus management/ARIA patterns. Automated zeroes are not treated as proof of accessibility.

### 2.3 State and edge-case coverage

| State class | Surfaces inspected | Audit outcome |
|---|---|---|
| Global loading | <code>apps/web/app/loading.tsx:7</code> | Spinner-only but bounded; no failure found. Add meaningful label if typical waits exceed a brief route transition. |
| Project loading | <code>apps/web/app/projects/[id]/loading.tsx:8</code> | Includes a user-facing label; positive baseline. |
| Recoverable/fatal errors | <code>apps/web/app/error.tsx:16</code>, <code>global-error.tsx:28</code>, <code>projects/[id]/error.tsx:15</code> | Clear retry/reload actions are present; positive baseline. Raw error detail should be reviewed before exposing production messages. |
| 404 | <code>apps/web/app/not-found.tsx:8</code> | Recovery exists; role-unaware action priority is F44. |
| Empty/loading/error lists | Projects, Tasks, Comments, resources, integrations | Project list states are comparatively explicit; several secondary screens collapse errors into empty/disconnected (F18, F35). |
| Disabled/pending | Guest, deploy, settings saves, dialogs, task creation | Busy states are common, but disabled Turnstile lacks recovery (F06) and some mutations lack scoped feedback (F16, F37). |
| Success | Toasts, settings saves, contact, deploy/task states | Many actions acknowledge completion; Contact reports success too early (F31), and task queue success overstates execution (F17). |
| Permission denied | Middleware, server RBAC, workspace/org actions | Enforcement exists server-side; pre-action UI capability communication is incomplete (F12). |
| Offline/reconnect | <code>ChatPanel.tsx:1006-1059</code>, <code>Workspace.tsx:898-912</code> | Reconnect/offline messaging is a product strength; integration/read errors still need distinct unknown states. |
| Destructive | Project, org, member, database, design system, checkpoint, secret, integration | Project typed confirmation and shared Modal are positive patterns; consequence copy, live deployment handling, and consistency need F14/F15/F37. |
| Form validation | Contact, login/guest recovery, settings/resource editors | Native required validation works on Contact; label/error/status and delivery issues are covered by F28/F31. |
| Theme/density/motion | Dark/light, comfortable/compact, reduced motion | Pre-paint hydration and neutral token ramps are strong. Foreground/fill contrast and narrow reflow still fail in localized components (F27/F29). |

### 2.4 Standards and classification

- WCAG 2.2 AA is the conformance target.
- WAI-ARIA APG is used for menu, listbox/combobox, tree, radio, tab, and dialog behavior.
- Nielsen heuristics are used for system status, real-world language, control/freedom, consistency, error prevention, recognition, recovery, and help.
- Next.js guidance is used for route announcements, unique titles/headings, and built-in accessibility linting expectations.
- Gate 15's design language is used for theme contrast, near-black ink on bright fills, <code>--accent-text</code> foregrounds, type scale, iconography, and motion.

Primary references: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/), [Nielsen's 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/), and [Next.js accessibility guidance](https://nextjs.org/docs/architecture/accessibility).

**Finding type legend**

- **Confirmed usability problem:** current flow or code predictably impedes completion/recovery.
- **Accessibility violation:** source or rendered behavior fails a testable WCAG requirement.
- **Visual inconsistency:** deviates from the product's documented system.
- **Conversion/trust risk:** promise, consent, security, billing, or funnel behavior can undermine confidence or revenue.
- **Responsive-design issue:** touch, reflow, clipping, or mobile navigation problem.
- **Product opportunity:** not a defect, but a material findability/scaling improvement.
- **Subjective preference:** aesthetic judgment with no demonstrated usability or system basis. No subjective preference is ranked above Low.

## 3. Executive summary

Gate 15's public visual foundation is considerably stronger than its workflow integrity. The marketing pages are cohesive, responsive at the tested viewports, distinctive, and supported by a thoughtful dark/light token system. The core product also has unusually broad capability—planning, live preview, code, activity, comments, tasks, checkpoints, secrets, integrations, deployment, design systems, skills, knowledge, and organizations.

The principal risk is that several interfaces **promise or imply an outcome the implementation does not reliably deliver**:

- A deploy helper can replace a valid stored production secret with an empty value.
- “Start a Team trial” stops at generic sign-in, with no billing/checkout or resumed plan intent.
- Auto-routing marketing names providers that the router explicitly excludes.
- “Invite” only adds people who already have accounts.
- Agent Tasks accepts work even though the worker is off by default.
- Contact reports success after launching a mail client, even if no message is sent.
- Organization leave/delete copy contradicts actual ownership behavior.
- Project deletion can leave the public Vercel site live.

The second major risk is accessibility in the highest-value product controls. Public keyboard basics are mostly sound, but the landing composers lose focus visibility; protected UI source shows incomplete portaled menus, an unlabeled core chat composer, invalid editor-tab actions, a drag-only file move, invalid tree focus semantics, custom overlays without dialog behavior, and systemic light-theme/filled-control contrast failures.

The third major risk is information architecture. The dashboard's eleven destinations are local state rather than navigable URLs, the mobile dashboard becomes a long unlabeled horizontal strip, and the workspace layers Preview/Code, Live/Agent/Activity, editor tabs, topbar overflow, and six mobile tabs. The product has enough capability; it needs a clearer shell and stronger state/permission communication more than more features.

### Severity summary

| Severity | Count in detailed findings | Interpretation |
|---|---:|---|
| Critical | 1 | Can break a production deployment through a normal UI path |
| High | 29 | Material task-completion, trust, conversion, privacy, responsive, or WCAG barrier |
| Medium | 12 | Meaningful friction, incomplete pattern, or localized risk |
| Low | 2 | Polish/consistency with limited immediate task impact |
| Informational | 2 | Forward-looking product/testing opportunity |

No evidence supports a blanket claim that the application is unusable or visually poor. The strongest public pages pass basic responsive and automated checks. The severity is concentrated in protected workflows and the gap between what the interface says and what the system does.

## 4. Prioritized findings table

| ID | Severity | Type | Finding | Primary journey |
|---|---|---|---|---|
| F01 | Critical | Confirmed workflow/data-safety defect | Stored-secret picker can blank a real production credential | Deploy |
| F02 | High | Privacy/trust risk | Confidential first prompts are put in the URL | Create project |
| F03 | High | Trust/visual inconsistency | Hosted sign-in still presents legacy Uniqus-Code branding | Authentication |
| F04 | High | Conversion/trust risk | Team trial and billing promises do not have a completion flow | Pricing → paid |
| F05 | High | Product-claim mismatch | Pricing overstates Auto-routing provider coverage | Model evaluation |
| F06 | High | Error-recovery/conversion | Blocked Turnstile leaves guest entry permanently disabled | Guest entry/restore |
| F07 | High | Trust/legal risk | Legal, abuse, social, and login-consent destinations are placeholders | Evaluation/sign-in |
| F08 | High | Responsive/conversion | Mobile marketing navigation removes all discovery links | Mobile acquisition |
| F09 | High | Navigation/IA | Dashboard destinations have no URL, history, or deep-link state | Dashboard navigation |
| F10 | High | IA/task completion | Workspace exposes overlapping modes and six mobile panes | Core build loop |
| F11 | High | Responsive/IA | Mobile dashboard becomes a long unlabeled horizontal nav strip | Mobile dashboard |
| F12 | High | Permission usability | Workspace/admin actions are exposed without effective-role gating | Collaboration |
| F13 | High | Team activation | “Invite” only direct-adds existing accounts | Add teammate |
| F14 | High | Destructive/trust | Organization leave/delete assurances contradict backend behavior | Org exit/delete |
| F15 | High | Destructive/trust | Deleting a project can leave its public Vercel site live | Project deletion |
| F16 | High | Error feedback | Project edit/delete failures are hidden behind dialogs | Project management |
| F17 | High | Product integrity | Durable Tasks accepts work that normally never runs | Agent Tasks |
| F18 | High | State/trust | Integration and BYOK failures are mislabeled as disconnected/platform-key | Settings/integrations |
| F19 | High | Workflow continuity | GitHub OAuth drops project and action context | Connect GitHub |
| F20 | High | Data-safety | Custom prompts load failure can enable an empty overwrite | Settings |
| F21 | High | Accessibility | Portaled menus do not move/restore focus or implement menu keys | Navigation/pickers |
| F22 | High | Accessibility | Core chat input/suggestions and streaming output lack correct semantics | Build conversation |
| F23 | High | Accessibility | Editor tab save/close/stop actions are nested mouse-only spans | Code editing |
| F24 | High | Accessibility | File move is drag-only and the file tree focus model is invalid | File management |
| F25 | High | Accessibility | Custom overlays bypass the accessible shared modal | Destructive/quick open |
| F26 | High | Accessibility | High-value controls remove visible focus indicators | Keyboard use |
| F27 | High | Accessibility | Filled controls and light-theme foreground colors fail contrast | Both themes |
| F28 | High | Accessibility | Forms and complex inputs lack durable programmatic labels | Forms/build/settings |
| F29 | High | Accessibility/responsive | Shared modals and complex editor grids do not reflow at narrow/zoomed widths | Mobile/zoom |
| F30 | High | Accessibility | Decorative landing mock leaks duplicate landmarks and nested controls | Landing |
| F31 | Medium | Conversion | Contact “Send message” only launches an email draft | Contact |
| F32 | Medium | Trust/content | Guest storage copy misstates where work is saved | Guest onboarding |
| F33 | Medium | Collaboration | Checkpoint/PR comments cannot identify an actual artifact | Review/comments |
| F34 | Medium | Accessibility | Composite radio/tab/tooltip/annotation patterns are incomplete | Settings/preview/data |
| F35 | Medium | Error states | Tasks/comments/integration load failures masquerade as empty/disconnected | Recovery |
| F36 | Medium | Accessibility | Heading, landmark, skip-link, and status-message structure is inconsistent | Public/settings |
| F37 | Medium | Destructive/visual | Safeguards and semantic colors are inconsistent for destructive actions | Delete/remove |
| F38 | Medium | Navigation/consistency | Marketing current state is absent and root duplicates public chrome | Marketing |
| F39 | Medium | Touch usability | Several mobile targets remain 18–40px and require spacing validation | Mobile |
| F40 | Medium | Trust/product claim | Security promises an audit-trail viewer that is not exposed | Security → project |
| F41 | Medium | Findability | Search is confined to All Projects; lists lack a scalable global find path | Power use/scale |
| F42 | Medium | Performance UX risk | Mobile workspace renders desktop first; tablet topbar needs CLS/overflow validation | Cold load/tablet |
| F43 | Low | Visual inconsistency | Emoji, off-scale half-pixel type, and legacy indigo remain in product UI | Visual system |
| F44 | Low | Navigation/content | 404 prioritizes an auth-gated destination for anonymous visitors | Error recovery |
| F45 | Informational | Localization opportunity | English-only/fixed-width implementation is not ready for long translations | Future markets |
| F46 | Informational | Product opportunity | Persistent review/history and command search would expose existing capability | Expert workflow |

## 5. Detailed findings

### F01 — Stored-secret picker can blank a real production credential

1. **Title:** Stored-secret picker can blank a real production credential.
2. **Severity:** **Critical** — confirmed workflow/data-safety defect.
3. **Affected surface:** Deploy modal and server env merge; <code>apps/web/components/DeployButton.tsx:256-268,289-296,526-554</code>; <code>services/orchestrator/src/deploy.ts:272-281</code>.
4. **User journey:** Project → Publish/Deploy → Add from Secrets → deploy.
5. **Issue:** Selecting a stored secret creates an env row with the real key and an empty value. The client sends that row. The server deliberately lets request env override stored secrets, so <code>SECRET=""</code> replaces the valid stored value.
6. **Why it creates friction or risk:** The UI describes “Add from Secrets” as a safe convenience, but the implementation converts a secure stored reference into an empty override.
7. **Expected impact:** A production deploy can succeed while its database/API credentials are blank, breaking the generated application and making the failure look like an app/runtime problem.
8. **Recommended fix:** Include project secrets automatically as immutable references. Manual env rows should represent explicit overrides only. Never generate an empty manual row from a stored secret.
9. **Suggested replacement copy:** “Project secrets are included automatically. Add values below only to override them for this deploy.”
10. **Proposed code/design change:** Remove <code>addEnvFromSecret</code> from the editable-row path, render stored names in a read-only “Included secrets” list, and transmit only non-empty intentional overrides. Prefer a typed request separating <code>storedSecretNames</code> from <code>manualEnv</code> so an empty string cannot ambiguously mean “reference” and “override.”
11. **Validation:** Seed a valid stored secret, open deploy without editing it, and assert the Vercel env retains the stored value. Verify an explicit non-empty override still wins. Add a regression test around the merge order.

### F02 — Confidential first prompts are placed in the URL

1. **Title:** Confidential first prompts are placed in the URL.
2. **Severity:** **High** — confirmed privacy/trust risk.
3. **Affected surface:** Landing/dashboard composer handoff; <code>apps/web/components/LandingPrompt.tsx:122-145</code>, <code>apps/web/components/ProjectPicker.tsx:621-644</code>, <code>apps/web/components/Workspace.tsx:250-297</code>.
4. **User journey:** Marketing or dashboard brief → create project → first agent turn.
5. **Issue:** The refined brief is encoded in <code>?brief=...</code> until the workspace WebSocket sends it and the router removes it.
6. **Why it creates friction or risk:** Business plans, code requirements, customer names, or credentials can enter browser history, access logs, analytics, crash reports, screenshots, and referrers before removal.
7. **Expected impact:** Sensitive prompt leakage, enterprise security objections, and reduced trust in a product marketed around private workspaces.
8. **Recommended fix:** Store the pending first turn server-side or in session storage and put only an opaque, single-use intent ID in the URL.
9. **Suggested replacement copy:** No copy change required. If handoff fails: “We couldn’t transfer your brief. Your text is still here—try again.”
10. **Proposed code/design change:** Create a short-lived pending-intent record keyed to the new project/session, consume it idempotently after WebSocket readiness, then delete it. Do not log its content.
11. **Validation:** Verify prompt text never appears in address history, server access logs, analytics payloads, referrer headers, or screenshots. Test refresh/reconnect and prevent duplicate first turns.

### F03 — Hosted sign-in presents legacy Uniqus-Code branding

1. **Title:** Hosted sign-in presents legacy Uniqus-Code branding.
2. **Severity:** **High** — confirmed trust and visual-consistency problem.
3. **Affected surface:** WorkOS hosted authentication reached from <code>apps/web/app/login/page.tsx:15-27</code>, <code>apps/web/app/projects/page.tsx:39</code>, <code>apps/web/app/settings/page.tsx:29</code>, and <code>apps/web/app/projects/[id]/page.tsx:24</code>; branding itself is WorkOS dashboard configuration.
4. **User journey:** Sign in, sign up, password recovery, or protected-route redirect.
5. **Issue:** The live hosted page used a purple legacy logo and “Sign in to Uniqus-Code” while the originating product is Gate 15's ember/industrial interface.
6. **Why it creates friction or risk:** An external auth hop is already a sensitive context switch. A different name and visual identity resembles phishing, a stale tenant, or the wrong product.
7. **Expected impact:** Sign-in abandonment, support questions, and lower confidence in credential handling.
8. **Recommended fix:** Update the WorkOS organization/branding assets, product name, colors, support/contact details, and policy links to Gate 15. Audit email templates at the same time.
9. **Suggested replacement copy:** “Sign in to Gate 15” and “Continue to Gate 15.”
10. **Proposed code/design change:** Treat hosted-auth branding as a release dependency with a checklist and screenshot test. Keep local entry-page and WorkOS tenant configuration in one ownership document; <code>notes/workos-authkit-branding.md</code> already identifies this configuration surface.
11. **Validation:** Exercise sign-in, sign-up, verification email, password reset, consent, cancel, and error pages in desktop/mobile dark and light contexts; every page must show Gate 15 and link to real policies.

### F04 — The Team trial and billing funnel does not complete

1. **Title:** “Start a Team trial” does not start or resume a trial, and Settings has no billing surface.
2. **Severity:** **High** — confirmed conversion/trust risk.
3. **Affected surface:** <code>apps/web/app/(marketing)/pricing/page.tsx:27-41,93-102,153-158</code>, <code>apps/web/app/login/page.tsx:15-16</code>, <code>apps/web/app/(marketing)/support/page.tsx:79-101</code>, <code>apps/web/components/SettingsView.tsx:244-492</code>.
4. **User journey:** Pricing → Team CTA → authentication → checkout/trial → seat/billing management.
5. **Issue:** The Team CTA links to generic <code>/login</code>; authentication returns to <code>/projects</code>. No plan intent, trial creation, checkout, seat selection, payment, invoices, cancellation, or post-auth resume exists. Support copy nevertheless says users can manage plan/seats in Settings.
6. **Why it creates friction or risk:** The highest-intent paid CTA ends in an unrelated dashboard, and help content describes controls users cannot find.
7. **Expected impact:** Lost paid conversions, sales/support load, and distrust of pricing claims such as trial, proration, and per-seat billing.
8. **Recommended fix:** Implement a real entitlement/checkout flow and billing area, or remove the transactional trial language until it exists. Preserve intent across authentication.
9. **Suggested replacement copy:** Interim: “Talk to us about Team access” or “Join the Team plan waitlist.” Completed flow: keep “Start Team trial” and show “You’ll choose seats and confirm billing after sign-in.”
10. **Proposed code/design change:** Use <code>/login?returnTo=/settings/billing&amp;plan=team</code> or a server-signed equivalent, validate return targets, resume checkout after auth, and expose Current plan, Seats, Payment method, Invoices, Usage, Cancel/Change plan.
11. **Validation:** Test signed-out and signed-in funnels, canceled/failed checkout, return after verification, proration, seat changes, invoice access, cancellation, and entitlement change.

### F05 — Pricing overstates Auto-routing provider coverage

1. **Title:** Pricing says Auto uses four providers while routing uses only Anthropic and Google.
2. **Severity:** **High** — confirmed product-claim mismatch.
3. **Affected surface:** <code>apps/web/app/(marketing)/pricing/page.tsx:17-20</code>; actual router exclusions at <code>services/orchestrator/src/agent/autoRouter.ts:15-17,206-213</code>.
4. **User journey:** Pricing/model evaluation → choose Auto → assess value and provider diversity.
5. **Issue:** Marketing says Auto routes among Claude, GPT, Gemini, and GLM. Current logic explicitly excludes OpenAI and Z.ai from Auto; GPT and GLM are manual choices only.
6. **Why it creates friction or risk:** Technical buyers can quickly observe the discrepancy, and provider selection affects quality, data handling, and cost.
7. **Expected impact:** Reduced credibility of model claims and possible procurement objections.
8. **Recommended fix:** Make capability copy derive from a shared, tested model/provider matrix, or update it whenever router policy changes.
9. **Suggested replacement copy:** “Auto routing across Claude and Gemini. GPT and GLM remain available as manual per-turn choices.”
10. **Proposed code/design change:** Export a public-safe Auto-provider list from the same package or generated artifact that owns router policy; snapshot-test pricing copy against it.
11. **Validation:** Compare all public model/pricing/docs claims with <code>MODEL_CATALOG</code>, provider capability checks, configured-key behavior, and Auto route tests.

### F06 — Turnstile failure creates a permanent guest-entry dead end

1. **Title:** Blocked or timed-out Turnstile leaves guest entry permanently disabled.
2. **Severity:** **High** — confirmed error-recovery and conversion problem.
3. **Affected surface:** <code>apps/web/components/Turnstile.tsx:9-12,69-100</code>; <code>apps/web/components/GuestLoginActions.tsx:174-187</code>.
4. **User journey:** Login → Continue as guest or Have a recovery code? → Restore.
5. **Issue:** After roughly 15 seconds the widget poll stops, but the parent receives no explicit load-error state. The CTA remains disabled as “Verifying you’re human…” indefinitely. This reproduced in the local live review.
6. **Why it creates friction or risk:** Privacy blockers, restricted school networks, CDN failure, offline state, or a site/secret mismatch create a dead end with no diagnosis or retry.
7. **Expected impact:** Guest acquisition and recovery failure for exactly the school/restricted-network audience the guest copy targets.
8. **Recommended fix:** Keep the server fail-closed, but expose <code>loading | ready | error | expired</code> on the client with a visible Retry action and troubleshooting link.
9. **Suggested replacement copy:** “Human verification couldn’t load. Check your connection or privacy blocker, then retry.”
10. **Proposed code/design change:** Add <code>onStateChange</code> to <code>Turnstile</code>; call error on max attempts and callbacks; let Retry remove/reload the script or reset the widget; include accessible status/alert semantics.
11. **Validation:** Block <code>challenges.cloudflare.com</code>, test timeout/offline/error/expiry/site-key mismatch, and confirm recovery without a full page reload.

### F07 — Legal, abuse, social, and consent links are placeholders

1. **Title:** Trust and consent destinations do not lead to the promised content.
2. **Severity:** **High** — confirmed legal/trust/conversion risk.
3. **Affected surface:** <code>apps/web/components/SiteFooter.tsx:47-60</code>; unlinked consent text at <code>apps/web/app/login/page.tsx:38-40</code>.
4. **User journey:** Marketing due diligence, abuse reporting, social proof, and sign-in consent.
5. **Issue:** Privacy, Terms, and Report abuse all point to the Gate 15 homepage. Social icons point to generic platform homepages. Login asks users to agree to Terms and Privacy without linking either.
6. **Why it creates friction or risk:** Users cannot inspect what they are consenting to or find an owned abuse-reporting/social destination.
7. **Expected impact:** Sign-in hesitation, enterprise/security diligence failure, weak consent evidence, and lower trust.
8. **Recommended fix:** Publish distinct versioned policies and an abuse channel; link only official social profiles and remove unavailable ones.
9. **Suggested replacement copy:** Login: “By continuing, you agree to the Gate 15 Terms of Service and acknowledge the Privacy Policy.” Make both document names links.
10. **Proposed code/design change:** Add real <code>/privacy</code>, <code>/terms</code>, and <code>/abuse</code> routes or authoritative external URLs, effective dates, contact owner, and footer/login link tests.
11. **Validation:** Crawl links for 200 responses, correct canonical URL/title/H1/effective date, keyboard access, and external-profile ownership.

### F08 — Mobile marketing navigation removes all discovery links

1. **Title:** Tablet/phone headers hide every product-discovery destination.
2. **Severity:** **High** — confirmed responsive and conversion issue.
3. **Affected surface:** <code>apps/web/components/MarketingNav.tsx:33-54</code>; <code>apps/web/app/globals.css:7829-7831,7866-7877</code>; root header at <code>apps/web/app/page.tsx:31-51</code>.
4. **User journey:** Mobile visitor → explore Pricing, Models, Workspaces, Enterprise, Docs, Security, Support, Templates, or Sign in.
5. **Issue:** Below 820px the entire links/Explore block disappears. Below 520px the ghost Sign in button also disappears. Live mobile review showed only the brand and Get started.
6. **Why it creates friction or risk:** Users must already know a URL or scroll to the footer; comparison and trust pages become effectively undiscoverable from the primary navigation.
7. **Expected impact:** Lower mobile evaluation depth, weaker pricing/docs discovery, and avoidable sign-in friction.
8. **Recommended fix:** Add a labelled mobile menu/drawer with all destinations, current-page state, focus management, and a persistent Sign in path.
9. **Suggested replacement copy:** Trigger: “Menu.” Items: Pricing, AI models, Workspaces, Enterprise, Docs, Templates, Security, Support, Sign in.
10. **Proposed code/design change:** Reuse one nav data source for desktop and mobile. Implement disclosure/drawer semantics, Escape, focus trap or managed non-modal disclosure, outside close, scroll lock where appropriate, and trigger focus restoration.
11. **Validation:** Test 320/375/390/768/820px, keyboard, VoiceOver/TalkBack, long labels, orientation change, and authenticated/guest states.

### F09 — Dashboard destinations have no URL, history, or deep-link state

1. **Title:** Eleven dashboard destinations are ephemeral local state.
2. **Severity:** **High** — confirmed navigation and information-architecture issue.
3. **Affected surface:** <code>apps/web/components/ProjectPicker.tsx:368-386,927-1145,1202-1237</code>.
4. **User journey:** Dashboard → Skills/Knowledge/Databases/organization view → refresh, browser Back, bookmark, or share.
5. **Issue:** Navigation calls <code>setView</code> instead of changing a route or query. Reload returns to Home; Back/Forward does not traverse dashboard destinations; support cannot link to a specific surface.
6. **Why it creates friction or risk:** Major destinations behave like temporary tabs despite representing separate jobs and data models.
7. **Expected impact:** Lost context, poor learnability, weak support/documentation links, and more repeated navigation.
8. **Recommended fix:** Give major destinations nested routes or query-backed state, preserving organization/workspace context.
9. **Suggested replacement copy:** No copy change required; optionally add meaningful document titles such as “Skills — Gate 15.”
10. **Proposed code/design change:** Prefer <code>/projects</code>, <code>/projects/recent</code>, <code>/resources/skills</code>, <code>/resources/knowledge</code>, and <code>/organizations/[id]/members</code>, or minimally <code>/projects?view=skills</code> with validated values and history updates.
11. **Validation:** Deep-link, reload, Back/Forward, open-in-new-tab, organization switch, permission denial, and route-announcement tests.

### F10 — Workspace information architecture overloads the build loop

1. **Title:** Overlapping mode systems obscure where work, review, and progress live.
2. **Severity:** **High** — confirmed usability/IA issue.
3. **Affected surface:** desktop Preview/Code <code>Workspace.tsx:531-573</code>; Live Preview/Agent Preview/Activity <code>:1277-1335</code>; mobile panes <code>:775-852</code>; editor tabs and topbar overflow.
4. **User journey:** Prompt → inspect progress → review app/code → resolve error → comment or rewind.
5. **Issue:** Desktop layers Preview/Code, Live/Agent/Activity, editor tabs, topbar actions, and overflow. Mobile exposes Chat, Code, Preview, Activity, Files, and Logs. Related review/history actions are split across several places.
6. **Why it creates friction or risk:** Users must learn product-specific nesting and remember where similar information lives; capabilities become hidden despite being implemented.
7. **Expected impact:** Slower first-task completion, lower feature discovery, and a workspace that feels more complex than the underlying build loop.
8. **Recommended fix:** Reframe the shell around **App / Code / Review**, with Activity as a persistent rail/drawer and contextual review/history/comments together.
9. **Suggested replacement copy:** Desktop: “App,” “Code,” “Review.” Mobile: “Chat,” “App,” “Code,” “More.”
10. **Proposed code/design change:** Define one workspace navigation model shared across breakpoints; move Comments, Tasks, History/Checkpoints, runtime errors, and approvals into a contextual Review surface; keep Run, Publish, and More in the topbar.
11. **Validation:** Moderated first-use tests for “see what the agent changed,” “find a runtime error,” “rewind,” “comment on a file,” and “publish,” comparing time/error rate before and after.

### F11 — Mobile dashboard becomes a long unlabeled horizontal strip

1. **Title:** Mobile dashboard navigation loses hierarchy and scales poorly.
2. **Severity:** **High** — confirmed responsive/IA issue.
3. **Affected surface:** <code>apps/web/app/globals.css:4915-4949</code>; nav destinations at <code>apps/web/components/ProjectPicker.tsx:911-1184</code>.
4. **User journey:** Phone/tablet user navigates projects, resources, organization administration, docs, and account settings.
5. **Issue:** At 760px the entire sidebar becomes one horizontal scrolling row. Group labels and “soon” items disappear, so personal resources, organization destinations, docs, and account settings lose context.
6. **Why it creates friction or risk:** Horizontal discovery is invisible, position is unstable, and two “Settings” destinations become ambiguous without group labels.
7. **Expected impact:** Missed destinations, wrong-settings selection, repeated swiping, and poor behavior with long organization names.
8. **Recommended fix:** Keep 3–4 primary destinations and place the remainder in a labelled More drawer grouped by Projects, Resources, Organization, and Account.
9. **Suggested replacement copy:** Rename “Settings” to “Organization settings” and “Account settings.”
10. **Proposed code/design change:** Replace the mobile row with a bottom/compact tab set plus a sheet/drawer; retain active context and make the organization switcher explicit.
11. **Validation:** Test 320/375/390/760px, landscape, long names, 200% text, touch exploration, and screen-reader order.

### F12 — Actions are exposed without effective-role gating

1. **Title:** Shared-project and membership controls are shown before the UI knows whether the user may act.
2. **Severity:** **High** — confirmed permission-denied UX problem.
3. **Affected surface:** <code>apps/web/components/Workspace.tsx:76-78,324-425</code>; <code>MembersView.tsx:13-18,110-145,218-260</code>; <code>OrgMembersView.tsx:29-34,127-169,221-252</code>; missing capability data in <code>packages/api-types/src/index.ts:654-682</code>; server enforcement example <code>services/orchestrator/src/server.ts:1952-1959</code>.
4. **User journey:** Viewer/editor opens a shared project and tries Skills, Secrets, Rewind, Members, Tasks, GitHub, Deploy, invite, role change, or removal.
5. **Issue:** Controls are largely gated by guest/standard account type, not the effective project/org role. Users discover restrictions only after a request fails.
6. **Why it creates friction or risk:** The UI implies authority and then contradicts itself with 403/404 responses; destructive controls may also be visible to users who should never consider them.
7. **Expected impact:** Repeated failures, role confusion, lower collaboration trust, and avoidable support.
8. **Recommended fix:** Return an effective role and capability matrix with project/session/member data. Hide actions that are irrelevant; disable-with-reason when learning the capability is valuable.
9. **Suggested replacement copy:** “Only project admins can manage secrets.” “You can view this project; ask an admin for edit access.”
10. **Proposed code/design change:** Add typed capabilities such as <code>canDeploy</code>, <code>canManageMembers</code>, <code>canRestoreCheckpoint</code>, and <code>canManageSecrets</code>; use them consistently in navigation, menus, and dialogs.
11. **Validation:** End-to-end owner/admin/editor/viewer matrices across every workspace and organization action, including direct API denial.

### F13 — “Invite” only direct-adds existing users

1. **Title:** Team invitation is not an invitation workflow.
2. **Severity:** **High** — confirmed team activation/conversion problem.
3. **Affected surface:** <code>apps/web/components/MembersView.tsx:56-69,110-145</code>; <code>OrgMembersView.tsx:101-169</code>; <code>services/orchestrator/src/db/members.ts:290-305</code>; <code>services/orchestrator/src/collabRoutes.ts:384-407</code>.
4. **User journey:** Project/organization → invite a new teammate.
5. **Issue:** The backend only looks up an existing Gate 15 user and returns <code>no_user</code> otherwise. There is no email delivery, pending invitation, accept/decline, expiry, resend, or revoke.
6. **Why it creates friction or risk:** “Invite” sets the expectation that a new colleague can be onboarded; the core paid-team activation loop fails if they have not signed up first.
7. **Expected impact:** Failed team activation, coordination outside the product, and reduced Team-plan value.
8. **Recommended fix:** Implement signed email invitations and show pending membership state.
9. **Suggested replacement copy:** Until implemented: “Add existing Gate 15 member.” Completed flow: “Invite by email,” with “They’ll receive a link valid for 7 days.”
10. **Proposed code/design change:** Add invitation records with org/project, role, inviter, hashed token, expiry, accepted/revoked state; send email; support acceptance after authentication, resend, revoke, and duplicate protection.
11. **Validation:** Invite an unknown email, accept after signup, reject expired/revoked/duplicate tokens, and verify role/organization context.

### F14 — Organization leave/delete copy contradicts backend behavior

1. **Title:** Destructive organization assurances do not match ownership transitions.
2. **Severity:** **High** — confirmed destructive/data-access risk.
3. **Affected surface:** <code>apps/web/components/OrgSettingsView.tsx:266-319</code>; leave behavior <code>services/orchestrator/src/collabRoutes.ts:327-341</code>; org ownership semantics <code>services/orchestrator/src/db/members.ts:4-13,323-332</code>.
4. **User journey:** Organization Settings → Leave organization or Delete organization.
5. **Issue:** UI says owned projects return to Personal and projects return to their owners. Leaving only removes membership/access. Deleting moves all org projects to the deleting recovery owner, not their individual creators.
6. **Why it creates friction or risk:** Users make irreversible access decisions from inaccurate consequences.
7. **Expected impact:** Unexpected loss of access or mass transfer of projects to the wrong person.
8. **Recommended fix:** Implement the promised ownership model or state the actual result with affected project/member counts. Require typed organization name for deletion.
9. **Suggested replacement copy:** Leave: “You’ll immediately lose access to every organization project. No projects move to Personal.” Delete: “All organization projects move to your Personal workspace; every other member loses access.”
10. **Proposed code/design change:** Return a preflight consequence object—project count, destination owner, affected members—and render it in the confirmation. Make the backend operation and copy share tested semantics.
11. **Validation:** Role/creator fixtures must assert exact post-leave/delete ownership and access; manually verify the preflight counts and typed confirmation.

### F15 — Project deletion can leave the public Vercel site live

1. **Title:** Deleting a Gate 15 project does not necessarily take its published site offline.
2. **Severity:** **High** — confirmed destructive/trust risk.
3. **Affected surface:** confirmation <code>apps/web/components/ProjectPicker.tsx:2806-2814</code>; deletion handler <code>services/orchestrator/src/server.ts:3602-3657</code>.
4. **User journey:** Published project → Delete project.
5. **Issue:** The handler removes Gate 15 records/storage/VM/sandbox/checkpoints but does not delete the Vercel project/deployment. Current copy does not plainly warn that the public URL may remain live and unmanaged.
6. **Why it creates friction or risk:** “Delete project” is reasonably interpreted as ending the product and its publication, especially when deployment is managed inside the same workspace.
7. **Expected impact:** Continued public exposure, surprise costs, compliance/security incidents, and loss of the Gate 15 control surface needed to manage the site.
8. **Recommended fix:** Offer a separately acknowledged “Also remove the Vercel project/deployments” choice backed by Vercel's API; default according to a clearly documented product policy.
9. **Suggested replacement copy:** “Deleting here does not take your Vercel site offline unless you select that option.”
10. **Proposed code/design change:** Add a deletion preflight showing current public URL and Vercel project. Execute/record both operations independently and provide a recoverable partial-failure state.
11. **Validation:** Test both confirmation variants and forced Vercel API failure; public URL, Vercel project, Gate 15 record, and user receipt must match the selected outcome.

### F16 — Project edit/delete failures are hidden behind dialogs

1. **Title:** Rename, icon, and delete failures do not appear where the action occurred.
2. **Severity:** **High** — confirmed error-feedback defect.
3. **Affected surface:** mutation state <code>apps/web/components/ProjectPicker.tsx:798-831</code>; error rendering <code>:1698-1705</code>; dialogs <code>:1811-1837</code>; delete catch <code>:2754-2765</code>.
4. **User journey:** Home/All/Recent → rename, change icon, or delete a project.
5. **Issue:** Mutations set shared <code>error</code>, but it renders only in the Home creation block. On All/Recent it is not mounted; on Home it sits behind the dialog. Delete failure merely re-enables the button.
6. **Why it creates friction or risk:** A failed action appears to do nothing, so users retry without knowing whether the operation is pending, denied, conflicting, or broken.
7. **Expected impact:** Duplicate requests, unsafe retrying of destructive actions, and inability to self-recover.
8. **Recommended fix:** Keep pending/error state inside each dialog, leave it open on failure, name the failed action, and provide Retry. A toast may supplement but not replace persistent feedback.
9. **Suggested replacement copy:** “Project wasn’t deleted. It is still available. Check your connection and try again.” For conflicts: “This project changed elsewhere. Refresh before renaming.”
10. **Proposed code/design change:** Give each modal a local mutation state and error ID referenced with <code>aria-describedby</code>; reset only on success or explicit cancel.
11. **Validation:** Force 403, 409, timeout, offline, and 500 responses from Home, All, and Recent; the dialog must remain recoverable and focus the message.

### F17 — Durable Tasks accepts work that normally never runs

1. **Title:** Users can queue Agent Tasks before learning that no worker may execute them.
2. **Severity:** **High** — confirmed task-completion/product-integrity problem.
3. **Affected surface:** <code>apps/web/components/TasksView.tsx:8-18,104-127,189-277</code>; worker default <code>services/orchestrator/src/server.ts:7175-7198</code>.
4. **User journey:** Workspace → Tasks → Create task → wait for completion.
5. **Issue:** The UI accepts a task; the muted caveat appears only after it is queued. The async worker is off by default, so the task can remain queued indefinitely.
6. **Why it creates friction or risk:** A success state confirms durable background work without an available executor or reliable service-status signal.
7. **Expected impact:** Missed work, false confidence, repeated task creation, and distrust of automation.
8. **Recommended fix:** Complete the dedicated runner/editing-lane path, expose worker health before submission, and reject creation when no executor can claim the task.
9. **Suggested replacement copy:** Worker unavailable: “Background tasks are unavailable in this workspace. Keep this project open and use Chat, or ask an admin to enable the task runner.”
10. **Proposed code/design change:** Add task-runner capability/health to the project response; gate the CTA; enforce server-side admission; show queued/running/blocked/failed/completed with timestamps and retry/cancel.
11. **Validation:** Created tasks must transition within a defined SLA. Worker-off tests must block submission; worker-loss tests must produce an actionable blocked/failed state.

### F18 — Integration and BYOK failures are mislabeled as disconnected/platform-key

1. **Title:** Unknown/error states are rendered as authoritative connection and billing states.
2. **Severity:** **High** — confirmed financial/privacy/trust risk.
3. **Affected surface:** <code>GithubRepoButton.tsx:38-46</code>, <code>DeployButton.tsx:47-56,187-192</code>, <code>ProjectPicker.tsx:546-556</code>, <code>SettingsView.tsx:133-145</code>, <code>ProviderKeysCard.tsx:24-37,79-94</code>, provider contract <code>apps/web/lib/api.ts:84</code>, server keys <code>services/orchestrator/src/server.ts:1398-1425</code>.
4. **User journey:** Settings/workspace → GitHub, Vercel, Supabase, Figma, or provider keys.
5. **Issue:** Network/timeout/server failures synthesize “disconnected.” Provider-key status failure becomes an empty configured set and therefore “platform key.” Z.ai is omitted from account-level BYOK even though GLM is selectable.
6. **Why it creates friction or risk:** Users may unnecessarily repeat OAuth, disconnect valid accounts, or misunderstand which account is billed and which data terms apply.
7. **Expected impact:** Trust loss, failed reconnect loops, billing surprises, and no coherent BYOK story for GLM.
8. **Recommended fix:** Model <code>loading | connected | disconnected | error/unknown</code>; preserve last-known status; require authoritative status before destructive changes. Add Z.ai to the shared BYOK contract if GLM remains a selectable provider.
9. **Suggested replacement copy:** “Connection status unavailable. Your existing connection may still be active. Retry.” “Provider-key status unavailable; we cannot confirm whose key will be used.”
10. **Proposed code/design change:** Use a discriminated status union across integrations, show timestamps for last verified status, and centralize provider definitions/capabilities.
11. **Validation:** Seed every connection/key, force offline/timeout/401/500, and verify none is called disconnected/platform-key without an authoritative response. Confirm a saved Z.ai key is used for GLM.

### F19 — GitHub OAuth drops project and action context

1. **Title:** Workspace GitHub connection returns to the dashboard and abandons the initiating action.
2. **Severity:** **High** — confirmed workflow-continuity problem.
3. **Affected surface:** <code>apps/web/components/GithubRepoButton.tsx:146-156</code>.
4. **User journey:** Project workspace → Connect GitHub to create/link repository → OAuth → return.
5. **Issue:** The return target is hardcoded to <code>/projects</code>. The originating project and “create repository” intent are not resumed.
6. **Why it creates friction or risk:** External OAuth already interrupts attention; returning to a generic dashboard forces users to rediscover the project and repeat the action.
7. **Expected impact:** Abandonment, duplicate repositories/actions, and reduced integration success.
8. **Recommended fix:** Preserve a validated project return target and explicit post-auth intent.
9. **Suggested replacement copy:** Before redirect: “You’ll return to this project after connecting GitHub.”
10. **Proposed code/design change:** Use a signed/validated return such as <code>/projects/[id]?github=connected&amp;intent=create-repo</code>, then reopen the confirmation exactly once.
11. **Validation:** Successful, canceled, denied, expired, and failed OAuth must return to the same project with appropriate feedback and no open-redirect vulnerability.

### F20 — Custom-prompts load failure can enable an empty overwrite

1. **Title:** Settings renders editable empty values after a failed fetch and can overwrite real server data.
2. **Severity:** **High** — confirmed data-safety/recovery defect.
3. **Affected surface:** <code>apps/web/components/CustomPromptsCard.tsx:27-32,48-79,108-223</code>.
4. **User journey:** Settings → Custom prompts & default skills → load failure → type/save.
5. **Issue:** Fetch failure sets <code>status=error</code>, but only <code>loading</code> has a separate rendering branch. Error falls through to empty editable fields. Typing makes Save active against an empty “saved” snapshot.
6. **Why it creates friction or risk:** A transient read failure is treated as valid empty data; a normal edit can erase an existing custom prompt or skills configuration.
7. **Expected impact:** Loss of account instructions, changed agent behavior across projects, and difficult diagnosis.
8. **Recommended fix:** Render a distinct blocking load-error state with Retry. Do not mount/enable editors until the authoritative snapshot loads.
9. **Suggested replacement copy:** “We couldn’t load your saved prompts. Nothing has changed. Retry.”
10. **Proposed code/design change:** Split initial-load and save-error states. Keep a <code>hasLoadedSnapshot</code> invariant and reject updates server/client-side when the expected revision is absent; consider optimistic concurrency/versioning.
11. **Validation:** Seed non-empty values, fail the initial request, type with scripted DOM manipulation, and assert Save is impossible. Retry must restore the server snapshot; concurrent-edit tests should detect conflicts.

### F21 — Portaled menus do not manage keyboard focus

1. **Title:** Menu/listbox popovers do not focus options, support standard keys, or reliably restore focus.
2. **Severity:** **High** — confirmed accessibility violation (WCAG 2.1.1, 2.4.3, 4.1.2).
3. **Affected surface:** shared <code>Popover.tsx:64-115</code>; <code>NavExploreMenu.tsx:32-79</code>; <code>ModelPicker.tsx:89-116</code>; <code>PermissionModePicker.tsx:82-140</code>; <code>WorkspaceSwitcher.tsx:164-225</code>; other context menus.
4. **User journey:** Explore marketing, switch workspace, choose model/permission, use context menus.
5. **Issue:** Popovers portal to <code>document.body</code> and close on outside/Escape, but never move focus into options or return it. Call sites declare menu semantics without Arrow/Home/End/typeahead behavior.
6. **Why it creates friction or risk:** Tabbing after opening can skip portaled options; keyboard/screen-reader users cannot predictably operate critical model, permission, and workspace selectors.
7. **Expected impact:** Blocked or error-prone navigation and configuration for non-pointer users.
8. **Recommended fix:** Implement a menu/listbox popover mode with selected/first-item focus, roving tab index or active descendant, standard keys, Escape, typeahead, and trigger restoration. Ordinary site links should use disclosure navigation rather than application-menu semantics.
9. **Suggested replacement copy:** No copy change required; accessible names should be explicit, e.g. “Choose model” and “Switch workspace.”
10. **Proposed code/design change:** Centralize trigger/content IDs, <code>aria-expanded</code>/<code>aria-controls</code>, focus entry/exit, item refs, and keyboard handlers in <code>Popover</code> variants.
11. **Validation:** Keyboard-only tests plus NVDA/VoiceOver and Playwright focus assertions for open, arrows, Home/End, typeahead, select, Escape, outside click, and unmount.

### F22 — Core chat input, suggestions, and output lack complete semantics

1. **Title:** The primary build composer is unlabeled, suggestions are not a combobox, and streaming output is not announced.
2. **Severity:** **High** — confirmed accessibility violation (WCAG 1.3.1, 3.3.2, 4.1.2, 4.1.3).
3. **Affected surface:** <code>apps/web/components/ChatPanel.tsx:846-860,1103-1285</code>; send errors correctly use <code>role=alert</code> at <code>:2198-2208</code>.
4. **User journey:** Project → tell Gate 15 what to build → choose slash/file suggestion → follow streaming result.
5. **Issue:** The textarea relies on a changing, sometimes empty placeholder and has no durable accessible label. Slash/file suggestions use menu/menuitem with unsupported selection state and no combobox relationships. The message stream is a plain div without log/live semantics.
6. **Why it creates friction or risk:** Screen readers cannot reliably identify the core input, selected suggestion, new response, or activity completion.
7. **Expected impact:** The product's central interaction becomes confusing or unusable for screen-reader users.
8. **Recommended fix:** Add a permanent label, implement combobox/listbox semantics for suggestions, and announce concise status/completion updates without reading every token.
9. **Suggested replacement copy:** Label: “Message Gate 15.” Status: “Gate 15 is working.” Completion: “Gate 15 finished responding.”
10. **Proposed code/design change:** Add label/ID; use <code>aria-expanded</code>, <code>aria-controls</code>, <code>aria-activedescendant</code>, option IDs, and result counts. Mark the transcript <code>role=log</code> or use a separate polite status region that announces meaningful boundaries.
11. **Validation:** Inspect the accessibility tree and test <code>/</code>, <code>@</code>, arrows, Enter, Tab, Escape, streaming, tools, errors, and stop with NVDA and VoiceOver.

### F23 — Editor tab actions are nested mouse-only spans

1. **Title:** Save, close, and stop-preview controls inside editor tabs are not keyboard-operable controls.
2. **Severity:** **High** — confirmed accessibility violation (WCAG 2.1.1, 4.1.2).
3. **Affected surface:** <code>apps/web/components/EditorPreviewArea.tsx:283-369</code>.
4. **User journey:** Code workspace → select tab → save/close file or stop preview.
5. **Issue:** Clickable <code>span</code> elements are nested inside tab <code>button</code> elements. They have no role, name, tab index, or keyboard handler.
6. **Why it creates friction or risk:** Nested interactive behavior is invalid; keyboard activation selects the tab rather than invoking the action, and assistive technology does not expose the controls.
7. **Expected impact:** Keyboard users cannot complete routine file/preview management.
8. **Recommended fix:** Use a proper tablist with sibling tab and close/action buttons, accessible names, and roving tab focus.
9. **Suggested replacement copy:** Accessible names: “Save [filename],” “Close [filename],” “Stop live preview.”
10. **Proposed code/design change:** Separate each tab row into a focusable tab control and adjacent button(s); connect tab to tabpanel; expose dirty state in text/ARIA, not color alone.
11. **Validation:** DOM validator, accessibility-tree inspection, and keyboard tests for select, save, close, stop, unsaved confirmation, and focus after tab removal.

### F24 — File management is not keyboard-complete

1. **Title:** Moving files is drag-only and tree semantics put focus on the wrong nodes.
2. **Severity:** **High** — confirmed accessibility violation (WCAG 2.1.1, 2.5.7, 1.3.1, 4.1.2).
3. **Affected surface:** move API <code>apps/web/components/FileExplorer.tsx:217-229</code>; filtered tree <code>:307-342</code>; normal rows <code>:573-646</code>; drag/drop <code>:307-323,573-618</code>; context menu <code>:825-848</code>.
4. **User journey:** Workspace Files → navigate hierarchy, filter, select, move, rename, delete.
5. **Issue:** Move is available only via drag/drop; context menu omits it. <code>role=treeitem</code> and states sit on a non-focusable wrapper while focus lands on a child button. Filtered results place ordinary buttons directly under <code>role=tree</code>; every row becomes a Tab stop rather than roving tree focus.
6. **Why it creates friction or risk:** Users unable to drag cannot move files. Screen readers receive contradictory hierarchy/selection/focus, and large trees create excessive Tab sequences.
7. **Expected impact:** Blocked file organization for keyboard/touch users and inefficient navigation for all assistive-technology users.
8. **Recommended fix:** Add “Move to…” with an accessible folder picker. Make the focusable row itself the treeitem with one roving tab stop and APG keys, or remove tree ARIA and use an honest nested list.
9. **Suggested replacement copy:** Context action: “Move to…” Dialog label: “Choose destination folder.”
10. **Proposed code/design change:** Reuse the existing move API from a menu/dialog; implement Arrow Left/Right/Up/Down, Home/End, Enter, typeahead, nested groups, expansion, and selected state on one accessibility node.
11. **Validation:** Move a file using only taps and only a keyboard. Inspect normal/filtered accessibility trees and test large projects with NVDA.

### F25 — Custom overlays bypass the accessible shared modal

1. **Title:** Delete Confirm, Quick Open, and preview dialogs lack shared dialog behavior.
2. **Severity:** **High** — confirmed accessibility violation.
3. **Affected surface:** accessible baseline <code>apps/web/components/Modal.tsx:64-127</code>; custom overlays <code>FileExplorer.tsx:907-1054</code>; preview cards <code>PreviewPanel.tsx:1042-1070,1147-1192</code>.
4. **User journey:** Delete file/folder, quick-open a path, resolve runtime/selection state.
5. **Issue:** File Explorer overlays are plain divs without dialog naming, modal semantics, focus containment, Escape/restoration; Quick Open is placeholder-only. Preview cards declare dialog roles without matching focus behavior.
6. **Why it creates friction or risk:** Focus can stay behind a destructive/blocking surface, context may not be announced, and keyboard users can tab into obscured UI.
7. **Expected impact:** Accidental actions, lost context, and blocked keyboard/screen-reader recovery.
8. **Recommended fix:** Migrate modal surfaces to the shared <code>Modal</code>. If a preview card is deliberately non-modal, use disclosure/popover semantics and explicit focus behavior.
9. **Suggested replacement copy:** Quick Open label: “Open file by name.” Delete description should name the exact file/folder and permanence.
10. **Proposed code/design change:** Replace bespoke overlay/card markup with shared primitives and add variants where needed rather than reimplementing focus.
11. **Validation:** Tab/Shift+Tab/Escape, initial focus, destructive default focus, stacked surfaces, focus restoration, screen-reader announcement, and background inertness.

### F26 — High-value controls remove visible focus indicators

1. **Title:** Local CSS overrides the compliant global focus ring without an equivalent replacement.
2. **Severity:** **High** — confirmed accessibility violation (WCAG 2.4.7 and 1.4.11).
3. **Affected surface:** global baseline <code>apps/web/app/globals.css:232-250</code>; landing composers <code>:7287-7329,8272-8311</code>; selects <code>:6770-6775</code>; file filter/Quick Open <code>:3496-3499,3642-3644</code>; preview URL/annotator input <code>:3871-3874,4270-4277</code>.
4. **User journey:** Keyboard visitor types a landing brief; keyboard user filters files, opens a file, changes a select, edits preview URL, or annotates.
5. **Issue:** Controls use <code>outline:none</code>. Landing wrappers respond to hover but not <code>:focus-within</code>; live Tab testing confirmed the primary hero and closing inputs show no visual change.
6. **Why it creates friction or risk:** Keyboard users lose their location, especially in light theme and dense workspaces.
7. **Expected impact:** Input errors, slower navigation, and inability to confidently operate primary conversion controls.
8. **Recommended fix:** Never remove the global ring without an equal theme-aware replacement. Add wrapper focus-within treatments.
9. **Suggested replacement copy:** Not applicable.
10. **Proposed code/design change:** Add <code>.hero-prompt:focus-within</code> and <code>.bottom-prompt:focus-within</code> with a 2px <code>--accent-text</code> outline/ring; replace raw ember select rings and restore focus-visible styles on local inputs.
11. **Validation:** Keyboard traversal in both themes, 200% text, Windows High Contrast/forced colors, and screenshot regression for hover versus focus.

### F27 — Contrast failures recur across filled controls and light theme

1. **Title:** Bright fills use white text, and raw brand/marketing colors are used as light-theme foregrounds.
2. **Severity:** **High** — confirmed systemic accessibility violation (WCAG 1.4.3 and 1.4.11).
3. **Affected surface:** <code>apps/web/app/globals.css:10-23,120-173,2951,4439,6689-6739,6829-6874,9493,9704-9706,9944</code>; <code>AppearanceCard.tsx:53-73</code>; <code>ActivityMonitor.tsx:101-109</code>; <code>ChatPanel.tsx:1138</code>; <code>CheckpointsModal.tsx:176</code>; <code>SkillsModal.tsx:203</code>.
4. **User journey:** Appearance, destructive confirmation, activity, chat suggestions, checkpoints, skills, Pricing/Models/Changelog/Status in light theme.
5. **Issue:** White on dark-theme <code>--conf-low #F87171</code> is about 2.77:1. Appearance uses white over an orange→yellow gradient; the yellow stop is about 1.47:1. Raw <code>--accent #FF7700</code> is used as light-theme text despite the token comments documenting only 2.66:1 on white. Bright marketing green/cyan/yellow/teal remain fixed as text when surfaces flip light.
6. **Why it creates friction or risk:** Important selected, destructive, status, and technical content becomes difficult to read; the regressions contradict an otherwise well-engineered contrast system.
7. **Expected impact:** WCAG failures across multiple protected/public surfaces and reduced legibility for low-vision users.
8. **Recommended fix:** Use near-black ink on bright fills, <code>--accent-text</code> for foreground orange, deep light-theme semantic text variants, and <code>--border-active</code> for checked-control boundaries.
9. **Suggested replacement copy:** Not applicable.
10. **Proposed code/design change:** Add separate fill/text tokens; replace <code>color:var(--accent)</code> with <code>--accent-text</code>; introduce <code>--mk-*-text</code> light overrides; add a lint/style rule against raw accent foreground use.
11. **Validation:** Automated contrast tests for every gradient stop and semantic state in both themes, plus forced-colors validation. Require 4.5:1 for normal text and 3:1 for component boundaries/marks.

### F28 — Inputs and complex controls lack durable labels

1. **Title:** Placeholder or visual text is repeatedly used instead of programmatic labels.
2. **Severity:** **High** — confirmed accessibility violation (WCAG 1.3.1, 3.3.2, 4.1.2).
3. **Affected surface:** guest recovery <code>GuestLoginActions.tsx:211-263</code>; Skills editor <code>SkillsView.tsx:663-703</code>; agent flows <code>AgentPreviewPanel.tsx:337-404</code>; similar Knowledge, database SQL, member invite, File Explorer search, and Quick Open inputs.
4. **User journey:** Restore guest, edit skills, create an agent flow, search files, invite members, query a database.
5. **Issue:** Some inputs are placeholder-only; some visible <code>label</code> elements lack <code>htmlFor</code>; repeated rows lack fieldset/legend relationships. Guest errors are visual text without alert/status semantics.
6. **Why it creates friction or risk:** Placeholders disappear while typing and screen-reader form navigation encounters unnamed or ambiguously repeated fields.
7. **Expected impact:** Input mistakes and blocked form completion for assistive-technology users.
8. **Recommended fix:** Add stable IDs/labels, fieldset/legend for repeated groups, and <code>aria-describedby</code>/<code>aria-errormessage</code> for hints/errors.
9. **Suggested replacement copy:** Guest label: “Recovery code.” File search: “Filter project files.” Flow fields: “Step type,” “Element selector,” “Value.”
10. **Proposed code/design change:** Create a shared field component that requires a label and exposes hint/error IDs; add accessible-name assertions to component tests.
11. **Validation:** Accessibility-tree inspection, screen-reader form navigation, automated “every form control has a name” tests, and error announcement on submit.

### F29 — Modals and complex editors do not reflow at narrow/zoomed widths

1. **Title:** Shared modal dimensions and desktop-only inline grids can clip content at 320px or 400% zoom.
2. **Severity:** **High** — source-confirmed responsive/accessibility issue (WCAG 1.4.10).
3. **Affected surface:** <code>apps/web/app/globals.css:487-546,4835,6164-6170</code>; <code>SkillsView.tsx:638-703</code>; <code>SkillsModal.tsx:179-191</code>; <code>DesignSystemsView.tsx:757-825</code>; <code>AgentPreviewPanel.tsx:337-404</code>.
4. **User journey:** Phone/zoomed user edits skills, design systems, flows, secrets, members, or confirmation dialogs.
5. **Issue:** Modal overlay padding and non-wrapping action rows lack mobile overrides. Skills uses a fixed 280px column inside a card that can be only 272px wide. Design Systems and Agent Flow retain multi-column inline layouts; mobile panes hide overflow.
6. **Why it creates friction or risk:** Fields/actions can clip, compress beyond usability, or become unreachable rather than reflow.
7. **Expected impact:** Blocked configuration and destructive confirmations on small screens and browser zoom.
8. **Recommended fix:** Collapse grids/rows, wrap or stack actions, reduce overlay padding, cap dialogs to <code>100dvh</code>, and make all grid/flex children shrinkable.
9. **Suggested replacement copy:** Not applicable.
10. **Proposed code/design change:** Move inline layout declarations to responsive classes; at ≤600px use one column, full-width actions, <code>min-width:0</code>, scrollable modal body, and safe-area padding.
11. **Validation:** 320×568, 375×667, phone landscape, 200/400% zoom, long labels/errors, soft keyboard open, and every modal/editor action reachable without two-dimensional scrolling.

### F30 — Decorative landing mock leaks application semantics

1. **Title:** A single labelled mock image contains real nested landmarks, headings, and a button.
2. **Severity:** **High** — confirmed accessibility violation; live axe reported serious nested-interactive and landmark failures.
3. **Affected surface:** <code>apps/web/app/page.tsx:197-265</code>.
4. **User journey:** Landing page screen-reader/landmark/heading navigation.
5. **Issue:** The outer mock is <code>role=img</code> with an accessible label, but inner native <code>aside</code>, <code>nav</code>, <code>main</code>, <code>h3</code>, and <code>button</code> remain in the accessibility tree. This creates duplicate/nested landmarks and a button nested inside an image role.
6. **Why it creates friction or risk:** Decorative preview structure pollutes the real page outline and suggests an unavailable “New load” action.
7. **Expected impact:** Confusing landmark/heading navigation and misleading control announcements.
8. **Recommended fix:** Keep the concise outer image description and make the entire internal mock presentational/inert.
9. **Suggested replacement copy:** Existing image label is serviceable; shorten if necessary to “Gate 15 workspace building and previewing a freight dispatch board.”
10. **Proposed code/design change:** Replace inner semantic tags with <code>div/span</code>, add <code>aria-hidden=true</code> to the mock content, or render it as a single image; remove the native button.
11. **Validation:** Axe should report no duplicate/nested landmarks or nested interaction; screen-reader landmark and heading lists should contain only real page structure.

### F31 — Contact “Send message” only launches an email draft

1. **Title:** The contact form reports completion without delivering a message.
2. **Severity:** **Medium** — confirmed conversion risk.
3. **Affected surface:** page promise <code>apps/web/app/(marketing)/contact/page.tsx:115-123</code>; implementation <code>apps/web/components/ContactForm.tsx:18-45,130-143</code>.
4. **User journey:** Contact → complete form → Send message.
5. **Issue:** Submit builds a <code>mailto:</code> URL, changes <code>window.location.href</code>, and immediately replaces the form with a success status. No message reaches Gate 15 unless a configured mail client opens and the visitor separately sends the draft.
6. **Why it creates friction or risk:** No-handler, webmail-only, canceled draft, and mobile chooser outcomes look like success from the page's perspective.
7. **Expected impact:** Lost sales/support leads and false completion confidence.
8. **Recommended fix:** Add a real server-side contact endpoint with pending, delivered, failed, duplicate, and retry states plus abuse protection. If mailto remains, describe it as a draft handoff and retain the filled form.
9. **Suggested replacement copy:** CTA: “Open email draft.” Status: “Your email app should open with a draft. Review it and press Send to contact us.”
10. **Proposed code/design change:** Submit to a server route/provider, create a request ID, show success only after accepted delivery, preserve user input on failure, and provide a direct email fallback.
11. **Validation:** Test no mail handler, canceled draft, offline, server failure, slow response, duplicate submit, successful delivery, and keyboard/native validation.

### F32 — Guest storage copy misstates where work is saved

1. **Title:** “Saved on this device” conflates a browser session with server-side project storage.
2. **Severity:** **Medium** — confirmed trust/content problem.
3. **Affected surface:** <code>apps/web/components/GuestBanner.tsx:84-102</code>; server identity <code>services/orchestrator/src/auth/guest.ts:4-26,61-64</code>; cookie handling <code>apps/web/lib/guest-session.ts:20-22,43-52,64-72</code>.
4. **User journey:** Guest dashboard/workspace → understand persistence → clear cookies/change device/convert.
5. **Issue:** The device holds a sealed session cookie, while projects live server-side and can be restored elsewhere with the code. Current copy implies the work itself is local.
6. **Why it creates friction or risk:** Users can misunderstand what clearing browser data does, whether another device can access work, and what account conversion changes.
7. **Expected impact:** Lost access due to an unsaved recovery code, misplaced privacy expectations, and support requests.
8. **Recommended fix:** Explain the distinction between the browser-bound session, server-stored projects, and portable recovery code.
9. **Suggested replacement copy:** “This guest session is tied to this browser. Your projects are stored securely; save your recovery code to access them elsewhere.”
10. **Proposed code/design change:** Use the same persistence explanation on initial code modal, banner, restore form, docs, and conversion prompt. Add a “View recovery code” path where appropriate.
11. **Validation:** Comprehension testing for cookie clearing, another device, code recovery, and conversion; participants should accurately predict each outcome.

### F33 — Checkpoint and PR comments cannot identify an artifact

1. **Title:** Comment target kinds exist without immutable checkpoint/PR references.
2. **Severity:** **Medium** — confirmed collaboration-model defect.
3. **Affected surface:** <code>apps/web/components/CommentsView.tsx:16-23,135-168</code>; modal promise <code>apps/web/components/Workspace.tsx:873-879</code>.
4. **User journey:** Workspace → Comments → review a checkpoint or pull request → return later.
5. **Issue:** A comment can be typed as checkpoint or PR, but the form only captures element/file references. It stores no checkpoint ID/SHA, repository, or PR number.
6. **Why it creates friction or risk:** The thread cannot reliably return to the reviewed object when multiple checkpoints or PRs exist.
7. **Expected impact:** Ambiguous feedback, duplicated discussion, and a review feature that does not scale.
8. **Recommended fix:** Create comments from contextual artifact pickers and require immutable target references for checkpoint/PR kinds.
9. **Suggested replacement copy:** “Comment on checkpoint [timestamp/SHA]” and “Comment on PR #[number]: [title].”
10. **Proposed code/design change:** Extend the target schema with <code>checkpointId</code> or <code>repoId + pullNumber</code>; deep-link/render comments beside the artifact.
11. **Validation:** Create multiple checkpoints/PRs and threads; each comment must reopen the exact artifact, survive renames, and reject deleted/inaccessible targets clearly.

### F34 — Composite widgets and annotation patterns are incomplete

1. **Title:** Radio, tab, tooltip, and canvas patterns expose partial semantics without complete interaction.
2. **Severity:** **Medium** — confirmed accessibility inconsistency.
3. **Affected surface:** <code>AppearanceCard.tsx:39-75</code>; <code>PreviewAnnotator.tsx:421-525</code>; <code>DatabasesView.tsx:399-407</code>; <code>Tooltip.tsx:35-56</code>.
4. **User journey:** Choose theme/density, database tab, drawing tool/color/thickness, read a tooltip, annotate a screenshot.
5. **Issue:** Appearance radiogroups are unnamed, all radios are tabbable, and arrows do not move selection. Database tabs lack group name, arrow behavior, controls/panel relationships. Tooltip descriptions sit on non-focusable wrappers and are not inherited. The canvas is unnamed and pointer-dependent with no independent annotation list.
6. **Why it creates friction or risk:** Assistive technology receives roles that promise interaction behavior the component does not implement.
7. **Expected impact:** Extra Tab stops, missed descriptions, non-operable drawing controls, and no accessible equivalent for screenshot notes.
8. **Recommended fix:** Implement complete APG patterns or use honest button groups; attach descriptions to the focused node; provide a text-note/list alternative independent of canvas coordinates.
9. **Suggested replacement copy:** Group labels: “Theme,” “Density,” “Database view,” “Annotation tool.” Canvas: “Screenshot annotation canvas.”
10. **Proposed code/design change:** Add roving focus/arrow keys and labels to radio/tab groups; clone/render-prop tooltip triggers; expose annotations as editable list items with optional coordinates.
11. **Validation:** Keyboard and screen-reader tests for all groups/tooltips; create/edit/delete a text annotation without pointer input.

### F35 — Load failures masquerade as valid empty or disconnected states

1. **Title:** Several read errors erase state and render normal empty-state copy.
2. **Severity:** **Medium** — confirmed error-state/trust problem.
3. **Affected surface:** <code>TasksView.tsx:75-82,281-295</code>; <code>CommentsView.tsx:49-56,203-217</code>; settings/integrations in F18.
4. **User journey:** Open Tasks, Comments, or integration state during offline/server failure.
5. **Issue:** Tasks and Comments catches show a transient toast, set empty arrays, and then render “no tasks/comments.” Integration reads similarly collapse to disconnected.
6. **Why it creates friction or risk:** “There is no data” and “we could not load data” require different user decisions. A transient toast can disappear before the user understands why content vanished.
7. **Expected impact:** Users believe work/comments were deleted, create duplicates, or reconnect unnecessarily.
8. **Recommended fix:** Preserve <code>loading | ready(data) | empty | error</code> as distinct states; retain last-known content when safe; show persistent Retry.
9. **Suggested replacement copy:** “We couldn’t load tasks. Your existing tasks may still be there. Retry.”
10. **Proposed code/design change:** Use a shared async-resource state and skeleton/error/empty components; do not assign empty data in catch paths.
11. **Validation:** Seed data, force timeout/offline/500, and verify content is never labelled empty/disconnected; Retry must recover without duplicating mutations.

### F36 — Heading, landmark, skip-link, and status structure is inconsistent

1. **Title:** Public and settings structure does not consistently support fast assistive navigation.
2. **Severity:** **Medium** — confirmed accessibility issue/gap.
3. **Affected surface:** no global skip link in <code>apps/web/app/layout.tsx:41-49</code> or marketing layout <code>apps/web/app/(marketing)/layout.tsx:39-65</code>; Settings lacks a main landmark at <code>SettingsView.tsx:229-244</code>; Status starts with H2 at <code>status/page.tsx:24-104</code>; heading skips in <code>models/page.tsx:230-276</code>, <code>blog/page.tsx:20-65</code>, <code>changelog/page.tsx:888-910</code>; live axe results in §2.2.
4. **User journey:** Keyboard/screen-reader navigation across marketing, status, settings, and repeated global chrome.
5. **Issue:** No skip-to-content link exists; one protected shell lacks <code>main</code>; Status has no H1; several pages skip H2→H3. The decorative landing mock contributes duplicate landmarks (separately F30).
6. **Why it creates friction or risk:** Heading/landmark shortcuts become incomplete or misleading, and repeated navigation takes longer to bypass.
7. **Expected impact:** Slower navigation and weaker route announcements, particularly because Next.js uses title/H1/pathname to announce client navigation.
8. **Recommended fix:** Add a global skip link and stable main target; ensure one descriptive H1 per page and sequential structural headings; use visual classes instead of semantic level for size.
9. **Suggested replacement copy:** Status H1: “Gate 15 system status.” Skip link: “Skip to main content.”
10. **Proposed code/design change:** Put the skip link in root layout, standardize page shells, mark decorative headings presentational, and add automated heading/landmark tests.
11. **Validation:** Axe, accessibility-tree heading/landmark lists, keyboard skip behavior, and Next route announcements across all 21 pages.

### F37 — Destructive safeguards and semantic colors are inconsistent

1. **Title:** Some permanent actions lack confirmation/in-flight protection, and one delete confirmation is green.
2. **Severity:** **Medium** — confirmed destructive-action and visual-semantic risk.
3. **Affected surface:** Design Systems <code>DesignSystemsView.tsx:885-910</code> with token values <code>globals.css:70-75,170-172</code>; member removal <code>MembersView.tsx:81-89,250-259</code>; org removal <code>OrgMembersView.tsx:81-89,241-251</code>.
4. **User journey:** Delete design system; remove project/org member.
5. **Issue:** “Confirm delete” uses <code>--conf-high</code>, which is success green. Member removal has no confirmation and weak per-row in-flight/error behavior. Other destructive flows use stronger typed-name or two-step safeguards.
6. **Why it creates friction or risk:** Semantic inversion reduces warning salience; unconfirmed removal is vulnerable to slips and may change access immediately.
7. **Expected impact:** Accidental deletion/removal, uncertainty after a failed request, and inconsistent learned behavior.
8. **Recommended fix:** Use <code>--conf-low</code> for permanent actions, confirmation proportional to consequence, named impact, and scoped pending/error state. Do not require heavy typed confirmation for every member removal, but do require a clear modal/undo where feasible.
9. **Suggested replacement copy:** “Remove [name] from [project]? They will lose access immediately.” “Delete [design system]? This cannot be undone.”
10. **Proposed code/design change:** Add shared destructive-action tiers: reversible/undo, confirm, typed confirm. Route member/design-system actions through shared Modal and semantic tokens.
11. **Validation:** Misclick testing, keyboard focus/default action review, forced 403/500, rapid double click, and confirmation-copy snapshot tests.

### F38 — Marketing current state is absent and root duplicates chrome

1. **Title:** Public navigation does not identify the current page and has two implementations.
2. **Severity:** **Medium** — confirmed navigation/consistency issue.
3. **Affected surface:** <code>apps/web/components/MarketingNav.tsx:14-55</code>; current-state CSS exists at <code>apps/web/app/globals.css:10633-10647</code>; root duplicate at <code>apps/web/app/page.tsx:31-51</code>; shared layout <code>apps/web/app/(marketing)/layout.tsx:39-65</code>.
4. **User journey:** Browse among public pages and understand current location.
5. **Issue:** MarketingNav never reads the pathname or sets <code>aria-current</code>, despite designed support. Root uses a separate anchor-based header, increasing drift.
6. **Why it creates friction or risk:** Users get no persistent location cue; duplicated chrome makes responsive/auth/accessibility fixes easy to apply to only one header.
7. **Expected impact:** Mild orientation loss and long-term inconsistency.
8. **Recommended fix:** Parameterize one navigation component for landing anchors versus route destinations and mark the current route.
9. **Suggested replacement copy:** No copy change required.
10. **Proposed code/design change:** Use pathname-aware link data, <code>aria-current=page</code>, and shared mobile/desktop rendering; keep hover, focus, and current visually distinct.
11. **Validation:** Every public route should expose exactly one current item where applicable; verify root anchors, authenticated CTAs, keyboard focus, and mobile drawer.

### F39 — Several mobile touch targets remain undersized

1. **Title:** Small icon/text actions require target-size and spacing remediation.
2. **Severity:** **Medium** — confirmed platform usability gap; individual WCAG 2.5.8 failures depend on spacing exceptions.
3. **Affected surface:** guest recovery toggle <code>GuestLoginActions.tsx:201-208</code> (live 22px high); login docs link <code>login/page.tsx:30-36</code> (live ~14px text line); changelog commit links <code>changelog/page.tsx:880-927</code>; attachment close <code>globals.css:2582-2591</code>; tree/coarse pointer rules <code>:8577+</code>; annotator swatches.
4. **User journey:** Mobile login/recovery, changelog navigation, file management, attachment removal, annotation.
5. **Issue:** Several controls render below the 24px WCAG 2.2 minimum and below common 44–48px platform guidance; some may pass WCAG through spacing, but remain difficult to tap.
6. **Why it creates friction or risk:** Small targets increase selection errors, especially for motor impairments, one-handed use, and motion.
7. **Expected impact:** Mis-taps, slower task completion, and accidental removal.
8. **Recommended fix:** Give primary touch controls at least 44px hit boxes; ensure every target meets 24×24 or the formal spacing exception. Increase hit area without necessarily enlarging icons.
9. **Suggested replacement copy:** No copy change required.
10. **Proposed code/design change:** Add a coarse-pointer target token/class; use pseudo-elements/padding for compact icons; measure center-to-center spacing in automated tests.
11. **Validation:** 320/375/390px touch testing, WCAG target-spacing script, one-handed use, and screen magnification.

### F40 — Security promises an audit viewer that is not exposed

1. **Title:** Marketing says users can review a project audit trail, but no UI calls the existing API.
2. **Severity:** **Medium** — confirmed trust/product-claim mismatch.
3. **Affected surface:** claim <code>apps/web/app/(marketing)/security/page.tsx:150-151</code>; unused client wrapper <code>apps/web/lib/api.ts:1184-1186</code>; no consuming component found.
4. **User journey:** Security due diligence → project → inspect accountable history.
5. **Issue:** An audit endpoint wrapper exists, but the protected UI does not expose an audit/history viewer matching the present-tense claim.
6. **Why it creates friction or risk:** Security buyers evaluate controls as operational capabilities, not roadmap language.
7. **Expected impact:** Failed enterprise diligence and reduced confidence in other security assertions.
8. **Recommended fix:** Surface a scoped, filterable, immutable project audit viewer, or change the claim to accurately describe recording/API availability.
9. **Suggested replacement copy:** Interim: “Project audit events are recorded; a dedicated in-product viewer is not yet available.”
10. **Proposed code/design change:** Add Audit/History to the Review rail with actor, action, target, time, result, filters, pagination, export, and permission gating.
11. **Validation:** Navigate from a project to events and reconcile rows with API/audit records for deploy, secret, membership, checkpoint, and destructive actions.

### F41 — Findability does not scale beyond All Projects

1. **Title:** Search is isolated to one list and major resource collections have no global find path.
2. **Severity:** **Medium** — product improvement opportunity with scaling impact.
3. **Affected surface:** All Projects search/filter/sort <code>apps/web/components/ProjectPicker.tsx:2978-3132</code>; eleven local destinations <code>:368-397</code>; resources/organizations/settings/workspace actions.
4. **User journey:** Returning/power user finds a project, skill, design system, database, setting, action, comment, or task.
5. **Issue:** All Projects has useful search/filter/sort, but there is no product-wide command/search surface. Resource and activity lists rely on local navigation and may require full-list loading as volume grows.
6. **Why it creates friction or risk:** Capability breadth increases recognition/recall burden; users must remember where an item/action lives.
7. **Expected impact:** Lower discovery, slower expert workflows, and poor scaling for large accounts/organizations.
8. **Recommended fix:** Add a global command/search palette, scoped list search, and server pagination/cursors where collections can grow.
9. **Suggested replacement copy:** Trigger placeholder: “Search projects, resources, settings, and actions…”
10. **Proposed code/design change:** Index route destinations/actions client-side and query account content server-side; show type, location, permission, recent history, and keyboard shortcut.
11. **Validation:** Test 1, 100, 1,000, and 10,000-item fixtures; measure result relevance, keyboard time-to-action, pagination stability, and permission filtering.

### F42 — Mobile first-paint and tablet topbar need performance validation

1. **Title:** Mobile workspace renders desktop first and tablet topbar has a narrow breakpoint gap.
2. **Severity:** **Medium** — performance/responsive risk requiring rendered measurement.
3. **Affected surface:** <code>apps/web/lib/use-is-mobile.ts:5-31</code>; structural branch <code>apps/web/components/Workspace.tsx:652-777</code>; topbar <code>apps/web/app/globals.css:1629-1670</code>.
4. **User journey:** Cold-load a project on phone/tablet, especially on a slow device/network or with a long project name.
5. **Issue:** The hook deliberately renders desktop first and switches to structurally different mobile UI after an effect. The topbar remains a non-wrapping desktop row until 760px, leaving 768/834px tablets at risk.
6. **Why it creates friction or risk:** Structural swapping can cause layout shift, focus displacement, and perceived instability; tablet actions/name can collide before the mobile breakpoint.
7. **Expected impact:** Higher CLS, mis-taps, lost keyboard focus, and cluttered tablet headers.
8. **Recommended fix:** Use CSS-first responsive structure where possible, or server/client media strategy that reserves stable layout. Add truncation/overflow rules and an earlier compact topbar mode.
9. **Suggested replacement copy:** Not applicable.
10. **Proposed code/design change:** Measure rather than guess; instrument Web Vitals by viewport, add stable skeleton dimensions, and test a 761–1024px compact header.
11. **Validation:** Cold-load CLS/INP on real low/mid-tier phones, 3G/CPU throttling, 768/834/1024px, 200% text, 50+ character names, and focus persistence through hydration.

### F43 — Visual-system drift remains in product UI

1. **Title:** Emoji/dingbat icons, half-pixel type, and a legacy indigo active state bypass the documented design system.
2. **Severity:** **Low** — confirmed visual inconsistency.
3. **Affected surface:** project/starter icons <code>ProjectPicker.tsx:60-108</code>; agent/chat/model/plan glyphs including <code>AgentPreviewPanel.tsx:177</code>; legacy indigo <code>ChatSessionDropdown.tsx:208</code>; multiple 11.5/12.5/13.5px declarations in <code>apps/web/app/globals.css</code>, despite type guidance at <code>:82-92</code>.
4. **User journey:** Dashboard, model selection, chat/activity, sessions, design/resource editors.
5. **Issue:** The house guidance disallows emoji as UI icons and half-pixel type, but both remain; one selected row uses indigo from the previous palette.
6. **Why it creates friction or risk:** Platform-dependent emoji rendering and ad hoc type/color weaken coherence and can alter alignment across OS/browser.
7. **Expected impact:** Perceived polish/brand consistency rather than direct task failure.
8. **Recommended fix:** Replace functional emoji/dingbats with the existing vector icon vocabulary, snap type to tokens, and replace legacy indigo with semantic active tokens. User-selected project avatars can remain expressive if clearly treated as content.
9. **Suggested replacement copy:** Not applicable.
10. **Proposed code/design change:** Add lint/style checks for half-pixel font sizes, raw off-brand colors, and functional emoji in controls; migrate shared icons first.
11. **Validation:** Cross-platform screenshot review on Windows/macOS/iOS/Android and token-usage scan.

### F44 — Anonymous 404 recovery prioritizes an auth-gated route

1. **Title:** The main 404 action sends anonymous users into sign-in.
2. **Severity:** **Low** — confirmed navigation/content issue.
3. **Affected surface:** <code>apps/web/app/not-found.tsx:8-40</code>.
4. **User journey:** Anonymous visitor follows a broken public URL → recover.
5. **Issue:** “Back to projects” is the primary action while “Go home” is secondary. For anonymous visitors the primary path adds an unexpected authentication hop.
6. **Why it creates friction or risk:** Recovery should return users to the nearest safe context; role-unaware priority imposes another decision.
7. **Expected impact:** Minor bounce/abandonment and an avoidable sign-in redirect.
8. **Recommended fix:** Make Home primary for anonymous users and Projects primary for authenticated/guest users; add useful public destinations/search when appropriate.
9. **Suggested replacement copy:** Anonymous: “Go to Gate 15 home.” Signed in: “Back to projects.”
10. **Proposed code/design change:** Resolve session in the 404 shell or use neutral “Go home” primary plus “Open projects” secondary.
11. **Validation:** Test unknown public and protected URLs in anonymous, guest, and standard sessions.

### F45 — Localization and long-text readiness is not established

1. **Title:** English-only copy and fixed inline widths leave future localization risk.
2. **Severity:** **Informational** — product opportunity, not a current violation if English-only is intentional.
3. **Affected surface:** hardcoded <code>lang=en</code> at <code>apps/web/app/layout.tsx:43</code>; no localization dependency/layer; fixed widths and non-wrapping grids across workspace/settings/resource components.
4. **User journey:** Future non-English locale, browser translation, long name/error/provider/model strings.
5. **Issue:** Copy is embedded directly in components and several layouts assume short English labels.
6. **Why it creates friction or risk:** Translation expansion, pluralization, locale formatting, RTL, and long dynamic content can clip or distort dense UI.
7. **Expected impact:** Higher localization cost and late-stage responsive regressions.
8. **Recommended fix:** Decide whether localization is in scope. If yes, introduce message IDs, locale-aware date/number formatting, expansion-safe layouts, and pseudolocalization before adding languages.
9. **Suggested replacement copy:** Not applicable.
10. **Proposed code/design change:** Add pseudolocale tests at 30–50% expansion, remove fixed text-dependent widths, and set <code>lang</code>/<code>dir</code> per locale.
11. **Validation:** Pseudolocalization, long English fixtures, RTL smoke test, localized dates/numbers, 320px/400% zoom.

### F46 — Existing capability needs a persistent review/history and command layer

1. **Title:** The strongest product capabilities are fragmented rather than missing.
2. **Severity:** **Informational** — product improvement opportunity.
3. **Affected surface:** Workspace shell/activity/comments/tasks/checkpoints/audit API; dashboard routes/resources/settings; sources mapped in §1.4.
4. **User journey:** Returning user understands what changed, what needs approval, what failed, and where to act next.
5. **Issue:** Activity, agent preview, comments, tasks, checkpoints, errors, and audit data live in separate tabs/modals/menus; there is no persistent inbox/review timeline or command layer.
6. **Why it creates friction or risk:** Users must reconstruct a turn/project history from transient surfaces and remember where capabilities live.
7. **Expected impact:** Lower engagement with already-built features and weaker expert efficiency.
8. **Recommended fix:** Build a Review surface/timeline and a global command/search palette after the correctness/accessibility blockers are fixed.
9. **Suggested replacement copy:** Review sections: “Needs your attention,” “Changes,” “Checks,” “Comments,” “History.” Command placeholder: “Search or run an action…”
10. **Proposed code/design change:** Consolidate approvals, runtime/test status, diffs, comments, deploy/task events, checkpoints, and audit entries into a permission-aware event model; keep transient toasts only as pointers.
11. **Validation:** Longitudinal usability testing on multi-turn projects; measure time to answer “what changed?”, “what failed?”, “who did it?”, and “what do I need to do?”

## 6. Top 10 highest-impact improvements

1. **Fix deploy secret merging immediately (F01).** This is the only Critical issue and can break a production app through a normal, well-intentioned action.
2. **Remove sensitive briefs from URLs (F02).** This aligns the actual handoff with Gate 15's privacy/security positioning.
3. **Make paid promises executable (F04, F05).** Either complete trial/billing and accurate Auto copy or use honest non-transactional CTAs.
4. **Repair authentication/consent trust (F03, F07).** Rebrand hosted WorkOS and publish/link real policies before driving more sign-in traffic.
5. **Make guest verification recoverable (F06).** Keep Turnstile fail-closed while adding a client error/retry state.
6. **Return effective capabilities to the UI (F12).** One permission matrix should prevent a large family of failed-action experiences.
7. **Resolve destructive ownership/publication semantics (F14, F15, F37).** Users must know exactly what survives, moves, or loses access.
8. **Make core keyboard workflows complete (F21–F28).** Prioritize composer, menus, editor tabs, files, focus, labels, and contrast before secondary polish.
9. **Simplify and route the product shell (F09–F11).** Durable dashboard URLs and an App/Code/Review workspace model will expose existing power with less cognitive load.
10. **Use truthful persistent states (F16–F20, F35).** Never turn unknown/error into empty, disconnected, sent, queued, or platform-key.

## 7. Quick wins that can be completed immediately

| Effort | Change | Findings |
|---|---|---|
| Hours | Filter/remove empty stored-secret overrides and add a regression test | F01 |
| Hours | Replace pricing Auto copy with the current Anthropic/Google policy | F05 |
| Hours | Link or temporarily remove placeholder legal/social destinations; link login policies | F07 |
| Hours | Add <code>:focus-within</code> to both landing composers and restore local focus rings | F26 |
| Hours | Change Appearance/bright filled controls to near-black ink; replace raw accent foregrounds | F27 |
| Hours | Change Design Systems confirmation from <code>--conf-high</code> to <code>--conf-low</code> | F37 |
| Hours | Add H1 to Status, fix H2→H3 skips, add the global skip link/main target | F36 |
| Hours | Add labels/alert semantics to guest recovery and a permanent label to chat | F22, F28 |
| 1 day | Add explicit Turnstile error/expired/retry state | F06 |
| 1 day | Add error branches with Retry to Tasks, Comments, integrations, and custom prompts | F18, F20, F35 |
| 1 day | Preserve project/intent through GitHub OAuth | F19 |
| 1–2 days | Add pathname/aria-current and share one root/subpage marketing nav data source | F38 |
| 1–2 days | Add Move to… and migrate File Explorer overlays to shared Modal | F24, F25 |

## 8. Recommended improvement roadmap

### Phase A — Stop data/trust failures (0–2 weeks)

- Fix F01 and F02 with regression/privacy tests.
- Correct WorkOS branding, legal links, Auto claims, and Team CTA/support copy.
- Add Turnstile recovery.
- Separate error/unknown/empty/connected states and block Custom Prompts until load succeeds.
- Correct org/project deletion consequences and ship preflight receipts.

**Exit criteria:** No normal UI action can silently blank a stored secret; no prompt content enters URLs; every high-intent promise has either a working flow or accurate copy; unknown state is never represented as success/empty/disconnected.

### Phase B — Accessibility and mobile task completion (2–6 weeks)

- Create shared accessible menu/listbox, field, tab/radio, and responsive modal patterns.
- Repair chat composer/output, editor tab actions, file tree/move, overlays, focus, labels, and theme contrast.
- Add mobile marketing menu; replace dashboard strip; collapse complex grids.
- Establish automated axe/accessibility-name/contrast/keyboard tests and manual NVDA/VoiceOver/forced-colors checks.

**Exit criteria:** The primary create/build/review/deploy journeys are keyboard-complete; target WCAG 2.2 AA failures are resolved; 320px/400% zoom has no clipped actions.

### Phase C — Clarify roles and information architecture (4–10 weeks)

- Return role/capability data and apply it across every action.
- Route dashboard destinations and preserve history/deep links.
- Redesign workspace around App/Code/Review with Activity/attention rail.
- Implement real invitations and artifact-bound review comments.

**Exit criteria:** Viewer/editor/admin/owner users see correct affordances before acting; dashboard/workspace location survives refresh/Back/share; first-time users can find progress, changes, comments, errors, and publish.

### Phase D — Complete commercial and operational surfaces (6–12 weeks)

- Implement Team trial/checkout/billing/seats/invoices/cancellation.
- Make Agent Tasks executable with health/SLA or keep creation unavailable.
- Expose project audit/history.
- Deliver contact requests through a real endpoint.
- Add deploy/publication deletion controls with partial-failure recovery.

**Exit criteria:** Marketing, support, and in-product flows describe the same product; paid/team/security workflows can be completed end to end.

### Phase E — Scale and refine (ongoing)

- Add global command/search, pagination/cursors, persistent review/history/notifications.
- Measure Web Vitals/CLS and optimize mobile first paint.
- Replace visual-system drift and add token linting.
- Decide localization scope and add pseudolocalization if needed.

## 9. Accessibility gaps

Highest-priority WCAG gaps:

- **Keyboard/focus:** portaled menus, nested editor actions, drag-only file movement, custom overlays, and removed focus rings.
- **Name/role/value:** unlabeled chat/recovery/flow inputs, invalid tree ownership/focus, incomplete combobox/radio/tab semantics, tooltip description placement.
- **Status messages:** streaming agent output and several asynchronous errors are not announced or are reduced to transient toasts.
- **Contrast:** white on bright semantic/brand fills, raw ember foregrounds in light theme, fixed bright marketing semantic text, checked-control boundary/mark.
- **Reflow:** shared modal/action layout and inline fixed grids at 320px/400% zoom.
- **Structure:** missing skip link, Settings main landmark, Status H1, heading-order gaps, decorative mock landmarks.
- **Pointer alternatives/targets:** drag-only move, pointer-only canvas annotation, and several undersized targets.
- **High Contrast/AT validation:** no forced-colors strategy was found; Monaco screen-reader mode, preview iframe, WorkOS, and Turnstile require manual assistive-technology testing.

Recommended test gate:

1. ESLint with <code>jsx-a11y</code> enforced in CI.
2. Axe on every route/state story, not just page default.
3. Playwright keyboard assertions for menus, dialogs, tabs, tree, composer, and destructive flows.
4. Contrast-token tests for dark/light and gradient stops.
5. Manual NVDA + Chrome/Edge, VoiceOver + Safari, 400% zoom, Windows High Contrast, and reduced motion before release.

## 10. Mobile-specific issues

- Marketing discovery navigation disappears below 820px; Sign in disappears below 520px.
- Dashboard navigation flattens many destinations into an unlabeled horizontal strip.
- Workspace exposes six panes rather than a smaller task model.
- Modal padding/action rows and fixed grids can clip at 320px/zoom.
- File movement has no non-drag path; annotation remains pointer-centric.
- Several targets are 18–40px and need 24px spacing/44px usability remediation.
- Mobile first render swaps desktop to mobile after an effect, creating potential CLS/focus instability.
- Tablet topbar has a 761–1024px risk zone for long names and dense actions.

Positive mobile baseline: all 17 tested public routes reflowed without horizontal page overflow at 390×844 and 768×1024. The corrective work should preserve that marketing foundation.

## 11. Screens and flows requiring further user testing

1. **First-time project creation:** Can a new user choose guest/account, understand recovery, submit a useful brief, and know what happens next?
2. **Workspace mental model:** Can first-time and returning users find progress, app, code, files, errors, review, rewind, and publish without coaching?
3. **Viewer/editor/admin/owner collaboration:** Do users understand what each role can see/do before encountering denial?
4. **Organization leave/delete:** Can participants accurately predict project ownership/access after reading the confirmation?
5. **Published project deletion:** Do users distinguish deleting Gate 15 state from taking a public Vercel site offline?
6. **Team conversion:** Signed-out and signed-in acquisition, seat selection, invitation of a new user, acceptance, and billing management.
7. **Guest recovery under constrained networks:** School firewall, privacy blocker, expired/invalid CAPTCHA, lost code, another device.
8. **Agent Tasks:** Expectations for when work begins, whether the project must stay open, status/SLA, retry/cancel, and notification.
9. **Review/comments/history:** Artifact-level comments, “what changed?”, “what failed?”, “who acted?”, and approvals.
10. **Keyboard/screen-reader core loop:** Composer, suggestions, plan approval, streamed result, files/editor, preview error, deploy.

## 12. Remaining limitations

- Cloudflare Turnstile did not complete locally, so guest onboarding and protected screens could not be visually exercised beyond the login/recovery surface.
- WorkOS hosted authentication was visible, but no authenticated test account was used; signup/password-reset emails and all WorkOS error branches remain to be exercised.
- Protected/dashboard/workspace conclusions are implementation-confirmed but not all visually revalidated in this run.
- No production data, real billing account, Vercel deployment teardown, GitHub OAuth, provider-key billing, organization ownership mutation, or destructive operation was executed.
- Axe was run only on live default public states; it does not cover hidden modals, transient states, shadow/portal content, Monaco, cross-origin preview iframes, or screen-reader usability.
- Light-theme protected surfaces, 400% zoom, Windows High Contrast, real iOS/Android browsers, NVDA, VoiceOver, TalkBack, reduced bandwidth/CPU, and offline service-worker behavior require dedicated passes.
- The live pass used three representative viewports, not every intermediate width. Tablet/topbar and modal assertions marked “risk” still require rendered validation.
- Contrast values derived from source colors should be rechecked against final composited rendered pixels, particularly gradients/transparency.
- Performance was reviewed through source/perceived behavior, not a production Lighthouse/Web Vitals trace; no production bundle/network profile was available.
- No representative customer interviews, analytics, funnel data, support tickets, or usability sessions were available, so business impact is prioritized heuristically.

## 13. Final recommendation

Do not begin with a broad visual redesign. The visual foundation is already coherent and responsive on public pages. First make the product's promises, permissions, destructive consequences, and asynchronous states truthful; then make the core build/deploy workflow keyboard- and mobile-complete. After that, simplify the shell into durable dashboard routes and an App/Code/Review workspace, then expose the existing activity/comments/checkpoints/audit capability as a persistent Review/history layer.

That order fixes the root causes most likely to break work or trust while preserving the strongest current asset: a distinctive Gate 15 visual system wrapped around a genuinely capable product.

## 14. Resolution register — 2026-07-14

All 46 findings were re-checked against the implementation. Status totals: **39 Fixed**, **0 Already Resolved**, **1 False Positive**, **2 Blocked**, and **4 Needs Manual Validation**. “Fixed” below means the actionable defect or misleading promise was changed and at least source/type validation passed; remaining live-browser or external-system checks are stated explicitly.

### F01 — Fixed

- **Files changed:** `apps/web/components/DeployButton.tsx`, `services/orchestrator/src/deploy.ts`, `services/orchestrator/src/server.ts`, `services/orchestrator/src/deploy.security.test.ts`.
- **Fix:** Stored project secrets are included server-side only for project admins/owners and are no longer converted into editable empty overrides; editors can submit only explicit request values. Secret-load failures fail closed and stored values remain runtime-only rather than entering `build.env`.
- **Checks:** Consolidated orchestrator run passed 19 suites / 134 tests, including the deploy secret regression suite; orchestrator typecheck passed.
- **Remaining limitations:** A real Vercel deploy using production credentials was deliberately not executed.

### F02 — Fixed

- **Files changed:** `apps/web/lib/first-turn-intent.ts`, `apps/web/lib/first-turn-intent.test.ts`, `apps/web/components/LandingPrompt.tsx`, `apps/web/components/ProjectPicker.tsx`, `apps/web/components/Workspace.tsx`.
- **Fix:** Prompt text now stays in session storage behind an opaque, single-use `?intent=` identifier; consumption is idempotent and the draft remains recoverable when transfer fails.
- **Checks:** `first-turn-intent.test.ts` passed 2/2 tests; web typecheck passed; source scan confirms the handoff no longer emits `?brief=`.
- **Remaining limitations:** Browser-history/referrer inspection still requires an instrumented live session.

### F03 — Blocked

- Hosted authentication branding is controlled in the external WorkOS dashboard. The repository contains no supported local setting for that hosted logo/name, and this run had no WorkOS dashboard authority. Required action: set the hosted app name/logo to Gate 15 and manually validate sign-in, sign-up, reset, and error pages.

### F04 — Fixed

- **Files changed:** `apps/web/app/(marketing)/pricing/page.tsx`, `apps/web/app/(marketing)/support/page.tsx`, `apps/web/app/(marketing)/contact/page.tsx`.
- **Fix:** Nonexistent self-serve Team trial/billing promises were replaced with an honest assisted “talk to us” path and supporting copy.
- **Checks:** Web typecheck passed; CTA/link source review confirms no trial-start claim remains.
- **Remaining limitations:** Self-serve billing is still not implemented; the page no longer claims it is.

### F05 — Fixed

- **Files changed:** `apps/web/app/(marketing)/models/page.tsx`, `apps/web/app/(marketing)/pricing/page.tsx`.
- **Fix:** Auto-routing copy now states the implemented Anthropic + Google scope and no longer implies Z.ai or OpenAI participate in Auto.
- **Checks:** Web typecheck passed; copy was checked against `router.ts`/`autoRouter.ts` behavior documented in the repository.
- **Remaining limitations:** Provider availability still depends on configured keys.

### F06 — Fixed

- **Files changed:** `apps/web/components/Turnstile.tsx`, `apps/web/components/GuestLoginActions.tsx`.
- **Fix:** CAPTCHA loading, ready, expired, error, and retry states are explicit; guest entry stays fail-closed but is no longer a permanent dead end after widget failure.
- **Checks:** Web typecheck passed; state transitions and durable alert/label wiring were source-reviewed.
- **Remaining limitations:** Cloudflare could not complete in the local environment, so an actual expired/error widget needs live validation.

### F07 — Blocked

- Placeholder legal/social/abuse links were removed from `apps/web/components/SiteFooter.tsx` and the UI now says policies are pending instead of sending users to fake destinations. Publishing real Privacy, Terms, abuse-reporting, and approved social destinations is blocked on approved policy content and destination ownership not present in the repository.

### F08 — Fixed

- **Files changed:** `apps/web/components/MarketingNav.tsx`, `apps/web/app/(marketing)/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/globals.css`.
- **Fix:** Mobile marketing navigation now exposes the shared destination set in an accessible menu with Escape, outside-click, focus return, and pathname-aware current state.
- **Checks:** Web typecheck passed; keyboard/focus wiring and breakpoint rules were source-reviewed.
- **Remaining limitations:** VoiceOver/TalkBack testing remains manual.

### F09 — Fixed

- **Files changed:** `apps/web/components/ProjectPicker.tsx`, `apps/web/app/globals.css`.
- **Fix:** Dashboard view and project-history state are query-backed, so refresh, Back/Forward, deep links, and document titles preserve location.
- **Checks:** Web typecheck passed; query read/write paths and history behavior were source-reviewed.
- **Remaining limitations:** A signed-in browser history pass was not available.

### F10 — Needs Manual Validation

- The broad App/Code/Review information-architecture proposal is not a single correctness patch. Navigation, compact topbar, task naming, and durable dashboard routes were improved, but validating a larger shell redesign requires representative first-time/returning-user sessions before changing the product model.

### F11 — Fixed

- **Files changed:** `apps/web/components/ProjectPicker.tsx`, `apps/web/app/globals.css`.
- **Fix:** The unlabeled mobile strip was replaced with a labeled grouped selector/compact navigation treatment that preserves the active destination and organization context.
- **Checks:** Web typecheck passed; 320–760px CSS reflow rules and accessible labels were source-reviewed.
- **Remaining limitations:** Real-device touch exploration remains manual.

### F12 — Fixed

- **Files changed:** `packages/api-types/src/index.ts`, `services/orchestrator/src/db/members.ts`, `services/orchestrator/src/server.ts`, `apps/web/components/Workspace.tsx`, `apps/web/components/ProjectPicker.tsx`, `apps/web/components/MembersView.tsx`, `apps/web/components/OrgMembersView.tsx`, `apps/web/lib/role-capabilities.test.ts`.
- **Fix:** Project and organization payloads now carry the acting user’s effective role. Workspace, dashboard, project menus, and membership controls gate editor/admin/owner actions before requests are attempted and explain read-only access.
- **Checks:** Owner/admin/editor/viewer/null capability matrix passed 5/5 tests; web and orchestrator typechecks passed; server API enforcement remains in place.
- **Remaining limitations:** A full authenticated multi-user E2E role matrix still needs staging accounts.

### F13 — Fixed

- **Files changed:** `apps/web/components/MembersView.tsx`, `apps/web/components/OrgMembersView.tsx`.
- **Fix:** The existing direct-add capability is now labeled “Add an existing member” and explicitly requires an existing Gate 15 account, removing the false email-invitation promise.
- **Checks:** Web typecheck passed; all affected visible copy was source-reviewed.
- **Remaining limitations:** A true pending email invitation workflow remains a separate product capability and requires a transactional-email/token design.

### F14 — Fixed

- **Files changed:** `apps/web/components/OrgSettingsView.tsx`.
- **Fix:** Leave and delete confirmations now match backend consequences: leaving removes access without moving projects; owner deletion moves projects to Personal and removes other members. Organization-name typing is required for deletion.
- **Checks:** Web typecheck passed; copy was checked against the server mutation paths.
- **Remaining limitations:** No destructive production organization mutation was executed.

### F15 — Fixed

- **Files changed:** `apps/web/components/ProjectPicker.tsx`, `services/orchestrator/src/vercel.ts`, `services/orchestrator/src/server.ts`, `services/orchestrator/src/deploy.ts`, `services/orchestrator/src/db/projects.ts`, `services/orchestrator/src/db/schema.sql`, `services/orchestrator/src/vercel.test.ts`.
- **Fix:** Gate 15 records the immutable Vercel project ID and team. Project deletion removes that remote project first in the exact owning scope and retains local data on missing auth, team mismatch, timeout, or API failure; 404 is safely idempotent. Legacy name-only links fail closed with manual instructions.
- **Checks:** Vercel teardown suite passed 5/5 tests (missing auth, team mismatch, scoped ID request, 404, rejection); orchestrator and web typechecks passed.
- **Remaining limitations:** Legacy rows without a remote ID require one manual Vercel deletion; no real production site was destroyed.

### F16 — Fixed

- **Files changed:** `apps/web/components/ProjectPicker.tsx`.
- **Fix:** Rename, move, icon, and delete failures remain visible in their dialogs instead of being lost behind transient state; destructive controls stay open for retry.
- **Checks:** Web typecheck passed; rejection branches and persistent messages were source-reviewed.
- **Remaining limitations:** Live network-failure interaction remains manual.

### F17 — Fixed

- **Files changed:** `services/orchestrator/src/collabRoutes.ts`, `services/orchestrator/src/server.ts`, `apps/web/lib/api.ts`, `apps/web/components/TasksView.tsx`, `services/orchestrator/src/collabRoutes.security.test.ts`.
- **Fix:** Task list responses report worker availability; creation returns 503 without persisting work when the worker is disabled, and the UI disables creation with a durable explanation.
- **Checks:** Collaboration route suite passed 8/8 tests, including worker-off GET/POST cases; web and orchestrator typechecks passed.
- **Remaining limitations:** Long-running worker SLA/notification behavior was not load-tested.

### F18 — Fixed

- **Files changed:** `apps/web/components/ProviderKeysCard.tsx`, `apps/web/components/GithubRepoButton.tsx`, `apps/web/components/SettingsView.tsx`.
- **Fix:** Integration/BYOK loading failures have explicit error and retry states and are no longer represented as “disconnected” or “platform key”; Z.ai status is shown alongside other providers.
- **Checks:** Web typecheck passed; success/unknown/error branches were source-reviewed.
- **Remaining limitations:** Real provider and OAuth failures need connected staging accounts.

### F19 — Fixed

- **Files changed:** `apps/web/components/GithubRepoButton.tsx`.
- **Fix:** GitHub connect carries the current project and intended action through OAuth so callback returns to the initiating workflow.
- **Checks:** Web typecheck passed; URL construction and callback query handling were source-reviewed.
- **Remaining limitations:** A live GitHub OAuth round trip was not executed.

### F20 — Fixed

- **Files changed:** `apps/web/components/CustomPromptsCard.tsx`.
- **Fix:** Load failure is distinct from an empty prompt set; editing/saving stays blocked until a successful load and Retry is available, preventing an empty overwrite.
- **Checks:** Web typecheck passed; failure/save gating was source-reviewed.
- **Remaining limitations:** Live request interruption remains manual.

### F21 — Fixed

- **Files changed:** `apps/web/components/Popover.tsx`, `apps/web/components/ModelPicker.tsx`, `apps/web/components/PermissionModePicker.tsx`, `apps/web/components/ChatSessionDropdown.tsx`.
- **Fix:** Portaled menus/dialogs now support focus-on-open, focus containment where appropriate, Escape dismissal, focus restoration, and menu/listbox/radio semantics.
- **Checks:** Web typecheck passed; keyboard event and focus-return paths were source-reviewed.
- **Remaining limitations:** NVDA/VoiceOver behavior requires manual validation.

### F22 — Fixed

- **Files changed:** `apps/web/components/ChatPanel.tsx`, `apps/web/app/globals.css`.
- **Fix:** The composer has a durable accessible label; suggestions/model controls expose combobox/listbox state; streamed output, activity, errors, and logs use appropriate live/status semantics.
- **Checks:** Web typecheck passed; role/name/state source scan completed.
- **Remaining limitations:** Screen-reader announcement timing during real streams remains manual.

### F23 — Fixed

- **Files changed:** `apps/web/components/CodeEditor.tsx`, `apps/web/components/EditorPreviewArea.tsx`, `apps/web/app/globals.css`.
- **Fix:** Editor tabs implement tablist/tab/tabpanel relationships and close/save actions are sibling buttons rather than nested mouse-only spans.
- **Checks:** Web typecheck passed; tab keyboard/focus markup was source-reviewed.
- **Remaining limitations:** Monaco screen-reader mode requires manual AT testing.

### F24 — Fixed

- **Files changed:** `apps/web/components/FileExplorer.tsx`, `apps/web/lib/store.ts`, `services/orchestrator/src/server.ts`, `apps/web/app/globals.css`.
- **Fix:** File rows support roving keyboard focus, expand/collapse, context actions, and a keyboard-accessible Move flow; server-returned path mappings atomically update tree/editor/save state after rename/move/delete.
- **Checks:** Web and orchestrator typechecks passed; mutation and mapping paths were source-reviewed.
- **Remaining limitations:** A live VM multi-client move/rename session was not exercised.

### F25 — Fixed

- **Files changed:** `apps/web/components/Modal.tsx`, `apps/web/components/FileExplorer.tsx`, `apps/web/components/PreviewPanel.tsx`.
- **Fix:** File and preview custom overlays now use the shared accessible modal with consistent labeling, focus management, Escape, and background isolation.
- **Checks:** Web typecheck passed; modal call sites were source-reviewed.
- **Remaining limitations:** iOS/Safari focus behavior remains manual.

### F26 — Fixed

- **Files changed:** `apps/web/app/globals.css`.
- **Fix:** Visible `:focus-visible`/`:focus-within` treatment was restored on high-value composers, controls, tree rows, tabs, and icon actions using theme-safe focus tokens.
- **Checks:** Web typecheck passed; stylesheet scan confirms prior outline-removal cases now have explicit replacement focus cues.
- **Remaining limitations:** Windows High Contrast rendering remains manual.

### F27 — Fixed

- **Files changed:** `apps/web/app/globals.css`, `apps/web/components/AppearanceCard.tsx`, `apps/web/components/Toaster.tsx`, `apps/web/components/PreviewAnnotator.tsx`.
- **Fix:** Bright ember/signal fills use near-black ink, light-theme text/focus/semantic ramps were strengthened, and raw accent foregrounds were replaced by semantic `--accent-text`/status tokens.
- **Checks:** Token contrast calculations are documented beside the CSS; source scan and web typecheck passed.
- **Remaining limitations:** Final composited gradient/transparency pixels need rendered contrast verification.

### F28 — Fixed

- **Files changed:** `apps/web/components/ChatPanel.tsx`, `apps/web/components/GuestLoginActions.tsx`, `apps/web/components/Turnstile.tsx`, `apps/web/components/DatabasesView.tsx`, `apps/web/components/PreviewAnnotator.tsx`.
- **Fix:** Inputs and complex controls have durable labels/descriptions; CAPTCHA recovery, chat, tabs, and annotator controls expose usable accessible names and state.
- **Checks:** Web typecheck passed; accessible-name source scan completed.
- **Remaining limitations:** Browser accessibility-tree inspection remains manual.

### F29 — Fixed

- **Files changed:** `apps/web/components/Modal.tsx`, `apps/web/components/DesignSystemsView.tsx`, `apps/web/components/DatabasesView.tsx`, `apps/web/components/EditorPreviewArea.tsx`, `apps/web/app/globals.css`.
- **Fix:** Modal padding/actions, fixed grids, and complex editor rows collapse or wrap at narrow widths/zoom instead of clipping controls.
- **Checks:** Web typecheck passed; 320px/zoom-oriented breakpoint rules were source-reviewed.
- **Remaining limitations:** 400% rendered zoom on every protected dialog remains manual.

### F30 — Fixed

- **Files changed:** `apps/web/app/page.tsx`, `apps/web/app/globals.css`.
- **Fix:** Decorative landing-page product mock content is hidden from assistive technology so it no longer contributes fake landmarks, controls, or status content.
- **Checks:** Web typecheck passed; decorative subtree semantics were source-reviewed.
- **Remaining limitations:** None known.

### F31 — Fixed

- **Files changed:** `apps/web/components/ContactForm.tsx`, `apps/web/app/(marketing)/contact/page.tsx`.
- **Fix:** The surface now explicitly describes and labels an email-draft handoff rather than claiming to submit a message to Gate 15; failure guidance preserves the address/body for manual send.
- **Checks:** Web typecheck passed; CTA and error copy were source-reviewed.
- **Remaining limitations:** There is still no server-side support-ticket endpoint, and the UI no longer implies one.

### F32 — Fixed

- **Files changed:** `apps/web/components/GuestBanner.tsx`, `apps/web/components/GuestLoginActions.tsx`, `apps/web/app/(marketing)/support/page.tsx`.
- **Fix:** Guest copy now distinguishes server-stored temporary work from the browser-held recovery code and states the recovery/expiry consequence accurately.
- **Checks:** Web typecheck passed; copy was checked against guest-session storage behavior.
- **Remaining limitations:** Cross-device recovery still requires the recovery code by design.

### F33 — Fixed

- **Files changed:** `apps/web/components/CommentsView.tsx`.
- **Fix:** The comment UI offers only artifact targets the current backend can identify (file/line/general) and no longer promises checkpoint/PR attachment it cannot persist.
- **Checks:** Web typecheck passed; target payloads and labels were source-reviewed.
- **Remaining limitations:** Rich checkpoint/PR review threads remain a future capability.

### F34 — Fixed

- **Files changed:** `apps/web/components/AppearanceCard.tsx`, `apps/web/components/DatabasesView.tsx`, `apps/web/components/FileExplorer.tsx`, `apps/web/components/PreviewAnnotator.tsx`.
- **Fix:** Appearance uses a radiogroup, database sections use proper tabs, file navigation uses a tree/roving model, and annotator tools expose keyboard-operable toggle/state semantics.
- **Checks:** Web typecheck passed; APG role/state/keyboard mappings were source-reviewed.
- **Remaining limitations:** Canvas precision with switch devices requires manual testing.

### F35 — Fixed

- **Files changed:** `apps/web/components/TasksView.tsx`, `apps/web/components/CommentsView.tsx`, `apps/web/components/ProviderKeysCard.tsx`, `apps/web/components/CustomPromptsCard.tsx`, `apps/web/components/OrgMembersView.tsx`, `apps/web/components/OrgSettingsView.tsx`, `apps/web/components/OrgUsageView.tsx`.
- **Fix:** Loading, empty, error, disconnected, and unavailable states are distinct and failed loads provide Retry instead of silently presenting valid-empty content.
- **Checks:** Web typecheck passed; each affected fetch state machine was source-reviewed.
- **Remaining limitations:** Live flaky-network behavior remains manual.

### F36 — Fixed

- **Files changed:** `apps/web/app/layout.tsx`, `apps/web/app/(marketing)/layout.tsx`, `apps/web/app/(marketing)/status/page.tsx`, `apps/web/components/SettingsView.tsx`, `apps/web/app/globals.css`.
- **Fix:** A global skip link/main target, route landmarks, Status H1, and corrected heading levels provide consistent document structure; async statuses use status/alert roles.
- **Checks:** Web typecheck passed; heading/landmark source scan completed.
- **Remaining limitations:** Full axe coverage of authenticated transient states remains manual.

### F37 — Fixed

- **Files changed:** `apps/web/components/ProjectPicker.tsx`, `apps/web/components/OrgSettingsView.tsx`, `apps/web/components/MembersView.tsx`, `apps/web/components/OrgMembersView.tsx`, `apps/web/components/DesignSystemsView.tsx`, `apps/web/app/globals.css`.
- **Fix:** Destructive operations use semantic danger styling, explicit consequences, durable errors, and confirmation where risk warrants it; success/status colors no longer misuse the danger token.
- **Checks:** Web typecheck passed; destructive call sites and token usage were source-reviewed.
- **Remaining limitations:** No production destructive operation was executed.

### F38 — Fixed

- **Files changed:** `apps/web/components/MarketingNav.tsx`, `apps/web/app/(marketing)/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/components/SiteFooter.tsx`.
- **Fix:** Root and marketing subpages share navigation data/chrome and expose pathname-aware `aria-current`, removing duplicated divergent menus.
- **Checks:** Web typecheck passed; destination parity and active-state logic were source-reviewed.
- **Remaining limitations:** None known.

### F39 — Fixed

- **Files changed:** `apps/web/app/globals.css`, `apps/web/components/GuestLoginActions.tsx`, `apps/web/components/PreviewAnnotator.tsx`, `apps/web/components/ProjectPicker.tsx`, `apps/web/app/(marketing)/changelog/page.tsx`.
- **Fix:** The cited 18–40px mobile controls were raised to usable coarse-pointer targets (generally 44px), with larger close/icon/navigation hit areas and spacing rules.
- **Checks:** Web typecheck passed; coarse-pointer and target-size stylesheet scan completed.
- **Remaining limitations:** One-handed real-device spacing/mis-tap testing remains manual.

### F40 — Fixed

- **Files changed:** `apps/web/app/(marketing)/security/page.tsx`.
- **Fix:** Security copy now states that events are recorded without promising an in-product audit-trail viewer that does not exist.
- **Checks:** Web typecheck passed; public claim was checked against the current audit API/UI surface.
- **Remaining limitations:** A viewer remains a future product capability.

### F41 — Needs Manual Validation

- Search now has durable All Projects routing and list-state improvements, but the finding is a scale/product opportunity rather than a bounded defect. Choosing global search scope, pagination, and command behavior requires representative large workspaces and task analysis.

### F42 — Needs Manual Validation

- **Code improved:** `apps/web/app/globals.css` adds an earlier compact tablet topbar and stable overflow/truncation behavior. The remaining claim is explicitly performance validation: cold-load CLS/INP, hydration focus, throttled phones, 768/834/1024px, and long-name/200% text measurement need a production-like browser trace.

### F43 — Fixed

- **Files changed:** `apps/web/app/globals.css`, `apps/web/components/ChatSessionDropdown.tsx`, `apps/web/components/AgentPreviewPanel.tsx`, `apps/web/components/ModelPicker.tsx`, `apps/web/components/PermissionModePicker.tsx`, `apps/web/components/PlanDocument.tsx`, `apps/web/components/ProjectPicker.tsx`.
- **Fix:** Half-pixel type declarations were snapped to whole pixels, the legacy indigo selection was replaced with Gate 15 semantic active tokens, and cited functional emoji/dingbats were replaced by vector icons. User-selected project avatars remain expressive content, as permitted by the finding.
- **Checks:** Web typecheck passed; source scans found no remaining `.5px` font sizes in web CSS/TSX and no cited legacy indigo active state.
- **Remaining limitations:** Cross-platform screenshot comparison still requires Windows/macOS/iOS/Android rendering.

### F44 — Fixed

- **Files changed:** `apps/web/app/not-found.tsx`.
- **Fix:** Neutral Home recovery is now the primary anonymous-safe action; Projects remains a secondary option.
- **Checks:** Web typecheck passed; route/action ordering was source-reviewed.
- **Remaining limitations:** Authenticated-vs-anonymous visual smoke testing remains manual.

### F45 — False Positive

- The report itself classifies this as a future-market opportunity and “not a current violation if English-only is intentional.” Gate 15 currently declares English and has no requested locale contract; adding an i18n framework now would be speculative scope. Reopen when a supported-language requirement exists.

### F46 — Needs Manual Validation

- This is a product opportunity, not a discrete implementation defect. Activity, comments, tasks, checkpoints, and audit data already exist, but consolidating them into a Review/history and command layer requires an event-model/product decision plus longitudinal usability validation; implementing that architecture inside an audit-remediation pass would be an unjustified broad refactor.

## 15. UI/UX validation performed

- `npx vitest run apps/web/lib/role-capabilities.test.ts apps/web/lib/first-turn-intent.test.ts` — **2 files, 7 tests passed**.
- `npm --workspace @gate15/orchestrator test -- src/vercel.test.ts src/collabRoutes.security.test.ts` — **2 files, 13 tests passed**.
- `npm --workspace @gate15/web run typecheck` — **passed**.
- `npm --workspace @gate15/orchestrator run typecheck` — **passed**.
- Security-agent consolidated orchestrator validation covering F01 — **19 suites, 134 tests passed**.
- Static scans: no web `.5px` font sizes; exact role/task/Vercel paths reviewed; keyboard/focus/label/landmark states reviewed in source.

Remaining release risks are confined to the two external-content/configuration blockers and the four explicitly manual/product-validation findings above, plus the live-browser/external-service limitations recorded per fixed item. No finding is left unclassified.
