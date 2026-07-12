import { useEffect, useState } from "react";
import { trpc } from "../api";

function StatusPoller({ id }: { id: string }) {
  const utils = trpc.useUtils();
  const status = trpc.generation.status.useQuery(
    { id },
    {
      // 到終局（done/failed）就停：此元件要等父列表刷新才卸載，這段空窗不能繼續空轉打 API
      refetchInterval: (query) =>
        query.state.data?.status === "done" || query.state.data?.status === "failed" ? false : 4000,
      // 切到別的分頁時也要繼續輪詢——否則使用者一離開，生成就「卡在生成中」直到切回來。
      refetchIntervalInBackground: true,
    },
  );
  const finished = status.data?.status === "done" || status.data?.status === "failed";
  // 完成後刷新列表與點數。副作用不能放 select（select 會在每次 render 重跑，觸發次數不受控）
  useEffect(() => {
    if (!finished) return;
    utils.generation.listByProject.invalidate();
    utils.quota.my.invalidate();
    utils.scenes.listByProject.invalidate();
    utils.projects.assets.invalidate(); // 生成完成會 insert 素材，素材庫/來源下拉要即時反映
  }, [finished, utils]);
  return null;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "排隊中",
  running: "生成中…",
  done: "完成 ✓",
  failed: "失敗（已退點）",
};

export function GenerationList({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const list = trpc.generation.listByProject.useQuery(
    { projectId },
    {
      // 沒有進行中的生成就停輪詢（省 API）；新送出／重試都會 invalidate 喚醒
      refetchInterval: (query) =>
        query.state.data?.some((g) => g.status === "queued" || g.status === "running") ? 8000 : false,
      refetchIntervalInBackground: true,
    },
  );
  // 與 SceneList 同 key 共用快取，不會多打 API——用來判斷成品是否已加入分鏡
  const scenes = trpc.scenes.listByProject.useQuery({ projectId });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const addScene = trpc.scenes.addFromGeneration.useMutation({
    onMutate: () => setAddedId(null),
    onSuccess: (_data, vars) => {
      setAddedId(vars.generationId);
      utils.scenes.listByProject.invalidate({ projectId });
    },
  });
  const retry = trpc.generation.submit.useMutation({
    onSuccess: () => {
      utils.generation.listByProject.invalidate({ projectId });
      utils.quota.my.invalidate();
    },
  });
  const addSceneError = addScene.error?.message;
  // 生成紀錄沒存 assetId，但素材的 url 與生成的 resultUrl 在落地前後都同步相等——以此比對「已加入」
  const inScenes = (resultUrl: string | null) => !!resultUrl && !!scenes.data?.some((s) => s.assetUrl === resultUrl);
  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
  };

  if (list.isLoading) return <p className="hint">載入中…</p>;
  if (!list.data?.length) return <p className="hint" style={{ marginTop: 12 }}>還沒有生成紀錄——上面試一次吧。</p>;

  return (
    <div style={{ marginTop: 14 }}>
      {addSceneError && <p className="error">加入分鏡失敗：{addSceneError}</p>}
      {addedId && !addSceneError && (
        <p className="hint" style={{ color: "var(--success)" }}>已加入分鏡 ✓（在下方分鏡・交付區）</p>
      )}
      {retry.error && <p className="error">重試失敗：{retry.error.message}</p>}
      {list.data.map((g) => (
        <div key={g.id} className="gen-row">
          {(g.status === "queued" || g.status === "running") && <StatusPoller id={g.id} />}
          {g.resultUrl ? (
            g.kind === "video" ? (
              <video className="gen-thumb" src={g.resultUrl} controls muted />
            ) : g.kind === "audio" ? (
              <div className="gen-thumb" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🔊</div>
            ) : (
              <a href={g.resultUrl} target="_blank" rel="noreferrer">
                <img className="gen-thumb" src={g.resultUrl} alt={g.prompt.slice(0, 40)} />
              </a>
            )
          ) : (
            <div className="gen-thumb" style={g.kind === "text" ? { display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 } : undefined}>
              {g.kind === "text" ? "📝" : ""}
            </div>
          )}
          <div>
            <div style={{ fontSize: 14 }}>{g.prompt}</div>
            <div className="meta mono" style={{ fontSize: 11 }}>
              {g.modelId}・−{g.pointsEst} 點{g.pointsRefunded > 0 && `（已退 +${g.pointsRefunded}）`}
            </div>
            {g.kind === "audio" && g.resultUrl && (
              <audio controls src={g.resultUrl} style={{ width: "100%", maxWidth: 320, height: 32, marginTop: 6 }} />
            )}
            {g.resultText && (
              <div
                className="result-text"
                style={{
                  whiteSpace: "pre-wrap", fontSize: 13, background: "var(--bg, #F4EEE4)",
                  border: "1px solid rgba(0,0,0,.08)", borderRadius: 10, padding: "8px 12px", marginTop: 6,
                }}
              >
                {g.resultText}
                <div style={{ marginTop: 6 }}>
                  <button style={{ padding: "2px 10px", fontSize: 11 }} onClick={() => copyText(g.id, g.resultText ?? "")}>
                    {copiedId === g.id ? "已複製 ✓" : "複製文字"}
                  </button>
                </div>
              </div>
            )}
            {g.error && <div className="error">生成失敗：{g.error}</div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <span className={`pill ${g.status}`}>{STATUS_LABEL[g.status] ?? g.status}</span>
            {g.status === "done" && g.kind !== "text" && (
              inScenes(g.resultUrl) ? (
                <button style={{ padding: "4px 12px", fontSize: 12 }} disabled>已加入</button>
              ) : (
                <button style={{ padding: "4px 12px", fontSize: 12 }} disabled={addScene.isPending}
                  onClick={() => addScene.mutate({ generationId: g.id })}>
                  ＋加入分鏡
                </button>
              )
            )}
            {g.status === "failed" && (
              <button style={{ padding: "4px 12px", fontSize: 12 }} disabled={retry.isPending}
                onClick={() => {
                  const cost = g.pointsEst > 0 ? `會再扣 ${g.pointsEst} 點` : "會再扣點";
                  if (!window.confirm(`以相同設定重試${cost}，確定要重試嗎？`)) return;
                  retry.mutate({ projectId, modelId: g.modelId, prompt: g.prompt, sourceUrl: g.sourceUrl ?? undefined });
                }}>
                以相同設定重試
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
