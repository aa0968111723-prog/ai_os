import { Icon, type IconName } from "./Icon";

export type VisualJourneyState = "done" | "current" | "upcoming";

export type VisualJourneyStep = {
  id: string;
  label: string;
  detail?: string;
  icon?: IconName;
  state: VisualJourneyState;
};

export function VisualJourney({
  steps,
  ariaLabel,
  onSelect,
  compact = false,
}: {
  steps: VisualJourneyStep[];
  ariaLabel: string;
  onSelect?: (step: VisualJourneyStep, index: number) => void;
  compact?: boolean;
}) {
  return (
    <ol className={`visual-journey${compact ? " visual-journey--compact" : ""}`} aria-label={ariaLabel}>
      {steps.map((step, index) => {
        const content = (
          <>
            <span className="visual-journey__marker" aria-hidden>
              {step.state === "done" ? <Icon name="Check" size={14} /> : step.icon ? <Icon name={step.icon} size={15} /> : index + 1}
            </span>
            <span className="visual-journey__copy">
              <strong>{step.label}</strong>
              {step.detail && <small>{step.detail}</small>}
            </span>
            {step.state === "current" && <span className="visual-journey__now">現在</span>}
          </>
        );

        return (
          <li
            key={step.id}
            className={`visual-journey__item is-${step.state}`}
            aria-current={step.state === "current" ? "step" : undefined}
          >
            {onSelect ? (
              <button type="button" onClick={() => onSelect(step, index)} title={step.detail}>
                {content}
              </button>
            ) : (
              <div>{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
