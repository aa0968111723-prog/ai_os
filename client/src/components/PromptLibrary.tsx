import { trpc } from "../api";

/**
 * 提示詞庫（簡報「打過的咒語一鍵再用」）：
 * 成功生成的提示詞自動入庫，這裡可「再用」（帶入生成台）、「複製」、「刪除」。
 */
export function PromptLibrary({ projectId, onUse }: { projectId: string; onUse: (text: string) => void }) {
  const utils = trpc.useUtils();
  const list = trpc.prompts.list.useQuery({ projectId });
  const remove = trpc.prompts.remove.useMutation({ onSuccess: () => utils.prompts.list.invalidate({ projectId }) });

  if (!list.data?.length) return null; // 沒有咒語就不佔版面（生成成功後自動出現）

  return (
    <section className="card">
      <h2>提示詞庫（打過的咒語，一鍵再用）</h2>
      <p className="hint">成功生成的提示詞會自動存這裡；常用的排在前面。</p>
      <div style={{ marginTop: 8 }}>
        {list.data.map((p) => (
          <div key={p.id} className="gen-row" style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}>
            <div style={{ fontSize: 13 }}>
              {p.text}
              {p.useCount > 1 && <span className="chip" style={{ marginLeft: 6 }}>用過 {p.useCount} 次</span>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ padding: "3px 12px", fontSize: 12 }} onClick={() => onUse(p.text)}>再用</button>
              <button style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => navigator.clipboard.writeText(p.text)}>複製</button>
              <button
                style={{ padding: "3px 10px", fontSize: 12, color: "var(--danger)" }}
                disabled={remove.isPending}
                onClick={() => remove.mutate({ id: p.id })}
              >
                刪除
              </button>
            </div>
          </div>
        ))}
      </div>
      {remove.error && <p className="error">{remove.error.message}</p>}
    </section>
  );
}
