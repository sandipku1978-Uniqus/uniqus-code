import Link from "next/link";
import { withAuth } from "@workos-inc/authkit-nextjs";
import GuestBanner from "@/components/GuestBanner";
import LandingPrompt from "@/components/LandingPrompt";
import MarketingNav from "@/components/MarketingNav";
import SiteFooter from "@/components/SiteFooter";
import { getGuestSession } from "@/lib/guest-server";

/**
 * Landing page v3 — "workshop at first light".
 *
 * A quiet, editorial composition: an understated left-aligned hero with the
 * real composer, then one big painterly stage — the workspace window floating
 * on generated artwork of the gate at dawn (public/brand/atmos-stage.webp),
 * the window offset left so the painting's single ember glow stays visible.
 * Below: three asymmetric feature bands, a hairline trust index, and a calm
 * closing band. All styles live under `.landing-v3` in globals.css.
 */
export default async function MarketingPage() {
  const { user } = await withAuth();
  const guest = user ? null : await getGuestSession();
  const signedIn = !!user || !!guest;
  const ctaHref = signedIn ? "/projects" : "/login";
  const ctaPrimary = signedIn ? "Open dashboard" : "Get started";
  const ctaHero = signedIn ? "Open dashboard" : "Start building";

  return (
    <div className="marketing-shell landing-v3">
      {guest && <GuestBanner />}
      <MarketingNav
        signedIn={signedIn}
        ctaHref={ctaHref}
        ctaLabel={ctaPrimary}
        variant="landing"
        showSignIn={!user}
      />

      <main id="main-content" tabIndex={-1}>
        <section className="lv3-hero">
          <div className="lv3-hero-inner">
            <h1>
              The coding agent you can{" "}
              <span className="grad">hold accountable.</span>
            </h1>
            <p className="lv3-lede">
              Gate 15 plans before it touches a file, builds on a private machine
              per project, and keeps the running app beside the work. Claude,
              Gemini, GPT, or GLM — your pick, every turn.
            </p>

            {/* The landing composer is intentionally unchanged. */}
            <LandingPrompt
              variant="hero"
              signedIn={signedIn}
              ctaHref={ctaHref}
              ctaLabel={ctaHero}
              placeholder="Ask Gate 15 to build an internal tool that…"
              suggestions={HERO_SUGGESTIONS}
            />
          </div>
        </section>

        <section
          className="lv3-stage"
          id="product-proof"
          aria-label="The Gate 15 workspace: an approved plan, visible build activity, and a running preview of a dispatch board"
        >
          <div className="lv3-stage-frame">
            <StageWindow />
          </div>
          <div className="lv3-legend" aria-label="What the workspace shows">
            <span><b>01</b> Approved plan</span>
            <span><b>02</b> Visible activity</span>
            <span><b>03</b> Running preview</span>
            <span><b>04</b> Manual publish</span>
          </div>
        </section>

        <section className="lv3-band" id="workflow">
          <div className="lv3-band-copy">
            <span className="lv3-num">01 / Plan</span>
            <h2>Nothing changes until you approve the plan.</h2>
            <p>
              Send a brief and Gate 15 reads the project, then proposes concrete
              steps — files, migrations, tests. Edit the plan or approve it as-is;
              the first write happens after you say so.
            </p>
            <ul className="lv3-ticks">
              <li>Steps are editable before anything runs</li>
              <li>Every change stays visible while it builds</li>
            </ul>
          </div>
          <PlanVisual />
        </section>

        <section className="lv3-band flip" id="models">
          <div className="lv3-band-copy">
            <span className="lv3-num">02 / Models</span>
            <h2>The right model for the turn, not the subscription.</h2>
            <p>
              Auto matches each request to the model built for it — fast ones for
              small edits, deep reasoners for architecture. Override it for any
              single turn without touching the rest of the project.
            </p>
            <ul className="lv3-ticks">
              <li>Auto picks by task, not by price</li>
              <li>Override any single turn</li>
            </ul>
          </div>
          <ModelsVisual />
        </section>

        <section className="lv3-band" id="workspaces">
          <div className="lv3-band-copy">
            <span className="lv3-num">03 / Machine</span>
            <h2>Every project gets its own machine.</h2>
            <p>
              Real packages, real processes, a real database — inside a private VM
              that belongs to that project alone. Close the tab, come back next
              week, and it reopens exactly where you left it.
            </p>
            <ul className="lv3-ticks">
              <li>Install real packages and services</li>
              <li>State survives between sessions</li>
            </ul>
          </div>
          <MachineVisual />
        </section>

        <section className="lv3-trust" id="trust">
          <div className="lv3-trust-head">
            <div>
              <span className="lv3-num">04 / Trust</span>
              <h2>Nothing important happens off-screen.</h2>
            </div>
            <p>Five defaults that keep the agent honest — each one visible in the workspace at the moment it matters.</p>
          </div>
          <div className="lv3-trust-grid">
            {TRUST_ROWS.map((row) => (
              <article className="lv3-trust-cell" key={row.num}>
                <span className="lv3-trust-num">{row.num}</span>
                <h3>{row.title}</h3>
                <p>{row.body}</p>
                <span className={`lv3-evidence ${row.tone}`}>
                  <i aria-hidden="true" />
                  {row.evidence}
                </span>
              </article>
            ))}
          </div>
        </section>

        <section className="lv3-close">
          <div className="lv3-close-inner">
            <h2>Ready when you are.</h2>
            <p>Start from a sentence, a repo, or a zip.</p>

            {/* The landing composer is intentionally unchanged. */}
            <LandingPrompt
              variant="bottom"
              signedIn={signedIn}
              ctaHref={ctaHref}
              ctaLabel={ctaHero}
              placeholder="Describe the tool your team needs…"
            />

            <p className="lv3-close-note">
              Free for solo projects · Team plans from $20/seat/month ·{" "}
              <Link href="/pricing">See pricing</Link>
            </p>
          </div>
          <SiteFooter />
        </section>
      </main>
    </div>
  );
}

