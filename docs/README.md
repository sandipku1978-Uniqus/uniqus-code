# Uniqus Code — docs

Code-grounded reference docs for the orchestrator, sandbox, and platform
features. Each links to the source it describes; where something is not yet
implemented, the doc says so explicitly.

## Security & isolation

- [Firecracker security](../infra/firecracker/SECURITY.md) — per-project
  microVM trust boundary, tap/bridge/NAT networking and the /16 IP-collision
  limit, what is and isn't firewalled, read-only golden rootfs, GC/retention,
  and the honest list of current gaps. (Operational/latency detail:
  [Firecracker README](../infra/firecracker/README.md).)
- [Connector security](./connector-security.md) — first-party connectors
  (http/slack/postgres/github), server-side secret resolution (the agent
  passes names, not values), and audit logging of every invocation.
- [Secret handling](./secret-handling.md) — per-project secrets: AES-256-GCM at
  rest, per-env scoping (default/development/staging/production), values never
  returned to the model, and the audit trail.

## Platform features

- [Usage accounting](./usage-accounting.md) — input/output/cache-read/
  cache-creation token classes, per-model pricing (`MODEL_PRICING`), cost
  estimation (`estimateCostUsd`), and per-turn `usage_events` rows.
- [Checkpoints](./checkpoints.md) — shadow-git per-tool-call snapshots: what's
  captured/excluded and the non-destructive restore semantics.
- [GitHub import & sync](./github-import.md) — OAuth scope, zip vs GitHub
  import safeguards, branch selection, what's persisted, and current limits
  (not yet PR-native / bidirectional).
- [Supported stacks & limits](./supported-stacks-and-limits.md) — detected
  project types (Node/Python/Go/static; Next/Vite via package.json) and
  runtime ceilings (VM memory, ext4 sizing, hydration/import caps).
