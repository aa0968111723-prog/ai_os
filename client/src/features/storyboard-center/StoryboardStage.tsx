/**
 * ② 分鏡（Storyboard Center；PE 計畫 §10）：分鏡卡是整套系統的中心。
 * 場（story_scenes）分組 → 每場底下的分鏡卡（Shot）；簡單／專業模式切換顯示深度。
 * 生成一律從 Shot 出發（單格工作室），素材天然知道自己屬於哪一幕哪一鏡哪個版本。
 * 交付面（粗剪、配音管線、打包）仍在「④ 成片」的 SceneList——這裡專注創作。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { SceneStudio } from "../../components/SceneStudio";
import { Button, Card, EmptyState, Hint, Meta } from "../../components/ui";
import { scrollToSelector } from "../creation-workbench/workbenchNav";
import { groupShotsByScene, loadBoardMode, saveBoardMode, type BoardMode } from "./boardPrefs";
import { SceneGroupHeader, type StorySceneRow } from "./SceneGroupHeader";
import { ShotCard, type ShotRow } from "./ShotCard";
import { registerAssistantFocus } from "../../lib/assistantContext";

export function StoryboardStage({
  projectId,
  canEdit,
  charIds,
  sceneIds,
  propIds,
}: {
  projectId: string;
  canEdit: boolean;
  /** 生成台勾選（單格工作室的 fallback 錨點；本鏡有綁定就用本鏡的） */
  charIds: string[];
  sceneIds: string[];
  propIds: string[];
}) {
  const utils = trpc.useUtils();
  const storyScenes = trpc.story.scenesList.useQuery({ projectId });
  const shots = trpc.scenes.listByProject.useQuery({ projectId });
  const characters = trpc.characters.list.useQuery({ projectId });
  const scenePresets = trpc.scenePresets.list.useQuery({ projectId });
  const looks = trpc.characterLooks.list.useQuery({ projectId });
  // §23／P3：哪些鏡的畫面已經跟卡片對不上（唯讀；不自動重生成）
  const continuity = trpc.story.continuityCheck.useQuery({ projectId });
  const [mode, setMode] = useState<BoardMode>(() => loadBoardMode(projectId));
  const [studioSceneId, setStudioSceneId] = useState<string | null>(null);
  const switchMode = (m: BoardMode) => {
    setMode(m);
    saveBoardMode(projectId, m);
  };

  const shotRows = (shots.data ?? []) as unknown as ShotRow[];
  const sceneRows = (storyScenes.data ?? []) as unknown as StorySceneRow[];
  const groups = useMemo(
    () => groupShotsByScene(sceneRows.map((s) => s.id), shotRows),
    [sceneRows, shotRows],
  );
  const characterNames = useMemo(
    () => new Map((characters.data ?? []).map((c: { id: string; name: string }) => [c.id, c.name])),
    [characters.data],
  );
  const outdatedByShot = useMemo(
    () => new Map((continuity.data?.outdated ?? []).map((o: { shotId: string; reason: string }) => [o.shotId, o.reason])),
    [continuity.data],
  );
  /** 全片鏡號（跨場連續；與 ④ 成片、交付包同一套序號） */
  const shotNumber = useMemo(() => {
    const sorted = [...shotRows].sort((a, b) => a.orderIndex - b.orderIndex);
    return new Map(sorted.map((s, i) => [s.id, i + 1]));
  }, [shotRows]);
  const studioShot = studioSceneId ? shotRows.find((s) => s.id === studioSceneId) : null;

  const isEmpty = !shots.isLoading && shotRows.length === 0;

  /**
   * 分鏡多選：全站第一個。只有一個用途——把「這幾鏡」交給 AI 助手。
   * 不做批次編輯 UI（那是另一件事，也會需要另一套確認與復原）。
   */
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const togglePick = useCallback((shotId: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });
  }, []);
  // 鏡被刪掉時把它從選取裡剔除——否則助手會收到一個已經不存在的 id
  const liveShotIds = useMemo(() => new Set(shotRows.map((s) => s.id)), [shotRows]);
  useEffect(() => {
    setPicked((prev) => {
      const kept = [...prev].filter((id) => liveShotIds.has(id));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [liveShotIds]);

  /**
   * 回報給 AI 助手：正在看哪一鏡、勾了哪幾鏡。
   *
   * 「正在看」的定義刻意是**單格工作室打開的那一鏡**——在這個產品裡，打開工作室
   * 就是「我要處理這一鏡」的明確表態；純捲動經過不算，否則助手會一直改口。
   * 勾選優先於打開中的那一鏡（使用者明確圈出的對象最優先）。
   */
  const pickedIds = useMemo(() => [...picked], [picked]);
  const focusShot = studioShot ?? (pickedIds.length === 1 ? shotRows.find((s) => s.id === pickedIds[0]) : undefined);
  const focusShotNo = focusShot ? shotNumber.get(focusShot.id) : undefined;
  useEffect(
    () => registerAssistantFocus({
      pageType: "storyboard",
      entityType: "shot",
      entityId: focusShot?.id,
      entityLabel: focusShotNo ? `第 ${focusShotNo} 鏡` : undefined,
      selectedEntityIds: pickedIds,
      activeTab: mode,
    }),
    [focusShot?.id, focusShotNo, pickedIds, mode],
  );

  return (
    <div className="board-stage stack" id="storyboard-center" data-fb="分鏡中心">
      <Card as="section">
        <div className="board-stage__toolbar">
          <h2 style={{ margin: 0 }}>分鏡卡</h2>
          <Meta as="span">
            {sceneRows.length > 0 ? `${sceneRows.length} 場・` : ""}
            {shotRows.length} 鏡
          </Meta>
          <span style={{ flex: "1 1 auto" }} />
          <div role="tablist" aria-label="顯示深度" className="board-mode-toggle">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "simple"}
              className={mode === "simple" ? "active" : undefined}
              onClick={() => switchMode("simple")}
              title="畫面、角色、場景、動作、秒數"
            >
              簡單
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "pro"}
              className={mode === "pro" ? "active" : undefined}
              onClick={() => switchMode("pro")}
              title="加開焦段、角度、運鏡、光線、構圖、表情、視線"
            >
              專業
            </button>
          </div>
        </div>
        {isEmpty ? (
          <EmptyState
            icon={<Icon name="Clapperboard" size={20} />}
            title="還沒有分鏡"
            description="回到「① 故事」貼上故事、按「AI 解析」再「產生分鏡」——場、鏡、角色、地點會一次排好。也可以在下方「④ 成片」手動加鏡。"
            action={
              <Button variant="primary" onClick={() => scrollToSelector("#stage-story")}>
                去寫故事
              </Button>
            }
          />
        ) : (
          <>
            <Hint style={{ margin: "4px 0 10px" }}>
              點分鏡卡的畫面或「生成」進單格工作室——圖、影、配音、環境音、版本都在那裡，生成結果自動綁回這一鏡。
            </Hint>
            {/* §23：卡片改過但畫面還是舊的。放在最上面，不必捲完整頁才知道有落差 */}
            {outdatedByShot.size > 0 && (
              <Hint as="div" role="status" style={{ margin: "0 0 10px" }}>
                <Icon name="TriangleAlert" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                有 {outdatedByShot.size} 鏡的畫面是用舊設定畫的（角色、場景或道具卡後來改過）。
                系統不會自動重畫——需要更新的鏡，打開單格工作室重新生成即可。
              </Hint>
            )}
            <div className="board-groups stack">
              {groups.map((group, gi) => {
                const scene = group.storySceneId ? sceneRows.find((s) => s.id === group.storySceneId) : null;
                return (
                  <section key={group.storySceneId ?? "unsorted"} className="board-scene-group">
                    {scene ? (
                      <SceneGroupHeader
                        projectId={projectId}
                        scene={scene}
                        index={gi}
                        shotCount={group.shots.length}
                        canEdit={canEdit}
                        locations={(scenePresets.data ?? []).map((l: { id: string; name: string }) => ({ id: l.id, name: l.name }))}
                      />
                    ) : (
                      <header className="board-scene-head board-scene-head--unsorted">
                        <span className="board-scene-head__num">未分場</span>
                        <Meta as="span">{group.shots.length} 鏡・手動加入或重構前的分鏡</Meta>
                      </header>
                    )}
                    {group.shots.length === 0 ? (
                      <Meta as="p" style={{ margin: "6px 0 0 2px" }}>這一場還沒有鏡——可在單格工作室或 ④ 成片手動補</Meta>
                    ) : (
                      <div className="board-shots">
                        {group.shots.map((shot) => (
                          <ShotCard
                            key={shot.id}
                            projectId={projectId}
                            shot={shot}
                            shotNumber={shotNumber.get(shot.id) ?? 0}
                            canEdit={canEdit}
                            mode={mode}
                            looks={looks.data ?? []}
                            characterNames={characterNames}
                            outdatedReason={outdatedByShot.get(shot.id)}
                            onOpenStudio={setStudioSceneId}
                            picked={picked.has(shot.id)}
                            onTogglePick={togglePick}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </>
        )}
      </Card>
      {studioShot && (
        <SceneStudio
          sceneId={studioShot.id}
          projectId={projectId}
          sceneNumber={shotNumber.get(studioShot.id) ?? 1}
          canEdit={canEdit}
          charIds={charIds}
          sceneIds={sceneIds}
          propIds={propIds}
          onClose={() => setStudioSceneId(null)}
          onChanged={() => {
            utils.scenes.listByProject.invalidate({ projectId });
          }}
        />
      )}
    </div>
  );
}
