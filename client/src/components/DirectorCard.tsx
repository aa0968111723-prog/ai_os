import { trpc } from "../api";

/** AI 導演建議（定案：建議僅供參考，成品須組長審核） */
export function DirectorCard({ projectId, onUse }: { projectId: string; onUse: (prompt: string) => void }) {
  const suggest = trpc.director.suggest.useMutation();
  return (
    <section className="card">
      <h2>AI 導演建議</h2>
      <p className="hint">依世界觀＋專案知識庫給分鏡 idea——僅供參考，成品仍須組長審核。</p>
      <button className="primary" disabled={suggest.isPending} onClick={() => suggest.mutate({ projectId })}>
        {suggest.isPending ? "導演思考中…" : "給我 3 個分鏡 idea"}
      </button>
      {suggest.error && <p className="error">{suggest.error.message}</p>}
      {suggest.data && (
        <div style={{ marginTop: 12 }}>
          <p className="hint" style={{ fontSize: 12 }}>
            {suggest.data.usedKnowledge ? "✓ 已讀取專案知識庫的素材" : "（尚未加入素材知識——加了開示/腳本，建議會更貼合）"}
            {suggest.data.mock ? "・示範建議" : ""}
          </p>
          {suggest.data.fallback && (
            <p className="hint" style={{ fontSize: 12, color: "var(--soft)" }}>（AI 暫時沒回應，以下是通用建議）</p>
          )}
          {suggest.data.suggestions.map((s, i) => (
            <div key={i} className="gen-row" style={{ gridTemplateColumns: "1fr auto" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{s.title}</div>
                <div className="meta" style={{ fontSize: 12 }}>{s.prompt}</div>
              </div>
              <button style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => onUse(s.prompt)}>
                用這個
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
