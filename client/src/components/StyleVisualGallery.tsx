import { useState, type ReactNode } from "react";
import {
  STYLE_FAMILY_ORDER,
  STYLE_FAMILY_META,
  STYLE_MEDIA_FAMILY,
  STYLE_LOOK_ROLE,
  STYLE_EN,
  looksForFamily,
  texturesForFamily,
  parseWorldviewStyleSlots,
  stylesForVisualInject,
  formatWorldviewStylesLabel,
  keepPrimaryWorldviewStyle,
  type StyleMediaFamily,
  type Worldview,
} from "@shared/worldview";
import { Icon } from "./Icon";
import { Chip, Meta, Hint } from "./ui";
import { STYLE_VISUAL_ASSETS, StyleImage, styleAssetOf } from "./StyleImage";

// 資產表本體搬到 StyleImage.tsx（與 <picture>／LQIP 邏輯放在一起）；
// 這裡再匯出一次，既有引用（StoryFlowVisualizer、WorldviewExampleCard、測試）不必改路徑。
export { STYLE_VISUAL_ASSETS } from "./StyleImage";

export interface StyleVisualGalleryProps {
  styles: string[];
  styleOpts: string[];
  labelledBy: string;
  canEdit: boolean;
  isLeader?: boolean;
  styleFamilyTab: StyleMediaFamily | null;
  onPickFamily: (fam: StyleMediaFamily) => void;
  onToggleStyle: (style: string) => void;
  onKeepPrimary: () => void;
  renderAddOption?: ReactNode;
  orphans?: string[];
  isLoading?: boolean;
}

