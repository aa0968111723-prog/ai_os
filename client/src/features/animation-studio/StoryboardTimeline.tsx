/**
 * 底部分鏡時間軸：整支片子的順序就在這一條。
 *
 * 與舊的 ShotStrip 差在「這是時間軸不是清單」：每一格帶縮圖、鏡號、秒數、景別，
 * 寬度固定所以掃過去就知道片長分布；選取態明確（畫布與 Inspector 跟著切）。
 *
 * 兩種排序操作並存是刻意的（沿用 ShotStrip 的既有決定）：桌機可以拖，但每一格
 * 永遠也有前／後按鈕——拖曳對鍵盤與讀屏使用者不成立，那是加速捷徑不是唯一的路。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon";
import { AssetImg } from "../../components/MediaFallback";
import { Button, Meta } from "../../components/ui";
import {
  COMPLETION_TRACKS,
  TRACK_LABEL,
  computeShotCompletion,
  type ShotCompletionInput,
} from "@shared/shotCompletion";
import type { StudioShot } from "./ShotStrip";
import { NewShotMenu, type NewShotKind } from "./NewShotMenu";
import { fixedShotMenuStyle, placeFixedShotMenu, viewportCssSize } from "./placeFixedShotMenu";

export interface StoryboardTimelineProps {
  shots: readonly StudioShot[];
  /** True while listByProject has no data yet — do not show「0 鏡」. */
  loading?: boolean;
  activeId: string | null;
  /** 有本機手稿還沒存成畫面的鏡 */
  draftIds: ReadonlySet<string>;
  canEdit: boolean;
  busy?: boolean;
  /** 每一鏡的景別（camera.shotSize），沒填就不顯示 */
  shotSizeOf: (shot: StudioShot) => string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onReorder: (orderedIds: string[]) => void;
  onNewShot: (kind: NewShotKind) => void;
  onDuplicate: (id: string) => void;
  /** Blank row immediately after this shot (not append-at-end). */
  onInsertAfter: (id: string) => void;
  onDelete: (id: string) => void;
  newShotBusy?: boolean;
}

