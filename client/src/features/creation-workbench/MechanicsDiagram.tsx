import type { MechanicsStage } from "@shared/modelMechanics";

/**
 * 模型運作的實體示意圖（SVG，非文字清單）。
 *
 * 兩件事只能用畫的講清楚：
 * 1. **管線的形狀**——文字塔、條件注入、去噪、解碼是一條有方向的鏈。
 * 2. **去噪到底在幹嘛**——用真的噪聲紋理（feTurbulence）逐格變乾淨，
 *    比「一步步把噪聲整理成畫面」這句話直觀得多。
 *
 * 這是**示意圖**，不是本次生成的中間結果——模型不回傳中間潛變數，
 * 畫一張假的「這次的去噪過程」跟假造注意力熱圖是同一種謊。標籤寫死在圖上。
 */

/** 每格的寬高與間距：手機上一行放得下 4–5 格 */
const CELL = 46;
const GAP = 8;

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
      viewBox={`0 0 ${width} 74`}
      width="100%"
      style={{ maxWidth: width * 1.6, marginTop: 8, display: "block" }}
      role="img"
      aria-label={`管線示意圖：${stages.map((stage) => stage.title).join(" → ")}`}
    >
      <defs>
        {/* 真的噪聲，不是灰色方塊：seed 固定，畫面每次一樣 */}
        <filter id="mech-noise" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <clipPath id="mech-cell">
          <rect x="0" y="0" width={CELL} height={CELL} rx="7" />
        </clipPath>
      </defs>

      {stages.map((stage, index) => {
        const x = index * (CELL + GAP);
        const active = activeKey === stage.key;
        // 每一格畫的是「畫布在這一關的狀態」：開頭全是噪聲，越後面越成形。
        // 這是示意，不是本次生成的中間潛變數（模型不回傳那個）。
        const noise = 1 - index / Math.max(1, stages.length - 1);
        return (
          <g key={stage.key} transform={`translate(${x} 0)`} onClick={() => onPick(stage.key)} style={{ cursor: "pointer" }}>
            <g clipPath="url(#mech-cell)">
              <rect x="0" y="0" width={CELL} height={CELL} fill="var(--card2)" />
              <rect
                x="0"
                y="0"
                width={CELL}
                height={CELL}
                filter="url(#mech-noise)"
                opacity={0.04 + noise * 0.78}
              />
              {/* 畫面是「漸漸長出來」的，不是最後一格才憑空出現：
                  倒數第二格先透出輪廓，最後一格才成形 */}
              {index >= stages.length - 2 ? (
                <g opacity={index === stages.length - 1 ? 0.9 : 0.32}>
                  <rect x="0" y={CELL * 0.62} width={CELL} height={CELL * 0.38} fill="var(--brand-lime)" />
                  <circle cx={CELL * 0.7} cy={CELL * 0.3} r={CELL * 0.13} fill="var(--primary)" />
                </g>
              ) : null}
            </g>
            <rect
              x="0.5"
              y="0.5"
              width={CELL - 1}
              height={CELL - 1}
              rx="7"
              fill="none"
              stroke={active ? "var(--primary)" : "var(--border-strong)"}
              strokeWidth={active ? 2 : 1}
            />
            <text x={CELL / 2} y={CELL + 14} textAnchor="middle" fontSize="9" fill="var(--fg-secondary)">
              {index + 1}
            </text>
            {/* 箭頭而不是短線：這條鏈是有方向的，方向本身就是資訊 */}
            {index < stages.length - 1 ? (
              <path
                d={`M ${CELL + 1} ${CELL / 2 - 3} L ${CELL + GAP - 1} ${CELL / 2} L ${CELL + 1} ${CELL / 2 + 3} Z`}
                fill="var(--border-strong)"
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
