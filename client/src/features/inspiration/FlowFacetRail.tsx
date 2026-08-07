/**
 * 細化分類篩選列。
 *
 * 每個 chip 都帶數量：沒有數量時使用者只能一個個點開才知道哪些是空的，
 * 點到空結果幾次就再也不會用篩選了。
 */
import { Icon } from "../../components/Icon";
import type { FacetRailGroup } from "./facetRail";

export function FlowFacetRail({
  groups,
  selectedCount,
  onToggle,
  onClear,
  loading,
}: {
  groups: FacetRailGroup[];
  selectedCount: number;
  onToggle: (tag: string) => void;
  onClear: () => void;
  loading?: boolean;
}) {
  if (groups.length === 0) {
    return (
      <div className="flow-facets">
        <div className="flow-facets__row">
          <span className="flow-facets__label">分類</span>
          <span style={{ fontSize: "var(--fs-12)", color: "var(--flow-ink-faint)" }}>
            {loading ? "分析中…" : "還沒有可分類的素材"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flow-facets">
      {groups.map((group) => (
        <div className="flow-facets__row" key={group.id}>
          <span className="flow-facets__label">{group.label}</span>
          {group.options.map((option) => (
            <button
              key={option.tag}
              type="button"
              className="flow-chip"
              aria-pressed={option.selected}
              onClick={() => onToggle(option.tag)}
            >
              {option.label}
              <span className="flow-chip__count">{option.count}</span>
            </button>
          ))}
        </div>
      ))}
      {selectedCount > 0 && (
        <div className="flow-facets__row">
          <span className="flow-facets__label" />
          <button type="button" className="flow-chip" onClick={onClear}>
            <Icon name="X" size={12} />
            清除 {selectedCount} 個分類條件
          </button>
        </div>
      )}
    </div>
  );
}
