import { useCallback, useId, useRef, type KeyboardEvent } from "react";
import { Icon, type IconName } from "../../components/Icon";
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
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 8,
        margin: "12px 0",
        // Mobile-friendly: allow horizontal scroll when grid collapses tightly
        overflowX: "auto",
      }}
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
            id={`${prefix}-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`${prefix}-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            className="btn-ghost"
            onClick={() => onModeChange(item.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              minHeight: 64,
              padding: "10px 12px",
              textAlign: "left",
              border: selected ? "1px solid var(--primary-border)" : "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              background: selected ? "var(--primary-tint)" : undefined,
            }}
          >
            <Icon name={MODE_ICONS[item.id]} size={16} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>
              <b style={{ display: "block" }}>{item.label}</b>
              <span className="hint" style={{ display: "block", marginTop: 2 }}>
                {item.description}
              </span>
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
