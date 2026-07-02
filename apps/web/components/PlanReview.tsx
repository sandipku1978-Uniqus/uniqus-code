"use client";

import { useEffect, useState } from "react";
import type { Plan } from "@uniqus/api-types";
import { send } from "@/lib/ws-client";
import { toast } from "@/lib/toast";
import { useStore, type ChatItem } from "@/lib/store";

type PlanItem = Extract<ChatItem, { kind: "plan_proposal" }>;

// One-time "why did a plan appear?" explainer (B1). Set once, globally, after
// the first plan the user sees.
const SEEN_PLAN_INTRO_KEY = "uniqus.seenPlanIntro";

export default function PlanReview({ item }: { item: PlanItem }) {
  const approvePendingPlan = useStore((s) => s.approvePendingPlan);
  const rejectPendingPlan = useStore((s) => s.rejectPendingPlan);
  const setPendingComposerText = useStore((s) => s.setPendingComposerText);
  const [editing, setEditing] = useState(false);
  // Guard the shape: a malformed plan (e.g. a truncated model tool-call with a
  // missing/non-array `steps`) must never crash the whole message with
  // "steps.map is not a function". Coerce `steps` to an array up front; the
  // orchestrator also normalizes, so this is belt-and-suspenders for old plans.
  const [draft, setDraft] = useState<Plan>(() => ({
    ...item.plan,
    steps: Array.isArray(item.plan?.steps) ? item.plan.steps : [],
  }));
  // B3: pure-client "Simplify" — show only the plain summary + safety line,
  // hide the steps / success criteria / technical summary. Zero model cost.
  const [simplified, setSimplified] = useState(false);
  // B2: the technical one-paragraph summary is secondary; collapsed by default.
  const [techOpen, setTechOpen] = useState(false);
  const isPending = item.status === "pending";
  const isRejected = item.status === "rejected";

  // B1 explainer banner — only until the user has seen one plan, and only on a
  // still-pending plan (no point explaining an already-decided one).
  const [showIntro, setShowIntro] = useState(false);
  useEffect(() => {
    if (!isPending) return;
    try {
      if (!localStorage.getItem(SEEN_PLAN_INTRO_KEY)) setShowIntro(true);
    } catch {
      /* private mode — just don't show it */
    }
  }, [isPending]);
  const dismissIntro = () => {
    setShowIntro(false);
    try {
      localStorage.setItem(SEEN_PLAN_INTRO_KEY, "1");
    } catch {
      /* non-fatal */
    }
  };

  // B2: prefer the plain-English sentence; fall back to the technical summary
  // for plans drafted before the planner learned to write one.
  const plain = (draft.plain_summary ?? "").trim() || draft.summary;
  const hasTech =
    !!draft.plain_summary?.trim() &&
    !!draft.summary?.trim() &&
    draft.summary.trim() !== draft.plain_summary.trim();

  const approve = (plan: Plan) => {
    // Check send()'s result (C-27): on a dropped socket the server never hears
    // the approval, so marking it "approved" locally would show the plan running
    // when nothing is. Surface the failure and leave the card actionable.
    if (!send({ type: "plan_approved", plan })) {
      toast.error("Couldn't reach the server — reconnecting. Try approving again in a moment.");
      return;
    }
    approvePendingPlan(plan);
    setEditing(false);
  };

  // Reject the plan and hand control back to the composer with a revision
  // scaffold, instead of forcing the user to abort and retype everything (§C).
  const rejectAndRevise = () => {
    // Unwind the loop's wait-for-plan (server resolves it as aborted).
    if (!send({ type: "abort" })) {
      toast.error("Couldn't reach the server — reconnecting. Try again in a moment.");
      return;
    }
    rejectPendingPlan();
    setPendingComposerText("Revise the plan: ");
  };

  const updateStep = (i: number, description: string) => {
    setDraft({
      ...draft,
      steps: draft.steps.map((s, idx) => (idx === i ? { ...s, description } : s)),
    });
  };

  const removeStep = (i: number) => {
    setDraft({ ...draft, steps: draft.steps.filter((_, idx) => idx !== i) });
  };

  const addStep = () => {
    setDraft({ ...draft, steps: [...draft.steps, { description: "" }] });
  };

  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.steps.length) return;
    const steps = [...draft.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setDraft({ ...draft, steps });
  };

  const label = isPending ? "— review" : isRejected ? "— rejected" : "— approved";
  const labelColor = isPending
    ? "var(--brand-magenta)"
    : isRejected
    ? "var(--conf-low)"
    : "var(--text-dim)";

  return (
    <div style={{ marginLeft: 30 }}>
      {showIntro && (
        <div className="plan-intro" role="note">
          <span style={{ flex: 1 }}>
            Uniqus drafted a <strong>plan</strong> first. Nothing runs until you click
            <strong> Approve &amp; run</strong>. You can turn this off anytime with the Plan
            toggle in the composer.
          </span>
          <button type="button" className="msg-action-btn" onClick={dismissIntro}>
            Got it
          </button>
        </div>
      )}
      <div className={`plan-card ${isPending ? "pending" : ""}`}>
        <div className="label-micro" style={{ color: labelColor }}>
          Plan {label}
        </div>
        {editing ? (
          <>
            <label className="plan-edit-label">Plain-English summary</label>
            <textarea
              value={draft.plain_summary ?? ""}
              onChange={(e) => setDraft({ ...draft, plain_summary: e.target.value })}
              className="step-input"
              style={{ marginBottom: 8, minHeight: 40 }}
              rows={2}
              placeholder="One plain sentence a non-technical user understands…"
              aria-label="Plain-English plan summary"
            />
            <label className="plan-edit-label">Technical summary</label>
            <textarea
              value={draft.summary}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              className="step-input"
              style={{ marginBottom: 10, minHeight: 50 }}
              rows={3}
              aria-label="Plan summary"
            />
          </>
        ) : (
          <>
            <p className="plan-plain">{plain}</p>
            {/* Hard-coded, model-independent safety line (B2). */}
            <p className="plan-safety">
              🔒 Nothing runs until you click <strong>Approve &amp; run</strong> — your files
              won&apos;t change before then.
            </p>
            {!simplified && draft.wireframe?.trim() && (
              // ASCII only — rendered as text in a <pre>, never as markup, so
              // there's no injection surface from model output (B4).
              <pre className="plan-wireframe" aria-label="Wireframe sketch">
                {draft.wireframe}
              </pre>
            )}
            {!simplified && !!draft.open_questions?.length && (
              <>
                <p className="label-micro" style={{ marginTop: 8, color: "var(--text-dim)" }}>
                  Open questions — answer in chat, or approve and the agent picks the default
                </p>
                <ul style={{ margin: "4px 0 8px", paddingLeft: 18 }} aria-label="Open questions">
                  {draft.open_questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </>
            )}
            {!simplified && hasTech && (
              <>
                <button
                  type="button"
                  className="plan-tech-toggle"
                  onClick={() => setTechOpen((v) => !v)}
                  aria-expanded={techOpen}
                >
                  {techOpen ? "▾" : "▸"} Technical summary
                </button>
                {techOpen && <p className="summary">{draft.summary}</p>}
              </>
            )}
          </>
        )}
        {!simplified && (
      <ol>
        {draft.steps.map((step, i) => (
          <li key={i}>
            {editing ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                <input
                  value={step.description}
                  onChange={(e) => updateStep(i, e.target.value)}
                  className="step-input"
                  style={{ marginBottom: 0 }}
                  aria-label={`Step ${i + 1}`}
                />
                <button
                  type="button"
                  onClick={() => moveStep(i, -1)}
                  disabled={i === 0}
                  className="icon-btn-sm"
                  title="Move step up"
                  aria-label="Move step up"
                  style={{ opacity: i === 0 ? 0.4 : 1 }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveStep(i, 1)}
                  disabled={i === draft.steps.length - 1}
                  className="icon-btn-sm"
                  title="Move step down"
                  aria-label="Move step down"
                  style={{ opacity: i === draft.steps.length - 1 ? 0.4 : 1 }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeStep(i)}
                  className="icon-btn-sm"
                  title="Remove step"
                  aria-label="Remove step"
                  style={{ color: "var(--conf-low)" }}
                >
                  ×
                </button>
              </div>
            ) : (
              <>
                <div>{step.description}</div>
                {step.success_criteria && (
                  <div className="step-criteria">↪ {step.success_criteria}</div>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
        )}
        {!simplified && editing && (
          <button
            type="button"
            onClick={addStep}
            className="btn-secondary"
            style={{ fontSize: 12, padding: "4px 10px", marginBottom: 8 }}
          >
            + Add step
          </button>
        )}
        {isPending && (
          <div className="actions">
            <button type="button" onClick={() => approve(draft)} className="btn-primary" style={{ fontSize: 12, padding: "6px 12px" }}>
              Approve & run
            </button>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="btn-secondary"
              style={{ fontSize: 12, padding: "6px 12px" }}
            >
              {editing ? "Done editing" : "Edit"}
            </button>
            {/* B3: pure-client simplify toggle — no model round-trip. */}
            {!editing && (
              <button
                type="button"
                onClick={() => setSimplified((v) => !v)}
                className="btn-ghost"
                style={{ fontSize: 12, padding: "6px 12px" }}
                title={
                  simplified
                    ? "Show the full plan with steps"
                    : "Show just the plain-English summary"
                }
              >
                {simplified ? "Show details" : "Simplify"}
              </button>
            )}
            <button
              type="button"
              onClick={rejectAndRevise}
              className="btn-ghost"
              style={{ fontSize: 12, padding: "6px 12px" }}
              title="Discard this plan and tell Uniqus what to do differently"
            >
              Reject &amp; revise
            </button>
          </div>
        )}
        {isRejected && (
          <div className="step-criteria" style={{ marginTop: 4 }}>
            Plan rejected — describe your changes in the composer below.
          </div>
        )}
      </div>
    </div>
  );
}
