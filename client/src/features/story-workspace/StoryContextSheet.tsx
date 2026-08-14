import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui";

/**
 * Mobile deep-edit layer for a story-inline section.
 * Saves the story scroll position on open and restores it on close.
 * Desktop keeps the inline expand; this sheet is the phone/full-screen path.
 */
export function StoryContextSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const scrollYRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    scrollYRef.current = window.scrollY;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      window.scrollTo(0, scrollYRef.current);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="story-context-sheet-root">
      <button
        type="button"
        className="story-context-sheet__backdrop"
        aria-label="關閉面板"
        onClick={onClose}
      />
      <div
        className="story-context-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="story-context-sheet__head">
          <strong>{title}</strong>
          <Button type="button" size="sm" aria-label="關閉" onClick={onClose}>
            <Icon name="X" size={16} />
          </Button>
        </div>
        <div className="story-context-sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
