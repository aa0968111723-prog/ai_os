/**
 * 左側工具軌 + Contextual Tool Options。
 *
 * 兩層刻意分開：**軌**永遠只有一欄圖示（窄，畫布優先），**設定**只在選到有二級
 * 選項的工具時才展開。先前六種筆刷永久攤在左欄，於是 200px 的寬度全年被
 * 「換筆」佔著，而真正決定工作方式的導覽／描圖／AI 反而沒有位置。
 */
import type { ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { PLANNED_TOOLS, STUDIO_TOOLS, type StudioTool } from "./studioTools";

export interface ToolRailProps {
  active: StudioTool;
  onSelect: (tool: StudioTool) => void;
  disabled?: boolean;
  /** 二級設定：由父層依 optionsKindFor 決定塞什麼進來；null＝這個工具沒有設定 */
  options: ReactNode | null;
  /** 二級面板的標題（讀屏要知道這區在講什麼） */
  optionsLabel: string;
}

export function ToolRail({ active, onSelect, disabled, options, optionsLabel }: ToolRailProps) {
  return (
    <div className="studio-tools" data-has-options={options ? "yes" : "no"}>
      <div className="studio-tools__rail" role="toolbar" aria-orientation="vertical" aria-label="工具">
        {STUDIO_TOOLS.map((tool) => {
          const on = active === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              className={`studio-tool${on ? " is-active" : ""}`}
              aria-pressed={on}
              aria-label={tool.label}
              // tooltip 兩行：做什麼＋快捷鍵。沒有說明的 icon 等於沒有這個功能
              title={`${tool.label}（${tool.hint}）\n${tool.detail}`}
              disabled={disabled}
              onClick={() => onSelect(tool.id)}
            >
              <Icon name={tool.icon} size={18} />
              <span className="studio-tool__key" aria-hidden="true">{tool.hint}</span>
            </button>
          );
        })}

        <span className="studio-tools__gap" aria-hidden="true" />

        {/* 規劃中：列出來讓工具架構完整，但停用且講明白——放上去卻點不動比沒有更糟，
            所以 tooltip 直接說「還沒做」而不是含糊的「即將推出」 */}
        <div className="studio-tools__planned" aria-label="規劃中的工具">
          {PLANNED_TOOLS.map((tool) => (
            <button
              key={tool.label}
              type="button"
              className="studio-tool is-planned"
              disabled
              aria-label={`${tool.label}（還沒做）`}
              title={`${tool.label}：還沒做。白板目前只存筆畫，要放文字／圖形／標註需要先擴充畫布格式。`}
            >
              <Icon name={tool.icon} size={16} />
            </button>
          ))}
        </div>
      </div>

      {options && (
        <section className="studio-tools__options" aria-label={optionsLabel}>
          <h2 className="studio-tools__options-title">{optionsLabel}</h2>
          <div className="studio-tools__options-body">{options}</div>
        </section>
      )}
    </div>
  );
}
