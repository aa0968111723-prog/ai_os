/**
 * 中央舞台：檯面（深）＋畫面（白）＋貼邊的控制項。
 *
 * 「哪裡是工作區、哪裡是真正的影片畫面」必須一眼分得出來——先前整片是白的，
 * 於是使用者不知道自己畫到框外會被裁掉。檯面壓深、紙張留白、輔助線可開，
 * 三件事合起來才讓白板從「線上畫板」變成「分鏡格」。
 *
 * 控制項一律貼在畫布邊緣的浮層，不佔一整條工具列——畫布是這個頁面的主角。
 */
import { Icon } from "../../components/Icon";
import { WhiteboardCanvas, type BoardView, type WhiteboardCanvasProps } from "./WhiteboardCanvas";
import { SHORTCUT_HINTS } from "./studioShortcuts";
import { FRAME_GUIDES, type GuideKey, type GuideState } from "./studioTools";

export interface StudioStageProps {
  canvas: WhiteboardCanvasProps;
  view: BoardView;
  guides: GuideState;
  onToggleGuide: (key: GuideKey) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onActualSize: () => void;
  /** 底部 HUD：這一鏡是什麼（沒選鏡時只顯示比例） */
  hud: {
    shotNumber: number | null;
    durationSec: number | null;
    aspect: string;
    /** 焦段（camera.focalLength）；沒填就不顯示 */
    lens?: string | null;
    shotSize?: string | null;
  };
  /** 已畫筆數／上限：畫布的預算是真的會滿的，要看得到 */
  strokeCount: number;
  maxStrokes: number;
}

export function StudioStage({
  canvas,
  view,
  guides,
  onToggleGuide,
  onZoomIn,
  onZoomOut,
  onFit,
  onActualSize,
  hud,
  strokeCount,
  maxStrokes,
}: StudioStageProps) {
  const anyGuideOn = FRAME_GUIDES.some((g) => guides[g.key]);
  return (
    <div className="studio-stage">
      <WhiteboardCanvas {...canvas} guides={guides} />

      {/* 左上：輔助線。分鏡的判準（安全區、三分法）要隨手開關，不該埋進設定選單 */}
      <div className="studio-stage__guides" role="group" aria-label="畫面輔助線">
        <span className="studio-stage__guides-label" aria-hidden="true">
          <Icon name="Grid" size={13} />
        </span>
        {FRAME_GUIDES.map((guide) => (
          <button
            key={guide.key}
            type="button"
            className={`studio-chipbtn${guides[guide.key] ? " is-on" : ""}`}
            aria-pressed={guides[guide.key]}
            title={`${guide.label}：${guide.detail}`}
            onClick={() => onToggleGuide(guide.key)}
          >
            {guide.label}
          </button>
        ))}
      </div>

      {/* 右下：縮放。數字本身是按鈕（點一下回 100%），這是繪圖工具的通用手勢 */}
      <div className="studio-stage__zoom" role="group" aria-label="縮放">
        <button type="button" className="studio-iconbtn" aria-label="縮小" title={`縮小（${SHORTCUT_HINTS.zoomOut}）`} onClick={onZoomOut}>
          <Icon name="ZoomOut" size={15} />
        </button>
        <button
          type="button"
          className="studio-stage__zoom-value"
          title="回到 100%"
          aria-label={`目前縮放 ${Math.round(view.scale * 100)}%，點一下回到 100%`}
          onClick={onActualSize}
        >
          {Math.round(view.scale * 100)}%
        </button>
        <button type="button" className="studio-iconbtn" aria-label="放大" title={`放大（${SHORTCUT_HINTS.zoomIn}）`} onClick={onZoomIn}>
          <Icon name="ZoomIn" size={15} />
        </button>
        <button type="button" className="studio-iconbtn" aria-label="整張放進畫面" title={`整張放進畫面（${SHORTCUT_HINTS.fit}）`} onClick={onFit}>
          <Icon name="Scan" size={15} />
        </button>
      </div>

      {/* 底部中央：這一格的規格。攝影組看板的資訊密度——一行講完，不要卡片 */}
      <div className="studio-stage__hud" aria-live="polite">
        {hud.shotNumber ? (
          <b className="studio-stage__hud-shot">第 {hud.shotNumber} 鏡</b>
        ) : (
          <b className="studio-stage__hud-shot studio-stage__hud-shot--free">自由塗鴉</b>
        )}
        {hud.durationSec != null && <span>{hud.durationSec}s</span>}
        <span>{hud.aspect}</span>
        {hud.shotSize && <span>{hud.shotSize}</span>}
        {hud.lens && <span>{hud.lens}</span>}
        <span className="studio-stage__hud-sep" aria-hidden="true" />
        <span className={strokeCount >= maxStrokes ? "is-warn" : undefined} title="白板筆畫數／上限">
          {strokeCount}/{maxStrokes} 筆
        </span>
        {anyGuideOn && (
          <span className="studio-stage__hud-guides" title="有開著的輔助線（不會被畫進成品）">
            輔助線
          </span>
        )}
      </div>
    </div>
  );
}
