import { type ReactNode } from "react";
import { TONE_EN } from "@shared/worldview";
import { Icon } from "./Icon";
import { Chip, Meta, Hint } from "./ui";

export const TONE_VISUAL_META: Record<
  string,
  {
    icon: string;
    tagline: string;
    gradient: string;
    color: string;
    emoji: string;
  }
> = {
  "溫暖": {
    icon: "Sun",
    emoji: "🌅",
    tagline: "柔和陽光・撫慰人心",
    gradient: "linear-gradient(135deg, #f59e0b, #ef4444)",
    color: "#f59e0b",
  },
  "莊嚴": {
    icon: "Shield",
    emoji: "🕯️",
    tagline: "高雅神聖・沉穩份量",
    gradient: "linear-gradient(135deg, #4338ca, #d97706)",
    color: "#4338ca",
  },
  "真誠": {
    icon: "Heart",
    emoji: "🕊️",
    tagline: "純粹坦率・真摯動人",
    gradient: "linear-gradient(135deg, #0284c7, #6366f1)",
    color: "#0284c7",
  },
  "療癒": {
    icon: "Smile",
    emoji: "🌿",
    tagline: "如沐春風・身心放鬆",
    gradient: "linear-gradient(135deg, #059669, #10b981)",
    color: "#059669",
  },
  "活潑": {
    icon: "Zap",
    emoji: "✨",
    tagline: "朝氣蓬勃・節奏明快",
    gradient: "linear-gradient(135deg, #ec4899, #f97316)",
    color: "#ec4899",
  },
  "簡約": {
    icon: "Square",
    emoji: "⚪",
    tagline: "留白俐落・純粹洗鍊",
    gradient: "linear-gradient(135deg, #475569, #64748b)",
    color: "#475569",
  },
};

export interface ToneVisualPaletteProps {
  tones: string[];
  options: string[];
  labelledBy: string;
  canEdit: boolean;
  onToggle: (tone: string) => void;
  onPromote: (tone: string) => void;
  renderAddOption?: ReactNode;
  orphans?: string[];
  isLoading?: boolean;
}

export function ToneVisualPalette({
  tones,
  options,
  labelledBy,
  canEdit,
  onToggle,
  onPromote,
  renderAddOption,
  orphans = [],
  isLoading = false,
}: ToneVisualPaletteProps) {
  const overSoft = tones.length > 2;
  const nonPrimary = tones.slice(1);

  return (
    <div className="tone-visual-palette" role="group" aria-labelledby={labelledBy}>
      <div className="tone-visual-grid">
        {options.map((name) => {
          const idx = tones.indexOf(name);
          const isSelected = idx !== -1;
          const isPrimary = idx === 0;
          const isSecondary = idx === 1;
          const meta = TONE_VISUAL_META[name];
          const en = TONE_EN[name];

          return (
            <button
              key={name}
              type="button"
              className={`tone-card ${isSelected ? "is-selected" : ""} ${isPrimary ? "is-primary" : ""}`}
              onClick={() => onToggle(name)}
              title={
                isSelected
                  ? `${name}（已選・點擊取消）`
                  : `選擇 ${name} 調性`
              }
              aria-pressed={isSelected}
            >
              {/* 背景氛圍光效 */}
              <div
                className="tone-card__glow"
                style={{
                  background: meta?.gradient ?? "var(--surface-3)",
                }}
              />

              <div className="tone-card__header">
                <span className="tone-card__emoji">{meta?.emoji ?? "✨"}</span>
                <span className="tone-card__name">{name}</span>
                {isSelected && (
                  <span className={`tone-card__rank ${isPrimary ? "is-rank-1" : "is-rank-2"}`}>
                    {isPrimary ? "#1 主要" : isSecondary ? "#2 次要" : `#${idx + 1}`}
                  </span>
                )}
              </div>

              {meta?.tagline && <span className="tone-card__tagline">{meta.tagline}</span>}

              {en && <span className="tone-card__en">{en}</span>}
            </button>
          );
        })}

        {renderAddOption}
      </div>

      {/* 孤兒選項 */}
      {orphans.map((t) => {
        const isSelected = tones.includes(t);
        return (
          <Chip
            key={`orphan-tone-${t}`}
            selected={isSelected}
            style={{ borderStyle: "dashed", opacity: 0.75, marginTop: 6 }}
            title="此選項已移出清單；點一下保留或取消"
            onClick={() => onToggle(t)}
          >
            {t} <Icon name="Info" size={12} style={{ verticalAlign: "-2px" }} />
          </Chip>
        );
      })}

      {/* 設主要與調性順序調整 */}
      {nonPrimary.length > 0 && canEdit && (
        <div className="tone-order-row">
          <Meta style={{ fontSize: 12 }}>
            點擊設為主要（第一順位）：
            {nonPrimary.map((t) => (
              <button
                key={t}
                type="button"
                className="linkish tone-promote-btn"
                onClick={() => onPromote(t)}
                title={`將「${t}」升為主要調性`}
              >
                {t}
              </button>
            ))}
          </Meta>
        </div>
      )}

      {overSoft && (
        <Hint
          layer="always"
          style={{ display: "block", marginTop: 6, fontSize: 12, color: "var(--warn, #b45309)" }}
        >
          已選 {tones.length} 個——畫面調性建議 1～2 個，出圖只會取前 2 個。
        </Hint>
      )}

      {isLoading && !options.length && <Meta>載入中…</Meta>}
    </div>
  );
}
