import type { ProjectStatusSummary, StatusItem } from "./projectStatusSummary";
import type { ProjectNextStep } from "./projectNextSteps";
import type { ProjectBlocker } from "./projectBlockers";
import { Card, Meta } from "../../components/ui";

export type ProjectStatusHeroProps = {
  summary: ProjectStatusSummary;
  /** 最多 3 個 deterministic 下一步（一句話 + 主按鈕） */
  nextSteps?: ProjectNextStep[];
  /** 最多 5 個 blockers（發生什麼 / 影響 / 怎解） */
  blockers?: ProjectBlocker[];
  /** 點擊進度／下一步／執行／待處理時呼叫（anchor 不含 #） */
  onNavigate?: (anchor: string) => void;
  className?: string;
};

function StatusRow({
  item,
  onNavigate,
  tone,
}: {
  item: StatusItem;
  onNavigate?: (anchor: string) => void;
  tone?: "running" | "attention";
}) {
  const clickable = Boolean(item.anchor && onNavigate);
  const className = [
    "project-status-hero__item",
    item.done ? "is-done" : "",
    tone === "running" ? "is-running" : "",
    tone === "attention" ? "is-attention" : "",
    clickable ? "is-clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (clickable) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => onNavigate!(item.anchor!)}
        title={item.anchor ? `前往 ${item.label}` : undefined}
      >
        {item.label}
      </button>
    );
  }
  return <span className={className}>{item.label}</span>;
}

/**
 * 專案頁首屏狀態摘要：目前階段、下一步、卡住了、真實工作流進度、正在執行、需要處理。
 * blockers 由 deriveProjectBlockers 推導（deterministic，最多 5）。
 */
