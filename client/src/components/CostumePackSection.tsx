import { useCallback, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Hint, Meta } from "./ui";

/** C1 (#402)：定裝三卡同一容器內一次只主開一類 */
export type CostumeTab = "characters" | "scenes" | "props";

const COSTUME_TABS: Array<{
  id: CostumeTab;
  label: string;
  /** 錨點 id 必須穩定，摘要 chip / scrollToSelector 依賴 */
  panelId: string;
}> = [
  { id: "characters", label: "角色", panelId: "sec-characters" },
  { id: "scenes", label: "場景", panelId: "sec-scenes" },
  { id: "props", label: "道具", panelId: "sec-props" },
];

export function costumeTabFromTarget(target: string): CostumeTab | null {
  if (target === "#sec-characters" || target === "sec-characters") return "characters";
  if (target === "#sec-scenes" || target === "sec-scenes") return "scenes";
  if (target === "#sec-props" || target === "sec-props") return "props";
  return null;
}

export function CostumePackSection({
  tab,
  onTabChange,
  counts,
  carriedHint,
  panels,
}: {
  tab: CostumeTab;
  onTabChange: (tab: CostumeTab) => void;
  counts: { characters?: number; scenes?: number; props?: number };
  /** 固定說明：勾選主人卡會自動帶入歸屬道具（與 generation 同源規則） */
  carriedHint?: ReactNode;
  panels: Record<CostumeTab, ReactNode>;
}) {
  const reactId = useId();
  const prefix = `costume-pack-${reactId.replace(/:/g, "")}`;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusTab = useCallback((index: number) => {
    tabRefs.current[index]?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      const count = COSTUME_TABS.length;
      let next = index;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        next = (index + 1) % count;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        next = (index - 1 + count) % count;
      } else if (event.key === "Home") {
        event.preventDefault();
        next = 0;
      } else if (event.key === "End") {
        event.preventDefault();
        next = count - 1;
      } else {
        return;
      }
      onTabChange(COSTUME_TABS[next]!.id);
      focusTab(next);
    },
    [focusTab, onTabChange],
  );

  const countLabel = (id: CostumeTab): string => {
    const n =
      id === "characters" ? counts.characters : id === "scenes" ? counts.scenes : counts.props;
    if (n == null) return "…";
    return String(n);
  };

  return (
    <section
      className="costume-pack"
      data-testid="costume-pack"
      aria-label="定裝：角色、場景、道具"
    >
      <div className="costume-pack__head">
        <strong className="costume-pack__title">定裝</strong>
        <Meta as="span" className="costume-pack__summary">
          角色 {countLabel("characters")} · 場景 {countLabel("scenes")} · 道具 {countLabel("props")}
        </Meta>
      </div>
      {carriedHint != null ? (
        <Hint layer="always" className="costume-pack__carried" style={{ margin: "6px 0 8px", fontSize: 12 }}>
          {carriedHint}
        </Hint>
      ) : null}

      <div role="tablist" aria-label="定裝類型" className="costume-pack-tabs">
        {COSTUME_TABS.map((item, index) => {
          const selected = tab === item.id;
          const n = countLabel(item.id);
          return (
            <button
              key={item.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`${prefix}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={item.panelId}
              tabIndex={selected ? 0 : -1}
              className={`costume-pack-tab${selected ? " is-selected" : ""}`}
              data-costume-tab={item.id}
              onClick={() => onTabChange(item.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
            >
              {item.label}
              <Meta as="span" className="costume-pack-tab__count">
                {n}
              </Meta>
            </button>
          );
        })}
      </div>

      {COSTUME_TABS.map((item) => {
        const selected = tab === item.id;
        return (
          <div
            key={item.id}
            id={item.panelId}
            role="tabpanel"
            aria-labelledby={`${prefix}-tab-${item.id}`}
            hidden={!selected}
            className="costume-pack-panel"
            data-testid={`costume-panel-${item.id}`}
          >
            {panels[item.id]}
          </div>
        );
      })}
    </section>
  );
}
