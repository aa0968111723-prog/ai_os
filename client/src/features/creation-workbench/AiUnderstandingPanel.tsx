import { useState } from "react";
import type { AiOperationPreview, CreativePromptOverride } from "@shared/aiTrace";
import { trpc } from "../../api";
import { Button, Card, Chip, Hint, Meta } from "../../components/ui";

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre style={{ margin: 0, padding: 10, maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", borderRadius: 8, background: "var(--card2)", fontSize: 12 }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/**
 * Shows application-layer context, provider envelopes and trace events.
 * It deliberately does not claim to expose model chain-of-thought or attention weights.
 */
export function AiUnderstandingPanel({
  projectId,
  preview,
  previewPending,
  previewError,
  onPreview,
  traceSessionId,
  override,
  onOverrideChange,
}: {
  projectId: string;
  preview?: AiOperationPreview;
  previewPending?: boolean;
  previewError?: string;
  onPreview: () => void;
  traceSessionId?: string | null;
  override?: CreativePromptOverride;
  onOverrideChange?: (next: CreativePromptOverride) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const review = trpc.aiTrace?.review?.useMutation?.() ?? {
    data: undefined,
    error: null,
    isPending: false,
    mutate: (_input: unknown) => undefined,
  };
  const trace = trpc.aiTrace?.get?.useQuery?.(
    { projectId, sessionId: traceSessionId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(traceSessionId && showTrace) },
  ) ?? { data: undefined, error: null, isLoading: false };

  const openPreview = () => {
    setOpen(true);
    onPreview();
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button type="button" size="sm" variant="ghost" onClick={openPreview}>
          AI 會怎麼理解？
        </Button>
        {traceSessionId ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(true); setShowTrace(true); }}>
            查看實際運作
          </Button>
        ) : null}
      </div>

      {open ? (
        <Card style={{ marginTop: 8, padding: 12, borderColor: "var(--primary)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <strong>AI 理解與實際運作</strong>
            <span style={{ flex: 1 }} />
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>收合</Button>
          </div>
          <Hint layer="always" style={{ marginTop: 6 }}>
            這裡顯示系統真正整理、送出與收到的資料；模型私密思維鏈與未公開的注意力權重不會被保存或假裝呈現。
          </Hint>

          {previewPending ? <Meta as="p">正在整理預覽…</Meta> : null}
          {previewError ? <p className="error">{previewError}</p> : null}
          {preview ? (
            <>
              <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {preview.provider ? <Chip>{preview.provider}</Chip> : null}
                {preview.model ? <Chip>{preview.model}</Chip> : null}
                {preview.estimatedPoints != null ? <Chip>{preview.estimatedPoints} 點</Chip> : null}
              </div>
              {preview.dynamicNotice ? <Meta as="p">{preview.dynamicNotice}</Meta> : null}
              <h4 style={{ margin: "12px 0 6px" }}>會帶入的上下文</h4>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {preview.context.map((item, index) => (
                  <li key={`${item.type}-${item.id ?? index}`}>
                    {item.included ? "✓" : "—"} {item.label}{item.note ? `：${item.note}` : ""}
                  </li>
                ))}
              </ul>
              {preview.warnings.length ? (
                <div role="status" style={{ marginTop: 10 }}>
                  {preview.warnings.map((warning) => (
                    <p key={warning.code} style={{ margin: "5px 0", color: warning.severity === "warning" ? "var(--gold-ink)" : undefined }}>
                      <b>{warning.title}</b>：{warning.detail}{warning.suggestion ? ` ${warning.suggestion}` : ""}
                    </p>
                  ))}
                </div>
              ) : null}
              <h4 style={{ margin: "12px 0 6px" }}>組裝後請求</h4>
              <JsonBlock value={preview.request} />

              {preview.canOverrideCreativePrompt && onOverrideChange ? (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 600 }}>進階：只覆寫創作提示詞</summary>
                  <Hint style={{ marginTop: 6 }}>只影響正向／負向創作內容，不會覆寫系統規則、工具權限、來源限制或專案權限。</Hint>
                  <label>正向提示覆寫</label>
                  <textarea value={override?.positive ?? ""} onChange={(event) => onOverrideChange({ ...override, positive: event.target.value || undefined })} placeholder="留空＝使用系統組裝結果" />
                  <label>負向提示覆寫</label>
                  <textarea value={override?.negative ?? ""} onChange={(event) => onOverrideChange({ ...override, negative: event.target.value || undefined })} placeholder="留空＝使用世界觀禁忌與模型預設" />
                </details>
              ) : null}

              <div style={{ marginTop: 10 }}>
                <Button type="button" size="sm" disabled={review.isPending} onClick={() => review.mutate({ projectId, preview })}>
                  {review.isPending ? "檢查中…" : "用 AI 檢查準確性（0 點）"}
                </Button>
              </div>
              {review.data ? (
                <Card variant="quiet" style={{ marginTop: 8, padding: 10 }}>
                  <strong>{review.data.review.summary}</strong>
                  <Meta as="p">
                    {review.data.provider}・{review.data.model}
                    {review.data.usage?.totalTokens != null ? `・${review.data.usage.totalTokens} tokens` : ""}
                    {review.data.usage?.costUsd != null ? `・US$${review.data.usage.costUsd.toFixed(6)}` : ""}
                    {review.data.fellBackToPaid ? "・NIM 失敗後已使用付費備援" : ""}
                    {review.data.parseMode === "repaired" ? "・已自動修復回覆格式" : ""}
                    {review.data.parseMode === "text_fallback" ? "・已保留文字結論" : ""}
                  </Meta>
                  {review.data.review.warnings.map((warning) => (
                    <p key={warning.code} style={{ margin: "5px 0" }}>
                      <b>{warning.title}</b>：{warning.detail}
                      {warning.suggestion ? ` 建議：${warning.suggestion}` : ""}
                    </p>
                  ))}
                  {(review.data.review.suggestedPrompt || review.data.review.suggestedNegativePrompt) && onOverrideChange ? (
                    <div style={{ marginTop: 8 }}>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => onOverrideChange({
                          ...override,
                          positive: review.data?.review.suggestedPrompt ?? override?.positive,
                          negative: review.data?.review.suggestedNegativePrompt ?? override?.negative,
                        })}
                      >
                        套用 AI 建議提示詞
                      </Button>
                    </div>
                  ) : null}
                </Card>
              ) : null}
              {review.error ? <p className="error">{review.error.message}</p> : null}
            </>
          ) : null}

          {showTrace && traceSessionId ? (
            <div style={{ marginTop: 14 }}>
              <h4 style={{ margin: "0 0 6px" }}>實際運作事件</h4>
              {trace.isLoading ? <Meta as="p">正在讀取紀錄…</Meta> : null}
              {trace.error ? <p className="error">{trace.error.message}</p> : null}
              {trace.data?.events.map((event) => (
                <details key={event.id} style={{ marginBottom: 6 }}>
                  <summary style={{ cursor: "pointer" }}>#{event.sequence} {event.summary}</summary>
                  <JsonBlock value={event.payload} />
                </details>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