export function ProjectStatusHero({
  summary,
  nextSteps,
  blockers,
  onNavigate,
  className = "",
}: ProjectStatusHeroProps) {
  const steps =
    nextSteps && nextSteps.length > 0
      ? nextSteps.slice(0, 3)
      : summary.nextLabel
        ? [
            {
              id: "legacy-next",
              kind: "generate_shot" as const,
              label: summary.nextLabel,
              actionLabel: "前往",
              anchor: summary.nextAnchor,
              priority: 0,
            },
          ]
        : [];

  return (
    <Card
      as="section"
      className={`project-status-hero ${className}`.trim()}
      aria-label="專案進度摘要"
      data-fb="專案首屏進度"
      data-stage={summary.stageId}
    >
      <div className="project-status-hero__stage">
        <Meta as="p" className="project-status-hero__stage-label">
          目前：<strong>{summary.stageLabel}</strong>
        </Meta>
        {summary.statusLine ? (
          <p className="project-status-hero__status-line">{summary.statusLine}</p>
        ) : null}
      </div>

      {steps.length > 0 ? (
        <div className="project-status-hero__next-block" data-fb="專案下一步">
          <span className="project-status-hero__block-label">下一步</span>
          <ul className="project-status-hero__next-list" aria-label="建議下一步">
            {steps.map((step, i) => {
              const clickable = Boolean(step.anchor && onNavigate);
              return (
                <li key={step.id} className="project-status-hero__next-row">
                  <span className="project-status-hero__next-index" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="project-status-hero__next-text">{step.label}</span>
                  {clickable ? (
                    <button
                      type="button"
                      className="project-status-hero__next-btn"
                      onClick={() => onNavigate!(step.anchor)}
                    >
                      {step.actionLabel}
                    </button>
                  ) : (
                    <span className="project-status-hero__next-btn is-static">{step.actionLabel}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {blockers && blockers.length > 0 ? (
        <div className="project-status-hero__blockers" data-fb="專案卡住了">
          <span className="project-status-hero__block-label">卡住了</span>
          <ul className="project-status-hero__blocker-list" aria-label="專案阻塞">
            {blockers.slice(0, 5).map((b) => {
              const clickable = Boolean(b.anchor && onNavigate);
              return (
                <li key={b.id} className={`project-status-hero__blocker is-${b.severity}`}>
                  <div className="project-status-hero__blocker-body">
                    <strong className="project-status-hero__blocker-what">{b.what}</strong>
                    <span className="project-status-hero__blocker-impact">影響：{b.impact}</span>
                    <span className="project-status-hero__blocker-fix">解決：{b.fix}</span>
                  </div>
                  {clickable ? (
                    <button
                      type="button"
                      className="project-status-hero__next-btn"
                      onClick={() => onNavigate!(b.anchor)}
                    >
                      {b.actionLabel}
                    </button>
                  ) : (
                    <span className="project-status-hero__next-btn is-static">{b.actionLabel}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="project-status-hero__block" data-fb="專案工作流進度">
        <span className="project-status-hero__block-label">進度</span>
        <ul className="project-status-hero__progress" aria-label="工作流進度">
          {summary.progressItems.map((item) => (
            <li key={item.key}>
              <StatusRow item={item} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </div>

      {summary.runningItems.length > 0 ? (
        <div className="project-status-hero__block">
          <span className="project-status-hero__block-label">正在執行</span>
          <ul className="project-status-hero__list">
            {summary.runningItems.map((item) => (
              <li key={item.key}>
                <StatusRow item={item} onNavigate={onNavigate} tone="running" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary.attentionItems.length > 0 ? (
        <div className="project-status-hero__block">
          <span className="project-status-hero__block-label">需要處理</span>
          <ul className="project-status-hero__list">
            {summary.attentionItems.map((item) => (
              <li key={item.key}>
                <StatusRow item={item} onNavigate={onNavigate} tone="attention" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <style>{`
.project-status-hero {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  margin: 0 0 12px;
}
.project-status-hero__stage-label {
  margin: 0;
  font-size: 13px;
}
.project-status-hero__status-line {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--muted, #8a8a8a);
}
.project-status-hero__next-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.project-status-hero__next-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.project-status-hero__next-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border-strong, #333);
  border-radius: 10px;
  background: var(--surface-2, rgba(255, 107, 53, 0.06));
}
.project-status-hero__next-index {
  flex-shrink: 0;
  width: 1.4em;
  height: 1.4em;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: var(--accent, #ff6b35);
  color: #111;
}
.project-status-hero__next-text {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.35;
  min-width: 0;
}
.project-status-hero__next-btn {
  flex-shrink: 0;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--accent, #ff6b35);
  background: var(--accent, #ff6b35);
  color: #111;
  cursor: pointer;
}
.project-status-hero__next-btn.is-static {
  cursor: default;
  opacity: 0.85;
}
.project-status-hero__next-btn:hover:not(.is-static) {
  filter: brightness(1.08);
}
.project-status-hero__block {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
}
.project-status-hero__block-label {
  font-size: 12px;
  color: var(--muted, #8a8a8a);
  min-width: 4em;
}
.project-status-hero__progress,
.project-status-hero__list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.project-status-hero__item {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  line-height: 1.3;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border, #2a2a2a);
  background: transparent;
  color: inherit;
  font: inherit;
}
.project-status-hero__item.is-done {
  border-color: color-mix(in srgb, var(--ok, #3dd68c) 45%, transparent);
  color: var(--ok, #3dd68c);
}
.project-status-hero__item.is-running {
  border-color: color-mix(in srgb, var(--accent, #ff6b35) 50%, transparent);
  color: var(--accent, #ff6b35);
}
.project-status-hero__item.is-attention {
  border-color: color-mix(in srgb, var(--warn, #f5a524) 55%, transparent);
  color: var(--warn, #f5a524);
}
.project-status-hero__item.is-clickable {
  cursor: pointer;
}
.project-status-hero__item.is-clickable:hover {
  filter: brightness(1.08);
}
.project-status-hero__blockers {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.project-status-hero__blocker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.project-status-hero__blocker {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border, #2a2a2a);
  background: transparent;
}
.project-status-hero__blocker.is-critical {
  border-color: color-mix(in srgb, var(--danger, #f04438) 55%, transparent);
}
.project-status-hero__blocker.is-high {
  border-color: color-mix(in srgb, var(--warn, #f5a524) 55%, transparent);
}
.project-status-hero__blocker-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.project-status-hero__blocker-what {
  font-size: 13px;
  font-weight: 600;
}
.project-status-hero__blocker-impact,
.project-status-hero__blocker-fix {
  font-size: 12px;
  color: var(--muted, #8a8a8a);
  line-height: 1.35;
}
@media (max-width: 720px) {
  .project-status-hero {
    padding: 10px 12px;
    gap: 8px;
  }
  .project-status-hero__block-label {
    min-width: 100%;
  }
  .project-status-hero__next-row {
    flex-wrap: wrap;
  }
  .project-status-hero__next-btn {
    margin-left: auto;
  }
}
      `}</style>
    </Card>
  );
}
