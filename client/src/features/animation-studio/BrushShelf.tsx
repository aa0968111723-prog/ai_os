import { useState } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { Button, Hint, Meta } from "../../components/ui";
import {
  BRUSH_ENGINE_LABEL,
  BRUSH_LIMITS,
  type BrushEngine,
  type BrushSpec,
} from "./brushes";
import { isTuned } from "./brushCollection";
import type { StudioLayout } from "./studioLayout";

const ENGINE_ICON: Record<BrushEngine, IconName> = {
  pencil: "Pencil",
  pen: "PenTool",
  marker: "Highlighter",
  ink: "Feather",
  spray: "SprayCan",
  eraser: "Eraser",
};

/** 常用色：品牌四色＋墨黑與紙白，點一下就換色，不必開系統選色器 */
const SWATCHES = ["#16223b", "#101014", "#ef6a4e", "#f2b24a", "#8fe3cb", "#3b6ea5", "#8a5cf6", "#ffffff"];

export interface BrushShelfProps {
  layout: StudioLayout;
  /** 內建＋收藏，順序即顯示順序 */
  brushes: readonly BrushSpec[];
  /** 目前選中的筆刷 id（可能是內建） */
  activeId: string;
  /** 正在用的筆刷（選中筆刷的工作副本，含尚未收藏的調整） */
  brush: BrushSpec;
  onSelect: (id: string) => void;
  onBrushChange: (next: BrushSpec) => void;
  onCollect: (name: string) => void;
  onRemove: (id: string) => void;
  /** 收藏失敗（已滿）等訊息 */
  notice?: string;
  /** 線條穩定器 0-1（跨筆刷的工作習慣，存在裝置偏好，見 studioStorage） */
  stabilizer?: number;
  onStabilizerChange?: (value: number) => void;
}

/**
 * 筆刷櫃：選筆、調參數、把調好的收錄成自己的一支。
 *
 * 桌機是側邊直欄（參數滑桿全開），手機輕量版是底部橫向 dock——
 * 手機上把六條滑桿攤開會吃掉半個畫面，而在手機上真正會調的只有粗細與顏色。
 * 這個差異由 `layout.showBrushTuning` 決定，不是各自寫 CSS 藏起來（見 studioLayout）。
 */
