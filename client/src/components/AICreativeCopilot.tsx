import { useState, useRef, useEffect } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc, type AppRouter } from "../api";
import { setOrbState } from "../lib/orbState";
import { Icon, type IconName } from "./Icon";
import { Button, Card } from "./ui";
import { requestSiteAssistantStream } from "./assistantStream";
import { LiveAssistantTrace, type AssistantActivityEvent } from "./AssistantTrace";

type GlobalAskOutput = inferRouterOutputs<AppRouter>["globalAssistant"]["ask"];
type SiteAction = GlobalAskOutput["siteActions"][number];
type DispatchProposal = GlobalAskOutput["dispatches"][number];
type CommandProposal = GlobalAskOutput["actions"][number];

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  steps?: string[];
  contextUsed?: string[];
  /** 站級動作提議（建專案／筆記／行程／任務／私訊）——確認卡，按下才執行 */
  siteActions?: SiteAction[];
  /** 派工提議（交給某專案的 AI 代理排計畫） */
  dispatches?: DispatchProposal[];
  /** 監督指令提議（核准／停止／重排／改派） */
  commands?: CommandProposal[];
}

/** 圖示名稱標成 IconName：寫錯的名字在編譯期就擋下來。
 *  不標的話推論成 string，Icon 收到未知名稱只會畫出一個空的 svg——
 *  沒有任何錯誤，只有畫面上一塊看不見的空白。 */
const QUICK_PROMPTS: ReadonlyArray<{ icon: IconName; label: string; prompt: string }> = [
  {
    icon: "Sparkles",
    label: "爆款短片主題",
    prompt: "請幫我想 3 個適合發布在 Reels/TikTok 的生活短影音企劃主題與吸睛鉤子 (Hook)。",
  },
  {
    icon: "Zap",
    label: "分鏡腳本規劃",
    prompt: "請為一個 30 秒的產品開箱影片規劃 5 鏡詳細的分鏡腳本與畫面描述。",
  },
  {
    icon: "Search",
    label: "全組專案進度",
    prompt: "請盤點我們組內目前的專案進度，並提供下一步最優先建議。",
  },
  {
    icon: "Check",
    label: "開場鉤子技巧",
    prompt: "如何在前 3 秒抓住觀眾眼球？請提供 3 種經過驗證的短影片開頭話術公式。",
  },
];

/** 已解析動作 → runSiteAction 輸入（逐型別挑欄位；label 等顯示欄位不上送） */
export function toSiteActionInput(a: SiteAction) {
  switch (a.type) {
    case "create_project":
      return { type: a.type, groupId: a.groupId, title: a.title, kind: a.kind, platform: a.platform } as const;
    case "add_note":
      return { type: a.type, groupId: a.groupId, projectId: a.projectId, title: a.title, content: a.content } as const;
    case "add_schedule_item":
      return { type: a.type, groupId: a.groupId, projectId: a.projectId, title: a.title, startsAt: a.startsAt, endsAt: a.endsAt, note: a.note } as const;
    case "create_task":
      return { type: a.type, groupId: a.groupId, projectId: a.projectId, title: a.title, description: a.description, assigneeId: a.assigneeId, dueAt: a.dueAt, priority: a.priority } as const;
    case "send_dm":
      return { type: a.type, peerId: a.peerId, body: a.body } as const;
  }
}

/** 完成後「前往看結果」的落點（沒有合適落點就不給連結） */
export function siteActionDoneLink(a: SiteAction, result: { type: string; projectId?: string }): { href: string; label: string } | null {
  if (a.type === "create_project" && result.projectId) return { href: `/p/${result.projectId}`, label: "前往專案" };
  if (a.type === "add_schedule_item" || a.type === "add_note") return { href: "/planner", label: "查看筆記排程" };
  if (a.type === "create_task") return { href: `/p/${a.projectId}`, label: "前往專案" };
  if (a.type === "send_dm") return { href: "/chat", label: "打開私訊" };
  return null;
}

/**
 * 一張站級動作確認卡：提議 → 確認（以本人身分執行）／略過 → 完成或失敗。
 * 執行永遠是使用者按下那一刻的單發 mutation——AI 沒有任何路徑可以代按。
 */
