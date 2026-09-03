import React from "react";

export type StepState = "done" | "active" | "idle";

export interface StepItem {
  id: number;
  label: string;
  subLabel?: string;
  icon: "bulb" | "doc" | "grid" | "wave" | "upload";
}

/**
 * 專案 5 階段進度燈號文案。
 * 與手機 StageTrack / shared phoneStages 同一套語彙，避免桌機「靈感／腳本／發布」
 * 與手機「故事／分鏡／交付」各講一套，使用者以為是兩套流程。
 */
export const DEFAULT_STEPS: StepItem[] = [
  { id: 1, label: "故事", subLabel: "Story", icon: "bulb" },
  { id: 2, label: "分鏡", subLabel: "Board", icon: "doc" },
  { id: 3, label: "視覺", subLabel: "Visual", icon: "grid" },
  { id: 4, label: "生成", subLabel: "Generate", icon: "wave" },
  { id: 5, label: "交付", subLabel: "Deliver", icon: "upload" },
];

export const getStepState = (stepId: number, currentStep: number): StepState => {
  if (stepId < currentStep) return "done";
  if (stepId === currentStep) return "active";
  return "idle";
};

/** 節點內微圖標 */
function StepGlyph({ type, state }: { type: StepItem["icon"]; state: StepState }) {
  // 設計 token：idle 用次前景色（灰階語彙），active/done 用主前景色。
  // #fff 僅保留給 primary-solid 底上的圖示——本元件節點是漸層底，不屬白字情境。
  const strokeColor = state === "idle" ? "var(--fg-secondary)" : "var(--fg)";
  const fillColor = state === "idle" ? "var(--fg-secondary)" : "var(--fg)";

  switch (type) {
    case "bulb":
      return (
        <g transform="translate(0, -0.5)">
          <path
            d="M-2.5 -2.5 A3 3 0 1 1 2.5 -2.5 C2.5 -1.2 1.5 -0.2 1.2 0.5 L-1.2 0.5 C-1.5 -0.2 -2.5 -1.2 -2.5 -2.5 Z"
            stroke={strokeColor}
            strokeWidth="0.85"
            fill="none"
          />
          <line x1="-1" y1="1.5" x2="1" y2="1.5" stroke={strokeColor} strokeWidth="0.8" />
          <line x1="-0.6" y1="2.5" x2="0.6" y2="2.5" stroke={strokeColor} strokeWidth="0.8" />
        </g>
      );
    case "doc":
      return (
        <g transform="translate(0, -0.2)">
          <rect
            x="-2.5"
            y="-3.5"
            width="5"
            height="7"
            rx="0.8"
            stroke={strokeColor}
            strokeWidth="0.85"
            fill="none"
          />
          <line x1="-1.4" y1="-1.6" x2="1.4" y2="-1.6" stroke={strokeColor} strokeWidth="0.8" />
          <line x1="-1.4" y1="0.1" x2="1.4" y2="0.1" stroke={strokeColor} strokeWidth="0.8" />
          <line x1="-1.4" y1="1.8" x2="0.5" y2="1.8" stroke={strokeColor} strokeWidth="0.8" />
        </g>
      );
    case "grid":
      return (
        <g transform="translate(0, 0)">
          <rect
            x="-3.2"
            y="-3.2"
            width="6.4"
            height="6.4"
            rx="1"
            stroke={strokeColor}
            strokeWidth="0.85"
            fill="none"
          />
          <line x1="-3.2" y1="0" x2="3.2" y2="0" stroke={strokeColor} strokeWidth="0.75" />
          <line x1="0" y1="-3.2" x2="0" y2="3.2" stroke={strokeColor} strokeWidth="0.75" />
        </g>
      );
    case "wave":
      return (
        <g transform="translate(0, 0)">
          <line x1="-3" y1="-1.5" x2="-3" y2="1.5" stroke={strokeColor} strokeWidth="0.9" strokeLinecap="round" />
          <line x1="-1" y1="-3.2" x2="-1" y2="3.2" stroke={strokeColor} strokeWidth="0.9" strokeLinecap="round" />
          <line x1="1" y1="-2.2" x2="1" y2="2.2" stroke={strokeColor} strokeWidth="0.9" strokeLinecap="round" />
          <line x1="3" y1="-1.2" x2="3" y2="1.2" stroke={strokeColor} strokeWidth="0.9" strokeLinecap="round" />
        </g>
      );
    case "upload":
      return (
        <g transform="translate(0, 0)">
          <path
            d="M0 -3.2 L-2.5 -0.5 L-0.9 -0.5 L-0.9 2.2 L0.9 2.2 L0.9 -0.5 L2.5 -0.5 Z"
            fill={fillColor}
          />
          <line x1="-3" y1="3.4" x2="3" y2="3.4" stroke={strokeColor} strokeWidth="0.85" strokeLinecap="round" />
        </g>
      );
  }
}

