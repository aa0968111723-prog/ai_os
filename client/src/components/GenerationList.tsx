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
          utils.generation.pointsSummary.invalidate();
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
  const list = trpc.generation.listByProject.useQuery({ projectId }, { refetchInterval: 8000 });

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
            ) : (
              <a href={g.resultUrl} target="_blank" rel="noreferrer">
                <img className="gen-thumb" src={g.resultUrl} alt="" />
              </a>
            )
          ) : (
            <div className="gen-thumb" />
          )}
          <div>
            <div style={{ fontSize: 14 }}>{g.prompt}</div>
            <div className="meta mono" style={{ fontSize: 11 }}>
              {g.modelId}・預估 −{g.pointsEst}
              {g.pointsActual != null && `・實際 −${g.pointsActual}`}
              {g.pointsRefunded > 0 && `・退回 +${g.pointsRefunded}`}
            </div>
            {g.error && <div className="error">{g.error}</div>}
          </div>
          <span className={`pill ${g.status}`}>{STATUS_LABEL[g.status] ?? g.status}</span>
        </div>
      ))}
    </div>
  );
}