export function StyleVisualGallery({
  styles,
  styleOpts,
  labelledBy,
  canEdit,
  isLeader,
  styleFamilyTab,
  onPickFamily,
  onToggleStyle,
  onKeepPrimary,
  renderAddOption,
  orphans = [],
  isLoading = false,
}: StyleVisualGalleryProps) {
  const [viewMode, setViewMode] = useState<"visual" | "compact">("visual");

  const slots = parseWorldviewStyleSlots(styles);
  const inject = stylesForVisualInject(styles);
  const activeFamily: StyleMediaFamily | null = styleFamilyTab ?? slots.family;
  const lookOpts = activeFamily ? looksForFamily(activeFamily) : [];
  const textureOpts = activeFamily ? texturesForFamily(activeFamily) : [];
  const customOpts = styleOpts.filter((s) => !STYLE_MEDIA_FAMILY[s]);
  const canonical = keepPrimaryWorldviewStyle(styles);
  const dirty =
    styles.length !== canonical.length || styles.some((v, i) => v !== canonical[i]);

  // 當前選中的主風格 meta
  const currentLookMeta = styleAssetOf(slots.look);

  return (
    <div className="style-visual-gallery" role="group" aria-labelledby={labelledBy}>
      {/* 頂部切換條：媒材家族選擇器 ＋ 視覺/精簡檢視切換 */}
      <div className="style-gallery-header">
        <div className="style-family-bar" role="radiogroup" aria-label="媒材家族">
          <span className="style-family-label">媒材家族：</span>
          {STYLE_FAMILY_ORDER.map((fam) => {
            const meta = STYLE_FAMILY_META[fam];
            const on = activeFamily === fam;
            return (
              <button
                key={fam}
                type="button"
                role="radio"
                aria-checked={on}
                className={`style-family-tab ${on ? "is-active" : ""}`}
                title={`${meta.label}：${meta.hint}`}
                onClick={() => onPickFamily(fam)}
              >
                <span className="style-family-tab__icon">
                  {fam === "photo" ? "📸" : fam === "illustrate" ? "🎨" : "🧊"}
                </span>
                <span className="style-family-tab__label">{meta.label}</span>
                <span className="style-family-tab__hint">{meta.hint}</span>
              </button>
            );
          })}
        </div>

        {/* 檢視切換 */}
        <div className="style-view-mode-toggle" role="group" aria-label="檢視模式">
          <button
            type="button"
            className={`style-view-btn ${viewMode === "visual" ? "active" : ""}`}
            title="視覺卡片模式（帶範例縮圖）"
            onClick={() => setViewMode("visual")}
          >
            <Icon name="Grid" size={13} />
            <span>卡片</span>
          </button>
          <button
            type="button"
            className={`style-view-btn ${viewMode === "compact" ? "active" : ""}`}
            title="精簡標籤模式"
            onClick={() => setViewMode("compact")}
          >
            <Icon name="List" size={13} />
            <span>標籤</span>
          </button>
        </div>
      </div>

      {/* 視覺卡片檢視 */}
      {viewMode === "visual" ? (
        <div className="style-card-grid-container">
          {activeFamily && (
            <div className="style-card-section">
              <div className="style-section-title">
                <span>主風格（{STYLE_FAMILY_META[activeFamily].label}・擇一）</span>
                <span className="style-section-sub">點擊選為整支片的主要視覺基底</span>
              </div>

              <div className="style-card-grid">
                {lookOpts.map((name, i) => {
                  const on = slots.look === name;
                  const asset = styleAssetOf(name);
                  const en = STYLE_EN[name];

                  return (
                    <button
                      key={name}
                      type="button"
                      className={`style-visual-card ${on ? "is-selected" : ""}`}
                      onClick={() => onToggleStyle(name)}
                      title={on ? `${name}（目前主風格・點擊取消）` : `設為 ${name}`}
                      aria-pressed={on}
                    >
                      <div className="style-visual-card__media">
                        {/* 底層漸層：圖還沒到／載入失敗時都有底色，不會出現空白破框 */}
                        <div
                          className="style-visual-card__fallback-gradient"
                          style={{
                            background: asset?.color
                              ? `linear-gradient(135deg, ${asset.color}55, ${asset.color}18)`
                              : "var(--surface-3)",
                          }}
                        />
                        <StyleImage
                          asset={asset}
                          alt={name}
                          variant="card"
                          className="style-visual-card__img"
                          // 前兩張是進頁就看得到的，不延後載入；其餘交給 lazy
                          eager={i < 2}
                        />

                        {on && (
                          <div className="style-visual-card__badge-selected">
                            <Icon name="Check" size={12} />
                            <span>主風格</span>
                          </div>
                        )}
                      </div>

                      <div className="style-visual-card__body">
                        <div className="style-visual-card__name-row">
                          <span className="style-visual-card__title">{name}</span>
                          {en && <span className="style-visual-card__en">{en}</span>}
                        </div>
                        {asset?.tagline && (
                          <p className="style-visual-card__desc">{asset.tagline}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* 同家族質感 (Texture / Grain) */}
              {textureOpts.length > 0 && (
                <div className="style-texture-section">
                  <div className="style-section-title">
                    <span className="style-section-title__badge">質感疊加</span>
                    <span>同家族質感（可選・與主風格並存）</span>
                  </div>
                  <div className="style-texture-grid">
                    {textureOpts.map((t) => {
                      const on = slots.texture === t;
                      const asset = styleAssetOf(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          className={`style-texture-card ${on ? "is-selected" : ""}`}
                          onClick={() => onToggleStyle(t)}
                          aria-pressed={on}
                          title={on ? `${t}（已疊加質感・點擊取消）` : `疊加 ${t}`}
                        >
                          <StyleImage
                            asset={asset}
                            alt={t}
                            variant="thumb"
                            className="style-texture-card__thumb"
                          />
                          <div className="style-texture-card__info">
                            <div className="style-texture-card__header">
                              <span className="style-texture-card__name">{t}</span>
                              {on && <span className="style-texture-card__active-pill">已套用</span>}
                            </div>
                            <span className="style-texture-card__desc">
                              {asset?.tagline ?? "疊加顆粒與層次質感"}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* 精簡標籤檢視 */
        <div className="style-compact-chips">
          {activeFamily && (
            <>
              <Meta style={{ display: "block", marginTop: 8, marginBottom: 6, fontSize: 12 }}>
                主風格（{STYLE_FAMILY_META[activeFamily].label}・擇一）
              </Meta>
              <div className="style-chip-row">
                {lookOpts.map((t) => {
                  const on = slots.look === t;
                  return (
                    <Chip
                      key={t}
                      selected={on}
                      onClick={() => onToggleStyle(t)}
                      title={on ? "目前主風格（再點取消全部風格）" : "設為主風格"}
                    >
                      {on && (
                        <Meta
                          as="span"
                          style={{
                            marginRight: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--primary-ink)",
                          }}
                        >
                          主
                        </Meta>
                      )}
                      {t}
                    </Chip>
                  );
                })}
              </div>

              {textureOpts.length > 0 && (
                <>
                  <Meta style={{ display: "block", marginTop: 10, marginBottom: 6, fontSize: 12 }}>
                    質感（可選・與主風格同家族）
                  </Meta>
                  <div className="style-chip-row">
                    {textureOpts.map((t) => {
                      const on = slots.texture === t;
                      return (
                        <Chip
                          key={t}
                          selected={on}
                          onClick={() => onToggleStyle(t)}
                          title={on ? "取消質感" : "加上質感（可與主風格並存注入）"}
                        >
                          {on && (
                            <Meta
                              as="span"
                              style={{
                                marginRight: 4,
                                fontSize: 11,
                                fontWeight: 600,
                                color: "var(--primary-ink)",
                              }}
                            >
                              質感
                            </Meta>
                          )}
                          {t}
                        </Chip>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* 自訂風格區塊 */}
      {(customOpts.length > 0 || (isLeader && canEdit)) && (
        <div className="style-custom-section">
          <Meta style={{ display: "block", marginTop: 12, marginBottom: 6, fontSize: 12 }}>
            自訂風格（准單選・無家族映射）
          </Meta>
          <div className="style-chip-row">
            {customOpts.map((t) => {
              const on = styles.length === 1 && styles[0] === t;
              return (
                <Chip
                  key={t}
                  selected={on}
                  onClick={() => onToggleStyle(t)}
                  title={on ? "目前出圖風格（再點取消）" : "設為出圖風格（取代內建選擇）"}
                >
                  {on && (
                    <Meta
                      as="span"
                      style={{
                        marginRight: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--primary-ink)",
                      }}
                    >
                      出圖
                    </Meta>
                  )}
                  {t}
                </Chip>
              );
            })}
            {renderAddOption}
          </div>
        </div>
      )}

      {/* 孤兒選項提示 */}
      {orphans.map((t) => (
        <Chip
          key={`orphan-style-${t}`}
          selected
          style={{ borderStyle: "dashed", opacity: 0.75, marginTop: 6 }}
          title="此選項已移出清單；點一下套用收斂規則或取消"
          onClick={() => onToggleStyle(t)}
        >
          {t} <Icon name="Info" size={12} style={{ verticalAlign: "-2px" }} />
        </Chip>
      ))}

      {/* 視覺出圖風格摘要看板 (Active Style Showcase Banner) */}
      <div className="style-summary-banner" aria-live="polite">
        <div className="style-summary-banner__thumb">
          {currentLookMeta ? (
            <StyleImage
              asset={currentLookMeta}
              alt={slots.look || "風格縮圖"}
              variant="thumb"
              eager
            />
          ) : (
            <div className="style-summary-banner__placeholder">
              <Icon name="Image" size={16} />
            </div>
          )}
        </div>
        <div className="style-summary-banner__content">
          <div className="style-summary-banner__title">
            <span>出圖風格：</span>
            {inject.length ? (
              <strong className="style-summary-banner__label">
                {formatWorldviewStylesLabel(inject)}
              </strong>
            ) : (
              <span className="style-summary-banner__unset">尚未選擇（預設無特定風格）</span>
            )}
            {slots.family && (
              <span className="style-summary-banner__fam-badge">
                {STYLE_FAMILY_META[slots.family].label}家族
              </span>
            )}
          </div>
          {slots.look && STYLE_EN[slots.look] && (
            <div className="style-summary-banner__en-prompt">
              <span>模型英文字眼：</span>
              <code>{STYLE_EN[slots.look]}</code>
              {slots.texture && STYLE_EN[slots.texture] && (
                <code> + {STYLE_EN[slots.texture]}</code>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 資料需收斂按鈕 */}
      {canEdit && dirty && (
        <Meta style={{ display: "block", marginTop: 6, fontSize: 12 }}>
          資料需收斂——
          <button
            type="button"
            className="linkish"
            style={{
              marginLeft: 4,
              fontSize: 12,
              border: 0,
              background: "none",
              cursor: "pointer",
              color: "var(--primary-ink)",
              textDecoration: "underline",
              fontWeight: 600,
            }}
            onClick={onKeepPrimary}
          >
            一鍵只留「{formatWorldviewStylesLabel(canonical) || canonical[0] || "可注入項"}」
          </button>
        </Meta>
      )}

      {isLoading && !styleOpts.length && <Meta>載入中…</Meta>}
    </div>
  );
}
