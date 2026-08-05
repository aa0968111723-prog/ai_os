import { scrollToSelector } from "./workbenchNav";
import { revealProjectContextFromSelector } from "../project-nav/projectContextNav";

/**
 * Chips that navigate to existing project sections — same targets as AiHub.
 * Prefer reduced motion: use instant scroll when user prefers reduced motion
 * (handled inside scrollToSelector / reveal).
 */

export const CREATION_CONTEXT_LINKS: ReadonlyArray<{ label: string; target: string }> = [
  { label: "專案設定", target: "#stage-context" },
  { label: "知識", target: "#sec-knowledge" },
  { label: "資料來源", target: "#sec-databases" },
  { label: "素材", target: "#sec-assets" },
  { label: "分鏡與交付", target: "#stage-deliver" },
];

export { scrollToSelector };

export function CreationContextBar({
  onNavigate,
  projectId,
}: {
  /**
   * When provided, sole click handler (should expand/mode-switch + scroll).
   * When omitted, bar reveals context (C2) or scrolls to the target itself.
   */
  onNavigate?: (target: string) => void;
  /** Used for C2 reveal when onNavigate is omitted */
  projectId?: string;
}) {
  // P1 (#400): weaker than generate form chips — navigation only, not “this run includes…”
  return (
    <div
      className="ctx-summary creation-context-bar"
      role="group"
      aria-label="AI 創作工作台可連動的專案系統"
    >
      <span className="creation-context-bar__label">前往設定</span>
      {CREATION_CONTEXT_LINKS.map((item) => (
        <button
          key={item.target}
          type="button"
          className="chip pick creation-context-bar__link"
          onClick={() => {
            if (onNavigate) onNavigate(item.target);
            else
              revealProjectContextFromSelector(item.target, {
                projectId,
                returnTo: "studio",
              });
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