export interface ProgressStepperProps {
  currentStep?: number;
  steps?: StepItem[];
  size?: "sm" | "md" | "lg";
  showLabels?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 專案 5 階段進度燈號（ProgressStepper）
 * 故事 ➔ 分鏡 ➔ 視覺 ➔ 生成 ➔ 交付
 */
export function ProgressStepper({
  currentStep = 3,
  steps = DEFAULT_STEPS,
  size = "md",
  showLabels = true,
  className = "",
  style,
}: ProgressStepperProps) {
  const width = size === "sm" ? 180 : size === "lg" ? 280 : 230;
  const height = showLabels ? 42 : 24;
  const nodeRadius = size === "sm" ? 8 : size === "lg" ? 12 : 10;
  const yCenter = showLabels ? 14 : 12;

  const total = steps.length;
  const spacing = (width - nodeRadius * 2 - 16) / (total - 1);
  const startX = 8 + nodeRadius;

  return (
    <div
      className={`progress-stepper-wrap progress-stepper--${size} ${className}`}
      style={{ display: "inline-block", maxWidth: "100%", ...style }}
      aria-label={`專案進度：第 ${currentStep} 階段`}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="progress-stepper-svg"
      >
        <defs>
          <radialGradient id="stepper-active-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FF6B35" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#FF6B35" stopOpacity="0" />
          </radialGradient>

          <linearGradient id="stepper-done-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#66BB6A" />
            <stop offset="100%" stopColor="#2E7D32" />
          </linearGradient>

          <linearGradient id="stepper-active-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFAB40" />
            <stop offset="100%" stopColor="#FF6B35" />
          </linearGradient>
        </defs>

        {steps.map((step, idx) => {
          if (idx === total - 1) return null;
          const x1 = startX + idx * spacing + nodeRadius;
          const x2 = startX + (idx + 1) * spacing - nodeRadius;
          const isDoneSegment = step.id < currentStep;
          const isActiveSegment = step.id === currentStep;

          return (
            <line
              key={`line-${idx}`}
              x1={x1}
              y1={yCenter}
              x2={x2}
              y2={yCenter}
              stroke={isDoneSegment ? "#4CAF50" : isActiveSegment ? "#FF9800" : "#3A3A3A"}
              strokeWidth={isDoneSegment ? 2 : 1.5}
              strokeDasharray={isDoneSegment ? "none" : "3 3"}
              strokeLinecap="round"
            />
          );
        })}

        {steps.map((step, idx) => {
          const cx = startX + idx * spacing;
          const state = getStepState(step.id, currentStep);

          return (
            <g key={step.id} className={`stepper-node stepper-node--${state}`}>
              {state === "active" && (
                <circle
                  cx={cx}
                  cy={yCenter}
                  r={nodeRadius * 1.6}
                  fill="url(#stepper-active-glow)"
                  className="stepper-glow-pulse"
                />
              )}

              <circle
                cx={cx}
                cy={yCenter}
                r={nodeRadius}
                fill={
                  state === "done"
                    ? "url(#stepper-done-grad)"
                    : state === "active"
                    ? "url(#stepper-active-grad)"
                    : "#222222"
                }
                stroke={
                  state === "done"
                    ? "#43A047"
                    : state === "active"
                    ? "#FFB74D"
                    : "#444444"
                }
                strokeWidth={state === "active" ? 1.5 : 1}
              />

              <g transform={`translate(${cx}, ${yCenter})`}>
                <StepGlyph type={step.icon} state={state} />
              </g>

              {state === "done" && (
                <g transform={`translate(${cx + nodeRadius * 0.65}, ${yCenter + nodeRadius * 0.65})`}>
                  <circle cx="0" cy="0" r="3.2" fill="#2E7D32" stroke="#66BB6A" strokeWidth="0.6" />
                  <path
                    d="M-1.5 0 L-0.4 1.1 L1.6 -0.9"
                    stroke="#ffffff"
                    strokeWidth="0.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </g>
              )}

              {showLabels && (
                <text
                  x={cx}
                  y={height - 2}
                  textAnchor="middle"
                  fontSize="9.5"
                  fontWeight={state === "active" ? "600" : "500"}
                  fill={
                    state === "done"
                      ? "#81C784"
                      : state === "active"
                      ? "#FFB74D"
                      : "#666666"
                  }
                  style={{ userSelect: "none" }}
                >
                  {step.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** 進度推導可用的計數（有就用；Launchpad 列表可能暫時沒有） */
export type ProjectStepCounts = {
  /** 是否已有故事正文 */
  hasStory?: boolean;
  /** 分鏡數（scenes / shots） */
  shots?: number;
  /** 已有畫面的分鏡數 */
  shotsWithVisual?: number;
  /** 已完成生成數 */
  generationsDone?: number;
  /** 可播放成片數（組裝後的影片，不是單鏡靜圖） */
  playableResultCount?: number;
};

/**
 * 依專案狀態與計數推導階段 (1~5)。
 *
 * 對齊 `shared/phoneStages.inferPhoneStage` 的保守原則：
 * 只有上一階段確實有東西才往前——沒有分鏡時不說「在生成」。
 *
 * 簽名相容：Launchpad 仍可 `inferProjectCurrentStep(p, pd)`；
 * 有完整 counts 時（專案頁／未來列表 enrichment）才走細推導。
 */
export function inferProjectCurrentStep(
  project: { kind?: string; format?: string; status?: string; createdAt?: any; updatedAt?: any },
  pending?: { awaitingGenerations?: number } | null,
  counts?: ProjectStepCounts | null,
): number {
  if (project.status === "archived") return 5;

  const awaiting = pending?.awaitingGenerations ?? 0;
  const hasCounts =
    counts &&
    (counts.hasStory != null ||
      counts.shots != null ||
      counts.shotsWithVisual != null ||
      counts.generationsDone != null ||
      counts.playableResultCount != null);

  if (hasCounts) {
    const hasStory = Boolean(counts!.hasStory);
    const shots = counts!.shots ?? 0;
    const shotsWithVisual = counts!.shotsWithVisual ?? 0;
    const generationsDone = counts!.generationsDone ?? 0;
    const playable = counts!.playableResultCount ?? 0;

    if (playable > 0) return 5;
    if (awaiting > 0) return 4;
    if (!hasStory && shots === 0) return 1;
    if (shots === 0) return 2;
    if (shotsWithVisual === 0) return 3;
    if (shotsWithVisual < shots) return 4;
    return generationsDone > 0 ? 5 : 4;
  }

  // Launchpad 列表僅有 pending 摘要時的保守路徑
  if (awaiting > 0) return 4; // 生成／待裁決（舊版誤標 3＝分鏡）
  return 2;
}
