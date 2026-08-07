import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { Button, Meta } from "../../components/ui";
import { BrushShelf } from "./BrushShelf";
import { ShotStrip, type StudioShot } from "./ShotStrip";
import { StudioAiPanel } from "./StudioAiPanel";
import { WhiteboardCanvas, type BoardView } from "./WhiteboardCanvas";
import { collectBrush, updateSavedBrush, workingCopy } from "./brushCollection";
import { DEFAULT_BRUSH_ID, findBrush, type BrushSpec } from "./brushes";
import { boardSizeForFormat, isBoardEmpty } from "./boardDoc";
import { exportBoardPng } from "./boardExport";
import { allBrushes, readSavedBrushes, writeSavedBrushes } from "./studioStorage";
import { clampZoom, fitBoardToBox } from "./studioLayout";
import { useBoardSession } from "./useBoardSession";
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

  // ── 手機輕量版的面板 ──────────────────────────────────────
  const [sheet, setSheet] = useState<LiteSheet>("none");
  const lite = layout.mode === "lite";
  useEffect(() => { if (!lite) setSheet("none"); }, [lite]);

  const exportBoard = useCallback(() => exportBoardPng(boardRef.current.doc, layout.exportMaxEdge), [layout.exportMaxEdge]);

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
    />
  );

  return (
    <div className="studio" data-mode={layout.mode} ref={hostRef}>
      <header className="studio__bar">
        <div className="studio__bar-group">
          <strong className="studio__title" title={projectTitle}>{projectTitle}</strong>
          <Meta as="span" className="studio__where">
            {shot ? `第 ${shots.findIndex((s) => s.id === shot.id) + 1} 鏡・${shot.title}` : "自由塗鴉（未選分鏡）"}
          </Meta>
        </div>

        <div className="studio__bar-group studio__tools" role="toolbar" aria-label="白板工具">
          <button type="button" aria-label="復原" title="復原" disabled={board.doc.strokes.length === 0} onClick={undo}>
            <Icon name="Undo2" size={15} />
          </button>
          <button type="button" aria-label="重做" title="重做" disabled={board.redo.length === 0} onClick={redo}>
            <Icon name="RotateCw" size={15} />
          </button>
          <button type="button" aria-label="清空白板" title="清空白板（可逐筆復原）" disabled={boardEmpty} onClick={clear}>
            <Icon name="Trash2" size={15} />
          </button>
          <span className="studio__divider" aria-hidden="true" />
          <button type="button" aria-label="縮小" title="縮小" onClick={() => zoomBy(1 / 1.2)}>
            <Icon name="ZoomOut" size={15} />
          </button>
          <button type="button" aria-label="整張放進畫面" title="整張放進畫面" onClick={fitToScreen}>
            <Icon name="Maximize" size={15} />
          </button>
          <button type="button" aria-label="放大" title="放大" onClick={() => zoomBy(1.2)}>
            <Icon name="ZoomIn" size={15} />
          </button>
          <button
            type="button"
            className={panMode ? "is-on" : undefined}
            aria-pressed={panMode}
            aria-label="移動畫布"
            title="移動畫布（兩指拖曳也可以）"
            onClick={() => setPanMode((v) => !v)}
          >
            <Icon name="Hand" size={15} />
          </button>
          {shot?.assetUrl && shot.assetKind !== "audio" && (
            <button
              type="button"
              className={showReference ? "is-on" : undefined}
              aria-pressed={showReference}
              aria-label="描圖底稿"
              title="把這一鏡目前的畫面當底稿描"
              onClick={() => setShowReference((v) => !v)}
            >
              <Icon name="Layers" size={15} />
            </button>
          )}
        </div>

        {lite && (
          <div className="studio__bar-group studio__lite-tabs">
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
          />
          <div className="studio__canvas-meta">
            <Meta as="span">
              {board.doc.strokes.length}／{layout.maxStrokes} 筆・{Math.round(view.scale * 100)}%
              {layout.mode === "lite" ? "・輕量版" : ""}
            </Meta>
          </div>
        </div>

        {!lite && <aside className="studio__side">{aiPanel}</aside>}
      </div>

      {!lite && <div className="studio__rail">{shotStrip}</div>}

      {lite && (
        <>
          <div className="studio__dock">{brushShelf}</div>
          {sheet !== "none" && (
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
        </>
      )}
    </div>
  );
}
