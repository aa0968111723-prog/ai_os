import { useState } from "react";
import { trpc } from "../api";
import { Icon, type IconName } from "./Icon";
import { AgentCard } from "./AgentCard";
import { ProjectAssistant } from "./ProjectAssistant";
import { DirectorCard } from "./DirectorCard";
import { ScriptSplitCard } from "./ScriptSplitCard";

/**
 * 專案 AI 代理系統（四合一）：AI 代理・專案問答・導演建議・拆分鏡統一在同一張卡，分頁切換。
 * 四個功能共用同一組專案上下文（世界觀＋知識庫），入口只有一個，不再四張卡各自為政。
 * 分頁面板恆掛在 DOM（hidden 切換）——切走再切回，對話紀錄、執行中的代理進度都不會丟；
 * 代理的輪詢與桌面通知也照常運作（AgentCard 自己的 effect 不因分頁隱藏而卸載）。
 */

type TabId = "agent" | "assistant" | "director" | "split";

const TABS: Array<{ id: TabId; label: string; icon: IconName; title: string }> = [
  { id: "agent", label: "AI 代理", icon: "Sparkles", title: "一句目標 → 排計畫 → 核准後背景執行" },
  { id: "assistant", label: "專案問答", icon: "MessageCircle", title: "問進度、要建議，助手提議動作你確認才執行" },
  { id: "director", label: "導演建議", icon: "Lightbulb", title: "依世界觀＋知識庫給分鏡 idea" },
  { id: "split", label: "拆分鏡", icon: "Clapperboard", title: "貼腳本 → 自動切成一幕一幕的分鏡草稿" },
];

export function AiHub({
  projectId,
  canEdit,
  isLeader = false,
  onUsePrompt,
}: {
  projectId: string;
  canEdit: boolean;
  isLeader?: boolean;
  onUsePrompt: (prompt: string) => void;
}) {
  const [tab, setTab] = useState<TabId>("agent");
  // 代理分頁徽章：有 run 在跑／等核准時，切到別頁也一眼看得到（與 AgentCard 同 key 共用快取，不另開輪詢）
  const runs = trpc.agents.listByProject.useQuery({ projectId });
  const awaiting = (runs.data ?? []).filter((r) => r.status === "awaiting_approval").length;
  const running = (runs.data ?? []).filter((r) => r.status === "running").length;
  const agentBadge = running > 0 ? "執行中" : awaiting > 0 ? "待核准" : null;

  // 方向鍵在分頁間移動（tablist 慣例）：Home/End 跳頭尾
  const onTabKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = TABS.findIndex((t) => t.id === tab);
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next].id);
    document.getElementById(`ai-hub-tab-${TABS[next].id}`)?.focus();
  };

  return (
    <section className="card card--primary" data-fb="專案 AI 代理系統" id="sec-ai-hub">
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="Sparkles" size={18} style={{ color: "var(--primary-ink)" }} /> 專案 AI 代理系統（四合一）
      </h2>
      <p className="hint" style={{ marginTop: -4 }}>
        代理・問答・導演・拆分鏡統一在這裡——同一組世界觀＋知識庫上下文，切分頁不丟進度與對話。
      </p>

      <div className="seg" role="tablist" aria-label="專案 AI 代理系統功能" onKeyDown={onTabKey} style={{ flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`ai-hub-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`ai-hub-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? "on" : ""}
            title={t.title}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} size={13} /> {t.label}
            {t.id === "agent" && agentBadge && (
              <span className={`pill ${agentBadge === "執行中" ? "running" : "queued"}`} style={{ fontSize: "var(--fs-11)" }}>
                {agentBadge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 四個面板恆掛在 DOM，hidden 切換——保留各自狀態（對話、進度、輪詢） */}
      <div id="ai-hub-panel-agent" role="tabpanel" aria-labelledby="ai-hub-tab-agent" hidden={tab !== "agent"} style={{ marginTop: 12 }}>
        {/* 舊錨點 id 沿用：外部連結／e2e 走查靠這些定位 */}
        <div id="sec-agent">
          <AgentCard projectId={projectId} canEdit={canEdit} isLeader={isLeader} embedded />
        </div>
      </div>
      <div id="ai-hub-panel-assistant" role="tabpanel" aria-labelledby="ai-hub-tab-assistant" hidden={tab !== "assistant"} style={{ marginTop: 12 }}>
        <div id="sec-assistant">
          <ProjectAssistant projectId={projectId} embedded />
        </div>
      </div>
      <div id="ai-hub-panel-director" role="tabpanel" aria-labelledby="ai-hub-tab-director" hidden={tab !== "director"} style={{ marginTop: 12 }}>
        <div id="sec-director">
          <DirectorCard projectId={projectId} onUse={onUsePrompt} embedded />
        </div>
      </div>
      <div id="ai-hub-panel-split" role="tabpanel" aria-labelledby="ai-hub-tab-split" hidden={tab !== "split"} style={{ marginTop: 12 }}>
        <div id="sec-split">
          <ScriptSplitCard projectId={projectId} embedded />
        </div>
      </div>
    </section>
  );
}
