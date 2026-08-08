import { Icon, type IconName } from "../../components/Icon";

export interface IntelligenceSummaryView {
  aiReview: number;
  unnamedPeople: number;
  possibleDuplicates: number;
  unassignedProject: number;
}

const ROWS: Array<{ key: keyof IntelligenceSummaryView; label: string; icon: IconName }> = [
  { key: "aiReview", label: "AI 待確認", icon: "Sparkles" },
  { key: "unnamedPeople", label: "未命名人物", icon: "User" },
  { key: "possibleDuplicates", label: "可能重複", icon: "Copy" },
  { key: "unassignedProject", label: "未歸屬專案", icon: "Waypoints" },
];

export function ReviewSummary({ summary, onSelect }: {
  summary: IntelligenceSummaryView;
  onSelect: (key: keyof IntelligenceSummaryView) => void;
}) {
  return (
    <section className="review-summary" aria-labelledby="review-summary-title">
      <h2 id="review-summary-title">需要處理</h2>
      <div className="review-summary__rows">
        {ROWS.map((row) => (
          <button key={row.key} type="button" className="review-summary__row" onClick={() => onSelect(row.key)}>
            <Icon name={row.icon} size={16} />
            <span>{row.label}</span>
            <strong>{summary[row.key]}</strong>
            <Icon name="ChevronRight" size={15} />
          </button>
        ))}
      </div>
    </section>
  );
}