function SiteActionCard({ action, onNavigate }: { action: SiteAction; onNavigate?: (href: string) => void }) {
  const run = trpc.globalAssistant.runSiteAction.useMutation();
  const [skipped, setSkipped] = useState(false);
  if (skipped) return null;

  if (run.isSuccess) {
    const link = siteActionDoneLink(action, run.data);
    return (
      <div className="ai-copilot-action-card is-done" data-fb="站級動作卡">
        <Icon name="Check" size={14} />
        <span className="ai-copilot-action-card__label">已完成：{action.label}</span>
        {link && onNavigate && (
          <Button variant="ghost" size="sm" onClick={() => onNavigate(link.href)}>{link.label}</Button>
        )}
      </div>
    );
  }
  // 以本人名義送出的內容必須全文可見再確認：label 只有摘要，私訊本文與筆記內容整段亮出來
  const fullText =
    action.type === "send_dm" ? action.body : action.type === "add_note" ? action.content : null;
  return (
    <div className="ai-copilot-action-card" data-fb="站級動作卡">
      <span className="ai-copilot-action-card__label">{action.label}</span>
      {fullText && <span className="ai-copilot-action-card__detail">{fullText}</span>}
      {run.error && <span className="ai-copilot-action-card__error">{run.error.message}</span>}
      <div className="ai-copilot-action-card__buttons">
        <Button
          size="sm"
          disabled={run.isPending}
          onClick={() => run.mutate(toSiteActionInput(action))}
        >
          {run.isPending ? "執行中…" : run.error ? "重試" : "確認執行"}
        </Button>
        <Button variant="ghost" size="sm" disabled={run.isPending} onClick={() => setSkipped(true)}>
          略過
        </Button>
      </div>
    </div>
  );
}

/** 派工確認卡：把目標交給某專案的 AI 代理排計畫（計畫仍需在該專案核准才會花點） */
function DispatchCard({ groupId, dispatch, onNavigate }: { groupId: string; dispatch: DispatchProposal; onNavigate?: (href: string) => void }) {
  const run = trpc.teamAssistant.dispatch.useMutation();
  const [skipped, setSkipped] = useState(false);
  if (skipped) return null;
  if (run.isSuccess) {
    return (
      <div className="ai-copilot-action-card is-done" data-fb="派工卡">
        <Icon name="Check" size={14} />
        <span className="ai-copilot-action-card__label">已建立待核准的代理計畫（估 {run.data.estPoints} 點）</span>
        {onNavigate && (
          <Button variant="ghost" size="sm" onClick={() => onNavigate(`/p/${dispatch.projectId}`)}>前往核准</Button>
        )}
      </div>
    );
  }
  return (
    <div className="ai-copilot-action-card" data-fb="派工卡">
      <span className="ai-copilot-action-card__label">{dispatch.label}</span>
      {run.error && <span className="ai-copilot-action-card__error">{run.error.message}</span>}
      <div className="ai-copilot-action-card__buttons">
        <Button size="sm" disabled={run.isPending} onClick={() => run.mutate({ groupId, projectId: dispatch.projectId, goal: dispatch.goal })}>
          {run.isPending ? "規劃中…" : run.error ? "重試" : "確認派工"}
        </Button>
        <Button variant="ghost" size="sm" disabled={run.isPending} onClick={() => setSkipped(true)}>略過</Button>
      </div>
    </div>
  );
}

/** 監督指令確認卡：核准／停止／放棄／重排子計畫、調整任務（權限在後端 runGroupCommand 內再驗一次） */
function CommandCard({ groupId, command }: { groupId: string; command: CommandProposal }) {
  const run = trpc.teamAssistant.command.useMutation();
  const [skipped, setSkipped] = useState(false);
  if (skipped) return null;
  if (run.isSuccess) {
    return (
      <div className="ai-copilot-action-card is-done" data-fb="指令卡">
        <Icon name="Check" size={14} />
        <span className="ai-copilot-action-card__label">已執行：{command.label}</span>
      </div>
    );
  }
  return (
    <div className="ai-copilot-action-card" data-fb="指令卡">
      <span className="ai-copilot-action-card__label">{command.label}</span>
      {command.reason && <span className="ai-copilot-action-card__reason">{command.reason}</span>}
      {run.error && <span className="ai-copilot-action-card__error">{run.error.message}</span>}
      <div className="ai-copilot-action-card__buttons">
        <Button size="sm" disabled={run.isPending} onClick={() => run.mutate({ groupId, command: command.command })}>
          {run.isPending ? "執行中…" : run.error ? "重試" : "確認"}
        </Button>
        <Button variant="ghost" size="sm" disabled={run.isPending} onClick={() => setSkipped(true)}>略過</Button>
      </div>
    </div>
  );
}

