import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function plannerInitialSections(focusTarget: string | null): {
  schedule: boolean;
  notes: boolean;
  knowledgeMap: boolean;
} {
  return {
    schedule: !focusTarget || focusTarget.startsWith("schedule-"),
    notes: !!focusTarget?.startsWith("note-"),
    knowledgeMap: false,
  };
}

/** Shared controlled disclosure used by the three large planner work areas. */
export function PlannerSection({
  open,
  onOpenChange,
  contentId,
  title,
  lede,
  primary = false,
  analyticsLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentId: string;
  title: string;
  lede: string;
  primary?: boolean;
  analyticsLabel: string;
  children: ReactNode;
}) {
  return (
    <details
      id={contentId.replace(/-content$/, "")}
      className="card planner-section"
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      data-fb={analyticsLabel}
    >
      <summary className="planner-section-summary" aria-controls={contentId}>
        <span className="planner-section-heading">
          <span className="planner-section-title">
            {title} {primary && <span className="planner-primary-badge">主要</span>}
          </span>
          <span className="planner-section-lede">{lede}</span>
        </span>
        <span className="planner-section-toggle" aria-hidden="true">
          {open ? "收合" : "展開"} <Icon name={open ? "ChevronUp" : "ChevronDown"} size={14} />
        </span>
      </summary>
      <div className="planner-section-body" id={contentId}>
        {children}
      </div>
    </details>
  );
}
