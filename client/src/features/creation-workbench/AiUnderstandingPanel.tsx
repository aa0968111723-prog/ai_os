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

const PROMPT_FIELDS = new Set(["prompt", "positive_prompt", "negative_prompt"]);
const PARAMETER_LABELS: Record<string, string> = {
  aspect_ratio: "畫面比例",
  duration: "影片秒數",
  duration_seconds: "影片秒數",
  fps: "影格率",
  guidance_scale: "提示詞引導強度",
  image_size: "輸出尺寸",
  num_frames: "影格數",
  num_images: "生成張數",
  num_inference_steps: "推理步數",
  resolution: "解析度",
  seed: "隨機種子",
  strength: "修改強度",
};

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readableParameter(value: unknown): string | undefined {
  if (typeof value === "string") return value.length <= 100 && !/^https?:\/\//i.test(value) ? value : undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} 項`;
  return undefined;
}

export function friendlyPreviewError(error?: string): string | undefined {
  if (!error) return undefined;
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(error)) {
    return "預覽服務目前無法連線；模型配對與本機組裝的提示詞仍可直接使用，不必重新提問。";
  }
  return error;
}

export function presentAiRequest(request: Record<string, unknown>) {
  const providerInput = objectValue(request.providerInput) ?? {};
  const positivePrompt = typeof request.positivePrompt === "string"
    ? request.positivePrompt
    : typeof providerInput.prompt === "string"
      ? providerInput.prompt
      : "";
  const negativePrompt = typeof request.negativePrompt === "string"
    ? request.negativePrompt
    : typeof providerInput.negative_prompt === "string"
      ? providerInput.negative_prompt
      : "";
  const parameters = Object.entries(providerInput).flatMap(([key, value]) => {
    if (PROMPT_FIELDS.has(key) || /(?:^|_)(?:url|urls)$/.test(key)) return [];
    const readable = readableParameter(value);
    return readable == null ? [] : [{ key, label: PARAMETER_LABELS[key] ?? key, value: readable }];
  });
  return { positivePrompt, negativePrompt, parameters };
}

function RequestPreview({ request }: { request: Record<string, unknown> }) {
  const { positivePrompt, negativePrompt, parameters } = presentAiRequest(request);
  return (
    <>
      <h4 style={{ margin: "12px 0 6px" }}>實際使用的創作提示詞</h4>
      <div
        data-testid="readable-positive-prompt"
        style={{ padding: 10, maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", borderRadius: 8, background: "var(--card2)", fontSize: 13, lineHeight: 1.65 }}
      >
        {positivePrompt || "這次請求沒有創作提示詞。"}
      </div>

      {negativePrompt ? (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>限制與避免內容</summary>
          <div
            data-testid="readable-negative-prompt"
            style={{ marginTop: 6, padding: 10, maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", borderRadius: 8, background: "var(--card2)", fontSize: 13, lineHeight: 1.65 }}
          >
            {negativePrompt}
          </div>
        </details>
      ) : null}

      {parameters.length ? (
        <div style={{ marginTop: 10 }}>
          <strong style={{ fontSize: 13 }}>模型參數</strong>
          <dl style={{ display: "grid", gridTemplateColumns: "minmax(7em, auto) 1fr", gap: "4px 10px", margin: "6px 0 0", fontSize: 13 }}>
            {parameters.map((parameter) => (
              <div key={parameter.key} style={{ display: "contents" }}>
                <dt style={{ color: "var(--muted)" }}>{parameter.label}</dt>
                <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{parameter.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>開發者資料：完整請求 JSON</summary>
        <div style={{ marginTop: 6 }}><JsonBlock value={request} /></div>
      </details>
    </>
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
  const displayedPreviewError = friendlyPreviewError(previewError);

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
          {displayedPreviewError ? <Hint as="p" layer="always">{displayedPreviewError}</Hint> : null}
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
              <RequestPreview request={preview.request} />

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
                  {review.isPending ? "檢查中…" : "再用 AI 加強檢查（可選・0 點）"}
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
              {review.error ? (
                <Hint as="p" layer="always" style={{ color: "var(--gold-ink)" }}>
                  雲端 AI 檢查目前無法連線；上方由系統組裝的模型、提示詞與參數仍可直接使用，不必重新提問。
                </Hint>
              ) : null}
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
