import { useState } from "react";
import { trpc } from "../api";
import { ConfirmButton } from "./interactions";

/**
 * 提示詞庫（簡報「打過的咒語一鍵再用」）：
 * 成功生成的提示詞自動入庫，這裡可「再用」（帶入生成台）、「複製」、「刪除」。
 */
export function PromptLibrary({ projectId, onUse }: { projectId: string; onUse: (text: string) => void }) {
  const utils = trpc.useUtils();
  const list = trpc.prompts.list.useQuery({ projectId });
  const remove = trpc.prompts.remove.useMutation({ onSuccess: () => utils.prompts.list.invalidate({ projectId }) });

  // 複製給即時回饋：成功閃「已複製」、被瀏覽器擋下閃「複製失敗」，約 1.5 秒後復原。
  const [copyState, setCopyState] = useState<{ id: string; ok: boolean } | null>(null);
  const flashCopy = (id: string, ok: boolean) => {
    setCopyState({ id, ok });
    setTimeout(() => setCopyState((s) => (s && s.id === id ? null : s)), 1500);
  };
  const copy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(
      () => flashCopy(id, true),
      () => flashCopy(id, false),
    );
  };

  if (!list.data?.length) return null; // 沒有咒語就不佔版面（生成成功後自動出現）

  return (
    <section className="card" data-fb="提示詞庫">
      <h2>提示詞庫（用過的提示詞，一鍵再用）</h2>
      <p className="hint">成功生成的提示詞會自動存這裡；常用的排在前面。</p>
      <div style={{ marginTop: 8 }}>
        {list.data.map((p) => (
          <div key={p.id} className="gen-row" style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}>
            <div style={{ fontSize: "var(--fs-13)" }}>
              {p.text}
              {p.useCount > 1 && <span className="chip" style={{ marginLeft: 6 }}>用過 {p.useCount} 次</span>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ padding: "3px 12px", fontSize: "var(--fs-12)" }} onClick={() => onUse(p.text)}>再用</button>
              <button style={{ padding: "3px 10px", fontSize: "var(--fs-12)" }} onClick={() => copy(p.id, p.text)}>
                {copyState?.id === p.id ? (copyState.ok ? "已複製" : "複製失敗") : "複製"}
              </button>
              <ConfirmButton
                onConfirm={() => remove.mutate({ id: p.id })}
                message="刪除這則提示詞？"
                confirmLabel="刪除"
                triggerStyle={{ padding: "3px 10px", fontSize: "var(--fs-12)", color: "var(--danger-ink)" }}
                disabled={remove.isPending}
              >
                刪除
              </ConfirmButton>
            </div>
          </div>
        ))}
      </div>
      {remove.error && <p className="error">{remove.error.message}</p>}
    </section>
  );
}
