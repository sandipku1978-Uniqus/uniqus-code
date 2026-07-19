"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import BrandLockup from "./BrandLockup";
import ModelPicker from "./ModelPicker";
import AppearanceCard from "./AppearanceCard";
import CustomPromptsCard from "./CustomPromptsCard";
import ProviderKeysCard from "./ProviderKeysCard";
import BillingCard from "./BillingCard";
import Modal from "./Modal";
import { toast } from "@/lib/toast";
import {
  billingActivationReady,
  completedCheckoutSearch,
  formatUsd,
  isBillingCancelReturn,
  isBillingCheckoutReturn,
} from "@/lib/billing-display";
import {
  fetchGithubStatus,
  disconnectGithubApi,
  githubOauthStartUrl,
  fetchSupabaseStatus,
  disconnectSupabaseApi,
  supabaseOauthStartUrl,
  fetchFigmaStatus,
  disconnectFigmaApi,
  figmaOauthStartUrl,
  cancelBillingCheckoutApi,
  fetchBillingCheckoutStatusApi,
  fetchBillingStatusApi,
  ApiError,
  type BillingStatus,
  type GithubStatus,
  type SupabaseStatus,
  type FigmaStatus,
} from "@/lib/api";

/**
 * Settings → collapsible sections. Each <Section> is an independent native
 * <details> (so it works without JS and is keyboard-accessible); the section
 * heading is the <summary>, and the existing `.settings-card` blocks live
 * inside unchanged. Account + Integrations default open; the rest start
 * collapsed. This is purely a structural reorganization — every setting and its
 * behavior is preserved exactly.
 */
function Section({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  // Explicitly controlled (state + onToggle) rather than a bare `open={defaultOpen}`
  // binding — that pattern can re-assert the initial state on a parent re-render
  // (e.g. when editing a setting inside another section), snapping a section the
  // user opened/closed back. onToggle keeps React's state in lockstep with the
  // native disclosure so user toggles always stick.
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="settings-section"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary
        style={{
          listStyle: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          padding: "12px 4px",
          userSelect: "none",
        }}
      >
        <span
          aria-hidden
          className="settings-section-caret"
          style={{
            color: "var(--text-dim)",
            fontSize: 11,
            lineHeight: "20px",
            transition: "transform var(--dur-base) ease",
            transform: "translateY(-1px)",
          }}
        >
          ▸
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "var(--font-mono-stack)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "color-mix(in srgb, var(--accent-text) 72%, var(--text-muted))",
            }}
          >
            {title}
          </span>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{subtitle}</span>
        </span>
      </summary>
      <div style={{ marginTop: 4 }}>{children}</div>
      <style>{`
        .settings-section { border-top: 1px solid var(--border-default); }
        .settings-section:first-of-type { border-top: 0; }
        .settings-section > summary::-webkit-details-marker { display: none; }
        .settings-section[open] > summary .settings-section-caret { transform: rotate(90deg) translateY(-1px); }
        .settings-section > summary:hover .settings-section-caret { color: var(--text-muted); }
        .settings-section[open] > summary { margin-bottom: 4px; }
      `}</style>
    </details>
  );
}

