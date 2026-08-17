import type { PhoneCard, PhoneAssistantAction, PhoneContextCapsule, PhoneWorkStep, PhoneTargetCandidate } from "@shared/phoneAssistantProjection";
import { Icon, type IconName } from "../components/Icon";
import { Meta } from "../components/ui";

/**
 * 手機 Action-first 卡片組（Phone UX，<768px）。
 *
 * ## 為什麼是四種形狀而不是「一個聊天氣泡」
 *
 * 390px 上讀一段散文，等於要求使用者自己從文字裡把「發生了什麼、還缺什麼、
 * 下一步按哪裡」解析出來。手機沒有那個閱讀預算。所以助手的一輪工作在這裡
 * 收斂成四種形狀：回答／提議／進度／結果，各自只有標題、1–3 行狀態、
 * 一顆主要動作。
 *
 * ## 這些元件不知道任何業務規則
 *
 * 卡片內容全部由 `shared/phoneAssistantProjection` 的純函式算好。這裡只負責排版
 * 與可及性：**沒有任何一行字是在元件裡拼出來的**，所以「畫面說完成、後端說待確認」
 * 這種分岔不可能從樣式層長出來。
 *
 * ## 可及性
 *
 * - 狀態不只靠顏色：每一列工作階段都帶圖示＋`aria-label` 文字狀態。
 * - 進度卡是 `role="status"`（polite），結果／需要確認是 `role="alert"`——
 *   前者每一步都播報會吵死讀屏，後者是使用者真的在等的東西。
 * - 主要動作最小 44px（`.m-card__cta`，見 styles.mobile.css）。
 */

const STEP_ICON: Record<PhoneWorkStep["state"], IconName> = {
  done: "CheckCircle2",
  active: "Loader",
  pending: "CircleDot",
  blocked: "Pause",
  failed: "XCircle",
};

const STEP_STATE_LABEL: Record<PhoneWorkStep["state"], string> = {
  done: "已完成",
  active: "進行中",
  pending: "尚未開始",
  blocked: "等待你的確認",
  failed: "失敗",
};

const CARD_ICON: Record<PhoneCard["kind"], IconName> = {
  answer: "MessageSquare",
  proposal: "Check",
  progress: "Loader",
  result: "CheckCircle2",
  clarify: "HelpCircle",
};

const CARD_EYEBROW: Record<PhoneCard["kind"], string> = {
  answer: "回覆",
  proposal: "待確認",
  progress: "進行中",
  result: "結果",
  clarify: "需要你決定",
};

export function PhoneContextCapsuleView({ capsule }: { capsule: PhoneContextCapsule }) {
  // 沒有具體上下文就整塊收起來——空的膠囊只是佔掉第一屏（計畫 §3.2）
  if (!capsule.lines.length) return null;
  return (
    <div className="m-capsule" aria-label="目前工作對象">
      <Icon name="Compass" size={13} />
      <span className="m-capsule__lines">
        {capsule.lines.map((line, index) => (
          <span key={line} className={index === 0 ? "m-capsule__head" : "m-capsule__line"}>{line}</span>
        ))}
      </span>
    </div>
  );
}

function PhoneActionButton({
  action,
  variant,
  onRun,
}: {
  action: PhoneAssistantAction;
  variant: "primary" | "secondary";
  onRun: (action: PhoneAssistantAction) => void;
}) {
  return (
    <button
      type="button"
      className={`m-card__cta m-card__cta--${variant}`}
      onClick={() => onRun(action)}
    >
      {action.label}
      {/* 付費一律標在按鈕上：把成本藏起來換取「一鍵感」是明確禁止的（計畫 §2.5） */}
      {action.paid && <span className="m-card__paid">需點數</span>}
      <Icon name="ChevronRight" size={14} />
    </button>
  );
}

export function PhoneAssistantCardView({
  card,
  onRun,
}: {
  card: PhoneCard;
  onRun: (action: PhoneAssistantAction) => void;
}) {
  const live = card.kind === "progress" ? "polite" : card.attention || card.kind === "clarify" ? "assertive" : "off";
  return (
    <section
      className={`m-card m-card--${card.kind}${card.attention ? " is-attention" : ""}`}
      aria-label={`${CARD_EYEBROW[card.kind]}：${card.title}`}
      {...(live === "off" ? {} : { role: live === "assertive" ? "alert" : "status", "aria-live": live })}
    >
      <header className="m-card__head">
        <Icon name={CARD_ICON[card.kind]} size={15} />
        <Meta as="span" className="m-card__eyebrow">{CARD_EYEBROW[card.kind]}</Meta>
      </header>
      <h3 className="m-card__title">{card.title}</h3>

      {card.lines.length > 0 && (
        <ul className="m-card__lines">
          {card.lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}

      {card.steps.length > 0 && (
        <ol className="m-card__steps" aria-label="這次真的做了什麼">
          {card.steps.map((step) => (
            <li key={step.key} className={`m-card__step is-${step.state}`}>
              <Icon name={STEP_ICON[step.state]} size={13} />
              <span className="m-card__step-label">{step.label}</span>
              {/* 0 是有意義的值（「找到 0 筆」），所以比對 undefined 而不是 falsy */}
              {step.count !== undefined && <span className="m-card__step-count">{step.count}</span>}
              <span className="sr-only">（{STEP_STATE_LABEL[step.state]}）</span>
            </li>
          ))}
        </ol>
      )}

      {(card.primaryAction || card.secondaryAction) && (
        <div className="m-card__actions">
          {card.primaryAction && <PhoneActionButton action={card.primaryAction} variant="primary" onRun={onRun} />}
          {card.secondaryAction && <PhoneActionButton action={card.secondaryAction} variant="secondary" onRun={onRun} />}
        </div>
      )}
    </section>
  );
}

/**
 * 模糊刪除目標的選擇卡。
 *
 * 這張卡出現時**還沒有任何請求送出**——它是在客戶端攔下來的，所以「取消」
 * 之後站上不會留下任何痕跡（既不會寫入，也不會在對話裡留下一句指涉不明的話）。
 */
export function PhoneTargetChooser({
  candidates,
  onPick,
  onCancel,
}: {
  candidates: PhoneTargetCandidate[];
  onPick: (candidate: PhoneTargetCandidate) => void;
  onCancel: () => void;
}) {
  return (
    <section className="m-card m-card--clarify is-attention" role="alert" aria-label="需要你決定：要刪掉哪一個">
      <header className="m-card__head">
        <Icon name="HelpCircle" size={15} />
        <Meta as="span" className="m-card__eyebrow">需要你決定</Meta>
      </header>
      <h3 className="m-card__title">要刪掉哪一個？</h3>
      <ul className="m-card__lines">
        <li>目前有 {candidates.length} 個可能的對象，還沒有動任何東西。</li>
      </ul>
      <div className="m-card__choices">
        {candidates.map((candidate) => (
          <button key={candidate.id} type="button" className="m-card__choice" onClick={() => onPick(candidate)}>
            {candidate.label}
          </button>
        ))}
      </div>
      <div className="m-card__actions">
        <button type="button" className="m-card__cta m-card__cta--secondary" onClick={onCancel}>
          先不要
        </button>
      </div>
    </section>
  );
}
