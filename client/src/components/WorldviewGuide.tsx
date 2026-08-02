import {
  worldviewGuideSteps,
  nextWorldviewStep,
  isWorldviewReady,
  type Worldview,
} from "@shared/worldview";
import { VisualJourney, type VisualJourneyStep } from "./VisualJourney";
import { Meta } from "./ui";

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
  const ready = isWorldviewReady(wv);

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
      {next ? (
        <p className="project-guide__next">
          下一步：<b>{next.label}</b>・{next.hint}
        </p>
      ) : null}
      {/* 里程碑讀的是 isWorldviewReady（＝最低門檻：一句話 ＋ 調性或畫風其一），
          刻意比上面的步驟寬鬆：門檻一過就先告訴人「可以出圖了」，沒打勾的步驟
          仍留著當建議。反過來（步驟打完卻說沒就緒）才是矛盾，由 shared 測試擋住。 */}
      <Meta as="p" className="wv-guide__milestone">
        {ready
          ? "已經可以出圖了——AI 每次都會自動帶上這些設定。上面沒打勾的可以再補，畫面會更穩。"
          : "填到「想要什麼感覺」或「畫面長什麼樣」其中一個，就能開始出圖。"}
      </Meta>
    </div>
  );
}
