import { useState } from "react";
import { trpc } from "../api";
import { Icon, type IconName } from "./Icon";
import { ConfirmButton } from "./interactions";
import { Badge, Button, Hint, Meta, Skeleton } from "./ui";
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
  restoring,
  purging,
}: {
  icon: IconName;
  title: string;
  sub?: string;
  when: Date | string | null;
  onRestore: () => void;
  onPurge: () => void;
  /** 這一列自己的還原/刪除進行中——只鎖本列並顯示進度，其他列照常可按（連續救回多項不必整桶等待） */
  restoring: boolean;
  purging: boolean;
}) {
  const rowBusy = restoring || purging;
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
        <Meta as="div" style={{ fontSize: 11 }}>
          {sub ? `${sub}・` : ""}刪除於 {fmtWhen(when) || "—"}
        </Meta>
      </div>
      <Button size="sm" disabled={rowBusy} onClick={onRestore}>
        {restoring ? (
          <><Icon name="Loader" className="spin" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />還原中…</>
        ) : (
          <><Icon name="Undo2" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />還原</>
        )}
      </Button>
      <ConfirmButton
        triggerClassName="btn-sm"
        triggerStyle={{ color: "var(--danger-ink)" }}
        disabled={rowBusy}
        triggerTitle="永久刪除後無法復原"
        message={`永久刪除「${title}」？此動作無法復原。`}
        confirmLabel="永久刪除"
        onConfirm={onPurge}
      >
        {purging ? "刪除中…" : "永久刪除"}
      </ConfirmButton>
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
  // 折疊態也先抓一次，讓收合的回收桶就能顯示「N 項可還原」的提示（避免誤刪後毫無線索）
  const deleted = trpc.projects.listDeleted.useQuery({ projectId });

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

  const err =
    restoreAsset.error ?? purgeAsset.error ??
    restoreScene.error ?? purgeScene.error ??
    restoreKnowledge.error ?? purgeKnowledge.error;

  const data = deleted.data;
  const total = data ? data.assets.length + data.scenes.length + data.knowledge.length : 0;

  return (
    <section className="card" data-fb="回收桶">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          style={{ padding: "6px 12px", fontSize: 14, display: "inline-flex", alignItems: "center", gap: 8 }}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? "ChevronUp" : "ChevronDown"} size={16} />
          回收桶
        </button>
        {data && total > 0 && <Badge><span className="mono">{total}</span> 項可還原</Badge>}
        <Hint as="span" layer="always" style={{ flex: "1 1 auto", fontSize: 12 }}>
          刪除的素材／分鏡／知識暫存於此，可還原（不扣點）
        </Hint>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          {deleted.isLoading ? (
            // 與全站主清單一致的骨架微光（一行灰字容易被誤讀成「卡住了」，且載入後高度跳動）
            <div aria-hidden="true">
              {[0, 1].map((i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border-soft)" }}>
                  <Skeleton style={{ width: 16, height: 16, borderRadius: 4 }} />
                  <Skeleton style={{ height: 13, flex: "1 1 auto", maxWidth: i === 0 ? 220 : 170 }} />
                  <Skeleton style={{ height: 26, width: 64, borderRadius: 999 }} />
                </div>
              ))}
            </div>
          ) : deleted.error ? (
            <p className="error">載入回收桶失敗：{deleted.error.message}</p>
          ) : total === 0 ? (
            <Hint layer="always">回收桶是空的——刪除的項目會出現在這裡。</Hint>
          ) : (
            <>
              {err && <p className="error">操作失敗：{err.message}</p>}

              {data!.assets.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <Meta as="p" style={{ margin: "4px 0", fontWeight: 600 }}>素材（{data!.assets.length}）</Meta>
                  {data!.assets.map((a) => (
                    <DeletedRow
                      key={a.id}
                      icon={KIND_ICON[a.kind] ?? "Package"}
                      title={a.title}
                      sub={a.kind}
                      when={a.deletedAt}
                      restoring={restoreAsset.isPending && restoreAsset.variables?.assetId === a.id}
                      purging={purgeAsset.isPending && purgeAsset.variables?.assetId === a.id}
                      onRestore={() => restoreAsset.mutate({ assetId: a.id })}
                      onPurge={() => purgeAsset.mutate({ assetId: a.id })}
                    />
                  ))}
                </div>
              )}

              {data!.scenes.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <Meta as="p" style={{ margin: "4px 0", fontWeight: 600 }}>分鏡（{data!.scenes.length}）</Meta>
                  {data!.scenes.map((s) => (
                    <DeletedRow
                      key={s.id}
                      icon="Clapperboard"
                      title={s.title}
                      when={s.deletedAt}
                      restoring={restoreScene.isPending && restoreScene.variables?.sceneId === s.id}
                      purging={purgeScene.isPending && purgeScene.variables?.sceneId === s.id}
                      onRestore={() => restoreScene.mutate({ sceneId: s.id })}
                      onPurge={() => purgeScene.mutate({ sceneId: s.id })}
                    />
                  ))}
                </div>
              )}

              {data!.knowledge.length > 0 && (
                <div>
                  <Meta as="p" style={{ margin: "4px 0", fontWeight: 600 }}>知識庫（{data!.knowledge.length}）</Meta>
                  {data!.knowledge.map((k) => (
                    <DeletedRow
                      key={k.id}
                      icon="FileText"
                      title={k.title}
                      sub={`${KNOWLEDGE_LABEL[k.kind] ?? k.kind}・${k.chars} 字`}
                      when={k.deletedAt}
                      restoring={restoreKnowledge.isPending && restoreKnowledge.variables?.id === k.id}
                      purging={purgeKnowledge.isPending && purgeKnowledge.variables?.id === k.id}
                      onRestore={() => restoreKnowledge.mutate({ id: k.id })}
                      onPurge={() => purgeKnowledge.mutate({ id: k.id })}
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
