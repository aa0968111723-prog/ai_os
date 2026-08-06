import { useState, useRef, useEffect } from "react";
import { trpc } from "../api";
import { Icon, type IconName } from "./Icon";
import { Button, Card, Chip, Hint, Meta } from "./ui";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  steps?: string[];
  contextUsed?: string[];
}

const QUICK_PROMPTS: { icon: IconName; label: string; prompt: string }[] = [
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

    ask.mutate(
      {
        groupId,
        message: text,
        history: newHistory,
      },
      {
        onSuccess: (data) => {
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

  return (
    <Card className="ai-copilot-card" data-fb="AI 創作助理">
      {/* ── 頂部標頭 ── */}
      <div className="ai-copilot-header">
        <div className="ai-copilot-header__left">
          <div className="ai-copilot-badge">
            <Icon name="Sparkles" size={16} className="ai-copilot-badge__icon" />
            <span>AI 創作助理</span>
          </div>
          <span className="ai-copilot-status-dot" title="隨時待命" />
          <Meta style={{ margin: 0 }}>靈感發想・分鏡建議・專案全知解答</Meta>
        </div>

        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMessages([]);
              ask.reset();
            }}
            title="清空對話紀錄"
          >
            <Icon name="Trash2" size={13} style={{ marginRight: 4 }} />
            清空對話
          </Button>
        )}
      </div>

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
            <div className="ai-copilot-bubble ai-copilot-bubble--assistant">
              <div className="ai-copilot-bubble__avatar">
                <Icon name="Sparkles" size={15} className="spin" />
              </div>
              <div className="ai-copilot-bubble__content">
                <div className="ai-copilot-bubble__text ai-copilot-loading">
                  <Icon name="Loader" size={14} className="spin" />
                  <span>AI 正在構思企劃中…</span>
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
          placeholder={
            messages.length > 0
              ? "接著追問…（Shift + Enter 換行，Enter 送出）"
              : "輸入任何想發想的主題、分鏡疑問或專案提問…（例如：幫我想個咖啡短片主題）"
          }
          rows={1}
          maxLength={500}
          disabled={ask.isPending || !groupId}
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

      <Hint layer="always" style={{ margin: "8px 0 0", fontSize: 12, color: "var(--fg-secondary)" }}>
        💡 免費・無限制發想。AI 隨時待命為您提供腳本點子、分鏡架構與專案全知建議。
      </Hint>
    </Card>
  );
}