/**
 * WATCH foundation：開 sheet 還沒開口問之前，先把「需要你注意」遞過來。
 *
 * 全部重用既有唯讀查詢（groupInsights＝阻塞與逾期、agentOverview＝代理計畫動態），
 * 不新建掃描器、不加後端——這是 event-driven 的第一層：資料本來就在，缺的只是
 * 一個把它主動端到眼前的位置。全部健康時整塊不渲染（沒事就不要出聲）。
 */
function WatchDigest({ groupId, onNavigate }: { groupId: string; onNavigate?: (href: string) => void }) {
  const insights = trpc.teamAssistant.groupInsights.useQuery({ groupId });
  const overview = trpc.teamAssistant.agentOverview.useQuery({ groupId });
  const items: Array<{ key: string; text: string }> = [];
  const s = overview.data?.summary;
  if (s?.awaitingApproval) items.push({ key: "approve", text: `${s.awaitingApproval} 份代理計畫等你核准` });
  if (s?.failedRecent) items.push({ key: "failed", text: `近 7 天有 ${s.failedRecent} 份代理計畫失敗` });
  if (s?.waiting) items.push({ key: "waiting", text: `${s.waiting} 份代理計畫停在人類關卡等人` });
  const ins = insights.data;
  if (ins?.overdueTasks) items.push({ key: "overdue", text: `${ins.overdueTasks} 件人員任務已逾期` });
  for (const b of (ins?.blockers ?? []).filter((x) => x.severity === "critical").slice(0, 2)) {
    items.push({ key: `b:${b.label}`, text: b.label });
  }
  if (!items.length) return null;
  return (
    <div className="ai-copilot-watch" data-fb="需要你注意">
      <div className="ai-copilot-watch__title">
        <Icon name="Bell" size={13} />
        <span>需要你注意</span>
      </div>
      {items.slice(0, 5).map((item) => (
        <div key={item.key} className="ai-copilot-watch__row">{item.text}</div>
      ))}
      {onNavigate && (
        <Button variant="ghost" size="sm" onClick={() => onNavigate("/dashboard")}>
          去工作台處理
        </Button>
      )}
    </div>
  );
}

interface AICreativeCopilotProps {
  groupId?: string;
  /** 發問當下所在的專案頁（脈絡提示；只影響 trace 與伺服器端提示，不是授權） */
  projectId?: string;
  onUseIdeaForNewProject?: (ideaTitle: string) => void;
  /** 動作完成後「前往看結果」：由外殼決定怎麼導航（sheet 會先關閉自己再導） */
  onNavigate?: (href: string) => void;
}

