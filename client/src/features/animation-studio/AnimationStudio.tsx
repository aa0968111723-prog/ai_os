import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { Button, Meta } from "../../components/ui";
import { BrushShelf } from "./BrushShelf";
import { ShotStrip, type StudioShot } from "./ShotStrip";
import { StudioAiPanel } from "./StudioAiPanel";
import { WhiteboardCanvas, type BoardView } from "./WhiteboardCanvas";
import { collectBrush, updateSavedBrush, workingCopy } from "./brushCollection";
import { BRUSH_LIMITS, DEFAULT_BRUSH_ID, findBrush, type BrushSpec } from "./brushes";
import { boardSizeForFormat, isBoardEmpty } from "./boardDoc";
import { exportBoardPng } from "./boardExport";
import { allBrushes, readSavedBrushes, readStudioPrefs, writeSavedBrushes, writeStudioPrefs } from "./studioStorage";
import { summarizeBoard } from "./boardSummary";
import { clampZoom, fitBoardToBox } from "./studioLayout";
import { resolveShortcut, SHORTCUT_HINTS } from "./studioShortcuts";
import type { SketchPreview } from "./sketchReplay";
import { useBoardSession } from "./useBoardSession";
import { useImmersive } from "./useImmersive";
import { useStudioLayout } from "./useStudioLayout";
import "./studio.css";

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
 * 動畫創作室：左手畫、右手把它變成分鏡。
 *
 * 三個區塊固定不變，只有排法隨裝置換（見 studioLayout）：
 *   **手繪大白板**（中央）｜**順序分鏡表**（桌機底部軌道／手機貼底 sheet）｜**AI 協作欄**（桌機右欄／手機 sheet）
 *
 * 白板草稿存在本機（每一鏡一份，見 studioStorage），只有按下「存成這一鏡的畫面」
 * 才會上傳成專案素材。這條界線是刻意的：塗鴉階段不該打擾團隊的素材庫，
 * 也不該讓每一筆都等網路。
 */
