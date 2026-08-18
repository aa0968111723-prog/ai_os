import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "../../api";
import { registerAssistantFocus, registerAssistantPage } from "../../lib/assistantContext";
import { Icon } from "../../components/Icon";
import { Button, Meta } from "../../components/ui";
import { BrushShelf } from "./BrushShelf";
import { ShotStrip, type StudioShot } from "./ShotStrip";
import { StudioAiPanel } from "./StudioAiPanel";
import { StudioHeader } from "./StudioHeader";
import { StudioStage } from "./StudioStage";
import { StoryboardTimeline } from "./StoryboardTimeline";
import { ShotInspector, type InspectorShot, type InspectorTab } from "./ShotInspector";
import { ToolRail } from "./ToolRail";
import { WhiteboardCanvas, type BoardView } from "./WhiteboardCanvas";
import { collectBrush, updateSavedBrush, workingCopy } from "./brushCollection";
import { BRUSH_LIMITS, DEFAULT_BRUSH_ID, findBrush, type BrushSpec } from "./brushes";
import { boardSizeForFormat, isBoardEmpty } from "./boardDoc";
import { boardFileName, exportBoardPng } from "./boardExport";
import { allBrushes, readSavedBrushes, readStudioPrefs, writeSavedBrushes, writeStudioPrefs } from "./studioStorage";
import { summarizeBoard } from "./boardSummary";
import { clampZoom, fitBoardToBox } from "./studioLayout";
import { resolveShortcut, SHORTCUT_HINTS } from "./studioShortcuts";
import {
  DEFAULT_GUIDES,
  DEFAULT_PANELS,
  brushIdFor,
  optionsKindFor,
  panModeFor,
  toggleGuide,
  toolForBrushId,
  type GuideKey,
  type StudioTool,
} from "./studioTools";
import type { NewShotKind } from "./NewShotMenu";
import type { SketchPreview } from "./sketchReplay";
import { createInsertAfterQueue } from "../../lib/insertAfterQueue";
import { shouldApplySceneWriteAck } from "@shared/sceneWriteAck";
import { useBoardSession } from "./useBoardSession";
import { useImmersive } from "./useImmersive";
import { useStudioLayout } from "./useStudioLayout";
import "./studio.css";
import "./studio.workspace.css";

export interface AnimationStudioProps {
  projectId: string;
  projectTitle: string;
  /** 專案比例：白板比例要跟它一致，手稿綁回分鏡才不會被裁 */
  projectFormat: string | null | undefined;
  canEdit: boolean;
}

/** 手機輕量版一次只開一個面板——同時開兩個等於沒有白板可畫 */
type LiteSheet = "none" | "shots" | "ai" | "brushes";

/**
 * 進入創作室時掛在 <body>：全站導航（今日／私訊／資料中心／靈感頻道…）讓開。
 *
 * 與 `studio-immersive`（全螢幕按鈕）平行而不是同一個：**沉浸是版面，全螢幕是視窗**。
 * 進站即工作台模式——創作時畫面上該有的是這支片，不是「換一件事做」的入口；
 * 回全站的路留在 Top Bar 最左的麵包屑，不是藏起來。
 * 只有桌機掛：手機拿掉底部分頁列會讓人出不去（那是它唯一的返回路徑）。
 */
export const WORKSPACE_BODY_CLASS = "studio-workspace";

/**
 * Aios Storyboard Studio：左手畫、右手把它變成分鏡。
 *
 * 桌機是四區工作台（Figma／Resolve 那一類的專業版面）：
 *   **ToolRail**（左，窄）｜**Stage**（中，畫布優先）｜**Shot Inspector**（右）｜**Storyboard Timeline**（底）
 * 手機維持既有的輕量版（白板＋筆刷 dock＋貼底 sheet）——四區工作台在 390px 上不成立，
 * 硬塞只會讓白板小到不能畫。版面由 `studioLayout` 決定後掛成 `data-mode`，CSS 只吃屬性。
 *
 * 白板草稿存在本機（每一鏡一份，見 studioStorage），只有按下「存成這一鏡的畫面」
 * 才會上傳成專案素材。這條界線是刻意的：塗鴉階段不該打擾團隊的素材庫，
 * 也不該讓每一筆都等網路。
 */
