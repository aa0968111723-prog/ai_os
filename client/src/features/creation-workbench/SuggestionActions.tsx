import type { CreationAction } from "./creationActions";
import { generateBringInAction, planBringInAction } from "./creationActions";

/**
 * Minimal bring-in buttons for an AI / prompt suggestion (proposal §6.1).
 * All CreationAction paths only fill draft + switch mode — never auto-submit or charge.
 * Side effects (scene draft / prompt library) use optional callbacks outside the contract.
 */
export function SuggestionActions({
  suggestionText,
  modelId,
  onAction,
  onSavePrompt,
  onSaveSceneDraft,
  disabled = false,
  /** When false, only show workbench bring-in (generate + plan). Default true when callbacks given. */
  showSideEffects = true,
}: {
  suggestionText: string;
  modelId?: string;
  onAction: (action: CreationAction) => void;
  /** 存進提示詞庫 — parent runs prompts.save; not a CreationAction. */
  onSavePrompt?: (text: string, modelId?: string) => void;
  /** 存成分鏡草稿 — parent runs scenes.addDraft; not a CreationAction. */
  onSaveSceneDraft?: (text: string) => void;
  disabled?: boolean;
  showSideEffects?: boolean;
}) {
  const text = suggestionText.trim();
  if (!text) return null;

  return (
    <div
      style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}
      role="group"
      aria-label="建議帶入工作台"
    >
      <button
        type="button"
        className="btn-sm"
        disabled={disabled}
        title="填入出圖提示詞並切換模式，不送出、不扣點"
        onClick={() =>
          onAction(
            generateBringInAction({
              prompt: text,
              modelId,
            }),
          )
        }
      >
        帶入直接出圖
      </button>
      <button
        type="button"
        className="btn-sm"
        disabled={disabled}
        title="帶入多步開拍目標並切換模式，不自動排程"
        onClick={() =>
          onAction(
            planBringInAction(text, {
              prompt: text,
              modelId,
            }),
          )
        }
      >
        建立多步開拍
      </button>
      {showSideEffects && onSaveSceneDraft && (
        <button
          type="button"
          className="btn-sm"
          disabled={disabled}
          title="新增一格分鏡草稿（不生成、不扣點）"
          onClick={() => onSaveSceneDraft(text)}
        >
          存成分鏡草稿
        </button>
      )}
      {showSideEffects && onSavePrompt && (
        <button
          type="button"
          className="btn-sm"
          disabled={disabled}
          title="存進提示詞庫，之後可再用"
          onClick={() => onSavePrompt(text, modelId)}
        >
          存進提示詞庫
        </button>
      )}
    </div>
  );
}
