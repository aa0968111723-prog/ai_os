import {
  worldviewGuideSteps,
  nextWorldviewStep,
  type Worldview,
} from "@shared/worldview";
import { VisualJourney, type VisualJourneyStep } from "./VisualJourney";

/**
 * 快速層引導鋪軌。
 *
 * 刻意**不做**擁有草稿狀態的精靈：多畫面精靈需要本地緩衝，會直接撞爛
 * ProjectPage 的 `key={...}` 重掛 + onBlur 部分 patch 模型（協作靠它才不會
 * 互相覆蓋）。這裡只是疊在**完全不變的既有 input** 之上的一條進度軌——
 * 它不持有任何欄位值，只讀 wv、只負責告訴人「下一步填哪個」並捲過去。
 */
export function WorldviewGuide({
  wv,
  onJump,
}: {
  wv: Worldview;
  /** 帶錨點選擇器（如 "#wv-logline"）；由呼叫端決定捲動與展開行為 */
  onJump: (anchor: string, stepId: string) => void;
}) {
  const steps = worldviewGuideSteps(wv);
  const next = nextWorldviewStep(wv);

  const journeySteps: VisualJourneyStep[] = steps.map((s) => ({
    id: s.id,
    label: s.label,
    detail: s.hint,
    state: s.done ? "done" : s.id === next?.id ? "current" : "upcoming",
  }));

  return (
    <div className="wv-guide">
      <VisualJourney
        steps={journeySteps}
        ariaLabel="這支片的固定設定：填寫進度"
        compact
        onSelect={(step) => {
          const target = steps.find((s) => s.id === step.id);
          if (target) onJump(target.anchor, target.id);
        }}
      />
      {/* 就緒狀態與下一步 CTA 由上方 wv-ready-strip 單一出口負責（去重複文案）：
          這裡只留「哪一步填了、現在該填哪一步」的進度軌，避免同一句話在一屏內講三次。
          就緒門檻（isWorldviewReady＝一句話 ＋ 調性或畫風其一）刻意比步驟寬鬆，
          沒打勾的步驟仍留著當建議；矛盾情況由 shared 測試擋住。 */}
    </div>
  );
}
