import { trpc } from "../api";

function StatusPoller({ id }: { id: string }) {
  const utils = trpc.useUtils();
  trpc.generation.status.useQuery(
    { id },
    {
      refetchInterval: 4000,
      // 完成後刷新列表與點數
      select: (data) => {
        if (data.status === "done" || data.status === "failed") {
          utils.generation.listByProject.invalidate();
          utils.quota.my.invalidate();
          utils.scenes.listByProject.invalidate();
        }
        return data;
      },
    },
  );
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
  const list = trpc.generation.listByProject.useQuery({ projectId }, { refetchInterval: 8000 });
  const addScene = trpc.scenes.addFromGeneration.useMutation({
    onSuccess: () => utils.scenes.listByProject.invalidate({ projectId }),
  });

  if (list.isLoading) return <p className="hint">載入中…</p>;
  if (!list.data?.length) return <p className="hint" style={{ marginTop: 12 }}>還沒有生成紀錄——上面試一次吧。</p>;

  return (
    <div style={{ marginTop: 14 }}>
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
                <img className="gen-thumb" src={g.resultUrl} alt="" />
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
                  <button style={{ padding: "2px 10px", fontSize: 11 }} onClick={() => navigator.clipboard.writeText(g.resultText ?? "")}>
                    複製文字
                  </button>
                </div>
              </div>
            )}
            {g.error && <div className="error">{g.error}</div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <span className={`pill ${g.status}`}>{STATUS_LABEL[g.status] ?? g.status}</span>
            {g.status === "done" && g.kind !== "text" && (
              <button style={{ padding: "4px 12px", fontSize: 12 }} disabled={addScene.isPending}
                onClick={() => addScene.mutate({ generationId: g.id })}>
                ＋加入分鏡
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