export function AnimationStudio({ projectId, projectTitle, projectFormat, canEdit }: AnimationStudioProps) {
  const layout = useStudioLayout();
  const utils = trpc.useUtils();
  const scenes = trpc.scenes.listByProject.useQuery({ projectId });
  const shots: StudioShot[] = useMemo(() => scenes.data ?? [], [scenes.data]);

  const boardSize = useMemo(() => boardSizeForFormat(projectFormat), [projectFormat]);
  // 白板本體、切鏡與存檔都在 useBoardSession（會弄丟畫作的邏輯集中在那裡，並有測試盯著）
  const { board, activeShotId, draftIds, storageFull, switchTo, pushStroke, undo, redo, clear, markSaved } =
    useBoardSession(projectId, boardSize, layout);
  const shot = shots.find((s) => s.id === activeShotId) ?? null;

  // ── 筆刷櫃 ───────────────────────────────────────────────
  const [saved, setSaved] = useState<BrushSpec[]>(() => readSavedBrushes());
  const brushes = useMemo(() => allBrushes(saved), [saved]);
  const [activeBrushId, setActiveBrushId] = useState<string>(DEFAULT_BRUSH_ID);
  const [brush, setBrush] = useState<BrushSpec>(() => workingCopy(findBrush(allBrushes(readSavedBrushes()), DEFAULT_BRUSH_ID)));
  const [brushNotice, setBrushNotice] = useState("");

  const selectBrush = (id: string) => {
    setActiveBrushId(id);
    setBrush(workingCopy(findBrush(brushes, id)));
    setBrushNotice("");
  };

  /** 線條穩定器：跨筆刷的工作習慣（這台裝置＋這雙手），存進裝置偏好 */
  const [stabilizer, setStabilizer] = useState(() => readStudioPrefs().stabilizer);
  const changeStabilizer = (value: number) => {
    setStabilizer(value);
    writeStudioPrefs({ stabilizer: value });
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

  // ── 白板檢視（縮放、平移、描圖底稿）──────────────────────
  const [view, setView] = useState<BoardView>({ scale: 1, offsetX: 0, offsetY: 0 });
  /** AI 正在畫的那一筆（逐點預覽）：由 StudioAiPanel 的重播驅動，畫在白板 live 層 */
  const [aiPreview, setAiPreview] = useState<SketchPreview | null>(null);
  const [panMode, setPanMode] = useState(false);
  const [showReference, setShowReference] = useState(true);
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

  /** 快捷鍵要呼叫的東西每次 render 都是新函式；用 ref 轉一手，
   *  keydown 監聽器才不必每次重掛（重掛本身沒錯，但按鍵在重掛的空檔會漏接）。 */
  const zoomByRef = useRef(zoomBy);
  zoomByRef.current = zoomBy;
  const fitToScreenRef = useRef(fitToScreen);
  fitToScreenRef.current = fitToScreen;
  const selectBrushRef = useRef(selectBrush);
  selectBrushRef.current = selectBrush;

  // ── 分鏡表操作 ────────────────────────────────────────────
  const invalidateScenes = () => { void utils.scenes.listByProject.invalidate({ projectId }); };
  const addShot = trpc.scenes.addDraft.useMutation({
    onSuccess: (created) => {
      invalidateScenes();
      if (created?.id) switchTo(created.id);
    },
  });
  const move = trpc.scenes.move.useMutation({ onSuccess: invalidateScenes });
  const reorder = trpc.scenes.reorder.useMutation({ onSuccess: invalidateScenes });

  // ── 收成 sheet 的面板（手機全部、窄桌機只有 AI 欄）────────────
  const [sheet, setSheet] = useState<LiteSheet>("none");
  const lite = layout.mode === "lite";
  const shotsAsSheet = layout.shotStrip === "sheet";
  const aiAsSheet = layout.aiPanel === "sheet";
  const panelsAsSheet = shotsAsSheet || aiAsSheet;
  // 版面切換（轉向、拉視窗、進出全螢幕）時把開著的 sheet 收掉，
  // 否則常駐欄與 sheet 會同時出現同一塊內容
  useEffect(() => {
    setSheet((cur) => (cur === "shots" && !shotsAsSheet) || (cur === "ai" && !aiAsSheet) ? "none" : cur);
  }, [shotsAsSheet, aiAsSheet]);

  // ── 全螢幕專注模式 ────────────────────────────────────────
  const { immersive, exit: exitImmersive, toggle: toggleImmersive } = useImmersive(hostRef);

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
        case "eraser": selectBrushRef.current("builtin.eraser"); break;
        case "brush": selectBrushRef.current(DEFAULT_BRUSH_ID); break;
        case "pan": setPanMode((v) => !v); break;
        case "fit": fitToScreenRef.current(); break;
        case "zoomIn": zoomByRef.current(1.2); break;
        case "zoomOut": zoomByRef.current(1 / 1.2); break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, toggleImmersive, exitImmersive, immersive]);

  const referenceUrl = showReference && shot?.assetUrl && shot.assetKind !== "audio" ? shot.assetUrl : null;
  const boardEmpty = isBoardEmpty(board.doc);

  const shotStrip = (
    <ShotStrip
      layout={layout}
      shots={shots}
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
      // 存進素材庫之後這份手稿不再是「未存的草稿」；本機那份留著可繼續改
      onBoardSaved={markSaved}
      // AI 畫草圖：筆一筆重播進白板（走同一個 pushStroke，上限與尺寸都跟手繪同一套）；
      // preview 讓「正在畫的那一筆」逐點出現在白板上（live 層，不進文件）；
      // summarize 給 AI 白板現況（純數字摘要）——它才知道哪裡已有東西、該畫進哪裡
      sketch={{
        pushStroke,
        preview: setAiPreview,
        summarize: () => summarizeBoard(boardRef.current.doc),
        boardW: boardSize.w,
        boardH: boardSize.h,
        maxStrokes: layout.maxStrokes,
        strokeCount: board.doc.strokes.length,
      }}
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
      stabilizer={stabilizer}
      onStabilizerChange={changeStabilizer}
    />
  );

  const tool = (
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
            {shot ? `第 ${shots.findIndex((s) => s.id === shot.id) + 1} 鏡・${shot.title}` : "自由塗鴉（未選分鏡）"}
          </Meta>
        </div>

        <div className="studio__bar-group studio__tools" role="toolbar" aria-label="白板工具">
          {tool("undo", "復原", "Undo2", undo, { disabled: board.doc.strokes.length === 0 })}
          {tool("redo", "重做", "RotateCw", redo, { disabled: board.redo.length === 0 })}
          {tool("clear", "清空白板（可逐筆復原）", "Trash2", clear, { disabled: boardEmpty })}
          <span className="studio__divider" aria-hidden="true" />
          {tool("zoomOut", "縮小", "ZoomOut", () => zoomBy(1 / 1.2))}
          {tool("fit", "整張放進畫面", "Scan", fitToScreen)}
          {tool("zoomIn", "放大", "ZoomIn", () => zoomBy(1.2))}
          {tool("pan", "移動畫布（兩指拖曳也可以）", "Hand", () => setPanMode((v) => !v), { on: panMode })}
          {shot?.assetUrl && shot.assetKind !== "audio" &&
            tool("reference", "描圖底稿", "Layers", () => setShowReference((v) => !v), { on: showReference })}
          <span className="studio__divider" aria-hidden="true" />
          {tool("toggleImmersive", immersive ? "離開全螢幕" : "全螢幕專注模式", immersive ? "Shrink" : "Expand", toggleImmersive, { on: immersive })}
        </div>

        {/* 分鏡／AI 的入口：手機一律 sheet，窄桌機也走 sheet（先前是直接藏起來，
            821–1180px 的使用者連叫都叫不出來） */}
        {panelsAsSheet && (
          <div className="studio__bar-group studio__panel-tabs">
            <Button size="sm" variant={sheet === "shots" ? "tonal" : "ghost"} onClick={() => setSheet((s) => (s === "shots" ? "none" : "shots"))}>
              <Icon name="Film" size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              分鏡{shots.length ? `（${shots.length}）` : ""}
            </Button>
            <Button size="sm" variant={sheet === "ai" ? "tonal" : "ghost"} onClick={() => setSheet((s) => (s === "ai" ? "none" : "ai"))}>
              <Icon name="Sparkles" size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              AI
            </Button>
          </div>
        )}
      </header>

      {storageFull && (
        <p className="error" role="alert">
          本機草稿空間已滿，這張白板沒有存起來——請先把手稿「存成這一鏡的畫面」，或清掉其他鏡的草稿。
        </p>
      )}

      <div className="studio__stage">
        {!lite && <aside className="studio__shelf">{brushShelf}</aside>}

        <div className="studio__canvas-wrap">
          <WhiteboardCanvas
            doc={board.doc}
            brush={brush}
            layout={layout}
            panMode={panMode}
            view={view}
            onViewChange={setView}
            onStrokeEnd={pushStroke}
            referenceUrl={referenceUrl}
            readOnly={!canEdit}
            aiPreview={aiPreview}
            stabilizer={stabilizer}
          />
          {/* 狀態晶片：浮在畫布角落而不是佔一整列——這是給人「瞄一眼」的資訊，
              不該跟工具搶版面（先前那行「0／400 筆・9%・輕量版」看起來像除錯輸出） */}
          <div className="studio__status" aria-hidden="true">
            <span>{Math.round(view.scale * 100)}%</span>
            <span className="studio__status-sep" />
            <span>{board.doc.strokes.length}/{layout.maxStrokes}</span>
          </div>
        </div>

        {!lite && layout.aiPanel === "column" && <aside className="studio__side">{aiPanel}</aside>}
      </div>

      {!lite && <div className="studio__rail">{shotStrip}</div>}

      {lite && <div className="studio__dock">{brushShelf}</div>}

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
