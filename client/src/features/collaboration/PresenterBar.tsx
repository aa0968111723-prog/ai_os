/**
 * Presenter 的三張面孔：邀請卡、主講中徽章、跟隨狀態列。
 *
 * 共同的鐵律：**畫面上永遠看得出「我現在是不是被別人帶著走」，而且永遠有一鍵離開。**
 * 一個會自己動的畫面而使用者不知道為什麼在動，比沒有這個功能更糟。
 */
import { describeViewState, pauseLabel, type FollowState } from "../../../../shared/viewState";
import type { CollabPresenter } from "../../realtime";
import { Button, Hint } from "../../components/ui";
import { Icon } from "../../components/Icon";

/** 主要操作在手機上的最小觸控目標 */
const TAP = 44;

const BAR: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid var(--border-soft)",
  background: "var(--card2)",
};

/**
 * 「Bruce 正在帶大家看 [加入]」。
 *
 * **這張卡是整個功能的安全閥。** 主講者按下「帶大家看」時，其他人只會看到它——
 * 沒有人的畫面會被切走。加入與否完全是接收端的決定。
 */
export function PresenterInvite({
  presenter,
  onJoin,
  onDismiss,
}: {
  presenter: CollabPresenter;
  onJoin: () => void;
  onDismiss: () => void;
}) {
  return (
    <div role="status" aria-live="polite" data-testid="presenter-invite" style={{ ...BAR, background: "var(--primary-tint, var(--card2))" }}>
      <span
        aria-hidden
        style={{ width: 10, height: 10, borderRadius: 999, background: presenter.color, flex: "0 0 auto" }}
      />
      <span style={{ fontSize: "var(--fs-13)" }}>
        <strong>{presenter.name}</strong> 正在帶大家看
        {presenter.view && (
          <Hint as="span" style={{ marginLeft: 6, fontSize: "var(--fs-11)" }}>
            {describeViewState(presenter.view)}
          </Hint>
        )}
      </span>
      <span style={{ flex: "1 1 auto" }} />
      <Button size="sm" style={{ minHeight: TAP }} onClick={onJoin}>
        加入
      </Button>
      <Button size="sm" variant="ghost" style={{ minHeight: TAP }} onClick={onDismiss}>
        不用了
      </Button>
    </div>
  );
}

/** 主講者自己看到的：「主講中 · 3 人跟著」＋結束鈕 */
export function PresenterBadge({
  followerCount,
  onStop,
}: {
  followerCount: number;
  onStop: () => void;
}) {
  return (
    <div role="status" aria-live="polite" data-testid="presenter-badge" style={BAR}>
      <Icon name="Users" size={14} />
      <span style={{ fontSize: "var(--fs-13)" }}>
        主講中
        {followerCount > 0 && <> · {followerCount} 人跟著</>}
      </span>
      <span style={{ flex: "1 1 auto" }} />
      <Button size="sm" variant="ghost" style={{ minHeight: TAP }} onClick={onStop}>
        結束主講
      </Button>
    </div>
  );
}

/**
 * 跟隨者的狀態列。三種狀態各自有話要說，而且都有出口：
 *   following        「正在跟隨 Bruce」        [停止跟隨]
 *   paused           「已暫停跟隨（你自己捲動了）」 [回到 Bruce] [停止跟隨]
 *   presenter_gone   「Bruce 暫時離線」          [知道了]
 *
 * 特別注意 presenter_gone：它明確說出是**誰**離線了，而且不會自動改跟別人。
 */
export function FollowStatusBar({
  state,
  onResume,
  onLeave,
}: {
  state: FollowState;
  onResume: () => void;
  onLeave: () => void;
}) {
  if (state.status === "off") return null;
  const name = state.presenterName ?? "夥伴";

  if (state.status === "presenter_gone") {
    return (
      <div role="status" aria-live="polite" data-testid="follow-status" style={{ ...BAR, borderColor: "var(--warn-border, var(--border-soft))" }}>
        <Icon name="TriangleAlert" size={14} />
        {/* 說出是「誰」離線了。絕不自動改跟另一個在線的人——那是使用者從來沒要求過的事。 */}
        <span style={{ fontSize: "var(--fs-13)" }}>{name} 暫時離線</span>
        <span style={{ flex: "1 1 auto" }} />
        <Button size="sm" variant="ghost" style={{ minHeight: TAP }} onClick={onLeave}>
          知道了
        </Button>
      </div>
    );
  }

  if (state.status === "paused") {
    return (
      <div role="status" aria-live="polite" data-testid="follow-status" style={BAR}>
        <Icon name="Pause" size={14} />
        <span style={{ fontSize: "var(--fs-13)" }}>
          已暫停跟隨
          <Hint as="span" style={{ marginLeft: 6, fontSize: "var(--fs-11)" }}>{pauseLabel(state.pauseReason)}</Hint>
        </span>
        <span style={{ flex: "1 1 auto" }} />
        <Button size="sm" style={{ minHeight: TAP }} onClick={onResume}>
          回到 {name}
        </Button>
        <Button size="sm" variant="ghost" style={{ minHeight: TAP }} onClick={onLeave}>
          停止跟隨
        </Button>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" data-testid="follow-status" style={{ ...BAR, background: "var(--primary-tint, var(--card2))" }}>
      <Icon name="Play" size={14} />
      <span style={{ fontSize: "var(--fs-13)" }}>正在跟隨 {name}</span>
      <span style={{ flex: "1 1 auto" }} />
      <Button size="sm" variant="ghost" style={{ minHeight: TAP }} onClick={onLeave}>
        停止跟隨
      </Button>
    </div>
  );
}

/** 「帶大家看」啟動鈕（沒有其他人在線時不顯示——對著空房主講沒有意義） */
export function PresentButton({ peerCount, onStart }: { peerCount: number; onStart: () => void }) {
  if (peerCount === 0) return null;
  return (
    <Button size="sm" variant="ghost" style={{ minHeight: TAP }} onClick={onStart} data-testid="present-start">
      <Icon name="Users" size={14} /> 帶大家看
    </Button>
  );
}
