import Link from "next/link";
import { withAuth } from "@workos-inc/authkit-nextjs";
import GuestBanner from "@/components/GuestBanner";
import LandingPrompt from "@/components/LandingPrompt";
import MarketingNav from "@/components/MarketingNav";
import SiteFooter from "@/components/SiteFooter";
import { getGuestSession } from "@/lib/guest-server";

/**
 * Landing page v4 — “the build record”.
 *
 * Gate 15 is presented as an accountable operating system for software work,
 * not a magical prompt box. The page opens with one representative build
 * ledger, follows that same build through its approval gates, and puts the real
 * project composer in the hero. Dark graphite is the default; the existing light
 * theme flips the editorial surfaces to cold concrete without changing the
 * product instrument.
 */
export default async function MarketingPage() {
  const { user } = await withAuth();
  const guest = user ? null : await getGuestSession();
  const signedIn = !!user || !!guest;
  const ctaHref = signedIn ? "/projects" : "/login";
  const ctaPrimary = signedIn ? "Open dashboard" : "Get started";
  const ctaHero = signedIn ? "Open dashboard" : "Start a build";

  return (
    <div className="marketing-shell landing-v4">
      {guest && <GuestBanner />}
      <MarketingNav
        signedIn={signedIn}
        ctaHref={ctaHref}
        ctaLabel={ctaPrimary}
        variant="landing"
        showSignIn={!user}
      />

      <main id="main-content" tabIndex={-1}>
        <section className="br-hero" aria-labelledby="br-title">
          <div className="br-hero-copy">
            <span className="br-kicker">Illustrative build record 015</span>
            <h1 id="br-title">
              Every change.
              <span>Accounted for.</span>
            </h1>
            <p>
              Gate 15 turns a brief into an approved plan, a private build, and
              a verifiable change record. You keep the final say at every gate.
            </p>
            <LandingPrompt
              variant="hero"
              signedIn={signedIn}
              ctaHref={ctaHref}
              ctaLabel={ctaHero}
              placeholder="Describe the tool your team needs…"
            />
            <div className="br-hero-actions">
              <a className="br-secondary-action" href="#workflow">
                Inspect the illustrative build
                <ArrowIcon />
              </a>
            </div>
          </div>

          <BuildRecord />
        </section>

        <section className="br-workflow" id="workflow" aria-labelledby="workflow-title">
          <header className="br-section-head br-section-head-wide">
            <div>
              <span className="br-kicker">One build / start to finish</span>
              <h2 id="workflow-title">The work stays legible while it moves.</h2>
            </div>
            <p>
              One request, one chain of custody. Plans, file changes, tests,
              preview checks, and the release decision stay attached to the same turn.
            </p>
          </header>

          <div className="br-stage-list">
            <article className="br-stage">
              <StageCopy
                number="01"
                label="Plan gate"
                title="Nothing changes until the plan is visible."
                body="Gate 15 reads the project and proposes concrete steps, files, migrations, and checks. Edit the approach or approve it as written."
              />
              <PlanLedger />
            </article>

            <article className="br-stage br-stage-flip">
              <StageCopy
                number="02"
                label="Private build"
                title="Every command lands on a machine for this project alone."
                body="Real packages, processes, databases, and dev servers run inside a private VM. The file delta and command trail remain visible as the build progresses."
              />
              <ChangeLedger />
            </article>

            <article className="br-stage">
              <StageCopy
                number="03"
                label="Verification"
                title="The running app is evidence, not decoration."
                body="Gate 15 runs the suite, opens the preview, checks responsive layouts, and reports the outcome beside the work that produced it."
              />
              <VerifyLedger />
            </article>

            <article className="br-stage br-release-stage">
              <StageCopy
                number="04"
                label="Release gate"
                title="Publishing remains a separate decision."
                body="A successful build is ready for review, not automatically live. Shipping stays an explicit action you control."
              />
              <div className="br-release-ledger" aria-label="Release status: ready for review and not published">
                <div>
                  <span className="br-status br-status-ready"><i aria-hidden="true" /> Ready for review</span>
                  <strong>Not published</strong>
                  <small>Last verified · 09:48</small>
                </div>
                <Link href="/docs#ship">
                  How publishing works
                  <ArrowIcon />
                </Link>
              </div>
            </article>
          </div>
        </section>

        <section className="br-evidence" id="evidence" aria-labelledby="evidence-title">
          <header className="br-section-head">
            <div>
              <span className="br-kicker">Control record</span>
              <h2 id="evidence-title">Nothing important happens off-screen.</h2>
            </div>
            <p>
              Five product defaults keep the agent accountable, with the receipt
              shown in the workspace at the moment it matters.
            </p>
          </header>

          <div className="br-control-ledger">
            {CONTROL_ROWS.map((row) => (
              <article className="br-control-row" key={row.number}>
                <span className="br-control-number">{row.number}</span>
                <div className="br-control-copy">
                  <h3>{row.title}</h3>
                  <p>{row.body}</p>
                </div>
                <span className={`br-control-proof ${row.tone}`}>
                  <i aria-hidden="true" />
                  {row.proof}
                </span>
              </article>
            ))}
          </div>
        </section>

        <section className="br-systems" id="product" aria-labelledby="systems-title">
          <header className="br-section-head br-section-head-wide">
            <div>
              <span className="br-kicker">Under the work</span>
              <h2 id="systems-title">A real machine. A deliberate model choice.</h2>
            </div>
            <p>
              The infrastructure stays predictable: a private runtime for the
              project and task-aware routing for each turn, both overridable by you.
            </p>
          </header>

          <div className="br-system-grid">
            <MachineLedger />
            <RoutingLedger />
          </div>
        </section>

        <section className="br-close" aria-labelledby="close-title">
          <div className="br-close-inner">
            <span className="br-kicker">New build request</span>
            <h2 id="close-title">Bring the brief. Keep the final say.</h2>
            <p>Start from a sentence, a repository, or a zip.</p>

            <Link className="btn-primary br-primary-action br-close-action" href={ctaHref}>
              {ctaHero}
            </Link>

            <p className="br-close-note">
              $3 trial usage · BYOK from $8/month ·{" "}
              <Link href="/pricing">See pricing</Link>
            </p>
          </div>
          <SiteFooter />
        </section>
      </main>
    </div>
  );
}

