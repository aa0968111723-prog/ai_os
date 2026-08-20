import type { PillStatus } from "./ui";
import { Card, EmptyState, Meta, Pill } from "./ui";
import { cutosMessage, describeActivity } from "@shared/cutosMessages";

/**
 * CUTOS 影片剪輯面板：連線狀態、已連結的影片專案、以及**真的發生過**的活動。
 *
 * 三個刻意的設計：
 *
 * 1. 每一行進度都來自 CUTOS 送來的事件 `messageKey`，經 `shared/cutosMessages`
 *    轉成繁中——畫面不自己編字串，也不會出現 `activity.apply.completed`
 *    這種原始 key（`shared/cutosMessages.test.ts` 掃程式碼擋住漏翻）。
 * 2. 不顯示模型的思考過程。事件只有「做了什麼、結果如何」。
 * 3. 錯誤一律顯示可行動的中文，不把原始例外丟給使用者。
 */

export interface CutosConnection {
  reachable: boolean;
  compatible: boolean;
  /** 連線／版本狀態的文案鍵，例如 cutos.status.connected */
  messageKey: string;
  protocolVersion?: string;
  latencyMs?: number;
}

export interface CutosBoundProject {
  cutosProjectId: string;
  cutosProjectName?: string | null;
  timelineRevision?: number | null;
}

export interface CutosActivityRow {
  id: string;
  kind: string;
  status: string;
  messageKey: string;
  metadata?: Record<string, string | number | boolean>;
  occurredAt: string;
  cutosJobId?: string | null;
}

export interface CutosApproval {
  reasonCode: string;
  messageKey: string;
  removedRatio: number;
  keptRatio: number;
}

const STATUS_PILL: Record<string, PillStatus> = {
  started: "running",
  progress: "running",
  waiting_approval: "queued",
  waiting_external: "queued",
  completed: "done",
  failed: "failed",
  cancelled: "neutral",
};

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function timeOfDay(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

export function CutosVideoPanel({
  connection,
  project,
  activity = [],
  approval,
  error,
}: {
  connection: CutosConnection;
  /** 未連結時為 undefined——面板照樣顯示，只是告訴使用者要先連結。 */
  project?: CutosBoundProject;
  activity?: readonly CutosActivityRow[];
  /** 有值＝正在等待這位使用者確認。 */
  approval?: CutosApproval;
  /** 錯誤碼對應的文案鍵，例如 aios.error.staleRevision */
  error?: string;
}) {
  const connectionStatus: PillStatus = !connection.reachable
    ? "failed"
    : !connection.compatible
      ? "failed"
      : "done";

  return (
    <section className="cutos-panel" aria-label="CUTOS 影片剪輯" data-connected={connection.reachable}>
      <header className="cutos-panel__header">
        <strong>CUTOS 影片剪輯</strong>
        <Pill status={connectionStatus}>{cutosMessage(connection.messageKey)}</Pill>
      </header>

      {connection.reachable && connection.compatible && connection.protocolVersion ? (
        <Meta as="p" className="cutos-panel__meta">
          協定 {connection.protocolVersion}
          {typeof connection.latencyMs === "number" ? `｜延遲 ${connection.latencyMs} 毫秒` : ""}
        </Meta>
      ) : null}

      {error ? (
        <Card variant="quiet">
          <Meta as="p" className="cutos-panel__error">{cutosMessage(error)}</Meta>
        </Card>
      ) : null}

      {project ? (
        <Card variant="quiet">
          <Meta as="p">
            已連結 CUTOS 專案：{project.cutosProjectName?.trim() || project.cutosProjectId}
          </Meta>
          {typeof project.timelineRevision === "number" ? (
            <Meta as="p">時間軸版本 {project.timelineRevision}</Meta>
          ) : null}
        </Card>
      ) : (
        <EmptyState
          title="尚未連結 CUTOS 影片專案"
          description="先連結一個 CUTOS 影片專案，AI 助手才能分析與剪輯這支影片。"
        />
      )}

      {approval ? (
        <Card variant="quiet">
          <div className="cutos-panel__approval">
            <Pill status="queued">等待你的確認</Pill>
            <Meta as="p">{cutosMessage(approval.messageKey)}</Meta>
            <Meta as="p">
              預計刪除 {percent(approval.removedRatio)}，保留 {percent(approval.keptRatio)}
            </Meta>
          </div>
        </Card>
      ) : null}

      {activity.length > 0 ? (
        <ol className="cutos-panel__activity" aria-live="polite">
          {activity.map((event) => (
            <li key={event.id} data-kind={event.kind} data-status={event.status}>
              <Pill status={STATUS_PILL[event.status] ?? "neutral"}>
                {event.status === "failed" ? "未完成" : event.status === "completed" ? "完成" : "進行中"}
              </Pill>
              <span className="cutos-panel__activity-text">{describeActivity(event)}</span>
              <Meta as="span" className="cutos-panel__activity-time">{timeOfDay(event.occurredAt)}</Meta>
            </li>
          ))}
        </ol>
      ) : project ? (
        <Meta as="p">還沒有影片處理紀錄。</Meta>
      ) : null}
    </section>
  );
}
