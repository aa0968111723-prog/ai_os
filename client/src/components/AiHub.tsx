import { trpc } from "../api";
import { Icon } from "./Icon";
import { AgentCard } from "./AgentCard";
import { ProjectAssistant } from "./ProjectAssistant";

/**
 * 專案 AI 代理系統（統一深度整合）：一個對話入口統包「問答・發想・拆分鏡・下目標排計畫・查資料庫」。
 * 不是四張卡也不是四個分頁——同一個代理、同一組上下文（世界觀＋知識庫＋素材＋分鏡＋生成紀錄＋自訂資料庫）：
 * - 問：進度／還沒審的分鏡／該用哪個模型／資料庫裡的器材與任務——代理邊想邊查（唯讀），過程即時顯示。
 * - 做：單步動作（生成／建分鏡／改分鏡／送審／拆分鏡）由代理「提議」，你按確認才執行。
 * - 跑：多步驟目標由代理排成計畫（plan_agent，免費），在下方「代理執行」核准估點後由伺服器背景逐步跑，
 *   可寫入 AI 可寫的資料庫（record_to_database）——關掉頁面也會繼續，隨時可停止。
 * 對話（ProjectAssistant）與執行區（AgentCard）恆掛同一張卡：排完計畫立刻在下方看到、核准、追進度。
 */
export function AiHub({
  projectId,
  canEdit,
  isLeader = false,
}: {
  projectId: string;
  canEdit: boolean;
  isLeader?: boolean;
}) {
  // 執行區小標的活躍徽章（與 AgentCard 同 query key 共用快取，不另開輪詢）
  const runs = trpc.agents.listByProject.useQuery({ projectId });
  const awaiting = (runs.data ?? []).filter((r) => r.status === "awaiting_approval").length;
  const running = (runs.data ?? []).filter((r) => r.status === "running").length;

  return (
    <section className="card card--primary" data-fb="專案 AI 代理系統" id="sec-ai-hub">
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="Sparkles" size={18} style={{ color: "var(--primary-ink)" }} /> 專案 AI 代理系統
      </h2>
      <p className="hint" style={{ marginTop: -4 }}>
        一個代理連結全專案與資料庫：問進度、要發想、貼腳本、下目標——都用說的。單步動作提議後你確認執行；
        多步目標排成計畫、核准估點後由伺服器背景逐步跑。
      </p>

      {/* 統一對話入口（舊錨點 sec-assistant 沿用：外部連結／走查腳本靠它定位） */}
      <div id="sec-assistant">
        <ProjectAssistant projectId={projectId} embedded />
      </div>

      {/* 代理執行區：對話裡下的目標（plan_agent）排出的計畫在這裡核准、追進度、停止 */}
      <div id="sec-agent" style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-soft)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: "var(--fs-13)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="Film" size={14} /> 代理執行
          </strong>
          {running > 0 && <span className="pill running">執行中 {running}</span>}
          {awaiting > 0 && <span className="pill queued">待核准 {awaiting}</span>}
          <span className="hint" style={{ fontSize: "var(--fs-12)" }}>
            計畫核准後由伺服器背景逐步跑（關頁不中斷）；每步實際扣點走既有守門
          </span>
        </div>
        <AgentCard projectId={projectId} canEdit={canEdit} isLeader={isLeader} embedded hideComposer />
      </div>
    </section>
  );
}
