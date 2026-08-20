import { Icon } from "../components/Icon";
import { Button, Meta } from "../components/ui";

/**
 * 「失敗的重跑」確認卡（任務書 B8：MEDIUM／花點數 → 先問一次）。
 *
 * ## 為什麼是確定性動作而不是丟給助手
 *
 * 「把失敗的重跑」的語意完全確定：目標集合＝這個專案 status=failed 的生成，
 * 動作＝逐筆 `generation.retry`（既有端點：完整還原角色定裝／場景／道具／分鏡
 * 綁定，走 executeGenerationCommand 真扣點）。丟給 LLM 只是多一輪延遲與
 * 一次誤解的機會。確認卡照 companionActions 的政策出（costful 批次 → confirm_card），
 * 卡上講清楚幾筆、預估幾點——這正是任務書 B9 的 Confirmation 卡。
 *
 * ## 誠實回報
 *
 * 逐筆執行、逐筆記結果。部分失敗就說「N 成功、M 失敗」，不因為有成功就整批
 * 報成功。執行後的即時狀態由 WS companion-event 接手（retry → 生成翻 running
 * 時伺服器就發 generation_started，Orb 自動轉 executing）。
 */
export interface RetryItem {
  id: string;
  kind: string;
  modelId: string;
  pointsEst: number | null;
  error: string | null;
}

export function CompanionRetryConfirm({
  projectTitle,
  items,
  totalPointsEst,
  onConfirm,
  onCancel,
  running,
  outcome,
}: {
  projectTitle: string;
  items: RetryItem[];
  totalPointsEst: number;
  /** 使用者拍板：呼叫端逐筆跑 generation.retry */
  onConfirm: () => void;
  onCancel: () => void;
  running: boolean;
  /** 執行完的誠實結果；null＝還沒執行 */
  outcome: { succeeded: number; failed: number; firstError?: string } | null;
}) {
  return (
    <section className="companion-confirm" role="alertdialog" aria-label="重跑失敗生成的確認">
      <strong className="companion-confirm__title">
        重跑「{projectTitle}」的 {items.length} 筆失敗生成
      </strong>
      <Meta as="p" className="companion-confirm__line">
        {totalPointsEst > 0 ? `預估使用 ${totalPointsEst} 點。` : "不另外扣點。"}
        每筆都會還原原本的角色與場景綁定重新送出。
      </Meta>
      {outcome ? (
        <>
          <p className="companion-confirm__outcome" role="status">
            {outcome.failed === 0
              ? `已重新啟動 ${outcome.succeeded} 筆，進度會即時顯示在球上。`
              : `${outcome.succeeded} 筆已重啟、${outcome.failed} 筆沒送出去${outcome.firstError ? `（${outcome.firstError}）` : ""}。`}
          </p>
          <div className="companion-confirm__actions">
            <Button variant="ghost" onClick={onCancel}>
              <Icon name="Check" size={14} />
              知道了
            </Button>
          </div>
        </>
      ) : (
        <div className="companion-confirm__actions">
          <Button variant="primary" onClick={onConfirm} disabled={running}>
            {running ? "正在送出…" : "就這樣做"}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={running}>先不要</Button>
        </div>
      )}
    </section>
  );
}

export default CompanionRetryConfirm;
