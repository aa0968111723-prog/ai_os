import type { MechanicsStage } from "@shared/modelMechanics";

/**
 * 模型運作的結構圖（SVG）。
 *
 * 這裡刻意**不畫任何「生成結果」的示意圖**。畫一張卡通的太陽草地假裝那是模型的
 * 輸出，既不是本次的中間結果（模型不回傳中間潛變數），也讓整個面板看起來像草稿。
 * 每一格改畫這一關真正處理的**資料結構**：token 序列、注意力矩陣、潛空間 patch
 * 網格、像素網格、影格堆疊。結構是公開且確定的事實，畫出來不必假造任何內容。
 *
 * 視覺語言統一：1px 髮絲線、單色描邊、選中才上主色。不用實心色塊與圓角卡通。
 */

/** 每一關畫哪一種結構符號 */
type GlyphKind = "tokens" | "matrix" | "patches" | "pixels" | "frames" | "block";

/**
 * 階段 key → 結構符號。key 來自 shared/modelMechanics 的階段定義；
 * 對不上的（各家特化階段）退回一般方塊，不硬湊一個看起來很懂的圖。
 */
const GLYPH: Record<string, GlyphKind> = {
  encoder: "tokens",
  tokenize: "tokens",
  "cross-attn": "matrix",
  "double-stream": "matrix",
  "single-stream": "matrix",
  attention: "matrix",
  patchify: "patches",
  latent: "patches",
  decode: "pixels",
  temporal: "frames",
};

const CELL = 52;
const GAP = 14;
const LABEL_TOP = CELL + 13;
const HEIGHT = LABEL_TOP + 16;

function Glyph({ kind, stroke }: { kind: GlyphKind; stroke: string }) {
  const common = { fill: "none", stroke, strokeWidth: 1 };
  switch (kind) {
    case "tokens":
      // token 序列：等寬格子一排，尾端虛線＝窗口之外還有字但進不去
      return (
        <g>
          {[0, 1, 2, 3].map((index) => (
            <rect key={index} x={6 + index * 10} y={CELL / 2 - 6} width={8} height={12} rx={1.5} {...common} />
          ))}
          <rect x={46} y={CELL / 2 - 6} width={8} height={12} rx={1.5} {...common} strokeDasharray="2 2" />
        </g>
      );
    case "matrix":
      // 注意力矩陣的**結構**：列＝查詢位置、行＝被查位置。不畫權重值——那是模型內部，拿不到。
      return (
        <g>
          <rect x={12} y={12} width={28} height={28} {...common} />
          {[1, 2, 3].map((index) => (
            <g key={index}>
              <line x1={12 + index * 7} y1={12} x2={12 + index * 7} y2={40} {...common} strokeOpacity={0.5} />
              <line x1={12} y1={12 + index * 7} x2={40} y2={12 + index * 7} {...common} strokeOpacity={0.5} />
            </g>
          ))}
          <line x1={12} y1={19} x2={40} y2={19} stroke={stroke} strokeWidth={2} />
          <line x1={26} y1={12} x2={26} y2={40} stroke={stroke} strokeWidth={2} />
        </g>
      );
    case "patches":
      // 潛空間：切成 patch 的低解析網格
      return (
        <g>
          {[0, 1, 2, 3].map((row) =>
            [0, 1, 2, 3].map((col) => (
              <rect key={`${row}-${col}`} x={12 + col * 7} y={12 + row * 7} width={7} height={7} {...common} strokeOpacity={0.7} />
            )),
          )}
        </g>
      );
    case "pixels":
      // 解碼後：同樣面積、密度高得多的像素網格
      return (
        <g>
          <rect x={12} y={12} width={28} height={28} {...common} />
          {[1, 2, 3, 4, 5, 6].map((index) => (
            <g key={index}>
              <line x1={12 + index * 4} y1={12} x2={12 + index * 4} y2={40} {...common} strokeOpacity={0.35} />
              <line x1={12} y1={12 + index * 4} x2={40} y2={12 + index * 4} {...common} strokeOpacity={0.35} />
            </g>
          ))}
        </g>
      );
    case "frames":
      // 時序：疊在一起的影格
      return (
        <g>
          <rect x={10} y={16} width={26} height={22} {...common} strokeOpacity={0.4} />
          <rect x={14} y={13} width={26} height={22} {...common} strokeOpacity={0.7} />
          <rect x={18} y={10} width={26} height={22} {...common} />
        </g>
      );
    default:
      return <rect x={14} y={14} width={24} height={24} rx={2} {...common} />;
  }
}

export function MechanicsDiagram({
  stages,
  activeKey,
  onPick,
}: {
  stages: MechanicsStage[];
  activeKey: string | null;
  onPick: (key: string) => void;
}) {
  const width = stages.length * CELL + (stages.length - 1) * GAP;

  return (
    <svg
      data-testid="mechanics-diagram"
      viewBox={`0 0 ${width} ${HEIGHT}`}
      width="100%"
      style={{ maxWidth: width * 1.9, marginTop: 10, display: "block" }}
      role="img"
      aria-label={`結構圖：${stages.map((stage) => stage.title).join(" → ")}`}
    >
      {stages.map((stage, index) => {
        const x = index * (CELL + GAP);
        const active = activeKey === stage.key;
        const stroke = active ? "var(--primary)" : "var(--fg-secondary)";
        return (
          <g key={stage.key} transform={`translate(${x} 0)`} onClick={() => onPick(stage.key)} style={{ cursor: "pointer" }}>
            <rect
              x={0.5}
              y={0.5}
              width={CELL - 1}
              height={CELL - 1}
              rx={3}
              fill={active ? "var(--primary-tint)" : "var(--card2)"}
              stroke={active ? "var(--primary)" : "var(--border-strong)"}
              strokeWidth={1}
            />
            <Glyph kind={GLYPH[stage.key] ?? "block"} stroke={stroke} />
            <text
              x={CELL / 2}
              y={LABEL_TOP}
              textAnchor="middle"
              fontSize={9.5}
              fill={active ? "var(--primary-ink)" : "var(--fg-secondary)"}
            >
              {stage.title}
            </text>
            {/* 有方向的鏈：方向本身就是資訊 */}
            {index < stages.length - 1 ? (
              <g stroke="var(--border-strong)" strokeWidth={1} fill="none">
                <line x1={CELL + 2} y1={CELL / 2} x2={CELL + GAP - 4} y2={CELL / 2} />
                <path d={`M ${CELL + GAP - 7} ${CELL / 2 - 3} L ${CELL + GAP - 3} ${CELL / 2} L ${CELL + GAP - 7} ${CELL / 2 + 3}`} />
              </g>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
