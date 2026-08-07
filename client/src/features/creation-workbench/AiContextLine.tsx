import { Icon } from "../../components/Icon";
import { aiContextForMode, aiContextSentence } from "./aiContextSummary";
import type { CreationDraft, CreationMode } from "./creationDraft";

/**
 * 「本次 AI 會讀到什麼」單行狀態列（緊貼模式分頁下方）。
 *
 * 語意全部來自 aiContextSummary.ts（有測試守著）；這裡只負責呈現。
 * 排除項用警示色而不是灰色——「不含專案依據」是使用者最需要看見的一句，
 * 灰掉就等於沒說。整行掛 aria-label 給讀屏，逐項的 chip 對 AT 隱藏避免重複朗讀。
 */
export function AiContextLine({
  mode,
  draft,
}: {
  mode: CreationMode;
  draft: Pick<CreationDraft, "characterIds" | "scenePresetIds" | "propIds" | "knowledgeIds" | "sourceAssetIds">;
}) {
  const line = aiContextForMode(mode, draft);
  return (
    <div
      className="ai-context-line"
      data-testid="ai-context-line"
      // note 而非 status：這行是常駐說明，不是即時播報——用 status 會讓
      // 讀屏在每次切模式時搶播，也會撞到頁面既有的 role=status 元素。
      role="note"
      aria-label={aiContextSentence(line)}
    >
      <Icon name="Info" size={13} aria-hidden />
      <span className="ai-context-line__label" aria-hidden>本次 AI 會讀到</span>
      <span className="ai-context-line__items" aria-hidden>
        {line.included.map((item) => (
          <span key={item} className="ai-context-line__chip">{item}</span>
        ))}
        {line.excluded.map((item) => (
          <span key={item} className="ai-context-line__chip is-excluded">不含{item}</span>
        ))}
      </span>
    </div>
  );
}
