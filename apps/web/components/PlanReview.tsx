"use client";

import { useState } from "react";
import type { Plan } from "@uniqus/api-types";
import { send } from "@/lib/ws-client";
import { useStore, type ChatItem } from "@/lib/store";

type PlanItem = Extract<ChatItem, { kind: "plan_proposal" }>;

export default function PlanReview({ item }: { item: PlanItem }) {
  const approvePendingPlan = useStore((s) => s.approvePendingPlan);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Plan>(item.plan);
  const isPending = item.status === "pending";

  const approve = (plan: Plan) => {
    send({ type: "plan_approved", plan });
    approvePendingPlan(plan);
    setEditing(false);
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

  return (
    <div className={`plan-card ${isPending ? "pending" : ""}`} style={{ marginLeft: 30 }}>
      <div className="label-micro" style={{ color: isPending ? "var(--brand-magenta)" : "var(--text-dim)" }}>
        Plan {isPending ? "— review" : "— approved"}
      </div>
      {editing ? (
        <textarea
          value={draft.summary}
          onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
          className="step-input"
          style={{ marginBottom: 10, minHeight: 50 }}
          rows={3}
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
                />
                <button
                  type="button"
                  onClick={() => removeStep(i)}
                  className="icon-btn-sm"
                  title="remove step"
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
        </div>
      )}
    </div>
  );
}
