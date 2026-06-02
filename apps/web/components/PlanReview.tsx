"use client";

import { useState } from "react";
import type { Plan } from "@uniqus/api-types";
import { send } from "@/lib/ws-client";
import { useStore, type ChatItem } from "@/lib/store";

type PlanItem = Extract<ChatItem, { kind: "plan_proposal" }>;

export default function PlanReview({ item }: { item: PlanItem }) {
  const approvePendingPlan = useStore((s) => s.approvePendingPlan);
  const rejectPendingPlan = useStore((s) => s.rejectPendingPlan);
  const setPendingComposerText = useStore((s) => s.setPendingComposerText);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Plan>(item.plan);
  const isPending = item.status === "pending";
  const isRejected = item.status === "rejected";

  const approve = (plan: Plan) => {
    send({ type: "plan_approved", plan });
    approvePendingPlan(plan);
    setEditing(false);
  };

  // Reject the plan and hand control back to the composer with a revision
  // scaffold, instead of forcing the user to abort and retype everything (§C).
  const rejectAndRevise = () => {
    // Unwind the loop's wait-for-plan (server resolves it as aborted).
    send({ type: "abort" });
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
    <div className={`plan-card ${isPending ? "pending" : ""}`} style={{ marginLeft: 30 }}>
      <div className="label-micro" style={{ color: labelColor }}>
        Plan {label}
      </div>
      {editing ? (
        <textarea
          value={draft.summary}
          onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
          className="step-input"
          style={{ marginBottom: 10, minHeight: 50 }}
          rows={3}
          aria-label="Plan summary"
        />
      ) : (
        <p className="summary">{draft.summary}</p>
      )}
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
      {editing && (
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
  );
}
