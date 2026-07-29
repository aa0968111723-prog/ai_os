/**
 * Chips that scroll to existing project sections — same targets as AiHub.
 * Prefer reduced motion: use instant scroll when user prefers reduced motion.
 */

export const CREATION_CONTEXT_LINKS: ReadonlyArray<{ label: string; target: string }> = [
  { label: "專案設定", target: "#stage-context" },
  { label: "知識", target: "#sec-knowledge" },
  { label: "資料來源", target: "#sec-databases" },
  { label: "素材", target: "#sec-assets" },
  { label: "分鏡與交付", target: "#stage-deliver" },
];

function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined") return "auto";
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "auto";
  } catch {
    /* ignore */
  }
  return "smooth";
}

export function scrollToSelector(selector: string): void {
  requestAnimationFrame(() => {
    document.querySelector(selector)?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  });
}

export function CreationContextBar({
  onNavigate,
}: {
  /** Optional hook before scroll (e.g. expand hub body) */
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
            onNavigate?.(item.target);
            scrollToSelector(item.target);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
