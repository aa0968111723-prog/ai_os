/**
 * Top Workspace Bar：創作時畫面上方只該有「這支片、這一場、這一鏡」與最少的動作。
 *
 * 全站導航（今日／私訊／資料中心／靈感頻道…）在創作室一律讓開——那是「換一件事做」
 * 的入口，而這裡的人正在做一件事。讓開的機制沿用既有的 `body.studio-immersive`
 * （studio.css 已經有整套規則），差別只是現在**進站即沉浸**，不必先按全螢幕。
 * 回全站的路留在最左邊的麵包屑，不是藏起來。
 */
import { Link } from "wouter";
import { Icon } from "../../components/Icon";
import { Button, Meta } from "../../components/ui";
import { SHORTCUT_HINTS } from "./studioShortcuts";

export interface StudioHeaderProps {
  projectId: string;
  projectTitle: string;
  /** 這一鏡屬於哪一場（story_scenes）；null＝未分場或還沒解析 */
  sceneName: string | null;
  /** 全片第幾鏡（1 起算）；null＝自由塗鴉未選鏡 */
  shotNumber: number | null;
  /** Live leftover: 1280 header said Shot 03; only the timeline had「26 鏡・125s」. */
  shotCount: number;
  shotTitle: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** 本機手稿的存檔狀態：白板是離線優先的，要讓人知道「畫的東西在不在」 */
  saveLabel: string;
  /** 有幾個人也在這個專案裡（沿用專案頁的協作 presence 數字；0＝只有自己） */
  peerCount?: number;
  immersive: boolean;
  onToggleImmersive: () => void;
  /** 打開粗剪預覽（走 ④ 成片的既有播放器） */
  onPreview: () => void;
  /** 更多：分享、匯出 PNG、說明 */
  onMore: () => void;
  moreOpen: boolean;
}

export function StudioHeader({
  projectId,
  projectTitle,
  sceneName,
  shotNumber,
  shotCount,
  shotTitle,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  saveLabel,
  peerCount = 0,
  immersive,
  onToggleImmersive,
  onPreview,
  onMore,
  moreOpen,
}: StudioHeaderProps) {
  return (
    <header className="studio-topbar">
      {/* 麵包屑：專案 → 場 → 鏡。層級用字級與顏色分，不是三個一樣大的字串 */}
      <nav className="studio-crumbs" aria-label="目前位置">
        <Link href={`/p/${projectId}`} className="studio-crumbs__back" title="回到專案頁">
          <Icon name="ArrowLeft" size={15} />
          <span>返回專案</span>
        </Link>
        <span className="studio-crumbs__sep" aria-hidden="true">/</span>
        <span className="studio-crumbs__project" title={projectTitle}>{projectTitle}</span>
        {sceneName && (
          <>
            <span className="studio-crumbs__sep" aria-hidden="true">/</span>
            <span className="studio-crumbs__scene" title={sceneName}>{sceneName}</span>
          </>
        )}
        <span className="studio-crumbs__sep" aria-hidden="true">/</span>
        <span className="studio-crumbs__shot">
          {shotNumber
            ? (shotCount > 0 ? `第 ${shotNumber} / ${shotCount} 鏡` : `第 ${shotNumber} 鏡`)
            : "自由塗鴉"}
          {shotTitle && <span className="studio-crumbs__shot-title">{shotTitle}</span>}
        </span>
      </nav>

      <div className="studio-topbar__center" role="toolbar" aria-label="編輯歷史">
        <button
          type="button"
          className="studio-iconbtn"
          aria-label="復原"
          title={`復原（${SHORTCUT_HINTS.undo}）`}
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Icon name="Undo2" size={16} />
        </button>
        <button
          type="button"
          className="studio-iconbtn"
          aria-label="重做"
          title={`重做（${SHORTCUT_HINTS.redo}）`}
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Icon name="RotateCw" size={16} />
        </button>
        <Meta as="span" className="studio-topbar__save" aria-live="polite">{saveLabel}</Meta>
      </div>

      <div className="studio-topbar__right">
        {peerCount > 0 && (
          <span className="studio-topbar__peers" title={`還有 ${peerCount} 人在這個專案裡`}>
            <Icon name="Users" size={14} />
            {peerCount}
          </span>
        )}
        <button
          type="button"
          className="studio-iconbtn"
          aria-label={immersive ? "離開全螢幕" : "全螢幕"}
          title={`${immersive ? "離開全螢幕" : "全螢幕"}（${SHORTCUT_HINTS.toggleImmersive}）`}
          aria-pressed={immersive}
          onClick={onToggleImmersive}
        >
          <Icon name={immersive ? "Shrink" : "Expand"} size={16} />
        </button>
        <Button size="sm" variant="primary" onClick={onPreview}>
          <Icon name="Play" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
          預覽
        </Button>
        <button
          type="button"
          className="studio-iconbtn"
          aria-label="更多"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          title="更多（分享、匯出、說明）"
          onClick={onMore}
        >
          <Icon name="Ellipsis" size={16} />
        </button>
      </div>
    </header>
  );
}
