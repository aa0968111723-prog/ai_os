import { scrollToSelector } from "./workbenchNav";

/**
 * Chips that scroll to existing project sections — same targets as AiHub.
 * Prefer reduced motion: use instant scroll when user prefers reduced motion
 * (handled inside scrollToSelector / goTo).
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
}: {
  /**
   * When provided, sole click handler (should expand/mode-switch + scroll).
   * When omitted, bar scrolls to the target itself.
   */
  onNavigate?: (target: string) => void;
}) {
  return (
    <div className="ctx-summary" role="group" aria-label="AI 創作工作台可連動的專案系統">
      連動目前專案：
      {CREATION_CONTEXT_LINKS.map((item) => (
        <button
          key={item.target}
          type="button"
          className="chip pick"
          onClick={() => {
            if (onNavigate) onNavigate(item.target);
            else scrollToSelector(item.target);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