export function BrushShelf({
  layout,
  brushes,
  activeId,
  brush,
  onSelect,
  onBrushChange,
  onCollect,
  onRemove,
  notice,
  stabilizer = 0,
  onStabilizerChange,
}: BrushShelfProps) {
  const [collectName, setCollectName] = useState("");
  const [collecting, setCollecting] = useState(false);
  /**
   * 手機 dock 的參數區預設收起來。
   * 攤開是三列（筆／粗細濃度／色票），在 844px 高的手機上等於白板只剩三分之一——
   * 而換筆是每分鐘都在做的事，調參數不是。桌機空間夠，一律攤開。
   */
  const dock = layout.brushShelf === "dock";
  const [tuneOpen, setTuneOpen] = useState(!dock);
  const base = brushes.find((b) => b.id === activeId);
  const tuned = base ? isTuned(base, brush) : false;
  const set = (patch: Partial<BrushSpec>) => onBrushChange({ ...brush, ...patch });
  const showTune = !dock || tuneOpen;

  return (
    <section className="studio-brushes" data-mode={layout.mode} aria-label="筆刷櫃">
      <div className="studio-brushes__list" role="radiogroup" aria-label="選擇筆刷">
        {brushes.map((item) => {
          const active = item.id === activeId;
          return (
            <div key={item.id} className="studio-brushes__item">
              <button
                type="button"
                role="radio"
                aria-checked={active}
                className={`studio-brush${active ? " is-active" : ""}`}
                onClick={() => onSelect(item.id)}
                title={`${item.name}（${BRUSH_ENGINE_LABEL[item.engine]}）`}
              >
                <span className="studio-brush__ink" style={{ background: item.engine === "eraser" ? "var(--border)" : item.color }}>
                  <Icon name={ENGINE_ICON[item.engine]} size={15} />
                </span>
                <span className="studio-brush__name">{item.name}</span>
                {!item.builtin && <span className="studio-brush__mine" aria-label="我收錄的筆刷">★</span>}
              </button>
              {!item.builtin && (
                <button
                  type="button"
                  className="studio-brush__remove"
                  aria-label={`刪除筆刷 ${item.name}`}
                  onClick={() => onRemove(item.id)}
                >
                  <Icon name="X" size={12} />
                </button>
              )}
            </div>
          );
        })}
        {dock && (
          <button
            type="button"
            className={`studio-brushes__toggle${tuneOpen ? " is-on" : ""}`}
            aria-expanded={tuneOpen}
            aria-controls="studio-brush-tune"
            aria-label={tuneOpen ? "收起筆刷設定" : "展開筆刷設定"}
            onClick={() => setTuneOpen((v) => !v)}
          >
            <span
              className="studio-brushes__toggle-dot"
              style={{ background: brush.engine === "eraser" ? "var(--border)" : brush.color }}
              aria-hidden="true"
            />
            <b>{brush.size}</b>
            <Icon name={tuneOpen ? "ChevronDown" : "ChevronUp"} size={13} />
          </button>
        )}
      </div>

      <div className="studio-brushes__tune" id="studio-brush-tune" hidden={!showTune}>
        <label className="studio-slider">
          <span>粗細 <b>{brush.size}</b></span>
          <input
            type="range"
            min={BRUSH_LIMITS.size.min}
            max={BRUSH_LIMITS.size.max}
            value={brush.size}
            onChange={(e) => set({ size: Number(e.target.value) })}
          />
        </label>
        <label className="studio-slider">
          <span>濃度 <b>{Math.round(brush.opacity * 100)}%</b></span>
          <input
            type="range"
            min={2}
            max={100}
            value={Math.round(brush.opacity * 100)}
            onChange={(e) => set({ opacity: Number(e.target.value) / 100 })}
          />
        </label>

        {brush.engine !== "eraser" && (
          <div className="studio-swatches" role="group" aria-label="顏色">
            {SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                className={`studio-swatch${brush.color === color ? " is-active" : ""}`}
                style={{ background: color }}
                aria-label={`換成 ${color}`}
                aria-pressed={brush.color === color}
                onClick={() => set({ color })}
              />
            ))}
            <label className="studio-swatch studio-swatch--custom" title="自訂顏色">
              <Icon name="Pipette" size={13} />
              <input type="color" value={brush.color} onChange={(e) => set({ color: e.target.value })} aria-label="自訂顏色" />
            </label>
          </div>
        )}

        {layout.showBrushTuning && brush.engine !== "eraser" && (
          <details className="studio-brushes__advanced">
            <summary>手感微調</summary>
            <label className="studio-slider">
              <span>壓感 <b>{Math.round(brush.pressure * 100)}%</b></span>
              <input type="range" min={0} max={100} value={Math.round(brush.pressure * 100)} onChange={(e) => set({ pressure: Number(e.target.value) / 100 })} />
            </label>
            <label className="studio-slider">
              <span>飛白（越快越細） <b>{Math.round(brush.speed * 100)}%</b></span>
              <input type="range" min={0} max={100} value={Math.round(brush.speed * 100)} onChange={(e) => set({ speed: Number(e.target.value) / 100 })} />
            </label>
            <label className="studio-slider">
              <span>顆粒 <b>{Math.round(brush.grain * 100)}%</b></span>
              <input type="range" min={0} max={100} value={Math.round(brush.grain * 100)} onChange={(e) => set({ grain: Number(e.target.value) / 100 })} />
            </label>
            <label className="studio-slider">
              <span>收筆 <b>{Math.round(brush.taper * 100)}%</b></span>
              <input type="range" min={0} max={100} value={Math.round(brush.taper * 100)} onChange={(e) => set({ taper: Number(e.target.value) / 100 })} />
            </label>
            {onStabilizerChange && (
              <label className="studio-slider">
                <span>穩定器（抖動修正） <b>{Math.round(stabilizer * 100)}%</b></span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(stabilizer * 100)}
                  onChange={(e) => onStabilizerChange(Number(e.target.value) / 100)}
                />
              </label>
            )}
            <Hint>
              支援手寫板：壓感與傾斜側鋒（筆桿放倒線變寬）只有觸控筆吃得到，筆尾橡皮擦翻筆就能擦；
              滑鼠與手指改用「畫快一點就細一點」近似（飛白）。穩定器吸收手抖、線更順——代價是筆跡稍微落後筆尖。
            </Hint>
          </details>
        )}

        {/* 收錄：手機上調過才出現。永遠佔一整列的話，dock 會把白板的高度吃掉，
            而「還沒調參數就想收藏」本來就沒有意義（收到的是一模一樣的一支）。 */}
        {!layout.showBrushTuning && !tuned && !collecting ? null : collecting ? (
          <div className="studio-brushes__collect">
            <label htmlFor="studio-brush-name" className="sr-only">筆刷名稱</label>
            <input
              id="studio-brush-name"
              value={collectName}
              onChange={(e) => setCollectName(e.target.value)}
              placeholder={`我的${brush.name}`}
              maxLength={24}
            />
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                onCollect(collectName);
                setCollectName("");
                setCollecting(false);
              }}
            >
              收錄
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCollecting(false)}>取消</Button>
          </div>
        ) : (
          <Button size="sm" variant="tonal" onClick={() => setCollecting(true)} disabled={!!base && base.builtin === undefined && !tuned}>
            <Icon name="Star" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            收錄成我的筆刷
          </Button>
        )}
        {base?.builtin && tuned && (
          <Meta as="p" style={{ fontSize: "var(--fs-11)", margin: 0 }}>
            內建筆刷調過的參數只影響這次落筆——收錄之後才會記住。
          </Meta>
        )}
        {notice && <p className="error" role="alert">{notice}</p>}
      </div>
    </section>
  );
}
