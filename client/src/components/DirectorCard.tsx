import { trpc } from "../api";
import { Icon } from "./Icon";
import { ConfirmButton } from "./interactions";

/** AI 導演建議（定案：建議僅供參考，成品須組長審核） */
export function DirectorCard({ projectId, onUse }: { projectId: string; onUse: (prompt: string) => void }) {
  const utils = trpc.useUtils();
  // 會扣組共享點數——成功後刷新點數徽章，別讓頂欄顯示舊值
  const suggest = trpc.director.suggest.useMutation({ onSuccess: () => utils.quota.my.invalidate() });
  return (
    <section className="card" data-fb="AI 導演卡">
      <h2>AI 導演建議</h2>
      <p className="hint">依世界觀＋專案知識庫給分鏡 idea——僅供參考，成品仍須組長審核。</p>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {/* 本站通則「確認/揭示才扣點」：這裡也要先看價再花錢，不能一鍵靜默扣共享點數 */}
        <ConfirmButton
          triggerClassName="primary"
          disabled={suggest.isPending}
          message="會請 AI 導演讀世界觀＋知識庫給 3 個分鏡 idea，約扣 1 點。"
          confirmLabel="開始發想"
          onConfirm={() => suggest.mutate({ projectId })}
        >
          {suggest.isPending ? "導演思考中…" : "給我 3 個分鏡 idea"}
        </ConfirmButton>
        <span className="hint">每次約 1 點</span>
      </div>
      {suggest.error && <p className="error">{suggest.error.message}</p>}
      {suggest.data && (
        <div style={{ marginTop: "var(--sp-12)" }}>
          <p className="hint" style={{ fontSize: "var(--fs-12)" }}>
            {suggest.data.usedKnowledge ? <><Icon name="Check" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />已讀取專案知識庫的素材</> : "（尚未加入素材知識——加了開示/腳本，建議會更貼合）"}
            {suggest.data.mock ? "・測試模式建議" : ""}
          </p>
          {suggest.data.fallback && (
            <p className="hint" style={{ fontSize: 12 }}>（AI 暫時沒回應，以下是通用建議）</p>
          )}
          {suggest.data.suggestions.map((s, i) => (
            <div key={i} className="gen-row" style={{ gridTemplateColumns: "1fr auto" }}>
              <div>
                <div style={{ fontSize: "var(--fs-14)", fontWeight: 600 }}>{s.title}</div>
                <div className="meta" style={{ fontSize: "var(--fs-12)" }}>{s.prompt}</div>
              </div>
              <button className="btn-sm" onClick={() => onUse(s.prompt)}>
                用這個
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
