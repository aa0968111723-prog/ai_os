import { useState } from "react";
import { useLocation } from "wouter";
import {
  agentRunHudLabel,
  isAgentRunActiveForHud,
  isAgentRunWaitingForHuman,
} from "../../../../shared/agentQuestions";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { Button, Meta, Pill } from "../../components/ui";

/**
 * 代理動態列：跨頁常駐的「AI 正在幫你做什麼」＋隨時可停。
 *
 * 為什麼需要它：代理是**背景執行**的（關掉頁面也續跑，agentRunner 每 4 秒 tick）。
 * 在這之前，看得到進度的只有專案頁的 AgentCard——使用者一旦離開那頁，AI 在做
 * 什麼、做到哪、要不要停，全部失去線索。這正是「看得見 AI 正在操作」缺的那一半：
 * #526 已經讓伺服器在每步推進時推播（realtime 的 notifyAgentProgress），
 * 但沒有任何跨頁的地方在聽。
 *
 * ## 只在「真的有事在跑」時出現
 *
 * 沒有 running／waiting_*／awaiting_approval 的 run 就完全不渲染——常駐 UI 的成本
 * 是永久佔用畫面，只有在它真的有話要說時才值得。HITL 的 waiting_user_input 等
 * 狀態必須算 active，否則澄清中的 run 會從 HUD 消失。
 *
 * ## 停止是主權，不是進階功能
 *
 * 「停」直接放在列上，不藏進選單。代理會花點數、會改資料，使用者必須能在任何
 * 頁面、任何時候把它按停——這是「自主代理」與「使用者主權」的分界線。
 * 停止走既有的 agents.stop（stopAgentCore 內含權限復驗），前端不自己判斷誰能停。
 */
export function AgentActivityHud({ groupId }: { groupId: string }) {
  const [, navigate] = useLocation();
  const [stopping, setStopping] = useState<string | null>(null);
  const utils = trpc.useUtils();

  // 推播（#526）會透過 realtime 的 invalidate 讓這個查詢即時重取；
  // 輪詢是兜底——推播漏掉或 WS 斷線時仍會更新，只是慢一點。
  const overview = trpc.teamAssistant.agentOverview.useQuery(
    { groupId },
    { enabled: !!groupId, refetchInterval: 30_000, refetchIntervalInBackground: true },
  );

  const stop = trpc.agents.stop.useMutation({
    onSettled: () => {
      setStopping(null);
      void utils.teamAssistant.agentOverview.invalidate({ groupId });
    },
  });

  const active = (overview.data?.runs ?? []).filter((r) => isAgentRunActiveForHud(r.status));
  if (active.length === 0) return null;

  // 多個同時在跑時只常駐顯示最前面那個（清單在專案頁／組代理卡裡），
  // 但要說出還有幾個——不然使用者會以為只有這一個。
  const lead = active[0]!;
  const rest = active.length - 1;
  const label = agentRunHudLabel(lead.status);
  const pill = lead.status === "running" ? "running" as const : "queued" as const;
  const waitingHint = isAgentRunWaitingForHuman(lead.status)
    ? (lead.status === "waiting_permission" ? "・請處理權限" : "・請回覆")
    : "";

  return (
    <div className="agent-hud" role="status" aria-live="polite">
      <Pill status={pill}>{label}</Pill>
      <button
        type="button"
        className="agent-hud__body"
        onClick={() => navigate(`/p/${lead.projectId}?focus=agent-run-${lead.id}`)}
      >
        <span className="agent-hud__note">
          {lead.currentStepNote || lead.goal}
        </span>
        <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>
          {lead.projectTitle}
          {lead.totalSteps > 0 ? `・${lead.doneSteps}/${lead.totalSteps} 步` : ""}
          {waitingHint}
          {rest > 0 ? `・另有 ${rest} 個` : ""}
        </Meta>
      </button>
      {/* 停止不藏進選單：代理會花點數、會改資料，任何頁面都要能立刻按停 */}
      <Button
        variant="ghost"
        size="sm"
        disabled={stop.isPending && stopping === lead.id}
        onClick={() => {
          setStopping(lead.id);
          stop.mutate({ runId: lead.id });
        }}
      >
        <Icon name="CircleStop" size={13} />
        {stop.isPending && stopping === lead.id ? "停止中…" : "停"}
      </Button>
    </div>
  );
}
