import { useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { ConfirmButton } from "./interactions";

/** AI 導演建議（定案：建議僅供參考，成品須組長審核） */
export function DirectorCard({ projectId, onUse }: { projectId: string; onUse: (prompt: string) => void }) {
  const utils = trpc.useUtils();
  // 會扣組共享點數——成功後刷新點數徽章，別讓頂欄顯示舊值
  const suggest = trpc.director.suggest.useMutation({ onSuccess: () => utils.quota.my.invalidate() });
  // 工作台深度整合：建議一鍵存成③的分鏡草稿（免費、不扣點），發想直接落地
  const [savedIdx, setSavedIdx] = useState<Set<number>>(new Set());
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const addDraft = trpc.scenes.addDraft.useMutation({
    onSuccess: () => utils.scenes.listByProject.invalidate({ projectId }),
  });
  const saveAsScene = async (i: number, s: { title: string; prompt: string }) => {
    setSavingIdx(i);
    try {
      await addDraft.mutateAsync({ projectId, title: s.title.slice(0, 60), prompt: s.prompt });
      setSavedIdx((prev) => new Set(prev).add(i));
    } catch {
      // addDraft.error 已顯示在卡片底部；不標記已存，讓使用者可重試
    } finally {
      setSavingIdx((cur) => (cur === i ? null : cur));
    }
  };
  return (
    <section className="card" data-fb="AI 導演卡">
      <h2>AI 導演建議</h2>
      <p className="hint">依世界觀＋專案知識庫給分鏡 idea——僅供參考，成品仍須組長審核。</p>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {/* 本站通則「確認/揭示才扣點」：這裡也要先看價再花錢，不能一鍵靜默扣共享點數 */}
        <ConfirmButton
          triggerClassName="primary"
          disabled={suggest.isPending}
          message="會請 AI 導演讀世界觀＋知識庫給 3 個分鏡 idea——NIM 免費額度，不扣點。"
          confirmLabel="開始發想"
          onConfirm={() => { setSavedIdx(new Set()); suggest.mutate({ projectId }); }}
        >
          {suggest.isPending ? "導演思考中…" : "給我 3 個分鏡 idea"}
        </ConfirmButton>
        <span className="hint">免費（NVIDIA NIM）</span>
      </div>
      {suggest.error && <p className="error">{suggest.error.message}</p>}
      {suggest.data && (
        <div style={{ marginTop: "var(--sp-12)" }}>
          <p className="hint" style={{ fontSize: "var(--fs-12)" }}>
            {suggest.data.usedKnowledge ? <><Icon name="Check" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />已讀取專案知識庫的素材</> : "（尚未加入素材知識——加了開示/腳本，建議會更貼合）"}
            {suggest.data.mock ? "・測試模式建議" : ""}
          </p>
          {suggest.data.fallback && (
            <p className="hint" style={{ fontSize: 12 }}>
              {("limitNotice" in suggest.data && suggest.data.limitNotice)
                ? `（${suggest.data.limitNotice}——以下是通用建議）`
                : "（AI 暫時沒回應，以下是通用建議）"}
            </p>
          )}
          {suggest.data.suggestions.map((s, i) => {
            const saved = savedIdx.has(i);
            const saving = savingIdx === i;
            return (
              <div key={i} className="gen-row" style={{ gridTemplateColumns: "1fr auto" }}>
                <div>
                  <div style={{ fontSize: "var(--fs-14)", fontWeight: 600 }}>{s.title}</div>
                  <div className="meta" style={{ fontSize: "var(--fs-12)" }}>{s.prompt}</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button className="btn-sm" onClick={() => onUse(s.prompt)} title="把提示詞帶到生成台，馬上生成">
                    用這個
                  </button>
                  {/* 發想直接落地：建一格帶提示詞的草稿分鏡（不扣點），之後在③就地生成 */}
                  <button
                    className="btn-sm"
                    disabled={saved || saving}
                    title="在③分鏡列表建一格帶此提示詞的草稿（不扣點），之後可就地生成"
                    onClick={() => saveAsScene(i, s)}
                  >
                    {saved ? (
                      <><Icon name="Check" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />已存分鏡</>
                    ) : saving ? "存入中…" : (
                      <><Icon name="Clapperboard" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />存成分鏡</>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
          {addDraft.error && <p className="error">存成分鏡失敗：{addDraft.error.message}</p>}
        </div>
      )}
    </section>
  );
}
