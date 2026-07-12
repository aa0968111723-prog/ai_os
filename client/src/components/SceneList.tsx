import { trpc } from "../api";

const SCENE_STATUS: Record<string, { label: string; cls: string }> = {
  todo: { label: "草稿", cls: "queued" },
  review: { label: "草稿", cls: "queued" },
  pending: { label: "待審", cls: "running" },
  needs_work: { label: "需修改", cls: "failed" },
  approved: { label: "已通過", cls: "done" },
};

/** 分鏡與交付：簡易排序（↑↓）＋送審/裁決（三態機）＋打包下載 */
export function SceneList({ projectId, isLeader }: { projectId: string; isLeader: boolean }) {
  const utils = trpc.useUtils();
  const scenes = trpc.scenes.listByProject.useQuery({ projectId }, { refetchInterval: 10_000 });
  const approvals = trpc.approvals.listByProject.useQuery({ projectId }, { refetchInterval: 10_000 });
  const invalidate = () => {
    utils.scenes.listByProject.invalidate({ projectId });
    utils.approvals.listByProject.invalidate({ projectId });
    utils.messages.list.invalidate({ projectId });
  };
  const move = trpc.scenes.move.useMutation({ onSuccess: invalidate });
  const remove = trpc.scenes.remove.useMutation({ onSuccess: invalidate });
  const submitApproval = trpc.approvals.submit.useMutation({ onSuccess: invalidate });
  const decide = trpc.approvals.decide.useMutation({ onSuccess: invalidate });
  const pendingOf = (sceneId: string) => approvals.data?.find((a) => a.sceneId === sceneId && a.status === "pending");
  // 統一小紅字：這四個 mutation 先前只有 isPending disable，失敗時畫面毫無反應（使用者以為操作成功）
  const actionError = submitApproval.error ?? decide.error ?? move.error ?? remove.error;

  const list = scenes.data ?? [];
  const totalSec = list.reduce((sum, s) => sum + s.durationSec, 0);

  return (
    <section className="card">
      <h2>分鏡・交付</h2>
      {actionError && <p className="error">操作失敗：{actionError.message}</p>}
      {list.length === 0 ? (
        <p className="hint">還沒有分鏡——生成完成後按「＋加入分鏡」，排好順序就能打包交付。</p>
      ) : (
        <>
          {list.map((s, i) => (
            <div key={s.id} className="gen-row">
              {s.assetUrl ? (
                s.assetKind === "video" ? (
                  <video className="gen-thumb" src={s.assetUrl} muted />
                ) : (
                  <img className="gen-thumb" src={s.assetUrl} alt="" />
                )
              ) : (
                <div className="gen-thumb" />
              )}
              <div>
                <div style={{ fontSize: 14 }}>
                  <span className="mono" style={{ color: "var(--primary)", marginRight: 8 }}>{i + 1}</span>
                  {s.title}
                </div>
                <div className="meta mono" style={{ fontSize: 11 }}>
                  {s.durationSec}s・{s.assetKind ?? "無素材"}
                  <span className={`pill ${SCENE_STATUS[s.status]?.cls ?? "queued"}`} style={{ marginLeft: 8 }}>
                    {SCENE_STATUS[s.status]?.label ?? s.status}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  {(s.status === "todo" || s.status === "review" || s.status === "needs_work") && (
                    <button style={{ padding: "3px 12px", fontSize: 12 }} disabled={submitApproval.isPending}
                      onClick={() => submitApproval.mutate({ sceneId: s.id })}>
                      送審
                    </button>
                  )}
                  {isLeader && s.status === "pending" && pendingOf(s.id) && (
                    <>
                      <button style={{ padding: "3px 12px", fontSize: 12, color: "var(--success)", borderColor: "var(--success)" }}
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ approvalId: pendingOf(s.id)!.id, decision: "approved" })}>
                        ✓ 通過
                      </button>
                      <button style={{ padding: "3px 12px", fontSize: 12, color: "var(--danger)", borderColor: "var(--danger)" }}
                        disabled={decide.isPending}
                        onClick={() => {
                          const reason = window.prompt("退回理由（會通知提交人）：");
                          if (reason?.trim()) decide.mutate({ approvalId: pendingOf(s.id)!.id, decision: "needs_work", reason: reason.trim() });
                        }}>
                        ↩ 退回
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button style={{ padding: "4px 10px" }} disabled={i === 0 || move.isPending} onClick={() => move.mutate({ sceneId: s.id, direction: "up" })}>▲</button>
                <button style={{ padding: "4px 10px" }} disabled={i === list.length - 1 || move.isPending} onClick={() => move.mutate({ sceneId: s.id, direction: "down" })}>▼</button>
                <button style={{ padding: "4px 10px", color: "var(--danger)" }} disabled={remove.isPending} onClick={() => remove.mutate({ sceneId: s.id })}>✕</button>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
            <a href={`/api/export/${projectId}`} target="_blank" rel="noreferrer">
              <button className="primary">打包下載交付包（.zip）</button>
            </a>
            <span className="hint">共 {list.length} 鏡・約 {totalSec} 秒｜含素材＋腳本鏡頭表，直接進剪映/Premiere</span>
          </div>
        </>
      )}
    </section>
  );
}
