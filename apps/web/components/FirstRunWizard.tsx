"use client";

import { useState } from "react";
import Modal from "./Modal";

/**
 * First-run wizard (B6): a tiny 2-step prompt-sharpener shown the first time a
 * vague brief is submitted. It turns "an expense app" into a richer brief by
 * asking who it's for and what data it works with, then templating the answers
 * onto the original brief (client-side — no extra model call). Fully skippable;
 * Skip just proceeds with the brief as typed. Fires once per user (the caller
 * gates on the onboarding flag and marks it seen).
 */
export default function FirstRunWizard({
  initialBrief,
  onComplete,
  onClose,
}: {
  initialBrief: string;
  /** Called with the (possibly enriched) brief to create the project from. */
  onComplete: (brief: string) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [who, setWho] = useState("");
  const [data, setData] = useState("");

  const finish = (skip: boolean): void => {
    const parts: string[] = [];
    if (!skip && who.trim()) parts.push(`Who will use it: ${who.trim()}`);
    if (!skip && data.trim()) parts.push(`Key data it works with: ${data.trim()}`);
    const brief = parts.length
      ? `${initialBrief}\n\nMore context:\n- ${parts.join("\n- ")}`
      : initialBrief;
    onComplete(brief);
  };

  const steps = [
    {
      q: "Who will use this?",
      hint: "e.g. “my finance team”, “external auditors”, “just me”.",
      value: who,
      set: setWho,
      placeholder: "Who's it for?",
    },
    {
      q: "What data does it work with?",
      hint: "e.g. “expense submissions”, “control test results”, “monthly budgets”.",
      value: data,
      set: setData,
      placeholder: "What information does it handle?",
    },
  ];
  const cur = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <Modal
      title="Let's sharpen your idea"
      subtitle="Two quick questions make the first build much better. You can skip anytime."
      width={500}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={() => finish(true)}>
            Skip
          </button>
          <div className="modal-actions">
            {step > 0 && (
              <button type="button" className="btn-secondary" onClick={() => setStep((s) => s - 1)}>
                Back
              </button>
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={() => (isLast ? finish(false) : setStep((s) => s + 1))}
            >
              {isLast ? "Build it" : "Next"}
            </button>
          </div>
        </>
      }
    >
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
          Step {step + 1} of {steps.length}
        </div>
        <label style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
          {cur.q}
        </label>
        <input
          type="text"
          value={cur.value}
          onChange={(e) => cur.set(e.target.value)}
          placeholder={cur.placeholder}
          aria-label={cur.q}
          autoFocus
          style={{ fontSize: 13, padding: "8px 10px" }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              isLast ? finish(false) : setStep((s) => s + 1);
            }
          }}
        />
        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{cur.hint}</div>
      </div>
    </Modal>
  );
}
