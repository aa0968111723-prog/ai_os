import { useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { AssetImg } from "../../components/MediaFallback";
import { Button, Meta } from "../../components/ui";
import type { StudioLayout } from "./studioLayout";

/** 分鏡帶只需要這幾欄；型別刻意寫成結構相容，不綁 tRPC 的推導型別 */
export interface StudioShot {
  id: string;
  title: string;
  orderIndex: number;
  durationSec: number;
  assetUrl?: string | null;
  assetKind?: string | null;
  prompt?: string | null;
  voiceover?: string | null;
  /** 環境音描述（這一鏡聽得到什麼）；listByProject 已回這一欄 */
  ambience?: string | null;
  rev?: number;
}

export interface ShotStripProps {
  layout: StudioLayout;
  shots: readonly StudioShot[];
  /** True while listByProject has no data yet — do not show「0 鏡」. */
  loading?: boolean;
  activeId: string | null;
  /** 有本機手稿的分鏡（畫過但還沒存成畫面） */
  draftIds: ReadonlySet<string>;
  canEdit: boolean;
  busy?: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onMove: (id: string, direction: "up" | "down") => void;
  /** 桌機拖曳重排：整串新順序（伺服器以這串為準重編序號） */
  onReorder: (orderedIds: string[]) => void;
}

/**
 * 順序分鏡表：整支片子的順序就是這一條。
 *
 * 兩種操作並存是刻意的——桌機可以拖，但**每一格永遠也有「往前／往後」按鈕**。
 * 拖曳在觸控上與白板的平移手勢會打架，而且鍵盤與讀屏使用者拖不動；
 * 按鈕是所有裝置都成立的那條路，拖曳只是桌機的加速捷徑。
 */
export function ShotStrip({
  layout,
  shots,
  loading,
  activeId,
  draftIds,
  canEdit,
  busy,
  onSelect,
  onAdd,
  onMove,
  onReorder,
}: ShotStripProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const draggable = layout.mode === "desktop" && canEdit;

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
    <section className="studio-strip" data-mode={layout.mode} aria-label="順序分鏡表">
      <header className="studio-strip__head">
        <strong>
          <Icon name="Film" size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          分鏡順序
        </strong>
        <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>
          {loading ? "載入中" : `${shots.length} 鏡・約 ${totalSec} 秒`}
        </Meta>
        {canEdit && (
          <Button size="sm" variant="tonal" onClick={onAdd} disabled={busy}>
            <Icon name="Plus" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            加一鏡
          </Button>
        )}
      </header>

      {loading ? (
        <p className="studio-strip__empty">正在載入分鏡…</p>
      ) : shots.length === 0 ? (
        <p className="studio-strip__empty">
          還沒有分鏡。按「加一鏡」開一格空的，或用右邊的 AI 貼腳本一次拆成整份分鏡。
        </p>
      ) : (
        <ol className="studio-strip__list" ref={listRef}>
          {shots.map((shot, i) => {
            const active = shot.id === activeId;
            return (
              <li
                key={shot.id}
                className={`studio-shot${active ? " is-active" : ""}${overId === shot.id ? " is-over" : ""}`}
                draggable={draggable}
                onDragStart={draggable ? () => setDragId(shot.id) : undefined}
                onDragOver={draggable ? (e) => { e.preventDefault(); setOverId(shot.id); } : undefined}
                onDragLeave={draggable ? () => setOverId((cur) => (cur === shot.id ? null : cur)) : undefined}
                onDrop={draggable ? (e) => { e.preventDefault(); drop(shot.id); } : undefined}
                onDragEnd={draggable ? () => { setDragId(null); setOverId(null); } : undefined}
              >
                <button
                  type="button"
                  className="studio-shot__pick"
                  // 明確的可讀名稱：讀屏念出來要是「第 3 鏡：收尾」，
                  // 而不是把縮圖、秒數與序號黏成一串
                  aria-label={`第 ${i + 1} 鏡：${shot.title}`}
                  aria-current={active ? "true" : undefined}
                  onClick={() => onSelect(shot.id)}
                >
                  <span className="studio-shot__no">{i + 1}</span>
                  <span className="studio-shot__thumb">
                    {shot.assetUrl && shot.assetKind !== "audio" ? (
                      <AssetImg src={shot.assetUrl} alt="" fallbackLabel="畫面遺失" fallbackHeight={54} fallbackIconSize={13} />
                    ) : (
                      <span className="studio-shot__thumb-empty" aria-hidden="true">
                        <Icon name="Image" size={15} />
                      </span>
                    )}
                    {draftIds.has(shot.id) && (
                      <span className="studio-shot__draft" title="這一鏡有還沒存起來的手稿">
                        <Icon name="Pencil" size={10} />
                      </span>
                    )}
                  </span>
                  <span className="studio-shot__text">
                    <b>{shot.title}</b>
                    <small>{shot.durationSec}s</small>
                  </span>
                </button>
                {canEdit && (
                  <span className="studio-shot__order">
                    <button type="button" aria-label={`把「${shot.title}」往前移`} disabled={i === 0 || busy} onClick={() => onMove(shot.id, "up")}>
                      <Icon name="ArrowLeft" size={12} />
                    </button>
                    <button type="button" aria-label={`把「${shot.title}」往後移`} disabled={i === shots.length - 1 || busy} onClick={() => onMove(shot.id, "down")}>
                      <Icon name="ArrowRight" size={12} />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {draggable && shots.length > 1 && (
        <Meta as="p" className="studio-strip__tip">
          可直接拖曳縮圖換順序；鍵盤與手機請用每格的箭頭按鈕。
        </Meta>
      )}
    </section>
  );
}
