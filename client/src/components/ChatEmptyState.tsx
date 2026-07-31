import { Icon } from "./Icon";
import { Card, EmptyState } from "./ui";

export function focusChatPartnerPicker(input: HTMLInputElement | null): void {
  if (!input) return;
  input.focus();
  input.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
}

export function ChatEmptyState({ onStart }: { onStart: () => void }) {
  return (
    <Card as="section" className="dm-thread dm-empty">
      <EmptyState
        icon={<Icon name="MessageCircle" size={32} style={{ color: "var(--fg-secondary)" }} />}
        title={<>選一位夥伴開始聊</>}
        description={<>從夥伴選擇器挑一位同組夥伴，開始只有你們兩位看得到的對話。</>}
        action={
          <button
            type="button"
            className="primary dm-start-cta"
            aria-controls="dm-partner-picker"
            onClick={onStart}
          >
            <Icon name="Plus" size={15} />發起新對話
          </button>
        }
        style={{ margin: "auto" }}
      />
    </Card>
  );
}
