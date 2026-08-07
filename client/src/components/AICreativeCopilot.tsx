import { useState, useRef, useEffect } from "react";
import { trpc } from "../api";
import { setOrbState } from "../lib/orbState";
import { Icon, type IconName } from "./Icon";
import { Button, Card } from "./ui";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  steps?: string[];
  contextUsed?: string[];
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

interface AICreativeCopilotProps {
  groupId?: string;
  onUseIdeaForNewProject?: (ideaTitle: string) => void;
}

export function AICreativeCopilot({ groupId, onUseIdeaForNewProject }: AICreativeCopilotProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const ask = trpc.teamAssistant.ask.useMutation();

  const handleSend = (textToSend?: string) => {
    const text = (textToSend ?? input).trim();
    if (!text || !groupId || ask.isPending) return;

    const newHistory = messages.slice(-6).map((m) => ({ role: m.role, text: m.text }));
    const userMsg: ChatMessage = { role: "user", text };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    // 底部導覽那顆球與這張卡是同一個助手的兩個身體：卡片在思考時球也要跟著脈動，
    // 否則使用者把 sheet 滑下去之後，畫面上就沒有任何「它還在想」的線索。
    setOrbState("thinking");

    ask.mutate(
      {
        groupId,
        message: text,
        history: newHistory,
      },
      {
        onSuccess: (data) => {
          setOrbState("speaking");
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              text: data.answer,
              steps: data.steps,
              contextUsed: data.contextUsed ?? undefined,
            },
          ]);
        },
        onError: (err) => {
          setOrbState("error");
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              text: `⚠️ 抱歉，生成回答時發生錯誤：${err.message}`,
            },
          ]);
        },
      }
    );
  };

  useEffect(() => {
    if (messages.length > 0) {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, ask.isPending]);

  /** 光暈的強弱只有兩檔：待命時緩慢呼吸，思考時整圈亮起來並加速。
   *  狀態掛在外層 shell 而不是卡片上——光暈是卡片外緣的東西，
   *  卡片本身 overflow: hidden（feed 要能圓角裁切），罩不住自己的外光。 */
  const aiState = ask.isPending ? "thinking" : "idle";

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

        {/* ── 靈感快捷按鈕 ── */}
        <div className="ai-copilot-prompts">
          {QUICK_PROMPTS.map((item, idx) => (
            <button
              key={idx}
              type="button"
              className="ai-copilot-prompt-pill"
              onClick={() => handleSend(item.prompt)}
              disabled={ask.isPending || !groupId}
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

                  {/* 如果是 AI 回覆，提供一鍵新專案的按鈕 */}
                  {msg.role === "assistant" && onUseIdeaForNewProject && (
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

            {ask.isPending && (
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
                    <span className="ai-copilot-loading__label">AI 正在構思企劃中…</span>
                  </div>
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
                handleSend();
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
            disabled={ask.isPending || !groupId}
            /* 可見標題全部拿掉之後，這是唯一的輸入口——placeholder 不是標籤
               （一打字就消失），讀屏需要一個穩定的名字。 */
            aria-label="向 AI 助手提問"
          />

          <button
            type="button"
            className="ai-copilot-send-btn"
            onClick={() => handleSend()}
            disabled={!input.trim() || ask.isPending || !groupId}
            title="發送 (Enter)"
          >
            {ask.isPending ? (
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
