import { Icon } from "./Icon";
import { Card } from "./ui";

export function focusChatPartnerPicker(input: HTMLInputElement | null): void {
  if (!input) return;
  input.focus();
  input.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
}

export function ChatEmptyState({ onStart }: { onStart: () => void }) {
  return (
    <Card as="section" className="dm-thread dm-empty">
      <div className="empty-state" style={{ margin: "auto" }}>
        <Icon name="MessageCircle" size={32} style={{ color: "var(--fg-secondary)" }} />
        <h3>選一位夥伴開始聊</h3>
        <p className="hint">從夥伴選擇器挑一位同組夥伴，開始只有你們兩位看得到的對話。</p>
        <button
          type="button"
          className="primary dm-start-cta"
          aria-controls="dm-partner-picker"
          onClick={onStart}
        >
          <Icon name="Plus" size={15} />發起新對話
        </button>
      </div>
    </Card>
  );
}
