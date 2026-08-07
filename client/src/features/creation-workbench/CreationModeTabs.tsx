import { useCallback, useId, useRef, type KeyboardEvent } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { Meta } from "../../components/ui";
import { CREATION_MODES, type CreationMode } from "./creationDraft";

const MODE_ICONS: Record<CreationMode, IconName> = {
  ask: "MessageCircle",
  generate: "Image",
  template: "Clapperboard",
  plan: "Film",
};

export function CreationModeTabs({
  mode,
  onModeChange,
  tabPanelIdPrefix,
}: {
  mode: CreationMode;
  onModeChange: (mode: CreationMode) => void;
  /** Shared prefix so each tab's aria-controls matches its tabpanel id */
  tabPanelIdPrefix?: string;
}) {
  const reactId = useId();
  const prefix = tabPanelIdPrefix ?? `creation-mode-${reactId}`;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusTab = useCallback((index: number) => {
    const el = tabRefs.current[index];
    el?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      const count = CREATION_MODES.length;
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
      onModeChange(CREATION_MODES[next]!.id);
      focusTab(next);
    },
    [focusTab, onModeChange],
  );

  return (
    <div
      role="tablist"
      aria-label="AI 創作模式"
      className="creation-mode-tabs"
    >
      {CREATION_MODES.map((item, index) => {
        const selected = mode === item.id;
        return (
          <button
            key={item.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={modeTabId(prefix, item.id)}
            aria-selected={selected}
            aria-controls={modePanelId(prefix, item.id)}
            tabIndex={selected ? 0 : -1}
            className={`creation-mode-tab${selected ? " is-selected" : ""}`}
            onClick={() => onModeChange(item.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            <span className="creation-mode-tab__icon"><Icon name={MODE_ICONS[item.id]} size={17} /></span>
            <span className="creation-mode-tab__copy">
              <b>{item.label}</b>
              {/* 分頁標籤的第二行文字＝tab 可及名稱的一部分（內容，非說明），所以用 Meta 不用 Hint。 */}
              <Meta>{item.description}</Meta>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function modePanelId(prefix: string, mode: CreationMode): string {
  return `${prefix}-panel-${mode}`;
}

export function modeTabId(prefix: string, mode: CreationMode): string {
  return `${prefix}-tab-${mode}`;
}
