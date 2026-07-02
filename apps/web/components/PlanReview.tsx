"use client";

import { useStore } from "@/lib/store";
import { useIsMobile } from "@/lib/use-is-mobile";
import PlanDocument, { type PlanItem } from "./PlanDocument";

/**
 * Chat-side entry point for a plan_proposal item.
 *
 * On desktop Builder view a PENDING plan renders as a full document in the
 * Builder stage (see Workspace's BuilderStage), so the chat gets only a compact
 * stub pointing at it — rendering (and editing) the same plan in two places at
 * once would let the two copies diverge. Everywhere else — mobile, Code view,
 * and decided plans in scrollback — the full document renders inline in chat.
 */
export default function PlanReview({ item }: { item: PlanItem }) {
  const isMobile = useIsMobile();
  const view = useStore((s) => s.view);
  const pendingPlanItemId = useStore((s) => s.pendingPlanItemId);

  // Only the CURRENT pending plan is mirrored on the stage; a stale pending
  // card from an aborted run (belt-and-suspenders — cancelPendingPlan should
  // resolve those) still renders inline rather than pointing at nothing.
  const onStage =
    !isMobile && view === "builder" && item.status === "pending" && item.id === pendingPlanItemId;

  if (onStage) {
    const plain = (item.plan.plain_summary ?? "").trim() || item.plan.summary;
    return (
      <div style={{ marginLeft: 30 }}>
        <div className="plan-stub" role="note">
          <div className="label-micro" style={{ color: "var(--brand-magenta)" }}>
            Plan — review
          </div>
          <p className="plan-plain">{plain}</p>
          <p className="plan-stub-hint">
            Review the full plan in the panel on the right — nothing runs until you approve it
            there.
          </p>
        </div>
      </div>
    );
  }

  return (
    // Phones get the full document inline in the chat pane (there's no side
    // stage to point at) — reclaim the avatar indent so it can use the whole
    // narrow viewport.
    <div style={{ marginLeft: isMobile ? 0 : 30 }}>
      <PlanDocument item={item} variant="inline" />
    </div>
  );
}
