import { type Worldview } from "@shared/worldview";
import { StyleImage, styleAssetOf } from "./StyleImage";
import { TONE_VISUAL_META } from "./ToneVisualPalette";
import { Icon } from "./Icon";
import { Meta } from "./ui";

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
  const styleAsset = styleAssetOf(primaryStyle);
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
          {styleAsset ? (
            <StyleImage
              asset={styleAsset}
              alt={primaryStyle || "畫風"}
              variant="thumb"
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
 * 三幕劇可視化圖表 (3-Act Story Arc Diagram)
 */
export function ThreeActStoryArc({
  acts,
  canEdit,
  onChange,
}: {
  acts: { hook: string; turn: string; cta: string };
  canEdit: boolean;
  onChange: (key: "hook" | "turn" | "cta", value: string) => void;
}) {
  return (
    <div className="three-act-story-arc">
      <div className="three-act-header">
        <span className="three-act-header__title">
          <Icon name="Layers" size={14} />
          三幕劇視覺結構（寫腳本與分鏡 AI 專用）
        </span>
        <span className="three-act-header__hint">引導 AI 掌握節奏起伏</span>
      </div>

      <div className="three-act-timeline">
        {/* 第 1 幕：開場勾子 */}
        <div className={`three-act-stage stage-hook ${acts.hook ? "is-active" : ""}`}>
          <div className="three-act-stage__header">
            <span className="three-act-stage__badge">🪝 第 1 幕</span>
            <span className="three-act-stage__name">開場勾子 (Hook)</span>
          </div>
          <span className="three-act-stage__guide">前 3 秒抓住眼球、拋出痛點或懸念</span>
          <textarea
            key={`hook-${acts.hook}`}
            className="three-act-stage__input"
            defaultValue={acts.hook}
            readOnly={!canEdit}
            maxLength={500}
            rows={2}
            placeholder="例：陳師姐在深夜禪房獨坐，眼中帶著迷惘與疲憊…"
            onBlur={(e) => {
              if (canEdit && e.target.value !== acts.hook) {
                onChange("hook", e.target.value);
              }
            }}
          />
        </div>

        <div className="three-act-arrow">
          <Icon name="ChevronRight" size={18} />
        </div>

        {/* 第 2 幕：轉折與體悟 */}
        <div className={`three-act-stage stage-turn ${acts.turn ? "is-active" : ""}`}>
          <div className="three-act-stage__header">
            <span className="three-act-stage__badge">⚡ 第 2 幕</span>
            <span className="three-act-stage__name">轉折體悟 (Turn)</span>
          </div>
          <span className="three-act-stage__guide">遇見佛法與修行心境轉變之刻</span>
          <textarea
            key={`turn-${acts.turn}`}
            className="three-act-stage__input"
            defaultValue={acts.turn}
            readOnly={!canEdit}
            maxLength={500}
            rows={2}
            placeholder="例：師父的一句開示如醍醐灌頂，心門頓時敞開…"
            onBlur={(e) => {
              if (canEdit && e.target.value !== acts.turn) {
                onChange("turn", e.target.value);
              }
            }}
          />
        </div>

        <div className="three-act-arrow">
          <Icon name="ChevronRight" size={18} />
        </div>

        {/* 第 3 幕：昇華與行動 */}
        <div className={`three-act-stage stage-cta ${acts.cta ? "is-active" : ""}`}>
          <div className="three-act-stage__header">
            <span className="three-act-stage__badge">🌟 第 3 幕</span>
            <span className="three-act-stage__name">昇華行動 (CTA)</span>
          </div>
          <span className="three-act-stage__guide">心靈洗滌、感恩重生與行動號召</span>
          <textarea
            key={`cta-${acts.cta}`}
            className="three-act-stage__input"
            defaultValue={acts.cta}
            readOnly={!canEdit}
            maxLength={500}
            rows={2}
            placeholder="例：晨光中露出釋懷笑容，邀請觀眾一同體會心靈平靜…"
            onBlur={(e) => {
              if (canEdit && e.target.value !== acts.cta) {
                onChange("cta", e.target.value);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
