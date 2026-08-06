import { PROJECT_FORMATS, formatMeta, type ProjectFormat } from "@shared/models";
import { Hint, Meta } from "./ui";

/**
 * 畫面尺寸的視覺化挑選器（比例圖）。
 *
 * 為什麼要畫圖：「16:9／9:16／1:1」對非技術夥伴是三串數字，看不出哪個是直的哪個是橫的；
 * 尺寸挑錯要整支重生成，成本是真的點數。這裡把每個比例畫成等比例的小方框，
 * 一眼就分得出橫、方、直，再配一行白話用途（YouTube 橫式／限動直式…）與交付像素。
 *
 * 可選比例＝模型實際吃得下的全部比例（shared/models 的 PROJECT_FORMATS），
 * 不再只開三種；模型若只支援其中幾種，生成時由 nearestFormat 就近對應。
 */

/** 等比例小方框：框在 box×box 的格子裡，長邊貼齊格子、短邊按比例縮。 */
export function FormatSwatch({
  format,
  box = 26,
  color = "currentColor",
}: {
  format: string | null | undefined;
  /** 外框格子邊長（px） */
  box?: number;
  color?: string;
}) {
  const meta = formatMeta(format);
  const w = meta.ratio >= 1 ? box : box * meta.ratio;
  const h = meta.ratio >= 1 ? box / meta.ratio : box;
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        width: box,
        height: box,
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      <span
        style={{
          display: "block",
          width: Math.max(3, Math.round(w)),
          height: Math.max(3, Math.round(h)),
          border: `1.5px solid ${color}`,
          borderRadius: 3,
          background: "color-mix(in srgb, currentColor 12%, transparent)",
        }}
      />
    </span>
  );
}

/** 一行文字版：小方框＋比例＋像素（專案抬頭、清單列等只需要「看一眼」的地方） */
export function FormatTag({ format, showPixels = true }: { format: string | null | undefined; showPixels?: boolean }) {
  const meta = formatMeta(format);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, verticalAlign: "-6px" }}>
      <FormatSwatch format={meta.id} box={16} />
      <span>{meta.id}</span>
      {showPixels && <Meta as="span">{meta.width}×{meta.height}</Meta>}
    </span>
  );
}

export function FormatPicker({
  value,
  onChange,
  disabled,
  /** 指向外部標題的 id（用 aria-labelledby 綁，不重複畫一個標題） */
  labelledBy,
  /** 只想顯示部分比例時傳（預設全部） */
  formats,
}: {
  value: string | null | undefined;
  onChange: (format: ProjectFormat) => void;
  disabled?: boolean;
  labelledBy?: string;
  formats?: ProjectFormat[];
}) {
  const list = formats ? PROJECT_FORMATS.filter((f) => formats.includes(f.id)) : PROJECT_FORMATS;
  const current = formatMeta(value).id;
  return (
    <div>
      <div
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : "畫面尺寸"}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))",
          gap: 8,
          marginTop: 6,
        }}
      >
        {list.map((f) => {
          const selected = f.id === current;
          return (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              title={`${f.id}・${f.use}・${f.width}×${f.height}`}
              onClick={() => onChange(f.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: "var(--r-12)",
                border: selected ? "1.5px solid var(--primary)" : "1px solid var(--border-soft)",
                background: selected ? "color-mix(in srgb, var(--primary) 10%, var(--card))" : "var(--card)",
                color: selected ? "var(--primary-ink)" : "inherit",
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              <FormatSwatch format={f.id} box={28} />
              <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: "var(--fs-13)" }}>{f.id}</span>
                <Meta as="span" style={{ fontSize: 11, lineHeight: 1.3 }}>{f.use}</Meta>
                <Meta as="span" style={{ fontSize: 10 }}>{f.width}×{f.height}</Meta>
              </span>
            </button>
          );
        })}
      </div>
      <Hint style={{ marginTop: 6 }}>
        小方框就是實際畫面的形狀：橫的適合 YouTube 與簡報，直的適合 Shorts／Reels／限動，方的適合社群貼文。
        少數模型只支援部分比例，生成時會自動改用最接近的那一種。
      </Hint>
    </div>
  );
}
