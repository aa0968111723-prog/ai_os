import { Badge, Card, Hint, Meta } from "./ui";
import { Icon } from "./Icon";
import type { AssistantStreamDone } from "./assistantStream";

/**
 * 「本次依據」（P5）：這次回答 AI 實際讀了什麼。
 *
 * 為什麼要有這個——在此之前，知識庫進了多少、有沒有因為預算被腰斬，
 * 全部只存在伺服器的區域變數裡然後被丟掉。使用者看到一個回答，無從判斷
 * AI 是看完全部才這樣說，還是只看了前面三分之一。
 *
 * ★ 誠實優先於好看：被截斷、完全沒讀到的篇目都要講出來（§30）。
 *   一個「只看了一半」的回答被當成完整判斷，比看起來雜亂危險得多。
 */

export type AskSourcesData = NonNullable<AssistantStreamDone["sources"]>;

const STATUS_LABEL: Record<AskSourcesData["items"][number]["status"], string> = {
  full: "全部讀取",
  partial: "只讀了一部分",
  skipped: "這次沒讀到",
};

const OUTCOME_LABEL: Record<NonNullable<AskSourcesData["items"][number]["outcome"]>, string> = {
  OK: "已取得",
  EMPTY: "沒有符合資料",
  TIMEOUT: "逾時，已略過",
  AUTH_DENIED: "沒有權限",
  NOT_AVAILABLE: "目前不可用",
  TOOL_ERROR: "讀取失敗",
};

export function AskSources({ sources }: { sources: AskSourcesData | undefined }) {
  // 專案沒有任何知識資料時不出現這一區——空的「本次依據」只是噪音
  if (!sources || sources.items.length === 0) return null;

  const used = sources.items.filter((i) => i.status !== "skipped");
  const skipped = sources.items.filter((i) => i.status === "skipped");

  return (
    <Card as="details" variant="quiet" className="ask-sources" data-fb="本次依據">
      <summary>
        <Icon name="FileText" size={13} /> 執行詳情
        <Meta style={{ marginLeft: 8 }}>
          {used.length > 0 ? `參考 ${used.length} 個來源（讀了 ${used.length} 份）` : "這次沒有讀到任何資料"}
          {sources.truncated ? "・有內容未完整使用" : ""}
        </Meta>
      </summary>

      <ul className="ask-sources__list">
        {sources.items.map((item) => (
          <li key={item.id}>
            <span className="ask-sources__title">{item.title}</span>
            <Badge title={
              item.status === "partial"
                ? `全文 ${item.chars.toLocaleString("en-US")} 字，這次讀了 ${item.includedChars.toLocaleString("en-US")} 字`
                : undefined
            }>
              {item.outcome ? OUTCOME_LABEL[item.outcome] : STATUS_LABEL[item.status]}
            </Badge>
            {item.durationMs != null ? (
              <Meta>
                {item.retrieval ?? "structured"}
                {item.retrieval === "hybrid" ? (item.semanticApplied ? "（含語意排序）" : "（關鍵字＋中繼資料）") : ""}
                ・{item.durationMs} ms{(item.attempts ?? 1) > 1 ? `・重試 ${item.attempts! - 1} 次` : ""}
              </Meta>
            ) : null}
          </li>
        ))}
      </ul>

      {sources.truncated && (
        /* ★ 不 silent truncate：講出來，並說明可以怎麼辦 */
        <Hint style={{ margin: "6px 0 0" }}>
          部分資料因內容過長未完整使用（單次上限 {sources.budgetChars.toLocaleString("en-US")} 字）。
          需要 AI 精讀某幾份時，可以在下面指定「這次只用哪些依據」。
        </Hint>
      )}
      {skipped.length > 0 && !sources.truncated && (
        <Hint style={{ margin: "6px 0 0" }}>
          有 {skipped.length} 份這次沒有讀到；若為資料來源，標籤會分辨空資料、逾時、權限或工具錯誤。
        </Hint>
      )}
    </Card>
  );
}
