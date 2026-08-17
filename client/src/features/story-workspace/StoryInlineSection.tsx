import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { Meta } from "../../components/ui";
import { StoryContextSheet } from "./StoryContextSheet";
import type { StoryInlineSectionId } from "./storyInlineNav";

/**
 * One collapsed summary row under the story home.
 * Children mount on first expand and stay mounted so existing workbench /
 * card local state is not thrown away just because the row is closed.
 */
export function StoryInlineSection({
  sectionId,
  anchorId,
  title,
  summary,
  warning,
  open,
  onOpenChange,
  presentation = "inline",
  children,
}: {
  sectionId: StoryInlineSectionId;
  anchorId: string;
  title: string;
  summary: string;
  warning?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Mobile uses a full-screen sheet so the story scroll position is restored. */
  presentation?: "inline" | "sheet";
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  return (
    <section
      className="story-inline-section"
      data-section={sectionId}
      data-open={open ? "true" : "false"}
    >
      <button
        type="button"
        className="story-inline-section__toggle"
        aria-expanded={open}
        aria-controls={`${anchorId}-body`}
        onClick={() => onOpenChange(!open)}
      >
        <span className="story-inline-section__title">{title}</span>
        <span className="story-inline-section__summary">{summary}</span>
        {warning ? (
          <Meta as="span" className="story-inline-section__warn">
            {warning}
          </Meta>
        ) : null}
        <Icon
          name="ChevronDown"
          size={16}
          className="story-inline-section__caret"
          aria-hidden
        />
      </button>
      {/* Compatibility target: old TocNav / chips / collaboration hashes. */}
      <div id={anchorId} className="story-inline-section__anchor" aria-hidden />
      {presentation === "inline" && (open || mounted) && (
        <div
          id={`${anchorId}-body`}
          className="story-inline-section__body"
          role="region"
          aria-label={title}
          hidden={!open}
        >
          {children}
        </div>
      )}
      {presentation === "sheet" && (
        <StoryContextSheet open={open} title={title} onClose={() => onOpenChange(false)}>
          {open || mounted ? children : null}
        </StoryContextSheet>
      )}
    </section>
  );
}
