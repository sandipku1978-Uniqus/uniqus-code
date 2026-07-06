/**
 * F3 — Architecture diagram for the Security page.
 *
 * A labeled box-and-arrow SVG that depicts the four lanes a request crosses,
 * grounded in the real architecture (no embellishment):
 *
 *   1. Client / TLS edge      — browser over TLS 1.3.
 *   2. Orchestrator           — auth, provider routing (router.ts), server-side
 *                               secret decrypt (secrets.ts, AES-256-GCM).
 *   3. Sandbox fleet          — one isolated microVM per project; today all VMs
 *                               share a single bridge (fcbr0, 172.16/16) with
 *                               masquerade egress; in-VM sandbox-agent on :51000.
 *   4. Data stores            — project_secrets (AES-256-GCM at rest),
 *                               audit_events, messages.
 *
 * Server component (no interactivity). Uses the marketing color tokens so it
 * tracks light/dark theme, and is accessible (role="img" + <title>/<desc>).
 *
 * Panel height and y-position are COMPUTED from each lane's line count (see the
 * geometry block below) so the body copy can never overflow or get clipped by
 * its panel — earlier the heights were hand-tuned constants and the last line
 * of every box (and the final box) was cut off.
 */

// Lane content only — layout is derived from this below.
const LANE_CONTENT = [
  {
    id: "client",
    accent: "var(--mk-cyan)",
    label: "Client",
    title: "Your browser",
    lines: ["Encrypted with TLS 1.3", "in transit, end to end."],
  },
  {
    id: "orchestrator",
    accent: "var(--brand-magenta)",
    label: "Orchestrator",
    title: "Auth · routing · secret decrypt",
    lines: [
      "Verifies your session, routes the turn to",
      "Anthropic / Z.ai / OpenAI / Google, and",
      "decrypts secrets server-side (AES-256-GCM).",
    ],
  },
  {
    id: "fleet",
    accent: "var(--brand-purple-hi)",
    label: "Sandbox fleet",
    title: "One microVM per project",
    lines: [
      "Each project gets its own microVM with an",
      "in-VM agent on :51000. VMs share one bridge",
      "(172.16/16), but VM-to-VM traffic on it is",
      "dropped, so projects stay isolated from each other.",
    ],
  },
  {
    id: "data",
    accent: "var(--mk-green)",
    label: "Data stores",
    title: "Encrypted at rest",
    lines: [
      "project_secrets (AES-256-GCM) · audit_events · messages.",
      "Hard-deleted via cascade when you delete the project.",
    ],
  },
] as const;

// ── Geometry (SVG user units) ────────────────────────────────────────────────
const CANVAS_W = 920;
const X = 40; // panel left edge
const PANEL_W = 840; // panel width (right edge 880 → symmetric 40px margins)
const CENTER_X = X + PANEL_W / 2; // x of the vertical connectors
const TOP = 24; // top margin
const GAP = 32; // vertical gap between panels (room for the connector arrow)
const BADGE_DY = 30; // stage-badge baseline, from a panel's top
const TITLE_DY = 57; // heading baseline, from a panel's top
const BODY_TOP = 84; // first body-line baseline, from a panel's top
const LINE_H = 22; // body line height
const BOTTOM_PAD = 24; // breathing room below the last body line

const panelHeight = (lineCount: number) =>
  BODY_TOP + (lineCount - 1) * LINE_H + BOTTOM_PAD;

// Place each lane by accumulating heights + gaps from the top down.
const LANES = (() => {
  let y = TOP;
  return LANE_CONTENT.map((lane) => {
    const h = panelHeight(lane.lines.length);
    const placed = { ...lane, y, h };
    y += h + GAP;
    return placed;
  });
})();

// Connectors bridge each panel's bottom to the next panel's top.
const CONNECTORS = LANES.slice(0, -1).map((lane, i) => ({
  y1: lane.y + lane.h,
  y2: LANES[i + 1].y,
}));

const LAST = LANES[LANES.length - 1];
const CANVAS_H = LAST.y + LAST.h + TOP; // bottom margin mirrors the top

export default function ArchitectureDiagram() {
  return (
    <figure
      className="mk-card"
      style={{ margin: 0, padding: "clamp(20px, 3vw, 32px)", gap: 20 }}
    >
      <svg
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        width="100%"
        role="img"
        aria-labelledby="arch-title arch-desc"
        style={{ display: "block", maxWidth: "100%", height: "auto" }}
      >
        <title id="arch-title">
          How a request flows through Uniqus Code
        </title>
        <desc id="arch-desc">
          A request travels from your browser over TLS 1.3 to the orchestrator,
          which authenticates you, routes the turn to a model provider, and
          decrypts secrets server-side. The orchestrator drives a per-project
          isolated microVM (one VM per project, all VMs currently on a single
          shared bridge) and persists encrypted secrets, audit events, and
          messages to the data stores.
        </desc>

        <defs>
          <marker
            id="arch-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill="var(--mk-dim)" />
          </marker>
        </defs>

        {/* Vertical connectors between the four lanes. */}
        {CONNECTORS.map((c, i) => (
          <line
            key={i}
            x1={CENTER_X}
            y1={c.y1}
            x2={CENTER_X}
            y2={c.y2}
            stroke="var(--mk-dim)"
            strokeWidth="2"
            markerEnd="url(#arch-arrow)"
          />
        ))}

        {LANES.map((lane) => (
          <g key={lane.id}>
            {/* Lane panel */}
            <rect
              x={X}
              y={lane.y}
              width={PANEL_W}
              height={lane.h}
              rx="14"
              fill="color-mix(in srgb, var(--mk-panel-solid) 70%, transparent)"
              stroke="var(--mk-line)"
              strokeWidth="1.5"
            />
            {/* Accent rail */}
            <rect
              x={X}
              y={lane.y}
              width="6"
              height={lane.h}
              rx="3"
              fill={lane.accent}
            />
            {/* Stage badge */}
            <text
              x="72"
              y={lane.y + BADGE_DY}
              fill={lane.accent}
              fontSize="13"
              fontWeight="700"
              letterSpacing="0.06em"
              style={{
                fontFamily: "var(--font-mono-stack)",
                textTransform: "uppercase",
              }}
            >
              {lane.label}
            </text>
            {/* Heading */}
            <text
              x="72"
              y={lane.y + TITLE_DY}
              fill="var(--mk-text)"
              fontSize="19"
              fontWeight="650"
            >
              {lane.title}
            </text>
            {/* Body lines */}
            {lane.lines.map((ln, i) => (
              <text
                key={i}
                x="72"
                y={lane.y + BODY_TOP + i * LINE_H}
                fill="var(--mk-muted)"
                fontSize="14"
              >
                {ln}
              </text>
            ))}
          </g>
        ))}
      </svg>

      <figcaption
        style={{
          margin: 0,
          color: "var(--mk-muted)",
          fontSize: 14,
          lineHeight: 1.6,
          borderTop: "1px solid var(--mk-line)",
          paddingTop: 18,
        }}
      >
        Secrets are decrypted server-side only and written into the sandbox&rsquo;s{" "}
        <code
          style={{
            fontFamily: "var(--font-mono-stack)",
            color: "var(--mk-text)",
          }}
        >
          .env
        </code>{" "}
        — the agent receives the env-var <em>name</em>, never the plaintext
        value, so secrets never enter the model context.
      </figcaption>
    </figure>
  );
}