export function StoryboardTimeline({
  shots,
  loading,
  activeId,
  draftIds,
  canEdit,
  busy,
  shotSizeOf,
  onSelect,
  onMove,
  onReorder,
  onNewShot,
  onDuplicate,
  onInsertAfter,
  onDelete,
  newShotBusy,
}: StoryboardTimelineProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const moreBtnRefs = useRef(new Map<string, HTMLButtonElement>());

  const drop = (targetId: string) => {
    setOverId(null);
    const from = shots.findIndex((s) => s.id === dragId);
    const to = shots.findIndex((s) => s.id === targetId);
    setDragId(null);
    if (from < 0 || to < 0 || from === to) return;
    const ordered = shots.map((s) => s.id);
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved!);
    onReorder(ordered);
  };

  const totalSec = shots.reduce((sum, s) => sum + (s.durationSec || 0), 0);

  return (
    <section className="studio-timeline" aria-label="分鏡時間軸">
      <header className="studio-timeline__head">
        <strong className="studio-timeline__title">
          <Icon name="Film" size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          分鏡
        </strong>
        <Meta as="span" className="studio-timeline__count">
          {loading ? "載入中" : `${shots.length} 鏡・${totalSec}s`}
        </Meta>
        <span style={{ flex: "1 1 auto" }} />
        {canEdit && <NewShotMenu onPick={onNewShot} busy={newShotBusy} />}
      </header>

      {loading ? (
        <p className="studio-timeline__empty">正在載入分鏡…</p>
      ) : shots.length === 0 ? (
        <p className="studio-timeline__empty">
          還沒有分鏡。用右上的「＋ 新增鏡」開一格，或到 AI 分頁貼腳本一次拆成整份。
        </p>
      ) : (
        <ol className="studio-timeline__list" ref={listRef}>
          {shots.map((shot, i) => {
            const active = shot.id === activeId;
            const size = shotSizeOf(shot);
            const draggable = canEdit;
            const completion = computeShotCompletion(shot as unknown as ShotCompletionInput);
            return (
              <li
                key={shot.id}
                className={`studio-tlshot${active ? " is-active" : ""}${overId === shot.id ? " is-over" : ""}`}
                draggable={draggable}
                onDragStart={draggable ? () => setDragId(shot.id) : undefined}
                onDragOver={draggable ? (e) => { e.preventDefault(); setOverId(shot.id); } : undefined}
                onDragLeave={draggable ? () => setOverId((cur) => (cur === shot.id ? null : cur)) : undefined}
                onDrop={draggable ? (e) => { e.preventDefault(); drop(shot.id); } : undefined}
                onDragEnd={draggable ? () => { setDragId(null); setOverId(null); } : undefined}
              >
                <button
                  type="button"
                  className="studio-tlshot__pick"
                  aria-label={`第 ${i + 1} 鏡：${shot.title}`}
                  aria-current={active ? "true" : undefined}
                  onClick={() => onSelect(shot.id)}
                >
                  <span className="studio-tlshot__thumb">
                    {shot.assetUrl && shot.assetKind !== "audio" ? (
                      <AssetImg src={shot.assetUrl} alt="" fallbackLabel="畫面遺失" fallbackHeight={60} fallbackIconSize={13} />
                    ) : (
                      <span className="studio-tlshot__thumb-empty" aria-hidden="true">
                        <Icon name="Image" size={16} />
                      </span>
                    )}
                    {draftIds.has(shot.id) && (
                      <span className="studio-tlshot__draft" title="這一鏡有還沒存起來的手稿">
                        <Icon name="Pencil" size={9} />
                      </span>
                    )}
                  </span>
                  <span className="studio-tlshot__meta">
                    <b className="studio-tlshot__no">{String(i + 1).padStart(2, "0")}</b>
                    <span className="studio-tlshot__dur">{shot.durationSec}s</span>
                    {size && <span className="studio-tlshot__size">{size}</span>}
                  </span>
                  <span className="studio-tlshot__title">{shot.title}</span>
                  {/* 五軌完成度（shared/shotCompletion）：與專案頁的分鏡卡同一套推導，
                      同一個 shot 在兩個地方不該講出不一樣的狀態。這裡只留點、不留字——
                      Timeline 的一格只有 116px，五個標籤塞不下也不需要 */}
                  <span
                    className="studio-tlshot__tracks"
                    role="img"
                    aria-label={`完成度 ${completion.percent}%：${COMPLETION_TRACKS.map((t) => `${TRACK_LABEL[t]}${completion.tracks[t] === "done" ? "已完成" : completion.tracks[t] === "running" ? "進行中" : "未完成"}`).join("、")}`}
                  >
                    {COMPLETION_TRACKS.map((t) => (
                      <i
                        key={t}
                        className={`studio-tlshot__dot is-${completion.tracks[t]}`}
                        title={`${TRACK_LABEL[t]}：${completion.tracks[t] === "done" ? "已完成" : completion.tracks[t] === "running" ? "進行中" : "尚未完成"}`}
                      />
                    ))}
                  </span>
                </button>

                {canEdit && (
                  <button
                    type="button"
                    className="studio-tlshot__more"
                    ref={(el) => {
                      if (el) moreBtnRefs.current.set(shot.id, el);
                      else moreBtnRefs.current.delete(shot.id);
                    }}
                    aria-label={`「${shot.title}」的更多操作`}
                    title="更多（插入、複製、刪除）"
                    aria-haspopup="menu"
                    aria-expanded={menuId === shot.id}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMenuId((cur) => (cur === shot.id ? null : shot.id));
                    }}
                  >
                    <Icon name="Ellipsis" size={12} />
                  </button>
                )}

                {canEdit && (
                  <div className="studio-tlshot__ops">
                    <button
                      type="button"
                      aria-label={`把「${shot.title}」往前移`}
                      title="往前移"
                      disabled={i === 0 || busy}
                      onClick={() => onMove(shot.id, "up")}
                    >
                      <Icon name="ArrowLeft" size={11} />
                    </button>
                    <button
                      type="button"
                      aria-label={`把「${shot.title}」往後移`}
                      title="往後移"
                      disabled={i === shots.length - 1 || busy}
                      onClick={() => onMove(shot.id, "down")}
                    >
                      <Icon name="ArrowRight" size={11} />
                    </button>
                  </div>
                )}

                {menuId === shot.id && (
                  <ShotMoreMenu
                    trigger={moreBtnRefs.current.get(shot.id) ?? null}
                    onClose={() => setMenuId(null)}
                    onDuplicate={() => { setMenuId(null); onDuplicate(shot.id); }}
                    onInsertAfter={() => { setMenuId(null); onInsertAfter(shot.id); }}
                    onDelete={() => { setMenuId(null); onDelete(shot.id); }}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
      {canEdit && shots.length > 1 && (
        <Meta as="p" className="studio-timeline__tip">
          拖曳縮圖換順序；鍵盤與觸控請用每一格的箭頭。
        </Meta>
      )}
    </section>
  );
}

/**
 * Portal + position:fixed. Live 10:08: height is not the cause — 50%
 * zoom (CSS ~2560×1320) still painted the #790 cream ellipse. That is
 * the full-viewport scrim <button> (cream + 999px + inset:0), not
 * overflow-y. Do not mount a scrim. Do not keep --shot `bottom: 100%`
 * on a fixed portal (that stretches). Escape + outside pointerdown close.
 */
function ShotMoreMenu({
  trigger,
  onClose,
  onDuplicate,
  onInsertAfter,
  onDelete,
}: {
  trigger: HTMLButtonElement | null;
  onClose: () => void;
  onDuplicate: () => void;
  onInsertAfter: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const menuH = menuRef.current?.offsetHeight ?? 120;
      const menuW = menuRef.current?.offsetWidth ?? 190;
      const rect = trigger?.getBoundingClientRect() ?? null;
      const { vw, vh } = viewportCssSize();
      setBox(placeFixedShotMenu({
        trigger: rect,
        menuH,
        menuW,
        vw,
        vh,
      }));
    };
    place();
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [trigger]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target;
      if (!(node instanceof Node)) return;
      if (menuRef.current?.contains(node)) return;
      if (trigger?.contains(node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [trigger, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={menuRef}
      className="studio-menu studio-menu--fixed"
      role="menu"
      data-studio-shot-menu="1"
      style={fixedShotMenuStyle(box)}
    >
      <button
        type="button"
        role="menuitem"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onInsertAfter();
        }}
      >
        <Icon name="Plus" size={13} /> 在這之後插入一鏡
      </button>
      <button
        type="button"
        role="menuitem"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDuplicate();
        }}
      >
        <Icon name="Copy" size={13} /> 複製這一鏡
      </button>
      <button
        type="button"
        role="menuitem"
        className="is-danger"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete();
        }}
      >
        <Icon name="Trash2" size={13} /> 刪除（進回收桶）
      </button>
    </div>,
    document.body,
  );
}