export function AnimationStudio({ projectId, projectTitle, projectFormat, canEdit }: AnimationStudioProps) {
  const layout = useStudioLayout();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const scenes = trpc.scenes.listByProject.useQuery(
    { projectId },
    { refetchOnMount: "always" },
  );
  const shots: StudioShot[] = useMemo(() => scenes.data ?? [], [scenes.data]);
  const shotsLoading = scenes.isLoading && !scenes.data;
  // 場（story_scenes）：Top Bar 的麵包屑要顯示「這一鏡屬於哪一場」
  const storyScenes = trpc.story.scenesList.useQuery({ projectId });

  const boardSize = useMemo(() => boardSizeForFormat(projectFormat), [projectFormat]);
  // 白板本體、切鏡與存檔都在 useBoardSession（會弄丟畫作的邏輯集中在那裡，並有測試盯著）
  const { board, activeShotId, draftIds, storageFull, switchTo, pushStroke, undo, redo, clear, markSaved } =
    useBoardSession(projectId, boardSize, layout);
  const activeShotIdRef = useRef(activeShotId);
  activeShotIdRef.current = activeShotId;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const shot = shots.find((s) => s.id === activeShotId) ?? null;
  const shotIndex = shot ? shots.findIndex((s) => s.id === shot.id) : -1;

  /* 助手頁面感知：創作室＝專案 scope，白板上正在畫的那一鏡就是「這一鏡」。
     鏡號與分鏡中心同一套算法（orderIndex 排序後 index+1），兩邊講的「第 3 鏡」是同一鏡。 */
  const studioShotNo = useMemo(() => {
    if (!activeShotId) return undefined;
    const sorted = [...shots].sort((a, b) => a.orderIndex - b.orderIndex);
    const i = sorted.findIndex((s) => s.id === activeShotId);
    return i >= 0 ? i + 1 : undefined;
  }, [shots, activeShotId]);
  useEffect(
    () => registerAssistantPage({ pageType: "studio", projectId, projectTitle }),
    [projectId, projectTitle],
  );
  useEffect(
    () => registerAssistantFocus({
      pageType: "studio",
      entityType: "shot",
      entityId: activeShotId ?? undefined,
      entityLabel: studioShotNo ? `第 ${studioShotNo} 鏡` : undefined,
    }),
    [activeShotId, studioShotNo],
  );

  // ── 筆刷櫃 ───────────────────────────────────────────────
  const [saved, setSaved] = useState<BrushSpec[]>(() => readSavedBrushes());
  const brushes = useMemo(() => allBrushes(saved), [saved]);
  const [activeBrushId, setActiveBrushId] = useState<string>(DEFAULT_BRUSH_ID);
  const [brush, setBrush] = useState<BrushSpec>(() => workingCopy(findBrush(allBrushes(readSavedBrushes()), DEFAULT_BRUSH_ID)));
  const [brushNotice, setBrushNotice] = useState("");
  /** 上一支「畫圖用」的筆：從橡皮擦切回畫筆要回到它，而不是固定的預設筆 */
  const lastDrawBrushRef = useRef<string>(DEFAULT_BRUSH_ID);

  const selectBrush = (id: string) => {
    setActiveBrushId(id);
    setBrush(workingCopy(findBrush(brushes, id)));
    setBrushNotice("");
    if (id !== "builtin.eraser") lastDrawBrushRef.current = id;
  };

  /** 穩定器與筆壓曲線：跨筆刷的工作習慣（這台裝置＋這雙手），存進裝置偏好 */
  const [prefs, setPrefs] = useState(readStudioPrefs);
  const updatePrefs = (patch: Partial<typeof prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      writeStudioPrefs(next);
      return next;
    });
  };

  const changeBrush = (next: BrushSpec) => {
    setBrush(next);
    // 自己收錄的筆刷：調了就記住（內建的只影響這次落筆，見 brushCollection）
    const base = brushes.find((b) => b.id === next.id);
    if (base && !base.builtin) {
      const nextSaved = updateSavedBrush(saved, next);
      setSaved(nextSaved);
      writeSavedBrushes(nextSaved);
    }
  };

  const collect = (name: string) => {
    const result = collectBrush(saved, brush, name);
    setBrushNotice(result.error ?? "");
    if (!result.id) return;
    setSaved(result.saved);
    writeSavedBrushes(result.saved);
    setActiveBrushId(result.id);
    setBrush(workingCopy(findBrush(result.saved, result.id)));
  };

  const removeBrush = (id: string) => {
    const next = saved.filter((b) => b.id !== id);
    setSaved(next);
    writeSavedBrushes(next);
    if (activeBrushId === id) selectBrush(DEFAULT_BRUSH_ID);
  };

  // ── 工具（桌機的左欄；lite 沿用舊的「筆刷＋平移鈕」）────────
  const [tool, setTool] = useState<StudioTool>("draw");
  const [showReference, setShowReference] = useState(true);
  const [guides, setGuides] = useState(DEFAULT_GUIDES);
  const [panels, setPanels] = useState(DEFAULT_PANELS);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("frame");
  /** Top Bar 的「⋯」選單（匯出、分享、清空） */
  const [moreOpen, setMoreOpen] = useState(false);

  const pickTool = (next: StudioTool) => {
    setTool(next);
    const brushId = brushIdFor(next, lastDrawBrushRef.current);
    if (brushId) selectBrush(brushId);
    if (next === "ai") setInspectorTab("ai");
    if (next === "reference") setShowReference(true);
  };

  // ── 白板檢視（縮放、平移、描圖底稿）──────────────────────
  const [view, setView] = useState<BoardView>({ scale: 1, offsetX: 0, offsetY: 0 });
  /** AI 正在畫的那一筆（逐點預覽）：由 AI 動作的重播驅動，畫在白板 live 層 */
  const [aiPreview, setAiPreview] = useState<SketchPreview | null>(null);
  const [panMode, setPanMode] = useState(false);
  const boardRef = useRef(board);
  boardRef.current = board;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const boardBox = () => hostRef.current?.querySelector(".studio-board") as HTMLElement | null;

  const zoomBy = (factor: number) => {
    // 以可視區中心為錨：用原點當錨的話，按幾下放大就會把畫面推到白板的左上角外
    const el = boardBox();
    const cx = (el?.clientWidth ?? 0) / 2;
    const cy = (el?.clientHeight ?? 0) / 2;
    setView((v) => {
      const scale = clampZoom(v.scale * factor);
      const ratio = scale / v.scale;
      return { scale, offsetX: cx - (cx - v.offsetX) * ratio, offsetY: cy - (cy - v.offsetY) * ratio };
    });
  };

  const fitToScreen = () => {
    const el = boardBox();
    if (!el) return;
    const fit = fitBoardToBox({ w: board.doc.w, h: board.doc.h }, { w: el.clientWidth - 32, h: el.clientHeight - 32 });
    setView({ scale: fit.scale, offsetX: fit.offsetX + 16, offsetY: fit.offsetY + 16 });
  };

  /** 回到 100%：以可視區中心為錨（與 zoomBy 同一套數學，換算不會跳） */
  const actualSize = () => {
    const el = boardBox();
    const cx = (el?.clientWidth ?? 0) / 2;
    const cy = (el?.clientHeight ?? 0) / 2;
    setView((v) => {
      const ratio = 1 / v.scale;
      return { scale: 1, offsetX: cx - (cx - v.offsetX) * ratio, offsetY: cy - (cy - v.offsetY) * ratio };
    });
  };

  /** 快捷鍵要呼叫的東西每次 render 都是新函式；用 ref 轉一手，
   *  keydown 監聽器才不必每次重掛（重掛本身沒錯，但按鍵在重掛的空檔會漏接）。 */
  const zoomByRef = useRef(zoomBy);
  zoomByRef.current = zoomBy;
  const fitToScreenRef = useRef(fitToScreen);
  fitToScreenRef.current = fitToScreen;
  const selectBrushRef = useRef(selectBrush);
  selectBrushRef.current = selectBrush;
  const pickToolRef = useRef(pickTool);
  pickToolRef.current = pickTool;

  // ── 分鏡表操作 ────────────────────────────────────────────
  const invalidateScenes = () => { void utils.scenes.listByProject.invalidate({ projectId: projectIdRef.current }); };
  const addShot = trpc.scenes.addDraft.useMutation({
    onSuccess: (created) => {
      const ack = shouldApplySceneWriteAck({
        mountedProjectId: projectIdRef.current,
        writeProjectId: created?.projectId,
        followSelection: true,
        mountedShotId: activeShotIdRef.current,
        originShotId: activeShotIdRef.current,
      });
      if (ack.applyInvalidate) invalidateScenes();
      if (ack.followCreated && created?.id) switchTo(created.id);
    },
  });
  const move = trpc.scenes.move.useMutation({
    onSuccess: (result) => {
      const ack = shouldApplySceneWriteAck({
        mountedProjectId: projectIdRef.current,
        writeProjectId: result.projectId,
      });
      if (ack.applyInvalidate) invalidateScenes();
    },
  });
  const reorder = trpc.scenes.reorder.useMutation({
    onSuccess: (_result, variables) => {
      const ack = shouldApplySceneWriteAck({
        mountedProjectId: projectIdRef.current,
        writeProjectId: variables.projectId,
      });
      if (ack.applyInvalidate) invalidateScenes();
    },
  });
  const removeShot = trpc.scenes.remove.useMutation({ onSuccess: invalidateScenes });
  const insertAfter = trpc.scenes.insertAfter.useMutation({
    onSuccess: (created, variables) => {
      const ack = shouldApplySceneWriteAck({
        mountedProjectId: projectIdRef.current,
        writeProjectId: created?.projectId,
        mountedShotId: activeShotIdRef.current,
        originShotId: variables.sceneId,
        followSelection: true,
      });
      // Same-project list refresh is fine; follow the new row only if still on origin.
      if (ack.applyInvalidate) invalidateScenes();
      if (ack.followCreated && created?.id) switchTo(created.id);
    },
  });
  const insertAfterMutateRef = useRef(insertAfter.mutateAsync);
  insertAfterMutateRef.current = insertAfter.mutateAsync;
  const insertQueueRef = useRef<ReturnType<typeof createInsertAfterQueue> | undefined>(undefined);
  if (!insertQueueRef.current) {
    insertQueueRef.current = createInsertAfterQueue((input) => insertAfterMutateRef.current(input));
  }
  const updateShot = trpc.scenes.update.useMutation({ onSuccess: invalidateScenes });

  /**
   * 「＋ 新增鏡」的四條路（見 NewShotMenu）。每一條都對到既有的後端動作，
   * 不新開 API：blank／continue 走 addDraft／insertAfter，AI 兩條走 director。
   */
  const createShot = (kind: NewShotKind) => {
    if (kind === "blank") {
      addShot.mutate({ projectId, title: `第 ${shots.length + 1} 鏡` });
      return;
    }
    if (kind === "continue") {
      // 延續＝在這一鏡後面插一格（insertAfter 會帶走卡片綁定與鏡頭語言）；沒選鏡就退回開空白。
      // 連點同一鏡要串新 id，否則同一 sceneId 連打是 LIFO（與 SceneList 同一條）。
      if (shot) {
        // Per-origin tails: switching the selected shot must not reset A's
        // chain. Resetting here used to make remaining A clicks LIFO again.
        insertQueueRef.current?.enqueue(shot.id);
      } else {
        addShot.mutate({ projectId, title: `第 ${shots.length + 1} 鏡` });
      }
      return;
    }
    // AI 兩條：切到 Inspector 的 AI 分頁，動作本身在那裡（帶著這一鏡的上下文）
    setInspectorTab("ai");
    setTool("ai");
    setPanels((p) => ({ ...p, inspector: false }));
  };

  // ── 收成 sheet 的面板（手機全部、窄桌機只有 AI 欄）────────────
  const [sheet, setSheet] = useState<LiteSheet>("none");
  const lite = layout.mode === "lite";
  const shotsAsSheet = layout.shotStrip === "sheet";
  const aiAsSheet = layout.aiPanel === "sheet";
  const panelsAsSheet = lite && (shotsAsSheet || aiAsSheet);
  // 版面切換（轉向、拉視窗、進出全螢幕）時把開著的 sheet 收掉，
  // 否則常駐欄與 sheet 會同時出現同一塊內容
  useEffect(() => {
    setSheet((cur) => (cur === "shots" && !shotsAsSheet) || (cur === "ai" && !aiAsSheet) ? "none" : cur);
  }, [shotsAsSheet, aiAsSheet]);

  // ── 全螢幕專注模式 ────────────────────────────────────────
  const { immersive, exit: exitImmersive, toggle: toggleImmersive } = useImmersive(hostRef);

  /**
   * 工作台模式：桌機進站就讓全站導航收起（見 WORKSPACE_BODY_CLASS）。
   * 手機不掛——底部分頁列是它唯一的返回路徑，拿掉會讓人出不去。
   */
  useEffect(() => {
    if (lite) return;
    document.body.classList.add(WORKSPACE_BODY_CLASS);
    return () => document.body.classList.remove(WORKSPACE_BODY_CLASS);
  }, [lite]);

  const exportBoard = useCallback(() => exportBoardPng(boardRef.current.doc, layout.exportMaxEdge), [layout.exportMaxEdge]);

  /**
   * 鍵盤快捷鍵：手不離開畫布就能換筆、調粗細、復原、全螢幕。
   * 對照表在 studioShortcuts（純函式、可測），這裡只負責接線——
   * 尤其是「焦點在輸入框時一律讓路」那一條，壞掉會讓人在提示詞裡打個 e 就換成橡皮擦。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveShortcut(event);
      if (!action) return;
      if (action === "exitImmersive" && !immersive) return;
      event.preventDefault();
      switch (action) {
        case "undo": undo(); break;
        case "redo": redo(); break;
        case "toggleImmersive": toggleImmersive(); break;
        case "exitImmersive": exitImmersive(); break;
        case "brushBigger": setBrush((b) => ({ ...b, size: Math.min(BRUSH_LIMITS.size.max, b.size + 1) })); break;
        case "brushSmaller": setBrush((b) => ({ ...b, size: Math.max(BRUSH_LIMITS.size.min, b.size - 1) })); break;
        case "eraser": pickToolRef.current("eraser"); break;
        case "brush": pickToolRef.current("draw"); break;
        case "pan": setPanMode((v) => !v); break;
        case "fit": fitToScreenRef.current(); break;
        case "zoomIn": zoomByRef.current(1.2); break;
        case "zoomOut": zoomByRef.current(1 / 1.2); break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, toggleImmersive, exitImmersive, immersive]);

  /** 快捷鍵直接換筆（B／E）時，左欄的工具高亮要跟著走 */
  useEffect(() => {
    setTool((cur) => (cur === "draw" || cur === "eraser" ? toolForBrushId(activeBrushId) : cur));
  }, [activeBrushId]);

  // ── 把白板存成這一鏡的畫面（原本在 StudioAiPanel，抽上來讓兩種版面共用）──
  const [saveState, setSaveState] = useState<"idle" | "uploading" | "done">("idle");
  const [saveError, setSaveError] = useState("");
  useEffect(() => { setSaveState("idle"); setSaveError(""); }, [shot?.id]);
  const setVisual = trpc.scenes.setVisualFromAsset.useMutation({ onSuccess: invalidateScenes });
  const boardEmpty = isBoardEmpty(board.doc);

  const saveBoardToShot = useCallback(async () => {
    if (!shot || isBoardEmpty(boardRef.current.doc)) return;
    setSaveState("uploading");
    setSaveError("");
    try {
      const exported = await exportBoard();
      if (!exported) throw new Error("白板匯出失敗");
      const form = new FormData();
      form.append("projectId", projectId);
      form.append("file", new File([exported.blob], boardFileName(shot.title), { type: "image/png" }));
      const res = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
      const data = (await res.json()) as { ok?: boolean; error?: string; asset?: { id: string } };
      if (!res.ok || !data.ok || !data.asset) throw new Error(data.error ?? `上傳失敗（${res.status}）`);
      await setVisual.mutateAsync({ sceneId: shot.id, assetId: data.asset.id });
      void utils.projects.assets.invalidate({ projectId });
      setSaveState("done");
      markSaved(shot.id);
    } catch (err) {
      setSaveState("idle");
      setSaveError(err instanceof Error ? err.message : "存成畫面失敗——請檢查網路後重試");
    }
  }, [exportBoard, markSaved, projectId, setVisual, shot, utils]);

  const referenceUrl = showReference && shot?.assetUrl && shot.assetKind !== "audio" ? shot.assetUrl : null;

  const sketchBridge = {
    pushStroke,
    preview: setAiPreview,
    summarize: () => summarizeBoard(boardRef.current.doc),
    boardW: boardSize.w,
    boardH: boardSize.h,
    maxStrokes: layout.maxStrokes,
    strokeCount: board.doc.strokes.length,
  };

  const shotStrip = (
    <ShotStrip
      layout={layout}
      shots={shots}
      loading={shotsLoading}
      activeId={activeShotId}
      draftIds={draftIds}
      canEdit={canEdit}
      busy={move.isPending || reorder.isPending || addShot.isPending}
      onSelect={(id) => { switchTo(id); setSheet("none"); }}
      onAdd={() => addShot.mutate({ projectId, title: `第 ${shots.length + 1} 鏡` })}
      onMove={(id, direction) => move.mutate({ sceneId: id, direction })}
      onReorder={(orderedIds) => reorder.mutate({ projectId, orderedIds })}
    />
  );

  const aiPanel = (
    <StudioAiPanel
      layout={layout}
      projectId={projectId}
      shot={shot}
      canEdit={canEdit}
      boardEmpty={boardEmpty}
      exportBoard={exportBoard}
      onBoardSaved={markSaved}
      sketch={sketchBridge}
    />
  );

  const brushShelf = (
    <BrushShelf
      layout={layout}
      brushes={brushes}
      activeId={activeBrushId}
      brush={brush}
      onSelect={selectBrush}
      onBrushChange={changeBrush}
      onCollect={collect}
      onRemove={removeBrush}
      notice={brushNotice}
      stabilizer={prefs.stabilizer}
      onStabilizerChange={(value) => updatePrefs({ stabilizer: value })}
      pressureCurve={prefs.pressureCurve}
      onPressureCurveChange={(curve) => updatePrefs({ pressureCurve: curve })}
    />
  );

  const canvasProps = {
    doc: board.doc,
    brush,
    layout,
    panMode: panMode || (!lite && panModeFor(tool)),
    view,
    onViewChange: setView,
    onStrokeEnd: pushStroke,
    referenceUrl,
    readOnly: !canEdit,
    aiPreview,
    stabilizer: prefs.stabilizer,
    pressureCurve: prefs.pressureCurve,
  };

  /* ══ 桌機：四區工作台 ═══════════════════════════════════ */
  if (!lite) {
    const inspectorShot = (shot as InspectorShot | null) ?? null;
    const scene = inspectorShot?.storySceneId
      ? storyScenes.data?.find((s: { id: string }) => s.id === inspectorShot.storySceneId)
      : null;
    const optionsKind = optionsKindFor(tool);

    return (
      <div
        className={`studio is-workspace${immersive ? " is-immersive" : ""}`}
        data-mode={layout.mode}
        data-ai={layout.aiPanel}
        data-tool={tool}
        ref={hostRef}
      >
        <StudioHeader
          projectId={projectId}
          projectTitle={projectTitle}
          sceneName={scene?.title || null}
          shotNumber={shotIndex >= 0 ? shotIndex + 1 : null}
          shotTitle={shot?.title ?? null}
          canUndo={board.doc.strokes.length > 0}
          canRedo={board.redo.length > 0}
          onUndo={undo}
          onRedo={redo}
          saveLabel={
            storageFull ? "本機空間已滿" : boardEmpty ? "" : draftIds.has(activeShotId ?? "") || activeShotId === null ? "手稿已存本機 ✓" : "已自動儲存 ✓"
          }
          immersive={immersive}
          onToggleImmersive={toggleImmersive}
          onPreview={() => navigate(`/p/${projectId}#stage-deliver`)}
          onMore={() => setMoreOpen((v) => !v)}
          moreOpen={moreOpen}
        />

        {moreOpen && (
          <>
            <button type="button" className="studio-menu__scrim" aria-label="關閉選單" onClick={() => setMoreOpen(false)} />
            <div className="studio-menu studio-menu--more" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); void exportBoard().then((r) => {
                if (!r) return;
                const url = URL.createObjectURL(r.blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = boardFileName(shot?.title ?? "白板");
                a.click();
                URL.revokeObjectURL(url);
              }); }}>
                <Icon name="Download" size={13} /> 匯出白板 PNG
              </button>
              <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); navigate(`/p/${projectId}`); }}>
                <Icon name="Share2" size={13} /> 到專案頁分享
              </button>
              <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); clear(); }} disabled={boardEmpty}>
                <Icon name="Trash2" size={13} /> 清空白板（可復原）
              </button>
            </div>
          </>
        )}

        {storageFull && (
          <p className="error studio__alert" role="alert">
            本機草稿空間已滿，這張白板沒有存起來——請先把手稿「存成這一鏡的畫面」，或清掉其他鏡的草稿。
          </p>
        )}

        <div className="studio-workarea">
          <ToolRail
            active={tool}
            onSelect={pickTool}
            disabled={!canEdit}
            optionsLabel={optionsKind === "brush" ? "筆刷" : optionsKind === "reference" ? "描圖底稿" : "AI"}
            options={
              optionsKind === "brush" ? brushShelf
              : optionsKind === "reference" ? (
                <div className="studio-refopts">
                  {shot?.assetUrl && shot.assetKind !== "audio" ? (
                    <>
                      <label className="studio-field is-inline">
                        <input type="checkbox" checked={showReference} onChange={(e) => setShowReference(e.target.checked)} />
                        <span>顯示這一鏡的畫面當底稿</span>
                      </label>
                      <Meta as="p">底稿畫在筆畫之下，不會被匯出，也擦不掉。</Meta>
                    </>
                  ) : (
                    <Meta as="p">這一鏡還沒有畫面可以當底稿。先生成或存一張，再回來描。</Meta>
                  )}
                </div>
              )
              : optionsKind === "ai" ? (
                <Meta as="p">AI 的動作在右邊的 Inspector「AI」分頁——那裡看得到它掌握了哪些上下文。</Meta>
              )
              : null
            }
          />

          <StudioStage
            canvas={canvasProps}
            view={view}
            guides={guides}
            onToggleGuide={(key: GuideKey) => setGuides((g) => toggleGuide(g, key))}
            onZoomIn={() => zoomBy(1.2)}
            onZoomOut={() => zoomBy(1 / 1.2)}
            onFit={fitToScreen}
            onActualSize={actualSize}
            hud={{
              shotNumber: shotIndex >= 0 ? shotIndex + 1 : null,
              durationSec: shot?.durationSec ?? null,
              aspect: projectFormat ?? "16:9",
              lens: (shot as InspectorShot | null)?.camera?.focalLength ?? null,
              shotSize: (shot as InspectorShot | null)?.camera?.shotSize ?? null,
            }}
            strokeCount={board.doc.strokes.length}
            maxStrokes={layout.maxStrokes}
          />

          <ShotInspector
            projectId={projectId}
            projectFormat={projectFormat}
            shot={(shot as InspectorShot | null) ?? null}
            shotNumber={shotIndex >= 0 ? shotIndex + 1 : null}
            canEdit={canEdit}
            tab={inspectorTab}
            onTabChange={setInspectorTab}
            collapsed={panels.inspector}
            onToggleCollapsed={() => setPanels((p) => ({ ...p, inspector: !p.inspector }))}
            ai={{
              projectId,
              shot,
              canEdit,
              boardEmpty,
              onBoardSaved: markSaved,
              saveBoardToShot,
              saveState,
              saveError,
              sketch: sketchBridge,
              onApplyPrompt: (text: string) => {
                if (!shot) return;
                updateShot.mutate({
                  sceneId: shot.id,
                  prompt: text,
                  expectedRev: shot.rev,
                  baseline: { prompt: shot.prompt ?? null },
                });
                setInspectorTab("frame");
              },
            }}
          />
        </div>

        <StoryboardTimeline
          shots={shots}
          loading={shotsLoading}
          activeId={activeShotId}
          draftIds={draftIds}
          canEdit={canEdit}
          busy={move.isPending || reorder.isPending}
          shotSizeOf={(s) => (s as InspectorShot).camera?.shotSize ?? null}
          onSelect={switchTo}
          onMove={(id, direction) => move.mutate({ sceneId: id, direction })}
          onReorder={(orderedIds) => reorder.mutate({ projectId, orderedIds })}
          onNewShot={createShot}
          onDuplicate={(id) => insertQueueRef.current?.enqueue(id, { duplicate: true })}
          onDelete={(id) => removeShot.mutate({ sceneId: id })}
          newShotBusy={addShot.isPending || insertAfter.isPending}
        />
      </div>
    );
  }

  /* ══ 手機輕量版：維持既有版面（四區工作台在 390px 上不成立）══ */
  const tool2 = (
    action: string,
    label: string,
    icon: Parameters<typeof Icon>[0]["name"],
    onClick: () => void,
    opts: { disabled?: boolean; on?: boolean } = {},
  ) => (
    <button
      type="button"
      className={opts.on ? "is-on" : undefined}
      aria-pressed={opts.on === undefined ? undefined : opts.on}
      aria-label={label}
      title={SHORTCUT_HINTS[action] ? `${label}（${SHORTCUT_HINTS[action]}）` : label}
      disabled={opts.disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={16} />
    </button>
  );

  return (
    <div
      className={`studio${immersive ? " is-immersive" : ""}`}
      data-mode={layout.mode}
      data-ai={layout.aiPanel}
      ref={hostRef}
    >
      <header className="studio__bar">
        <div className="studio__bar-group studio__identity">
          <strong className="studio__title" title={projectTitle}>{projectTitle}</strong>
          <Meta as="span" className="studio__where">
            {shot ? `第 ${shotIndex + 1} 鏡・${shot.title}` : "自由塗鴉（未選分鏡）"}
          </Meta>
        </div>

        <div className="studio__bar-group studio__tools" role="toolbar" aria-label="白板工具">
          {tool2("undo", "復原", "Undo2", undo, { disabled: board.doc.strokes.length === 0 })}
          {tool2("redo", "重做", "RotateCw", redo, { disabled: board.redo.length === 0 })}
          {tool2("clear", "清空白板（可逐筆復原）", "Trash2", clear, { disabled: boardEmpty })}
          <span className="studio__divider" aria-hidden="true" />
          {tool2("zoomOut", "縮小", "ZoomOut", () => zoomBy(1 / 1.2))}
          {tool2("fit", "整張放進畫面", "Scan", fitToScreen)}
          {tool2("zoomIn", "放大", "ZoomIn", () => zoomBy(1.2))}
          {tool2("pan", "移動畫布（兩指拖曳也可以）", "Hand", () => setPanMode((v) => !v), { on: panMode })}
          {shot?.assetUrl && shot.assetKind !== "audio" &&
            tool2("reference", "描圖底稿", "Layers", () => setShowReference((v) => !v), { on: showReference })}
          <span className="studio__divider" aria-hidden="true" />
          {tool2("toggleImmersive", immersive ? "離開全螢幕" : "全螢幕專注模式", immersive ? "Shrink" : "Expand", toggleImmersive, { on: immersive })}
        </div>

        <div className="studio__bar-group studio__panel-tabs">
          <Button size="sm" variant={sheet === "shots" ? "tonal" : "ghost"} onClick={() => setSheet((s) => (s === "shots" ? "none" : "shots"))}>
            <Icon name="Film" size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            分鏡{shotsLoading ? "（載入中）" : shots.length ? `（${shots.length}）` : ""}
          </Button>
          <Button size="sm" variant={sheet === "ai" ? "tonal" : "ghost"} onClick={() => setSheet((s) => (s === "ai" ? "none" : "ai"))}>
            <Icon name="Sparkles" size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            AI
          </Button>
        </div>
      </header>

      {storageFull && (
        <p className="error" role="alert">
          本機草稿空間已滿，這張白板沒有存起來——請先把手稿「存成這一鏡的畫面」，或清掉其他鏡的草稿。
        </p>
      )}

      <div className="studio__stage">
        <div className="studio__canvas-wrap">
          <WhiteboardCanvas {...canvasProps} />
          <div className="studio__status" aria-hidden="true">
            <span>{Math.round(view.scale * 100)}%</span>
            <span className="studio__status-sep" />
            <span>{board.doc.strokes.length}/{layout.maxStrokes}</span>
          </div>
        </div>
      </div>

      <div className="studio__dock">{brushShelf}</div>

      {panelsAsSheet && sheet !== "none" && (
        <>
          <button type="button" className="studio-sheet__scrim" aria-label="關閉面板" onClick={() => setSheet("none")} />
          <aside className="studio-sheet" aria-label={sheet === "shots" ? "順序分鏡表" : "AI 協作"}>
            <div className="studio-sheet__head">
              <span className="studio-sheet__grip" aria-hidden="true" />
              <Button size="sm" variant="ghost" onClick={() => setSheet("none")} aria-label="關閉面板">
                <Icon name="X" size={16} />
              </Button>
            </div>
            <div className="studio-sheet__body">{sheet === "shots" ? shotStrip : aiPanel}</div>
          </aside>
        </>
      )}
    </div>
  );
}
