import { useEffect } from "react";
import type { AssistantInteractionRequest } from "@shared/assistantInteractions";
import { Icon, type IconName } from "./Icon";

const ICONS: Record<string, IconName> = {
  Cloud: "HardDrive",
  Image: "Image",
  Package: "Package",
  Upload: "Upload",
};

export function AssistantInteractionCard({
  request,
  busy = false,
  onPresented,
  onSelect,
  onCancel,
}: {
  request: AssistantInteractionRequest;
  busy?: boolean;
  onPresented?: () => void;
  onSelect: (ids: string[]) => void;
  onCancel?: () => void;
}) {
  useEffect(() => { onPresented?.(); }, [request.interactionId]);
  const options = request.options ?? [];
  return (
    <section
      className="assistant-interaction"
      aria-label={request.title}
      data-interaction-id={request.interactionId}
      data-interaction-type={request.type}
    >
      <header className="assistant-interaction__head">
        <strong>{request.title}</strong>
        {request.description ? <span>{request.description}</span> : null}
      </header>
      {options.length ? (
        <div className="assistant-interaction__options" role="list">
          {options.map((option) => {
            const blocked = option.availability === "BLOCKED";
            return (
              <button
                key={option.id}
                type="button"
                className="assistant-interaction__option"
                disabled={busy || blocked}
                aria-disabled={blocked || undefined}
                onClick={() => onSelect([option.id])}
              >
                <span className="assistant-interaction__option-icon" aria-hidden="true">
                  <Icon name={ICONS[option.icon ?? ""] ?? "ChevronRight"} size={18} />
                </span>
                <span className="assistant-interaction__option-copy">
                  <strong>{option.label}</strong>
                  {option.subtitle ? <small>{option.subtitle}</small> : null}
                  {blocked && option.blockerReason ? <small className="assistant-interaction__blocker">{option.blockerReason}</small> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : <p className="assistant-interaction__empty">目前沒有可選項目。</p>}
      {onCancel ? (
        <button type="button" className="assistant-interaction__cancel" disabled={busy} onClick={onCancel}>稍後再選</button>
      ) : null}
    </section>
  );
}