function BuildRecord() {
  return (
    <section className="br-record" aria-labelledby="record-title">
      <header className="br-record-head">
        <span className="br-record-mark" aria-hidden="true"><LedgerIcon /></span>
        <h2 id="record-title">Illustrative build record / Ready for review</h2>
        <span>Example · BR-015</span>
      </header>
      <ol className="br-record-rows">
        {BUILD_RECORD_ROWS.map((row) => (
          <li className={`br-record-row ${row.tone}`} key={row.number}>
            <span className="br-record-index">{row.number}</span>
            <span className="br-record-label">{row.label}</span>
            <span className="br-record-value">
              <i aria-hidden="true" />
              <span>{row.value}</span>
              {row.action && <b>{row.action}</b>}
            </span>
            <time>{row.time}</time>
          </li>
        ))}
      </ol>
      <footer className="br-record-foot">
        <span>Traceable</span>
        <span>Verifiable</span>
        <span>Accountable</span>
      </footer>
    </section>
  );
}

function StageCopy({
  number,
  label,
  title,
  body,
}: {
  number: string;
  label: string;
  title: string;
  body: string;
}) {
  return (
    <div className="br-stage-copy">
      <span className="br-stage-label"><b>{number}</b> / {label}</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function PlanLedger() {
  return (
    <div className="br-instrument br-plan-ledger" aria-label="An editable three-step plan waiting for approval">
      <header>
        <span>Proposed plan / 3 steps</span>
        <span className="br-status br-status-waiting"><i aria-hidden="true" /> Waiting for approval</span>
      </header>
      <ol>
        <li><b>01</b><span>Model loads, drivers, and exceptions<small>schema.sql · seed.ts</small></span><em>+96</em></li>
        <li><b>02</b><span>Build the dispatch board<small>DispatchBoard.tsx · board.css</small></span><em>+214</em></li>
        <li><b>03</b><span>Wire live updates and verify<small>events.ts · 6 tests</small></span><em>checks</em></li>
      </ol>
      <footer><span>Edit plan</span><strong>Approve &amp; build</strong></footer>
    </div>
  );
}

function ChangeLedger() {
  return (
    <div className="br-instrument br-change-ledger" aria-label="A live file and command record inside a private project machine">
      <header>
        <span>meridian-dispatch / Project VM</span>
        <span className="br-status br-status-running"><i aria-hidden="true" /> Running</span>
      </header>
      <div className="br-command">$ npm test &amp;&amp; npm run dev <span>process 4242</span></div>
      <div className="br-change-row"><span>schema.sql</span><em>+96</em><small>created</small></div>
      <div className="br-change-row"><span>DispatchBoard.tsx</span><em>+214</em><small>created</small></div>
      <div className="br-change-row"><span>board.css</span><em>+102 / −18</em><small>changed</small></div>
      <footer><span>9 files changed</span><strong>+412 / −38</strong></footer>
    </div>
  );
}

function VerifyLedger() {
  return (
    <div className="br-instrument br-verify-ledger" aria-label="Verification results for tests, desktop, mobile, and runtime errors">
      <header>
        <span>Verification record</span>
        <span className="br-status br-status-complete"><i aria-hidden="true" /> Complete</span>
      </header>
      <div className="br-verify-grid">
        <div><span>Test suite</span><strong>6 / 6</strong><small>passing</small></div>
        <div><span>Desktop</span><strong>1440</strong><small>checked</small></div>
        <div><span>Mobile</span><strong>390</strong><small>checked</small></div>
        <div><span>Console</span><strong>0</strong><small>errors</small></div>
      </div>
      <footer><span>Captured running preview</span><strong>09:41</strong></footer>
    </div>
  );
}

function MachineLedger() {
  return (
    <article className="br-system br-machine-ledger">
      <header>
        <div><span>Private workspace</span><h3>One project, one machine.</h3></div>
        <span className="br-status br-status-running"><i aria-hidden="true" /> Running</span>
      </header>
      <div className="br-machine-path" aria-label="Browser to control plane to private project VM to live preview">
        <span>Your browser<small>encrypted session</small></span>
        <i aria-hidden="true">→</i>
        <span>Control plane<small>selected project only</small></span>
        <i aria-hidden="true">→</i>
        <strong>Project VM<small>meridian-dispatch</small></strong>
        <i aria-hidden="true">→</i>
        <span>Live preview<small>port 4242</small></span>
      </div>
      <footer>
        <span>Node 22</span><span>Project disk</span><span>Saved state</span>
        <Link href="/workspaces">Explore workspaces <ArrowIcon /></Link>
      </footer>
    </article>
  );
}

function RoutingLedger() {
  return (
    <article className="br-system br-routing-ledger">
      <header>
        <div><span>Auto routing</span><h3>Fit the model to the turn.</h3></div>
        <span className="br-status br-status-complete"><i aria-hidden="true" /> Online</span>
      </header>
      <div className="br-route-row"><span>Quick</span><p>Tighten mobile spacing</p><strong>Gemini 3.5 Flash</strong></div>
      <div className="br-route-row"><span>Standard</span><p>Add CSV export</p><strong>Claude Sonnet 4.6</strong></div>
      <div className="br-route-row active"><span>Hard</span><p>Refactor authentication</p><strong>Claude Opus 4.8</strong></div>
      <footer><span>Override any turn</span><Link href="/models">Compare models <ArrowIcon /></Link></footer>
    </article>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}

function LedgerIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 5h10M6 10h10M6 15h10" />
      <path d="M3 5h.01M3 10h.01M3 15h.01" />
    </svg>
  );
}

const BUILD_RECORD_ROWS = [
  { number: "01", label: "Request", value: "Dispatch board for a freight team", time: "09:02", tone: "neutral", action: null },
  { number: "02", label: "Plan", value: "Approved by you · 09:14", time: "09:14", tone: "complete", action: null },
  { number: "03", label: "Changes", value: "9 files · +412 / −38", time: "09:27", tone: "changed", action: null },
  { number: "04", label: "Verify", value: "6/6 tests · desktop + mobile checked", time: "09:41", tone: "complete", action: null },
  { number: "05", label: "Release", value: "Waiting for your approval", time: "09:48", tone: "pending", action: "Approval required" },
] as const;

const CONTROL_ROWS = [
  {
    number: "01",
    title: "Plans wait for you",
    body: "Review or edit the proposed approach before the first implementation step.",
    proof: "Edit plan · Approve",
    tone: "waiting",
  },
  {
    number: "02",
    title: "Sources stay attached",
    body: "Web-researched answers keep their citations, titles, and domains visible.",
    proof: "3 cited sources",
    tone: "complete",
  },
  {
    number: "03",
    title: "Secrets stay out of chat",
    body: "Credentials are encrypted and their raw values never appear in the conversation.",
    proof: "DATABASE_URL · hidden",
    tone: "neutral",
  },
  {
    number: "04",
    title: "Experiments can rewind",
    body: "Checkpoints give risky work a clear path back to a known-good state.",
    proof: "Checkpoint v3 · 2 min ago",
    tone: "complete",
  },
  {
    number: "05",
    title: "Publishing is a decision",
    body: "Nothing goes live on its own. Shipping remains a visible action you choose.",
    proof: "Not published",
    tone: "neutral",
  },
] as const;
