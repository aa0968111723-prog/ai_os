import type { LlmIntrospection } from "@shared/llmIntrospection";
import { Hint, Meta } from "../../components/ui";

/**
 * 供應商揭露的推理摘要 + 逐 token 信心。
 *
 * 站內原則仍然是「不假裝呈現模型私密思維鏈」。這裡顯示的是**供應商在正式 API
 * 欄位裡主動回傳的文字**，來源必須寫在畫面上——不然使用者會以為這是模型真正的
 * 內部思考，那就變成我們在騙人。
 *
 * token 信心不是推測：logprob 是模型自己輸出的機率。低信心處＝模型自己也不確定，
 * 正是使用者最該親自覆核的地方。
 */
export function LlmIntrospectionView({ introspection }: { introspection?: LlmIntrospection }) {
  if (!introspection) return null;
  const { disclosedReasoning, meanConfidence, lowestConfidence, logprobsUnsupported } = introspection;
  if (!disclosedReasoning && meanConfidence == null && !logprobsUnsupported) return null;

  return (
    <div data-testid="llm-introspection" style={{ marginTop: 10 }}>
      {meanConfidence != null ? (
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 13 }}>模型自報信心</strong>
          <span style={{ fontSize: 13 }}>平均 {Math.round(meanConfidence * 100)}%</span>
          <Meta>（逐 token 機率的幾何平均，數字由模型輸出，不是站內推估）</Meta>
        </div>
      ) : null}

      {lowestConfidence?.length ? (
        <div style={{ marginTop: 6 }}>
          <Meta>最不確定的片段（值得你親自覆核）：</Meta>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            {lowestConfidence.map((row, index) => (
              <span
                key={`${row.token}-${index}`}
                style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: "var(--gold-soft)", color: "var(--gold-ink)" }}
              >
                {row.token.trim() || "␣"}　{Math.round(row.probability * 100)}%
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {logprobsUnsupported ? (
        <Hint as="p" style={{ margin: "6px 0 0" }}>
          這顆模型不提供逐 token 信心值，已改用不帶 logprobs 的方式完成檢查。
        </Hint>
      ) : null}

      {disclosedReasoning ? (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>供應商回傳的推理摘要</summary>
          <Hint style={{ marginTop: 6 }}>
            這是供應商在 API 欄位裡主動回傳的文字，站內原樣顯示、不改寫。
            它不等於模型真實的內部思考，也不保證與最終結論一致。
          </Hint>
          <div
            data-testid="disclosed-reasoning"
            style={{ marginTop: 6, padding: 10, maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", borderRadius: 8, background: "var(--card2)", fontSize: 13, lineHeight: 1.65 }}
          >
            {disclosedReasoning}
          </div>
        </details>
      ) : null}
    </div>
  );
}
