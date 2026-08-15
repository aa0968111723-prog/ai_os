import { useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { Button } from "../components/ui";
import { composeToAssistant } from "../lib/assistantCompose";
import { getAssistantQuickActions } from "../lib/assistantQuickActions";
import { useAssistantContext } from "../lib/assistantContext";

/**
 * 手機 AI-first 的主要入口：一列輸入框 ＋ 2–4 顆情境快捷。
 *
 * ## 為什麼不是「再做一個助手」
 *
 * 這裡**沒有任何對話狀態、沒有 model 呼叫、沒有工具執行**。送出只做一件事：
 * `composeToAssistant(text)` —— 把那句話丟到既有的 `aios:assistant-compose` 事件上，
 * 由 `MobileNavigation` 掛著的 `GlobalAssistantSheet` 接住、打開、填進輸入框。
 * 走的是使用者自己在助手裡打字完全相同的那條路（意圖判定、確認卡、執行全部沿用）。
 *
 * 所以站內仍然只有一套 Assistant。這個元件是它的**遙控器**，不是第二個它。
 *
 * ## 為什麼這件事對手機的 initial load 是關鍵
 *
 * 助手本體（AICreativeCopilot 54KB／ProjectAssistant 96KB）是 lazy chunk，
 * 只有真的打開 sheet 才下載。如果首頁直接嵌一個「可用的助手」，那兩個 chunk
 * 就會進首屏——AI-first 反而讓手機更慢。這個 bar 自己只有輸入框與按鈕，
 * 幾百 bytes；使用者真的說了話，才付助手的錢（漸進式 hydration）。
 *
 * 快捷來自既有的 `getAssistantQuickActions(pageCtx)`：分鏡頁是「下一幕／修改這幕／
 * 檢查角色」，素材頁是「加入場景／找相關素材／整理素材」——不另外寫一份手機的清單，
 * 否則兩邊的字遲早會分岔。
 */
export function MobileAiBar({
  placeholder = "想做什麼？直接跟 Aios 說",
  /** 額外插在情境快捷前面的一顆（例如專案頁的「接下來做什麼？」） */
  lead,
}: {
  placeholder?: string;
  lead?: { label: string; prompt: string };
}) {
  const ctx = useAssistantContext();
  const [text, setText] = useState("");
  // 頁面情境快捷最多 4 顆；有 lead 時留一格給它，總數仍守住「不做成滿版功能選單」
  const contextual = getAssistantQuickActions(ctx).slice(0, lead ? 3 : 4);

  const send = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    composeToAssistant(trimmed);
    setText("");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(text);
  };

  return (
    <section className="m-ai" aria-label="問 Aios">
      <form className="m-ai__form" onSubmit={onSubmit}>
        <Icon name="Sparkles" size={16} />
        <input
          className="m-ai__input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label="跟 Aios 說一句話"
          enterKeyHint="send"
        />
        <Button
          variant="primary"
          size="sm"
          type="submit"
          className="m-ai__send"
          disabled={!text.trim()}
          aria-label="送出給 Aios"
        >
          <Icon name="ArrowRight" size={15} />
        </Button>
      </form>
      <div className="m-ai__quick">
        {lead && (
          <button type="button" className="m-ai__chip m-ai__chip--lead" onClick={() => send(lead.prompt)}>
            {lead.label}
          </button>
        )}
        {contextual.map((action) => (
          <button key={action.id} type="button" className="m-ai__chip" onClick={() => send(action.prompt)}>
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}