export function AICreativeCopilot({ groupId, projectId, onUseIdeaForNewProject, onNavigate }: AICreativeCopilotProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // SSE 即時軌跡：這一題進行中的活動事件（thinking／lookup／step），答完清空
  const [liveEvents, setLiveEvents] = useState<AssistantActivityEvent[]>([]);
  const [liveOpen, setLiveOpen] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // 一次性 fallback：串流根本沒開始（舊代理、網路攔 SSE）才用；串流已吐過事件絕不重跑
  const ask = trpc.globalAssistant.ask.useMutation();
  const pending = streaming || ask.isPending;

  // 卸載（關 sheet／切 scope）時中止在途串流：後端收到 abort 會提早收工不白燒額度
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend ?? input).trim();
    if (!text || !groupId || pending) return;

    const newHistory = messages.slice(-6).map((m) => ({ role: m.role, text: m.text }));
    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setLiveEvents([]);
    // 底部導覽那顆球與這張卡是同一個助手的兩個身體：卡片在思考時球也要跟著脈動，
    // 否則使用者把 sheet 滑下去之後，畫面上就沒有任何「它還在想」的線索。
    setOrbState("thinking");

    type AskData = {
      answer: string;
      steps: string[];
      contextUsed?: string[];
      siteActions: SiteAction[];
      dispatches: DispatchProposal[];
      actions: CommandProposal[];
    };
    const applyDone = (data: AskData) => {
      setOrbState("speaking");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.answer,
          steps: data.steps,
          contextUsed: data.contextUsed ?? undefined,
          siteActions: data.siteActions.length ? data.siteActions : undefined,
          dispatches: data.dispatches.length ? data.dispatches : undefined,
          commands: data.actions.length ? data.actions : undefined,
        },
      ]);
    };
    const applyError = (message: string) => {
      setOrbState("error");
      setMessages((prev) => [...prev, { role: "assistant", text: `⚠️ 抱歉，生成回答時發生錯誤：${message}` }]);
    };

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    try {
      const handled = await requestSiteAssistantStream({
        groupId,
        message: text,
        history: newHistory,
        projectId,
        signal: controller.signal,
        handlers: {
          onStep: (e) => setLiveEvents((prev) => [...prev, e]),
          // SSE payload 是 GlobalAskResult 的純 JSON（無 superjson）；guard 只驗協定形狀，
          // 欄位型別由 tRPC 推導型別收窄（同一個 router 的回傳值）
          onDone: (d) => applyDone(d as unknown as AskData),
          onError: applyError,
        },
      });
      if (!handled) {
        // 串流沒開始：走一次性 tRPC（同一個核心；只是看不到即時軌跡）
        await new Promise<void>((resolve) => {
          ask.mutate(
            { groupId, message: text, history: newHistory, projectId },
            {
              onSuccess: (data) => { applyDone(data); resolve(); },
              onError: (err) => { applyError(err.message); resolve(); },
            },
          );
        });
      }
    } finally {
      setStreaming(false);
      setLiveEvents([]);
    }
  };

  useEffect(() => {
    if (messages.length > 0) {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, pending]);

  /** 光暈的強弱只有兩檔：待命時緩慢呼吸，思考時整圈亮起來並加速。
   *  狀態掛在外層 shell 而不是卡片上——光暈是卡片外緣的東西，
   *  卡片本身 overflow: hidden（feed 要能圓角裁切），罩不住自己的外光。 */
  const aiState = pending ? "thinking" : "idle";

  return (
    <div className="ai-copilot-shell" data-ai-state={aiState}>
      {/* 環境光：兩層互相錯開飄移的彩色暈斑，模糊後從卡片四周溢出。
          aria-hidden：它純粹是氛圍，讀屏念出來只會變成噪音。 */}
      <span className="ai-copilot-halo" aria-hidden="true" />

      <Card className="ai-copilot-card" data-fb="AI 創作助理">
        {/* 標頭（名牌、待命點、一行說明、底部的免費宣告）整組移除：那些是說明文字，
            不是助手。畫面上只留「能按的東西」與四周的感知光，其餘交給光自己講。
            清空對話留著但收成圖示鍵——它是功能，不是文案。 */}
        {messages.length > 0 && (
          <div className="ai-copilot-toolbar">
            <button
              type="button"
              className="ai-copilot-clear"
              onClick={() => {
                setMessages([]);
                ask.reset();
              }}
              title="清空對話紀錄"
              aria-label="清空對話紀錄"
            >
              <Icon name="Trash2" size={14} />
            </button>
          </div>
        )}

        {/* ── WATCH：還沒開口之前，先把需要注意的事遞過來（對話開始後讓位給對話） ── */}
        {messages.length === 0 && groupId && <WatchDigest groupId={groupId} onNavigate={onNavigate} />}

        {/* ── 靈感快捷按鈕 ── */}
        <div className="ai-copilot-prompts">
          {QUICK_PROMPTS.map((item, idx) => (
            <button
              key={idx}
              type="button"
              className="ai-copilot-prompt-pill"
              onClick={() => void handleSend(item.prompt)}
              disabled={pending || !groupId}
            >
              <Icon name={item.icon} size={13} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* ── 對話紀錄區域 ── */}
        {messages.length > 0 && (
          <div className="ai-copilot-chat-feed">
            {messages.map((msg, index) => (
              <div key={index} className={`ai-copilot-bubble ai-copilot-bubble--${msg.role}`}>
                <div className="ai-copilot-bubble__avatar">
                  {msg.role === "user" ? (
                    <span>我</span>
                  ) : (
                    <Icon name="Sparkles" size={15} />
                  )}
                </div>
                <div className="ai-copilot-bubble__content">
                  {msg.steps && msg.steps.length > 0 && (
                    <div className="ai-copilot-bubble__steps">
                      <Icon name="Search" size={11} />
                      <span>檢索了：{msg.steps.join("、")}</span>
                    </div>
                  )}
                  <div className="ai-copilot-bubble__text">{msg.text}</div>

                  {/* 動作提議：全部是「確認卡」，按下才以本人身分執行；AI 沒有代按的路 */}
                  {(msg.siteActions?.length || msg.dispatches?.length || msg.commands?.length) ? (
                    <div className="ai-copilot-bubble__cards">
                      {msg.siteActions?.map((a, i) => (
                        <SiteActionCard key={`s${i}`} action={a} onNavigate={onNavigate} />
                      ))}
                      {groupId && msg.dispatches?.map((d, i) => (
                        <DispatchCard key={`d${i}`} groupId={groupId} dispatch={d} onNavigate={onNavigate} />
                      ))}
                      {groupId && msg.commands?.map((c, i) => (
                        <CommandCard key={`c${i}`} groupId={groupId} command={c} />
                      ))}
                    </div>
                  ) : null}

                  {/* 如果是 AI 回覆，提供一鍵新專案的按鈕（帶靈感去建立表單；與 create_project
                      確認卡並存：卡是「AI 已擬好欄位」，這顆是「我自己去表單填」） */}
                  {msg.role === "assistant" && onUseIdeaForNewProject && !msg.siteActions?.some((a) => a.type === "create_project") && (
                    <div className="ai-copilot-bubble__actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          // 擷取第一句或主題作為專案名稱建議
                          const firstLine = msg.text.split("\n")[0].replace(/[#*「」]/g, "").trim();
                          onUseIdeaForNewProject(firstLine.slice(0, 30) || "新 AI 影音專案");
                        }}
                      >
                        <Icon name="Plus" size={13} style={{ marginRight: 4 }} />
                        以此靈感開新專案
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {pending && (
              <div className="ai-copilot-bubble ai-copilot-bubble--assistant is-thinking">
                <div className="ai-copilot-bubble__avatar">
                  <Icon name="Sparkles" size={15} />
                </div>
                <div className="ai-copilot-bubble__content">
                  {/* 旋轉的 Loader 圖示換成三顆呼吸的光點：轉圈是「系統卡住」的語彙，
                      光點才是「正在想」。文字本身也跑一道光掃過去。 */}
                  <div className="ai-copilot-bubble__text ai-copilot-loading">
                    <span className="ai-copilot-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="ai-copilot-loading__label">
                      {liveEvents.length ? liveEvents[liveEvents.length - 1].text : "AI 正在構思企劃中…"}
                    </span>
                  </div>
                  {/* SSE 即時軌跡：查了什麼、查到什麼，當下就看得到（與專案助手同一個元件）。
                      只在串流路徑渲染——一次性 fallback 沒有事件流，畫空軌跡只是噪音。 */}
                  {streaming && (
                    <LiveAssistantTrace
                      events={liveEvents}
                      open={liveOpen}
                      onToggle={() => setLiveOpen((v) => !v)}
                      onCancel={() => {
                        abortRef.current?.abort();
                        setOrbState("idle");
                      }}
                    />
                  )}
                </div>
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>
        )}

        {/* ── 輸入工具列 ── */}
        <div className="ai-copilot-input-box">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            /* 兩句都刻意壓在一行內：textarea 是 rows=1、min-height 24px 且外框
               overflow: hidden，字一旦折行就是被硬裁掉半截（原本兩句都會）。
               「Enter 送出」移到送出鍵的 title，那裡本來就寫著同一件事。 */
            placeholder={
              messages.length > 0
                ? "接著追問…（Shift + Enter 換行）"
                : "輸入任何想發想的主題或分鏡疑問…"
            }
            rows={1}
            maxLength={500}
            disabled={pending || !groupId}
            /* 可見標題全部拿掉之後，這是唯一的輸入口——placeholder 不是標籤
               （一打字就消失），讀屏需要一個穩定的名字。 */
            aria-label="向 AI 助手提問"
          />

          <button
            type="button"
            className="ai-copilot-send-btn"
            onClick={() => void handleSend()}
            disabled={!input.trim() || pending || !groupId}
            title="發送 (Enter)"
          >
            {pending ? (
              <Icon name="Loader" size={16} className="spin" />
            ) : (
              <Icon name="Send" size={16} />
            )}
          </button>
        </div>

      </Card>
    </div>
  );
}
