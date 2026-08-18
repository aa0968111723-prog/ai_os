/**
 * ② 分鏡（Storyboard Center；PE 計畫 §10）
 * PR-4a：右側 ResourceDock 就近取用素材／定裝／知識。
 * PR #710：勾選分鏡後顯示 VisualChoiceTray（動作／表情／鏡頭／光線／風格視覺選擇）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { SceneStudio } from "../../components/SceneStudio";
import { Button, Card, EmptyState, Hint, Meta } from "../../components/ui";
import { scrollToSelector } from "../creation-workbench/workbenchNav";
import { revealProjectContext } from "../project-nav/projectContextNav";
import {
  EMPTY_SHOT_SUGGESTION_ITEMS,
  expandShotSuggestions,
  type ShotAssetSuggestionItem,
} from "@shared/shotAssetSuggestions";
import { groupShotsByScene, loadBoardMode, saveBoardMode, type BoardMode } from "./boardPrefs";
import { SceneGroupHeader, type StorySceneRow } from "./SceneGroupHeader";
import { ShotCard, type ShotRow } from "./ShotCard";
import { ShotNavigator } from "./ShotNavigator";
import { VisualChoiceTray } from "./VisualChoiceTray";
import { registerAssistantFocus } from "../../lib/assistantContext";

export function StoryboardStage({
  projectId,
  canEdit,
  charIds,
  sceneIds,
  propIds,
  hideInspector = false,
  onSendToWorkbench,
}: {
  projectId: string;
  canEdit: boolean;
  charIds: string[];
  sceneIds: string[];
  propIds: string[];
  /** Mobile story sheet already occupies the one visible layer; desktop Inspector stays. */
  hideInspector?: boolean;
  /** Selected-shot adapter: reuse the existing CreationWorkbench, do not clone it. */
  onSendToWorkbench?: (shot: ShotRow) => void;
}) {
  const utils = trpc.useUtils();
  const storyScenes = trpc.story.scenesList.useQuery({ projectId });
  const shots = trpc.scenes.listByProject.useQuery({ projectId });
  const addShot = trpc.scenes.addDraft.useMutation({
    onSuccess: () => {
      void utils.scenes.listByProject.invalidate({ projectId });
      void utils.story.get.invalidate({ projectId });
      void utils.story.scenesList.invalidate({ projectId });
    },
  });
  const characters = trpc.characters.list.useQuery({ projectId });
  const scenePresets = trpc.scenePresets.list.useQuery({ projectId });
  const looks = trpc.characterLooks.list.useQuery({ projectId });
  const continuity = trpc.story.continuityCheck.useQuery({ projectId });
  const [mode, setMode] = useState<BoardMode>(() => loadBoardMode(projectId));
  const [studioSceneId, setStudioSceneId] = useState<string | null>(null);
  const suggestionBatch = trpc.story.shotAssetSuggestionsBatch.useQuery(
    { projectId },
    { enabled: mode === "pro", staleTime: 60_000 },
  );
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
  const shotNumber = useMemo(() => {
    const sorted = [...shotRows].sort((a, b) => a.orderIndex - b.orderIndex);
    return new Map(sorted.map((s, i) => [s.id, i + 1]));
  }, [shotRows]);
  const hintsByShot = useMemo(() => {
    const map = new Map<string, ShotAssetSuggestionItem[]>();
    const payload = suggestionBatch.data;
    if (!payload) return map;
    for (const shotId of Object.keys(payload.byShotId)) {
      map.set(shotId, expandShotSuggestions(payload, shotId));
    }
    return map;
  }, [suggestionBatch.data]);
  const studioShot = studioSceneId ? shotRows.find((s) => s.id === studioSceneId) : null;
  const isEmpty = !shots.isLoading && shotRows.length === 0;

  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const togglePick = useCallback((shotId: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });
  }, []);
  const liveShotIds = useMemo(() => new Set(shotRows.map((s) => s.id)), [shotRows]);
  useEffect(() => {
    setPicked((prev) => {
      const kept = [...prev].filter((id) => liveShotIds.has(id));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [liveShotIds]);

  const pickedIds = useMemo(() => [...picked], [picked]);
  const focusShot = studioShot ?? (pickedIds.length === 1 ? shotRows.find((s) => s.id === pickedIds[0]) : undefined);
  const focusShotNo = focusShot ? shotNumber.get(focusShot.id) : undefined;
  const hasShotFocus = !!focusShot || pickedIds.length > 0;
  useEffect(() => {
    if (!hasShotFocus) return;
    return registerAssistantFocus({
      pageType: "storyboard",
      entityType: "shot",
      entityId: focusShot?.id,
      entityLabel: focusShotNo ? `第 ${focusShotNo} 鏡` : undefined,
      selectedEntityIds: pickedIds,
      activeTab: mode,
    });
  }, [hasShotFocus, focusShot?.id, focusShotNo, pickedIds, mode]);

  return (
    <div className="board-stage stack" id="storyboard-center" data-fb="分鏡中心">
      <div className="board-stage__layout" style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <Card as="section" className="board-stage__main" style={{ flex: "1 1 280px", minWidth: 0 }}>
          <div className="board-stage__toolbar">
            <h2 style={{ margin: 0 }}>分鏡卡</h2>
            <Meta as="span">{sceneRows.length > 0 ? `${sceneRows.length} 場・` : ""}{shotRows.length} 鏡</Meta>
            <span style={{ flex: "1 1 auto" }} />
            <div className="board-stage__quick-links" role="navigation" aria-label="素材與定裝快速入口">
              <Button size="sm" variant="ghost" type="button" title="打開專案素材庫" onClick={() => revealProjectContext("assets", { projectId, returnTo: "scenes" })}>
                <Icon name="LayoutGrid" size={13} /> 素材庫
              </Button>
              <Button size="sm" variant="ghost" type="button" title="打開角色／造型定裝" onClick={() => revealProjectContext("characters", { projectId, returnTo: "scenes" })}>
                <Icon name="User" size={13} /> 定裝
              </Button>
              <Button size="sm" variant="ghost" type="button" title="打開知識庫" onClick={() => revealProjectContext("knowledge", { projectId, returnTo: "scenes" })}>
                <Icon name="FileText" size={13} /> 知識庫
              </Button>
            </div>
            <div role="tablist" aria-label="顯示深度" className="board-mode-toggle">
              <button type="button" role="tab" aria-selected={mode === "simple"} className={mode === "simple" ? "active" : undefined} onClick={() => switchMode("simple")}>簡單</button>
              <button type="button" role="tab" aria-selected={mode === "pro"} className={mode === "pro" ? "active" : undefined} onClick={() => switchMode("pro")}>專業</button>
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant="primary"
                type="button"
                disabled={addShot.isPending}
                title="解析逾時時不必卡住：先開一格空白鏡，或回故事按產生分鏡"
                onClick={() => addShot.mutate({ projectId, title: `第 ${shotRows.length + 1} 鏡` })}
              >
                <Icon name="Plus" size={13} /> {addShot.isPending ? "建立中…" : "新增鏡"}
              </Button>
            )}
            {canEdit && onSendToWorkbench && focusShot && (
              <Button
                size="sm"
                variant="tonal"
                type="button"
                onClick={() => onSendToWorkbench(focusShot)}
              >
                用此鏡去製作
              </Button>
            )}
          </div>
          {isEmpty ? (
            <EmptyState
              icon={<Icon name="Clapperboard" size={20} />}
              title="還沒有分鏡"
              description="回到故事按「產生分鏡」（解析未完成也能依原文拆鏡），或用右上「＋新增鏡」先開一格。"
              action={(
                <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                  <Button variant="primary" onClick={() => scrollToSelector("#stage-story")}>去寫故事／產生分鏡</Button>
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      disabled={addShot.isPending}
                      onClick={() => addShot.mutate({ projectId, title: "第 1 鏡" })}
                    >
                      新增鏡
                    </Button>
                  ) : null}
                </span>
              )}
            />
          ) : (
            <>
              <Hint style={{ margin: "4px 0 10px" }}>
                勾選一鏡先看目前創作狀態，再直接改角色、動作、光線或鏡頭；素材庫與定裝仍可由上方入口完整管理。
              </Hint>
              {outdatedByShot.size > 0 && (
                <Hint as="div" role="status" style={{ margin: "0 0 10px" }}>
                  <Icon name="TriangleAlert" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                  有 {outdatedByShot.size} 鏡的畫面是用舊設定畫的。需要更新請打開單格工作室重新生成。
                </Hint>
              )}
              <div className="board-groups stack">
                {groups.map((group, gi) => {
                  const scene = group.storySceneId ? sceneRows.find((s) => s.id === group.storySceneId) : null;
                  return (
                    <section key={group.storySceneId ?? "unsorted"} className="board-scene-group">
                      {scene ? (
                        <SceneGroupHeader projectId={projectId} scene={scene} index={gi} shotCount={group.shots.length} canEdit={canEdit} locations={(scenePresets.data ?? []).map((l: { id: string; name: string }) => ({ id: l.id, name: l.name }))} />
                      ) : (
                        <header className="board-scene-head board-scene-head--unsorted">
                          <span className="board-scene-head__num">未分場</span>
                          <Meta as="span">{group.shots.length} 鏡・手動加入或重構前的分鏡</Meta>
                        </header>
                      )}
                      {group.shots.length === 0 ? (
                        <Meta as="p" style={{ margin: "6px 0 0 2px" }}>這一場還沒有鏡</Meta>
                      ) : (
                        <div className="board-shots">
                          {group.shots.map((shot) => (
                            <ShotCard key={shot.id} projectId={projectId} shot={shot} shotNumber={shotNumber.get(shot.id) ?? 0} canEdit={canEdit} mode={mode} looks={looks.data ?? []} characterNames={characterNames} outdatedReason={outdatedByShot.get(shot.id)} onOpenStudio={setStudioSceneId} picked={picked.has(shot.id)} onTogglePick={togglePick} assetHints={mode === "pro" ? (hintsByShot.get(shot.id) ?? EMPTY_SHOT_SUGGESTION_ITEMS) : EMPTY_SHOT_SUGGESTION_ITEMS} />
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
        {!hideInspector && (
          <VisualChoiceTray projectId={projectId} canEdit={canEdit} pickedShotIds={pickedIds} onOpenStudio={setStudioSceneId} />
        )}
      </div>
      {studioShot && (
        <SceneStudio
          /*
           * key 綁 shot id：沒有它，用 ShotNavigator 換到下一鏡時 React 會**原地重用**
           * 同一個 SceneStudio 實例，於是這一鏡的變體冪等鍵、草稿、批次狀態全部跟著
           * 跑到下一鏡——按下「產生方向」會撞回上一鏡的那批生成（同一把鍵），
           * 使用者以為在替第 4 鏡出圖，實際拿回第 3 鏡的結果。
           * SceneList 那支早就有這個 key，分鏡中心這支漏了。
           */
          key={studioShot.id}
          sceneId={studioShot.id}
          projectId={projectId}
          sceneNumber={shotNumber.get(studioShot.id) ?? 1}
          canEdit={canEdit}
          charIds={charIds}
          sceneIds={sceneIds}
          propIds={propIds}
          nav={<ShotNavigator shots={shotRows} currentId={studioShot.id} onGo={(nextId) => setStudioSceneId(nextId)} />}
          onClose={() => setStudioSceneId(null)}
          onChanged={() => {
            void utils.scenes.listByProject.invalidate({ projectId });
            void utils.story.shotAssetSuggestionsBatch.invalidate({ projectId });
          }}
        />
      )}
    </div>
  );
}
