import { trpc } from "../api";

/** 分鏡與交付：簡易排序（↑↓）＋打包下載（交付包給剪映/Premiere 組裝） */
export function SceneList({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const scenes = trpc.scenes.listByProject.useQuery({ projectId }, { refetchInterval: 10_000 });
  const invalidate = () => utils.scenes.listByProject.invalidate({ projectId });
  const move = trpc.scenes.move.useMutation({ onSuccess: invalidate });
  const remove = trpc.scenes.remove.useMutation({ onSuccess: invalidate });

  const list = scenes.data ?? [];
  const totalSec = list.reduce((sum, s) => sum + s.durationSec, 0);

  return (
    <section className="card">
      <h2>分鏡・交付</h2>
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
                <div className="meta mono" style={{ fontSize: 11 }}>{s.durationSec}s・{s.assetKind ?? "無素材"}</div>
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