function IntegrationStatusError({
  service,
  message,
  onRetry,
}: {
  service: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="async-error" role="alert">
      <p>
        {service} connection status is unavailable. An existing connection may
        still be active.
      </p>
      <code>{message}</code>
      <button type="button" className="btn-secondary" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clearBillingReturnParams(): void {
  const params = new URLSearchParams(window.location.search);
  params.delete("billing");
  params.delete("session_id");
  params.delete("attempt_id");
  const qs = params.toString();
  window.history.replaceState(
    {},
    "",
    window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
  );
}

export default function SettingsView({
  userEmail,
  userName,
  signOutUrl,
  accountType = "standard",
  signupHref,
}: {
  userEmail: string | null;
  userName: string | null;
  signOutUrl: string;
  accountType?: "standard" | "guest";
  signupHref: string;
}) {
  const isGuest = accountType === "guest";
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [supabase, setSupabase] = useState<SupabaseStatus | null>(null);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);
  const [confirmingSupabaseDisconnect, setConfirmingSupabaseDisconnect] = useState(false);
  const [disconnectingSupabase, setDisconnectingSupabase] = useState(false);
  const [figma, setFigma] = useState<FigmaStatus | null>(null);
  const [figmaError, setFigmaError] = useState<string | null>(null);
  const [confirmingFigmaDisconnect, setConfirmingFigmaDisconnect] = useState(false);
  const [disconnectingFigma, setDisconnectingFigma] = useState(false);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingState, setBillingState] = useState<"loading" | "ready" | "error">("loading");
  const [billingError, setBillingError] = useState<string | null>(null);
  const billingReturnResultRef = useRef<string | null | undefined>(undefined);
  const billingReturnAnnouncedRef = useRef(false);
  const billingActivationCompletedRef = useRef(false);
  if (typeof window !== "undefined" && billingReturnResultRef.current === undefined) {
    billingReturnResultRef.current = new URLSearchParams(window.location.search).get("billing");
  }

  const loadBillingStatus = useCallback((): void => {
    setBillingState("loading");
    setBillingError(null);
    fetchBillingStatusApi()
      .then(({ billing: nextBilling }) => {
        setBilling(nextBilling);
        setBillingState("ready");
      })
      .catch((error) => {
        setBilling(null);
        setBillingError(error instanceof Error ? error.message : "Couldn't check billing");
        setBillingState("error");
      });
  }, []);

  function loadGithubStatus(): void {
    setGithub(null);
    setGithubError(null);
    fetchGithubStatus()
      .then(setGithub)
      .catch((error) =>
        setGithubError(error instanceof Error ? error.message : "Couldn't check GitHub"),
      );
  }

  function loadSupabaseStatus(): void {
    setSupabase(null);
    setSupabaseError(null);
    fetchSupabaseStatus()
      .then(setSupabase)
      .catch((error) =>
        setSupabaseError(error instanceof Error ? error.message : "Couldn't check Supabase"),
      );
  }

  function loadFigmaStatus(): void {
    setFigma(null);
    setFigmaError(null);
    fetchFigmaStatus()
      .then(setFigma)
      .catch((error) =>
        setFigmaError(error instanceof Error ? error.message : "Couldn't check Figma"),
      );
  }

  useEffect(() => {
    if (isGuest) return;
    loadGithubStatus();
    loadSupabaseStatus();
    loadFigmaStatus();
    // These load helpers only close over state setters; this effect intentionally
    // runs when the account type changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  useEffect(() => {
    const billingReturn = billingReturnResultRef.current;
    if (isBillingCheckoutReturn(billingReturn)) {
      // The Checkout-return handler below owns this first read so an ordinary
      // status response cannot overwrite activation or cancellation state.
      return;
    }
    loadBillingStatus();
  }, [isGuest, loadBillingStatus]);

  // Checkout completion and webhook provisioning are separate events. Keep the
  // billing card in a named activation state until the subscription and its
  // credit grant are visible, then clear Stripe's return parameters.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const result = billingReturnResultRef.current ?? new URLSearchParams(window.location.search).get("billing");
    if (!result) return;
    let cancelled = false;

    if (result === "success") {
      const sessionId = new URLSearchParams(window.location.search).get("session_id");
      if (!billingReturnAnnouncedRef.current) {
        billingReturnAnnouncedRef.current = true;
        toast.info("Checkout returned — verifying payment and plan access");
      }
      if (billingActivationCompletedRef.current) {
        billingReturnResultRef.current = null;
        clearBillingReturnParams();
        return;
      }
      setBillingState("loading");
      setBillingError(null);
      void (async () => {
        if (!sessionId) {
          billingReturnResultRef.current = null;
          clearBillingReturnParams();
          setBilling(null);
          setBillingError(
            "Checkout returned without a session identifier, so this payment cannot be verified. No paid access has been granted.",
          );
          setBillingState("error");
          return;
        }
        let lastError: string | null = null;
        let invalidSession = false;
        for (let attempt = 0; attempt < 40 && !cancelled; attempt += 1) {
          if (attempt > 0) await wait(1_500);
          if (cancelled) return;
          try {
            const checkout = await fetchBillingCheckoutStatusApi(sessionId);
            if (!checkout.fulfilled) continue;
            const response = await fetchBillingStatusApi();
            if (cancelled) return;
            lastError = null;
            if (billingActivationReady(response.billing)) {
              setBilling(response.billing);
              setBillingState("ready");
              if (!billingActivationCompletedRef.current) {
                billingActivationCompletedRef.current = true;
                toast.success(
                  response.billing.plan === "byok"
                    ? "BYOK activated — add provider keys to start"
                    : "Plan activated and credits are ready",
                );
              }
              billingReturnResultRef.current = null;
              clearBillingReturnParams();
              return;
            }
          } catch (error) {
            lastError = error instanceof Error ? error.message : "Couldn't check billing";
            if (error instanceof ApiError && error.code === "invalid_checkout") {
              invalidSession = true;
              break;
            }
          }
        }
        if (cancelled) return;
        if (invalidSession) {
          billingReturnResultRef.current = null;
          clearBillingReturnParams();
        }
        setBilling(null);
        setBillingError(
          lastError ??
            "Stripe Checkout returned, but invoice-backed plan access is still pending. Retry this check; no paid access has been granted yet.",
        );
        setBillingState("error");
        toast.info("Plan verification is still pending — retry the billing check");
      })();
    } else if (isBillingCancelReturn(result)) {
      setBillingState("loading");
      setBillingError(null);
      void (async () => {
        try {
          const attemptId = new URLSearchParams(window.location.search).get("attempt_id");
          const cancellation = attemptId
            ? await cancelBillingCheckoutApi(attemptId)
            : { canceled: false, completed: false };
          if (cancelled) return;
          if (cancellation.completed) {
            if (!cancellation.session_id) {
              throw new Error(
                "Checkout completed without a session identifier, so this payment cannot be verified.",
              );
            }
            window.location.replace(
              window.location.pathname +
                `?${completedCheckoutSearch(window.location.search, cancellation.session_id)}` +
                window.location.hash,
            );
            return;
          }
          if (!billingReturnAnnouncedRef.current) {
            billingReturnAnnouncedRef.current = true;
            toast.info("Checkout canceled — your existing plan is unchanged");
          }
          billingReturnResultRef.current = null;
          clearBillingReturnParams();
          loadBillingStatus();
        } catch (error) {
          if (cancelled) return;
          setBilling(null);
          setBillingError(
            error instanceof Error
              ? error.message
              : "Couldn't close the canceled Checkout. Retry this check.",
          );
          setBillingState("error");
        }
      })();
    } else {
      clearBillingReturnParams();
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // WorkOS return URLs cannot carry a URL fragment through the server, but the
  // validated plan query survives. Restore the pricing CTA's intended landing
  // position after authentication.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!["byok", "plus", "max"].includes(params.get("plan") ?? "")) return;
    window.requestAnimationFrame(() => {
      document.getElementById("billing-settings")?.scrollIntoView({ block: "start" });
    });
  }, []);

  // Billing errors deep-link directly to the provider-key card, which lives in
  // a collapsed native disclosure. Open its owning section before scrolling so
  // the CTA never lands on hidden content.
  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#provider-keys-settings") {
      return;
    }
    const target = document.getElementById("provider-keys-settings");
    const section = target?.closest("details");
    if (section && !section.open) section.open = true;
    target?.scrollIntoView({ block: "start" });
  }, []);

  // Surface the OAuth round-trip result when Supabase redirects back to /settings.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get("supabase");
    if (!result) return;
    if (result === "connected") toast.success("Supabase connected");
    else if (result === "error") {
      toast.error(`Couldn't connect Supabase${params.get("reason") ? `: ${params.get("reason")}` : ""}`);
    }
    params.delete("supabase");
    params.delete("reason");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  // Surface the OAuth round-trip result when Figma redirects back to /settings.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get("figma");
    if (!result) return;
    if (result === "connected") {
      toast.success("Figma connected");
      loadFigmaStatus();
    } else if (result === "error") {
      toast.error(`Couldn't connect Figma${params.get("reason") ? `: ${params.get("reason")}` : ""}`);
    }
    params.delete("figma");
    params.delete("reason");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  async function handleDisconnectFigma(): Promise<void> {
    setDisconnectingFigma(true);
    try {
      await disconnectFigmaApi();
      setFigma({ connected: false, handle: null, connected_at: null });
      setConfirmingFigmaDisconnect(false);
      toast.success("Figma disconnected");
    } catch (err) {
      toast.error(`Couldn't disconnect Figma: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDisconnectingFigma(false);
    }
  }

  async function handleDisconnectSupabase(): Promise<void> {
    setDisconnectingSupabase(true);
    try {
      await disconnectSupabaseApi();
      setSupabase({ connected: false, org_id: null, org_name: null, connected_at: null });
      setConfirmingSupabaseDisconnect(false);
      toast.success("Supabase disconnected");
    } catch (err) {
      toast.error(
        `Couldn't disconnect Supabase: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setDisconnectingSupabase(false);
    }
  }

  async function handleDisconnectGithub(): Promise<void> {
    setDisconnecting(true);
    try {
      await disconnectGithubApi();
      setGithub({ connected: false, login: null, connected_at: null });
      setConfirmingDisconnect(false);
      toast.success("GitHub disconnected");
    } catch (err) {
      // Was previously swallowed — surface it so the user knows it failed (§D).
      toast.error(
        `Couldn't disconnect GitHub: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <>
      <nav className="topnav">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/" style={{ textDecoration: "none" }}>
            <BrandLockup />
          </Link>
        </div>
        <div className="right">
          <Link href="/projects" className="btn-ghost" style={{ fontSize: 12 }}>
            ← Back to projects
          </Link>
        </div>
      </nav>

      <main id="main-content" tabIndex={-1} className="settings-wrap">
        <span className="page-eyebrow">Account</span>
        <h1>Settings</h1>
        <p className="settings-lede">
          Account and workspace preferences. Some items are project-scoped and
          live in the workspace itself — see the pointers below.
        </p>

        {/* ── Account ────────────────────────────────────────────────────── */}
        <Section
          title="Account"
          subtitle="Your profile and session."
          defaultOpen
        >
          {/* Profile — functional */}
          <div className="settings-card">
            <h2>Profile</h2>
            <p className="settings-card-sub">Who you’re signed in as.</p>
            <div className="settings-row">
              <span className="k">Name</span>
              <span className="v">{userName ?? "—"}</span>
            </div>
            <div className="settings-row">
              <span className="k">Email</span>
              <span className="v">{userEmail ?? (isGuest ? "guest session" : "—")}</span>
            </div>
            <div className="settings-row">
              <span className="k">Account type</span>
              <span className="v">{isGuest ? "Guest" : "Standard"}</span>
            </div>
            <div className="settings-row">
              <span className="k">Session</span>
              <form action={signOutUrl} method="post">
                <button type="submit" className="btn-ghost" style={{ fontSize: 12 }}>
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </Section>

        {/* ── Billing ────────────────────────────────────────────────────── */}
        <Section
          title="Billing"
          subtitle="Your plan, model-usage wallet, and Stripe billing controls."
          defaultOpen
        >
          <div id="billing-settings">
            {isGuest ? (
              <div className="settings-card billing-guest-card">
                <h2>Guest trial</h2>
                <p className="settings-card-sub">
                  Guest sessions can try Gate 15, but subscriptions need a full account so
                  purchases, credits, and receipts stay attached to you.
                </p>
                <div className="settings-row">
                  <span className="k">Trial build balance</span>
                  <span className="v">
                    {billing
                      ? formatUsd(billing.usage_credit_balance_usd)
                      : billingState === "error"
                        ? (
                          <button type="button" className="btn-ghost" onClick={loadBillingStatus}>
                            Retry billing
                          </button>
                        )
                        : "Checking…"}
                  </span>
                </div>
                <div className="settings-row">
                  <span className="k">Ready to choose a plan?</span>
                  <Link href={signupHref} className="btn-primary">
                    Create your account
                  </Link>
                </div>
              </div>
            ) : (
              <BillingCard
                billing={billing}
                loadState={billingState}
                loadError={billingError}
                onRetry={
                  billingReturnResultRef.current
                    ? () => window.location.reload()
                    : loadBillingStatus
                }
              />
            )}
          </div>
        </Section>

        {/* ── Integrations ───────────────────────────────────────────────── */}
        <Section
          title="Integrations"
          subtitle="Connect external accounts the agent can act on."
          defaultOpen
        >
          {/* GitHub — functional (standard accounts only) */}
          {!isGuest && (
            <div className="settings-card">
              <h2>GitHub</h2>
              <p className="settings-card-sub">
                Connect GitHub to import private repos and push projects without
                pasting a token each time.
              </p>
              {githubError ? (
                <IntegrationStatusError
                  service="GitHub"
                  message={githubError}
                  onRetry={loadGithubStatus}
                />
              ) : github === null ? (
                <div className="settings-row">
                  <span className="k">Status</span>
                  <span className="v">checking…</span>
                </div>
              ) : github.connected ? (
                <div className="settings-row">
                  <span className="k">
                    Connected as <strong>@{github.login}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirmingDisconnect(true)}
                    className="btn-ghost"
                    style={{ fontSize: 12 }}
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="settings-row">
                  <span className="k">Not connected</span>
                  <a
                    href={githubOauthStartUrl(
                      typeof window !== "undefined"
                        ? window.location.origin + "/settings"
                        : "/settings",
                    )}
                    className="btn-primary"
                    style={{ fontSize: 12, padding: "6px 12px", textDecoration: "none" }}
                  >
                    Connect GitHub
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Supabase — functional (standard accounts only). Lets the agent
              provision a Postgres DB per project + wire env vars. */}
          {!isGuest && (
            <div className="settings-card">
              <h2>Supabase</h2>
              <p className="settings-card-sub">
                Connect Supabase so the agent can create a Postgres database for a
                project and wire its keys automatically. Manage databases from the
                Databases tab on the projects page.
              </p>
              {supabaseError ? (
                <IntegrationStatusError
                  service="Supabase"
                  message={supabaseError}
                  onRetry={loadSupabaseStatus}
                />
              ) : supabase === null ? (
                <div className="settings-row">
                  <span className="k">Status</span>
                  <span className="v">checking…</span>
                </div>
              ) : supabase.connected ? (
                <div className="settings-row">
                  <span className="k">
                    Connected{supabase.org_name ? <> to <strong>{supabase.org_name}</strong></> : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirmingSupabaseDisconnect(true)}
                    className="btn-ghost"
                    style={{ fontSize: 12 }}
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="settings-row">
                  <span className="k">Not connected</span>
                  <a
                    href={supabaseOauthStartUrl(
                      typeof window !== "undefined"
                        ? window.location.origin + "/settings"
                        : "/settings",
                    )}
                    className="btn-primary"
                    style={{ fontSize: 12, padding: "6px 12px", textDecoration: "none" }}
                  >
                    Connect Supabase
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Figma — functional (standard accounts only). Reads a file's published
              styles to seed a design system from the Design Systems tab. */}
          {!isGuest && (
            <div className="settings-card">
              <h2>Figma</h2>
              <p className="settings-card-sub">
                Connect Figma so the agent can read a file&apos;s published color &amp; text
                styles and infer a design system from them. Use it from the Design Systems tab.
              </p>
              {figmaError ? (
                <IntegrationStatusError
                  service="Figma"
                  message={figmaError}
                  onRetry={loadFigmaStatus}
                />
              ) : figma === null ? (
                <div className="settings-row">
                  <span className="k">Status</span>
                  <span className="v">checking…</span>
                </div>
              ) : figma.connected ? (
                <div className="settings-row">
                  <span className="k">
                    Connected{figma.handle ? <> as <strong>{figma.handle}</strong></> : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirmingFigmaDisconnect(true)}
                    className="btn-ghost"
                    style={{ fontSize: 12 }}
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="settings-row">
                  <span className="k">Not connected</span>
                  <a
                    href={figmaOauthStartUrl(
                      typeof window !== "undefined" ? window.location.origin + "/settings" : "/settings",
                    )}
                    className="btn-primary"
                    style={{ fontSize: 12, padding: "6px 12px", textDecoration: "none" }}
                  >
                    Connect Figma
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Project-scoped configuration — pointers, not duplicated UI */}
          <div className="settings-card">
            <h2>Per-project configuration</h2>
            <p className="settings-card-sub">
              These live inside each project because they differ per project. Per-project
              Skills extend the account-wide default skills set below.
            </p>
            <div className="settings-row">
              <span className="k">Skills (agent instructions)</span>
              <span className="v">Open a project, then the Skills button in its top bar</span>
            </div>
            <div className="settings-row">
              <span className="k">Secrets / API keys</span>
              <span className="v">Open a project, then the Secrets button in its top bar</span>
            </div>
            <div className="settings-row">
              <span className="k">Connectors</span>
              <span className="v">Configured per project from the agent tools</span>
            </div>
          </div>
        </Section>

        {/* ── Preferences ────────────────────────────────────────────────── */}
        <Section
          title="Preferences"
          subtitle="Appearance for the whole app, saved on this device."
        >
          {/* Appearance — functional (theme + density, account-wide client pref) */}
          <AppearanceCard />
        </Section>

        {/* ── Agent ──────────────────────────────────────────────────────── */}
        <Section
          title="Agent"
          subtitle="Default model, custom prompts, and default skills for new projects."
        >
          <div className="settings-card">
            <h2>Default model</h2>
            <p className="settings-card-sub">
              Choose which model the coding agent runs on. <strong>Auto</strong>{" "}
              lets Gate 15 pick the strongest model for each task. Under{" "}
              <strong>Advanced</strong>, override it with a specific model from
              Anthropic (Claude), Z.ai (GLM), OpenAI (ChatGPT), or Google
              (Gemini). This is your account-wide default; you can also change it
              per turn from the chat composer.
            </p>
            <div style={{ marginTop: 12 }}>
              <ModelPicker variant="settings" />
            </div>
          </div>

          {/* Custom prompts & default skills — functional (account-wide, persisted) */}
          <CustomPromptsCard />
        </Section>

        {/* ── Advanced ───────────────────────────────────────────────────── */}
        {!isGuest && (
          <Section
            title="Advanced"
            subtitle="Power-user controls — bring your own provider API keys."
          >
            {/* Bring-your-own provider keys (F7) — standard accounts only */}
            <div id="provider-keys-settings">
              <ProviderKeysCard billing={billing} billingState={billingState} />
            </div>
          </Section>
        )}
      </main>

      {confirmingDisconnect && (
        <Modal
          title="Disconnect GitHub?"
          width={460}
          onClose={() => !disconnecting && setConfirmingDisconnect(false)}
          footer={
            <>
              <span />
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirmingDisconnect(false)}
                  disabled={disconnecting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={handleDisconnectGithub}
                  disabled={disconnecting}
                >
                  {disconnecting ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)" }}>
            You’ll need to reconnect to import private repos or create repos. Repositories
            already on github.com are left untouched.
          </p>
        </Modal>
      )}

      {confirmingSupabaseDisconnect && (
        <Modal
          title="Disconnect Supabase?"
          width={460}
          onClose={() => !disconnectingSupabase && setConfirmingSupabaseDisconnect(false)}
          footer={
            <>
              <span />
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirmingSupabaseDisconnect(false)}
                  disabled={disconnectingSupabase}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={handleDisconnectSupabase}
                  disabled={disconnectingSupabase}
                >
                  {disconnectingSupabase ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)" }}>
            The agent won’t be able to create or query databases until you reconnect.
            Databases already provisioned on Supabase are left untouched.
          </p>
        </Modal>
      )}

      {confirmingFigmaDisconnect && (
        <Modal
          title="Disconnect Figma?"
          width={460}
          onClose={() => !disconnectingFigma && setConfirmingFigmaDisconnect(false)}
          footer={
            <>
              <span />
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirmingFigmaDisconnect(false)}
                  disabled={disconnectingFigma}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={handleDisconnectFigma}
                  disabled={disconnectingFigma}
                >
                  {disconnectingFigma ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)" }}>
            You’ll need to reconnect to infer design systems from Figma files. Your Figma
            files are untouched.
          </p>
        </Modal>
      )}
    </>
  );
}
