import { Icon } from "./Icon";
import {
  databaseDetailTabForKey,
  type DatabaseDetailTab,
} from "./databaseTabs";

export function DatabaseDetailTabs({
  value,
  rowCount,
  onChange,
}: {
  value: DatabaseDetailTab;
  rowCount?: number;
  onChange: (tab: DatabaseDetailTab) => void;
}) {
  return (
    <div className="database-detail-tabs" role="tablist" aria-label="資料庫內容">
      {([
        ["rows", "FileText", `資料列${rowCount == null ? "" : ` ${rowCount.toLocaleString()}`}`],
        ["files", "Package", "文件"],
        ["connect", "SlidersHorizontal", "同步與 API"],
      ] as const).map(([tab, icon, label]) => (
        <button
          key={tab}
          type="button"
          role="tab"
          className={value === tab ? "on" : ""}
          aria-selected={value === tab}
          aria-controls={`database-${tab}-panel`}
          tabIndex={value === tab ? 0 : -1}
          data-database-tab={tab}
          onClick={() => onChange(tab)}
          onKeyDown={(event) => {
            const nextTab = databaseDetailTabForKey(tab, event.key);
            if (!nextTab) return;
            event.preventDefault();
            onChange(nextTab);
            event.currentTarget.parentElement
              ?.querySelector<HTMLButtonElement>(`[data-database-tab="${nextTab}"]`)
              ?.focus();
          }}
        >
          <Icon name={icon} size={13} /> {label}
        </button>
      ))}
    </div>
  );
}
