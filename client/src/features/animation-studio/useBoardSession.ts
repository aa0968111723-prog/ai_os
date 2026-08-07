import { useCallback, useEffect, useRef, useState } from "react";
import {
  addStroke,
  clearBoard,
  emptyBoard,
  emptyBoardState,
  isBoardEmpty,
  redoBoard,
  undoBoard,
  type BoardState,
  type Stroke,
} from "./boardDoc";
import { clearStoredBoard, readBoard, shotsWithDraft, writeBoard } from "./studioStorage";
import type { StudioLayout } from "./studioLayout";

export interface BoardSession {
  board: BoardState;
  /** 目前在畫哪一鏡；null＝自由塗鴉 */
  activeShotId: string | null;
  /** 有未存手稿的分鏡（分鏡帶上的小圓點） */
  draftIds: ReadonlySet<string>;
  /** 本機草稿空間滿了（存不進去）——要讓使用者知道，不能默默丟掉 */
  storageFull: boolean;
  switchTo: (shotId: string | null) => void;
  pushStroke: (stroke: Stroke) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  /** 手稿已上傳成分鏡畫面：不再算「未存草稿」 */
  markSaved: (shotId: string) => void;
}

/** 存檔節流：停筆後多久寫本機。每一筆都寫會在長筆畫時卡頓。 */
export const BOARD_AUTOSAVE_MS = 600;

/**
 * 白板的一次「工作階段」：哪一鏡、畫了什麼、什麼時候寫回本機。
 *
 * 抽成 hook 的理由是**這裡最容易寫出會弄丟畫作的 bug**——
 * 切換分鏡時「舊的分鏡 id」配上「已經換成新分鏡的白板」寫回去，
 * 上一鏡的草稿就被下一鏡的內容默默覆蓋。這種錯在畫面上完全看不出來，
 * 要等使用者切回去才發現，所以必須有測試（useBoardSession.test.ts）盯著。
 */
export function useBoardSession(
  projectId: string,
  boardSize: { w: number; h: number },
  layout: StudioLayout,
): BoardSession {
  const [board, setBoard] = useState<BoardState>(() => emptyBoardState(boardSize.w, boardSize.h));
  const [activeShotId, setActiveShotId] = useState<string | null>(null);
  const [draftIds, setDraftIds] = useState<ReadonlySet<string>>(() => shotsWithDraft(projectId));
  const [storageFull, setStorageFull] = useState(false);

  // 存檔一定要「當下的白板」配「當下的分鏡」，所以兩個都留 ref
  const boardRef = useRef(board);
  boardRef.current = board;
  const shotRef = useRef(activeShotId);
  shotRef.current = activeShotId;

  const switchTo = useCallback(
    (nextShotId: string | null) => {
      if (nextShotId === shotRef.current) return;
      const current = boardRef.current.doc;
      if (!isBoardEmpty(current)) writeBoard(projectId, shotRef.current, current);
      const loaded = readBoard(projectId, nextShotId);
      setBoard({ doc: loaded ?? emptyBoard(boardSize.w, boardSize.h), redo: [] });
      setActiveShotId(nextShotId);
      setDraftIds(shotsWithDraft(projectId));
    },
    [boardSize.h, boardSize.w, projectId],
  );

  // 進站先讀「自由塗鴉」那一份：沒選分鏡時畫的東西不該在重整後消失
  useEffect(() => {
    const loaded = readBoard(projectId, null);
    if (loaded) setBoard({ doc: loaded, redo: [] });
    setDraftIds(shotsWithDraft(projectId));
  }, [projectId]);

  // 自動存檔（停筆後）
  useEffect(() => {
    if (isBoardEmpty(board.doc)) return;
    const timer = setTimeout(() => {
      const ok = writeBoard(projectId, activeShotId, board.doc);
      setStorageFull(!ok);
      if (ok && activeShotId) {
        setDraftIds((prev) => (prev.has(activeShotId) ? prev : new Set([...prev, activeShotId])));
      }
    }, BOARD_AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [board.doc, projectId, activeShotId]);

  // 離開創作室時補存一次。deps 必須是空的——跟著 activeShotId 走的話，
  // 切換分鏡時的 cleanup 會用舊 id 存新內容（見檔頭）。
  useEffect(() => {
    return () => {
      const doc = boardRef.current.doc;
      if (!isBoardEmpty(doc)) writeBoard(projectId, shotRef.current, doc);
    };
    // projectId 在本元件生命週期內固定（換專案由路由 key 重建創作室）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushStroke = useCallback(
    (stroke: Stroke) => {
      setBoard((prev) => {
        const next = addStroke(prev, stroke, layout.maxStrokes);
        // redo 也要有界：清空一張畫滿的白板會把整份筆畫留在記憶體裡
        return next.redo.length > layout.maxUndo ? { ...next, redo: next.redo.slice(-layout.maxUndo) } : next;
      });
    },
    [layout.maxStrokes, layout.maxUndo],
  );

  const undo = useCallback(() => setBoard(undoBoard), []);
  const redo = useCallback(() => setBoard((prev) => redoBoard(prev, layout.maxStrokes)), [layout.maxStrokes]);

  const clear = useCallback(() => {
    setBoard((prev) => clearBoard(prev));
    clearStoredBoard(projectId, shotRef.current);
    const cleared = shotRef.current;
    if (cleared) {
      setDraftIds((prev) => {
        if (!prev.has(cleared)) return prev;
        const next = new Set(prev);
        next.delete(cleared);
        return next;
      });
    }
  }, [projectId]);

  const markSaved = useCallback((shotId: string) => {
    setDraftIds((prev) => {
      if (!prev.has(shotId)) return prev;
      const next = new Set(prev);
      next.delete(shotId);
      return next;
    });
  }, []);

  return { board, activeShotId, draftIds, storageFull, switchTo, pushStroke, undo, redo, clear, markSaved };
}
