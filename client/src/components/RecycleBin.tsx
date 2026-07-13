import { useState } from "react";
import { trpc } from "../api";
import { Icon, type IconName } from "./Icon";

/** 素材種類 → 圖示（與素材庫一致的視覺語彙） */
const KIND_ICON: Record<string, IconName> = { image: "Image", video: "Clapperboard", audio: "Volume2", doc: "FileText" };
/** 知識種類 → 中文標籤 */
const KNOWLEDGE_LABEL: Record<string, string> = { transcript: "師父開示稿", testimony: "見證故事", script: "腳本", note: "其他筆記" };

function fmtWhen(when: Date | string | null): string {
  if (!when) return "";
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-Hant", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 單列：左側名稱＋刪除時間，右側「還原／永久刪除」 */
function DeletedRow({
  icon,
  title,
  sub,
  when,
  onRestore,
  onPurge,
  busy,
}: {
  icon: IconName;
  title: string;
  sub?: string;
  when: Date | string | null;
  onRestore: () => void;
  onPurge: () => void;
  busy: boolean;
}) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
        borderTop: "1px solid var(--border-soft)",
      }}
    >
      <Icon name={icon} size={16} style={{ flexShrink: 0, color: "var(--soft)" }} />
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        <div className="hint" style={{ fontSize: 11 }}>
          {sub ? `${sub}・` : ""}刪除於 {fmtWhen(when) || "—"}
        </div>
      </div>
      <button style={{ padding: "2px 10px", fontSize: 11 }} disabled={busy} onClick={onRestore}>
        <Icon name="Undo2" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />還原
      </button>
      <button
        style={{ padding: "2px 10px", fontSize: 11, color: "var(--danger)" }}
        disabled={busy}
        title="永久刪除後無法復原"
        onClick={onPurge}
      >
        永久刪除
      </button>
    </div>
  );
}

/**
 * 回收桶：列出本專案已軟刪除的素材／分鏡／知識，可「還原」或「永久刪除」。
 * ★ 金錢安全：軟刪除不退點、不刪原檔；還原＝拿回原素材。永久刪除才真正 db.delete＋刪 Volume 檔。
 */
export function RecycleBin({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const deleted = trpc.projects.listDeleted.useQuery({ projectId }, { enabled: open });

  // 還原／永久刪除後要刷新的快取：回收桶自己＋對應的正式清單
  const refreshAssets = () => { utils.projects.listDeleted.invalidate({ projectId }); utils.projects.assets.invalidate({ projectId }); };
  const refreshScenes = () => { utils.projects.listDeleted.invalidate({ projectId }); utils.scenes.listByProject.invalidate({ projectId }); };
  const refreshKnowledge = () => { utils.projects.listDeleted.invalidate({ projectId }); utils.knowledge.list.invalidate({ projectId }); };

  const restoreAsset = trpc.projects.restoreAsset.useMutation({ onSuccess: refreshAssets });
  const purgeAsset = trpc.projects.purgeAsset.useMutation({ onSuccess: refreshAssets });
  const restoreScene = trpc.scenes.restore.useMutation({ onSuccess: refreshScenes });
  const purgeScene = trpc.scenes.purge.useMutation({ onSuccess: refreshScenes });
  const restoreKnowledge = trpc.knowledge.restore.useMutation({ onSuccess: refreshKnowledge });
  const purgeKnowledge = trpc.knowledge.purge.useMutation({ onSuccess: refreshKnowledge });

  const busy =
    restoreAsset.isPending || purgeAsset.isPending ||
    restoreScene.isPending || purgeScene.isPending ||
    restoreKnowledge.isPending || purgeKnowledge.isPending;
  const err =
    restoreAsset.error ?? purgeAsset.error ??
    restoreScene.error ?? purgeScene.error ??
    restoreKnowledge.error ?? purgeKnowledge.error;

  const data = deleted.data;
  const total = data ? data.assets.length + data.scenes.length + data.knowledge.length : 0;
  const confirmPurge = (label: string, run: () => void) => {
    if (window.confirm(`永久刪除「${label}」？此動作無法復原。`)) run();
  };

  return (
    <section className="card" data-fb="回收桶">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          style={{ padding: "6px 12px", fontSize: 14, display: "inline-flex", alignItems: "center", gap: 8 }}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? "ChevronDown" : "ChevronRight"} size={16} />
          回收桶
        </button>
        {open && data && total > 0 && <span className="badge"><span className="mono">{total}</span> 項可還原</span>}
        <span className="hint" style={{ flex: "1 1 auto", fontSize: 12 }}>
          刪除的素材／分鏡／知識暫存於此，可還原（不扣點）
        </span>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          {deleted.isLoading ? (
            <p className="hint">載入中…</p>
          ) : deleted.error ? (
            <p className="error">載入回收桶失敗：{deleted.error.message}</p>
          ) : total === 0 ? (
            <p className="hint">回收桶是空的——刪除的項目會出現在這裡。</p>
          ) : (
            <>
              {err && <p className="error">操作失敗：{err.message}</p>}

              {data!.assets.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <p className="hint" style={{ margin: "4px 0", fontWeight: 600 }}>素材（{data!.assets.length}）</p>
                  {data!.assets.map((a) => (
                    <DeletedRow
                      key={a.id}
                      icon={KIND_ICON[a.kind] ?? "Package"}
                      title={a.title}
                      sub={a.kind}
                      when={a.deletedAt}
                      busy={busy}
                      onRestore={() => restoreAsset.mutate({ assetId: a.id })}
                      onPurge={() => confirmPurge(a.title, () => purgeAsset.mutate({ assetId: a.id }))}
                    />
                  ))}
                </div>
              )}

              {data!.scenes.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <p className="hint" style={{ margin: "4px 0", fontWeight: 600 }}>分鏡（{data!.scenes.length}）</p>
                  {data!.scenes.map((s) => (
                    <DeletedRow
                      key={s.id}
                      icon="Clapperboard"
                      title={s.title}
                      when={s.deletedAt}
                      busy={busy}
                      onRestore={() => restoreScene.mutate({ sceneId: s.id })}
                      onPurge={() => confirmPurge(s.title, () => purgeScene.mutate({ sceneId: s.id }))}
                    />
                  ))}
                </div>
              )}

              {data!.knowledge.length > 0 && (
                <div>
                  <p className="hint" style={{ margin: "4px 0", fontWeight: 600 }}>知識庫（{data!.knowledge.length}）</p>
                  {data!.knowledge.map((k) => (
                    <DeletedRow
                      key={k.id}
                      icon="FileText"
                      title={k.title}
                      sub={`${KNOWLEDGE_LABEL[k.kind] ?? k.kind}・${k.chars} 字`}
                      when={k.deletedAt}
                      busy={busy}
                      onRestore={() => restoreKnowledge.mutate({ id: k.id })}
                      onPurge={() => confirmPurge(k.title, () => purgeKnowledge.mutate({ id: k.id }))}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
