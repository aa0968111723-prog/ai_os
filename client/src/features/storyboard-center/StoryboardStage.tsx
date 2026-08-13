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
import { groupShotsByScene, loadBoardMode, saveBoardMode, type BoardMode } from "./boardPrefs";
import { SceneGroupHeader, type StorySceneRow } from "./SceneGroupHeader";
import { ShotCard, type ShotRow } from "./ShotCard";
import { ShotNavigator } from "./ShotNavigator";
import { ResourceDock } from "./ResourceDock";
import { VisualChoiceTray } from "./VisualChoiceTray";
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
  const shotNumber = useMemo(() => {
    const sorted = [...shotRows].sort((a, b) => a.orderIndex - b.orderIndex);
    return new Map(sorted.map((s, i) => [s.id, i + 1]));
  }, [shotRows]);
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
          </div>
          {isEmpty ? (
            <EmptyState
              icon={<Icon name="Clapperboard" size={20} />}
              title="還沒有分鏡"
              description="回到「① 故事」貼上故事、按「AI 解析」再「產生分鏡」。"
              action={<Button variant="primary" onClick={() => scrollToSelector("#stage-story")}>去寫故事</Button>}
            />
          ) : (
            <>
              <Hint style={{ margin: "4px 0 10px" }}>
                點畫面或「單格工作室」細修；右側「資源」可就近取用素材／定裝。勾選分鏡後可用「視覺選擇」一次套用動作／表情／鏡頭／光線。
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
                            <ShotCard key={shot.id} projectId={projectId} shot={shot} shotNumber={shotNumber.get(shot.id) ?? 0} canEdit={canEdit} mode={mode} looks={looks.data ?? []} characterNames={characterNames} outdatedReason={outdatedByShot.get(shot.id)} onOpenStudio={setStudioSceneId} picked={picked.has(shot.id)} onTogglePick={togglePick} />
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
        <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: "0 0 auto" }}>
          <ResourceDock projectId={projectId} canEdit={canEdit} pickedShotIds={pickedIds} characterNames={characterNames} />
          <VisualChoiceTray projectId={projectId} canEdit={canEdit} pickedShotIds={pickedIds} />
        </div>
      </div>
      {studioShot && (
        <SceneStudio
          sceneId={studioShot.id}
          projectId={projectId}
          sceneNumber={shotNumber.get(studioShot.id) ?? 1}
          canEdit={canEdit}
          charIds={charIds}
          sceneIds={sceneIds}
          propIds={propIds}
          nav={<ShotNavigator shots={shotRows} currentId={studioShot.id} onGo={(nextId) => setStudioSceneId(nextId)} />}
          onClose={() => setStudioSceneId(null)}
          onChanged={() => { utils.scenes.listByProject.invalidate({ projectId }); }}
        />
      )}
    </div>
  );
}
