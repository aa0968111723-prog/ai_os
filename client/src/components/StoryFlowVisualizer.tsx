import { Fragment, useState } from "react";
import { formatActsLine, type Worldview } from "@shared/worldview";
import { STYLE_VISUAL_ASSETS } from "./StyleVisualGallery";
import { TONE_VISUAL_META } from "./ToneVisualPalette";
import { Icon } from "./Icon";
import { Button, Hint, Meta } from "./ui";

/**
 * 故事定盤星視覺藍圖 (Story Blueprint Strip)：
 * 將文字設定（一句話故事、金句、氣氛、畫風）以可視化看板呈現，減少文字枯燥感。
 */
export function StoryFlowBlueprint({
  wv,
  onFocusField,
}: {
  wv: Worldview;
  onFocusField?: (fieldId: string) => void;
}) {
  const primaryStyle = wv.styles[0];
  const styleAsset = primaryStyle ? STYLE_VISUAL_ASSETS[primaryStyle] : null;
  const primaryTone = wv.tones[0];
  const toneMeta = primaryTone ? TONE_VISUAL_META[primaryTone] : null;

  return (
    <div className="story-blueprint-strip">
      {/* 步驟 1：這支片在講什麼 */}
      <div
        className={`story-blueprint-card ${wv.logline ? "is-filled" : "is-empty"}`}
        onClick={() => onFocusField?.("wv-logline")}
        role="button"
        tabIndex={0}
        title="點擊編輯「這支片在講什麼」"
      >
        <div className="story-blueprint-card__badge">
          <Icon name="Film" size={13} />
          <span>核心故事</span>
        </div>
        <div className="story-blueprint-card__body">
          {wv.logline ? (
            <p className="story-blueprint-card__text">{wv.logline}</p>
          ) : (
            <span className="story-blueprint-card__placeholder">
              ＋ 填寫這支片在講什麼…
            </span>
          )}
        </div>
      </div>

      <div className="story-blueprint-connector">
        <Icon name="ArrowRight" size={14} />
      </div>

      {/* 步驟 2：看完要記得哪一句 */}
      <div
        className={`story-blueprint-card ${wv.message ? "is-filled" : "is-empty"}`}
        onClick={() => onFocusField?.("wv-message")}
        role="button"
        tabIndex={0}
        title="點擊編輯「看完要記得哪一句」"
      >
        <div className="story-blueprint-card__badge">
          <Icon name="MessageSquare" size={13} />
          <span>記憶金句</span>
        </div>
        <div className="story-blueprint-card__body">
          {wv.message ? (
            <p className="story-blueprint-card__text story-blueprint-card__quote">
              「{wv.message}」
            </p>
          ) : (
            <span className="story-blueprint-card__placeholder">
              ＋ 填寫看完要記得的一句話…
            </span>
          )}
        </div>
      </div>

      <div className="story-blueprint-connector">
        <Icon name="ArrowRight" size={14} />
      </div>

      {/* 步驟 3：畫面風格與氣氛視覺 */}
      <div
        className={`story-blueprint-card ${primaryStyle ? "is-filled" : "is-empty"}`}
        onClick={() => onFocusField?.("wv-styles")}
        role="button"
        tabIndex={0}
        title="點擊調整畫風與氣氛"
      >
        <div className="story-blueprint-card__badge">
          <Icon name="Palette" size={13} />
          <span>畫面定調</span>
        </div>
        <div className="story-blueprint-card__body story-blueprint-card__visual-body">
          {styleAsset?.image ? (
            <img
              src={styleAsset.image}
              alt={primaryStyle || "畫風"}
              className="story-blueprint-card__thumb"
            />
          ) : (
            <div className="story-blueprint-card__thumb-placeholder">
              <Icon name="Image" size={16} />
            </div>
          )}
          <div className="story-blueprint-card__visual-info">
            <span className="story-blueprint-card__style-name">
              {primaryStyle || "尚未選定畫風"}
            </span>
            {primaryTone && (
              <span
                className="story-blueprint-card__tone-pill"
                style={{
                  background: toneMeta?.color ? `${toneMeta.color}25` : "var(--surface-3)",
                  color: toneMeta?.color ? toneMeta.color : "inherit",
                }}
              >
                {toneMeta?.emoji} {primaryTone}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 一幕一行的上限。
 *
 * 從 500 收到 80 是這個元件的重點，不是順手調參數：舊版三個 500 字的 textarea
 * 等於在定調頁邀請使用者寫一份縮小版腳本，寫完到分鏡再寫一次，兩份從此分岔。
 * 一行寫得下的只有骨架，正文自然會留給分鏡腳本。
 */
const ACT_LINE_MAX = 80;

const THREE_ACTS = [
  {
    key: "hook",
    badge: "🪝 第 1 幕",
    name: "開場勾子 (Hook)",
    guide: "前 3 秒抓住眼球、拋出痛點或懸念",
    placeholder: "例：深夜獨坐，說不出的累",
  },
  {
    key: "turn",
    badge: "⚡ 第 2 幕",
    name: "轉折體悟 (Turn)",
    guide: "遇見佛法與修行心境轉變之刻",
    placeholder: "例：一句開示，心門打開",
  },
  {
    key: "cta",
    badge: "🌟 第 3 幕",
    name: "昇華行動 (CTA)",
    guide: "心靈洗滌、感恩重生與行動號召",
    placeholder: "例：晨光下釋懷，邀請一起靜心",
  },
] as const;

/**
 * 三幕大綱（3-Act Story Arc）：腳本的骨架，一幕一句。
 *
 * 已有分鏡時自動收合成一行摘要——這時候真相在分鏡表，大綱只是來歷，
 * 攤開三個輸入框只會讓人以為那裡還要再寫一次。
 */
export function ThreeActStoryArc({
  acts,
  canEdit,
  onChange,
  sceneCount = 0,
  onSplitFromOutline,
  splitting = false,
  splitError = null,
  onSeeScenes,
}: {
  acts: { hook: string; turn: string; cta: string };
  canEdit: boolean;
  onChange: (key: "hook" | "turn" | "cta", value: string) => void;
  /** 目前分鏡數；> 0 時預設收合並改標「以分鏡為準」 */
  sceneCount?: number;
  /** 用這份大綱直接拆分鏡；不給就不顯示按鈕（例如唯讀成員） */
  onSplitFromOutline?: () => void;
  splitting?: boolean;
  splitError?: string | null;
  /** 已有分鏡時，帶使用者去看實際的分鏡表 */
  onSeeScenes?: () => void;
}) {
  const hasScenes = sceneCount > 0;
  const filled = !!formatActsLine(acts);
  // null＝還沒手動開關過，跟著「有沒有分鏡」走；scenes 是非同步回來的，所以不能用 useState 初值鎖死
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? !hasScenes;

  return (
    <div className="three-act-story-arc" data-fb="三幕大綱">
      <div className="three-act-header">
        <button
          type="button"
          className="three-act-header__toggle"
          aria-expanded={open}
          onClick={() => setManualOpen(!open)}
        >
          <Icon name={open ? "ChevronDown" : "ChevronRight"} size={13} />
          <span className="three-act-header__title">
            <Icon name="Layers" size={14} />
            三幕大綱
          </span>
        </button>
        <span className="three-act-header__hint">
          {hasScenes ? (
            <>
              已有 {sceneCount} 鏡・實際結構以分鏡為準
              {onSeeScenes && (
                <button type="button" className="three-act-header__link" onClick={onSeeScenes}>
                  看分鏡
                </button>
              )}
            </>
          ) : (
            "一幕一句，當拆分鏡的骨架"
          )}
        </span>
      </div>

      {!open && (
        <p className="three-act-collapsed-summary">
          {filled ? formatActsLine(acts) : "尚未寫大綱"}
        </p>
      )}

      {open && (
        <>
          <div className="three-act-timeline">
            {THREE_ACTS.map((act, i) => (
              <Fragment key={act.key}>
                {i > 0 && (
                  <div className="three-act-arrow">
                    <Icon name="ChevronRight" size={18} />
                  </div>
                )}
                <div className={`three-act-stage stage-${act.key} ${acts[act.key] ? "is-active" : ""}`}>
                  <div className="three-act-stage__header">
                    <span className="three-act-stage__badge">{act.badge}</span>
                    <span className="three-act-stage__name">{act.name}</span>
                  </div>
                  <span className="three-act-stage__guide">{act.guide}</span>
                  <input
                    key={`${act.key}-${acts[act.key]}`}
                    className="three-act-stage__input"
                    aria-label={act.name}
                    defaultValue={acts[act.key]}
                    readOnly={!canEdit}
                    maxLength={ACT_LINE_MAX}
                    placeholder={act.placeholder}
                    onBlur={(e) => {
                      if (canEdit && e.target.value !== acts[act.key]) {
                        onChange(act.key, e.target.value);
                      }
                    }}
                  />
                </div>
              </Fragment>
            ))}
          </div>

          <Hint style={{ marginTop: 6, fontSize: 12 }}>
            這裡只寫<strong>骨架</strong>（一幕一句）；一鏡一鏡的畫面與旁白寫在分鏡。
            出圖不吃這一段，只給寫腳本／拆分鏡的 AI。
          </Hint>

          {onSplitFromOutline && !hasScenes && (
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Button
                variant="primary"
                size="sm"
                disabled={!filled || splitting}
                onClick={onSplitFromOutline}
              >
                {splitting ? "拆分鏡中…" : "用大綱拆分鏡"}
              </Button>
              <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>
                {filled ? "AI 會把三句大綱擴寫成 6～12 鏡草稿" : "先寫一句以上才能拆"}
              </Meta>
            </div>
          )}
          {splitError && <p className="error" role="alert">拆分鏡失敗：{splitError}</p>}
        </>
      )}
    </div>
  );
}