/** The workspace window that floats on the stage painting. Pure mock — every
 * control is decorative (tabIndex -1), the whole window reads as one image. */
function StageWindow() {
  return (
    <div
      className="lv3w"
      role="img"
      aria-label="Gate 15 workspace window: the agent pane shows an approved three-step plan and live build activity, the preview pane shows the running Meridian Freight dispatch board"
    >
      <div className="lv3w-bar" aria-hidden="true">
        <span className="lv3w-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="lv3w-title">
          <b className="lv3w-mark">15</b>
          meridian-dispatch <i>/</i> <strong>Builder</strong>
        </span>
        <span className="lv3w-run"><i /> Running</span>
      </div>

      <div className="lv3w-body" aria-hidden="true">
        <aside className="lv3w-chat">
          <div className="lv3w-brief">
            Build a dispatch board for our freight team — live loads, driver
            assignments, exception flags.
          </div>
          <div className="lv3w-plan">
            <header>
              <span><i /> Plan approved</span>
              <b>3 steps</b>
            </header>
            <ol>
              <li><span>01</span>Model loads, drivers, and exceptions</li>
              <li><span>02</span>Build the dispatch board</li>
              <li><span>03</span>Wire live updates and verify</li>
            </ol>
          </div>
          <div className="lv3w-act">
            <div><i className="done" /><span>Created 9 project files</span><time>0:14</time></div>
            <div><i className="done" /><span>Tests passing · 6/6</span><time>0:38</time></div>
            <div><i className="done" /><span>Captured desktop preview</span><time>0:47</time></div>
            <div><i className="live" /><span>Checking the mobile layout</span><time>live</time></div>
          </div>
          <div className="lv3w-note">
            <span>Ready for review</span>
            <p>The board is running. Desktop and mobile layouts checked.</p>
          </div>
        </aside>

        <div className="lv3w-app">
          <div className="lv3w-url">
            <span>preview.gate15.dev / dispatch</span>
            <b>Live</b>
          </div>
          <div className="lv3w-screen">
            <aside>
              <b className="lv3w-appmark">M</b>
              <nav>
                <b>Board</b>
                <span>Loads</span>
                <span>Drivers</span>
                <span>History</span>
              </nav>
            </aside>
            <main>
              <header>
                <div>
                  <small>MERIDIAN FREIGHT</small>
                  <h3>Dispatch board</h3>
                </div>
                <button type="button" tabIndex={-1}>+ New load</button>
              </header>
              <div className="lv3w-stats">
                <div><span>On the road</span><b>14</b></div>
                <div><span>Unassigned</span><b>03</b></div>
                <div><span>Exceptions</span><b>02</b></div>
              </div>
              <div className="lv3w-table">
                <div className="lv3w-th"><span>Load</span><span>Route</span><span>Driver</span><span>Status</span></div>
                <div className="lv3w-tr"><span>LD-2481</span><span>Oakland → Reno</span><span>D. Okafor</span><em className="ok">On time</em></div>
                <div className="lv3w-tr"><span>LD-2482</span><span>Fresno → Portland</span><span>M. Reyes</span><em className="warn">Delayed 40m</em></div>
                <div className="lv3w-tr"><span>LD-2484</span><span>Salt Lake → Boise</span><span>Unassigned</span><em>Needs driver</em></div>
                <div className="lv3w-tr"><span>LD-2485</span><span>Boise → Helena</span><span>J. Tran</span><em className="ok">On time</em></div>
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanVisual() {
  return (
    <div className="lv3-band-visual">
      <div className="lv3-viz" aria-label="A proposed four-step plan waiting for approval, with the files each step touches and edit and approve actions">
      <div className="lv3-viz-bar">
        <span className="lv3-viz-crumb"><b>15</b> crew-scheduler <i>/</i> plan</span>
        <span className="lv3-chip pending"><i aria-hidden="true" /> Waiting for approval</span>
      </div>
      <ol className="lv3-plan-steps">
        <li>
          <span className="n">01</span>
          <div><b>Model shifts and crews</b><small>schema.sql · seed.ts</small></div>
          <em>+96 lines</em>
        </li>
        <li>
          <span className="n">02</span>
          <div><b>Build the weekly rota with drag-to-swap</b><small>RotaView.tsx · rota.css</small></div>
          <em>+214 lines</em>
        </li>
        <li>
          <span className="n">03</span>
          <div><b>Flag overtime conflicts before they save</b><small>rules.ts</small></div>
          <em>+58 lines</em>
        </li>
        <li>
          <span className="n">04</span>
          <div><b>Run the suite and verify the preview</b><small>12 tests · desktop + mobile</small></div>
          <em>checks</em>
        </li>
      </ol>
      <footer className="lv3-viz-foot">
        <button type="button" tabIndex={-1} className="lv3-fake-ghost">Edit plan</button>
        <button type="button" tabIndex={-1} className="lv3-fake-primary">Approve &amp; build</button>
      </footer>
      </div>
      <aside className="lv3-float left" aria-hidden="true">
        <span>Plan edited</span>
        <b>Step 02 · updated by you</b>
      </aside>
    </div>
  );
}

function ModelsVisual() {
  return (
    <div className="lv3-band-visual">
      <div className="lv3-viz" aria-label="Auto routing the current turn to Claude Opus, with the quick and standard tiers routed to other models">
      <div className="lv3-viz-bar">
        <span className="lv3-viz-crumb"><b className="auto">A</b> auto routing</span>
        <span className="lv3-chip ok"><i aria-hidden="true" /> 4 providers online</span>
      </div>
      <div className="lv3-turn">
        <small>This turn</small>
        <p>&ldquo;Refactor the auth flow without breaking guest sessions.&rdquo;</p>
        <div className="lv3-turn-route">
          <span>Hard</span>
          <i aria-hidden="true">→</i>
          <b>Claude Opus 4.8</b>
          <em>deep reasoning</em>
        </div>
      </div>
      <div className="lv3-model-rows">
        <div className="lv3-model-row">
          <span className="lv3-tier">Quick</span>
          <p>Tighten the hero spacing on mobile</p>
          <b>Gemini 3.5 Flash</b>
        </div>
        <div className="lv3-model-row">
          <span className="lv3-tier">Standard</span>
          <p>Add CSV export to the reports page</p>
          <b>Claude Sonnet 4.6</b>
        </div>
      </div>
      <footer className="lv3-viz-foot models">
        <span>Prefer to choose?</span>
        <div><b>Claude</b><b>Gemini</b><b>GPT</b><b>GLM</b></div>
      </footer>
      </div>
      <aside className="lv3-float" aria-hidden="true">
        <span>Vision turn</span>
        <b>Screenshot → Gemini 3.5 Flash</b>
      </aside>
    </div>
  );
}

function MachineVisual() {
  return (
    <div className="lv3-band-visual">
      <div className="lv3-viz" aria-label="Isolation diagram: your browser reaches the Gate 15 control plane, which routes only to the selected project's private virtual machine">
      <div className="lv3-viz-bar">
        <span className="lv3-viz-crumb">workspace isolation</span>
        <span className="lv3-chip ok"><i aria-hidden="true" /> 2 projects</span>
      </div>
      <div className="lv3-iso">
        <div className="lv3-iso-node">Your browser <small>encrypted session</small></div>
        <div className="lv3-iso-stem" aria-hidden="true" />
        <div className="lv3-iso-node plane">Gate 15 control plane <small>routes only to the selected project</small></div>
        <div className="lv3-iso-fork" aria-hidden="true"><i /><i /></div>
        <div className="lv3-iso-vms">
          <article className="lv3-vm">
            <header>
              <span><i className="on" aria-hidden="true" /> VM 01 · Running</span>
              <b>crew-scheduler</b>
            </header>
            <div className="lv3-vm-grid">
              <span>Files</span>
              <span>Postgres 16</span>
              <span>Node 22</span>
              <span>Preview :4242</span>
            </div>
          </article>
          <article className="lv3-vm saved">
            <header>
              <span><i aria-hidden="true" /> VM 02 · Saved</span>
              <b>launch-site</b>
            </header>
            <div className="lv3-vm-grid">
              <span>Files</span>
              <span>SQLite</span>
              <span>Node 22</span>
              <span>State kept</span>
            </div>
          </article>
        </div>
      </div>
      </div>
      <aside className="lv3-float" aria-hidden="true">
        <span>Real runtime</span>
        <b>npm install stripe · ok</b>
      </aside>
    </div>
  );
}

const HERO_SUGGESTIONS = [
  "An internal admin tool",
  "A Stripe billing flow",
  "A customer CRM",
  "A marketing landing page",
] as const;

const TRUST_ROWS = [
  {
    num: "01",
    title: "Plans wait for you",
    body: "Review or edit the proposed approach before the first implementation step.",
    evidence: "Edit plan · Approve",
    tone: "pending",
  },
  {
    num: "02",
    title: "Sources stay attached",
    body: "Web-researched answers keep their citations — titles and domains visible.",
    evidence: "3 cited sources",
    tone: "ok",
  },
  {
    num: "03",
    title: "Secrets stay out of chat",
    body: "Credentials are stored encrypted; their values never appear in the conversation.",
    evidence: "DATABASE_URL · hidden",
    tone: "neutral",
  },
  {
    num: "04",
    title: "Any experiment can rewind",
    body: "Checkpoints give risky work a clear way back to a known-good state.",
    evidence: "Checkpoint v3 · 2 min ago",
    tone: "ok",
  },
  {
    num: "05",
    title: "Publishing is a decision",
    body: "Nothing goes live on its own. Shipping stays a visible action you choose.",
    evidence: "Not published",
    tone: "neutral",
  },
] as const;
