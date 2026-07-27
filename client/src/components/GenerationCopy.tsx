export const GENERATION_PROMPT_COLLAPSE_AT = 180;
export const GENERATION_RESULT_COLLAPSE_AT = 320;
export const GENERATION_RESULT_PREVIEW_LENGTH = 220;

export function generationResultPreview(text: string): string {
  return text.slice(0, GENERATION_RESULT_PREVIEW_LENGTH).replace(/\s+/g, " ");
}

/** Prompt copy stays compact by default but remains fully available through native details. */
export function GenerationPromptCopy({ text }: { text: string }) {
  if (text.length <= GENERATION_PROMPT_COLLAPSE_AT) return <>{text}</>;
  return (
    <details className="generation-copy-details">
      <summary>
        {text.slice(0, GENERATION_PROMPT_COLLAPSE_AT)}… <span className="hint">顯示完整提示詞</span>
      </summary>
      <div className="mono generation-copy-details__body">{text}</div>
    </details>
  );
}

/** Long text results are collapsed by default to keep the generation list scannable. */
export function GenerationResultCopy({
  text,
  copied = false,
  onCopy,
}: {
  text: string;
  copied?: boolean;
  onCopy: () => void;
}) {
  const copyButton = (
    <div style={{ marginTop: 6 }}>
      <button type="button" style={{ padding: "2px 10px", fontSize: 11 }} onClick={onCopy}>
        {copied ? "已複製 ✓" : "複製文字"}
      </button>
    </div>
  );

  if (text.length <= GENERATION_RESULT_COLLAPSE_AT) {
    return (
      <div className="result-text" style={{ whiteSpace: "pre-wrap", fontSize: 13, marginTop: 6 }}>
        {text}
        {copyButton}
      </div>
    );
  }

  return (
    <details className="result-text generation-copy-details" style={{ marginTop: 6 }}>
      <summary>
        {generationResultPreview(text)}…{" "}
        <span className="hint">顯示完整結果（{text.length.toLocaleString()} 字）</span>
      </summary>
      <div className="generation-copy-details__body" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
        {text}
        {copyButton}
      </div>
    </details>
  );
}
