import { Button, Card, Hint, Meta } from "../../components/ui";
import type { StoryReadiness } from "./storyInlineNav";

/**
 * Compact first-screen readiness + the single primary generation CTA.
 * The action stays on the existing one-click / parse / storyboard path.
 */
export function StoryReadinessBar({
  readiness,
  canEdit,
  primaryLabel,
  primaryDisabled,
  onPrimary,
  latestLabel,
  onOpenLatest,
}: {
  readiness: StoryReadiness;
  canEdit: boolean;
  primaryLabel?: string;
  primaryDisabled?: boolean;
  onPrimary?: () => void;
  latestLabel?: string;
  onOpenLatest?: () => void;
}) {
  return (
    <Card as="section" className="story-readiness" data-fb="故事準備狀態" data-kind={readiness.kind}>
      <div className="story-readiness__row">
        <div className="story-readiness__copy">
          <strong className="story-readiness__label">{readiness.label}</strong>
          <Meta as="p" className="story-readiness__detail">{readiness.detail}</Meta>
        </div>
        {canEdit && onPrimary && (
          <Button
            variant="primary"
            className="story-readiness__cta"
            disabled={primaryDisabled}
            onClick={onPrimary}
          >
            {primaryLabel}
          </Button>
        )}
      </div>
      {latestLabel && onOpenLatest && (
        <Hint as="p" className="story-readiness__latest">
          <Button variant="ghost" size="sm" type="button" onClick={onOpenLatest}>
            {latestLabel}
          </Button>
        </Hint>
      )}
    </Card>
  );
}
