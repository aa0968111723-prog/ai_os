import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  composeToAssistant,
  resetPendingComposeForTest,
  useAssistantComposeListener,
} from "./assistantCompose";

afterEach(() => resetPendingComposeForTest());

/** 助手本體的替身：晚一步掛載，就像真的 lazy chunk 那樣 */
function LateAssistantBody() {
  const [text, setText] = useState("");
  useAssistantComposeListener(setText, true);
  return <output data-testid="assistant-input">{text}</output>;
}

/** 面板擁有者的替身：只負責「打開」，不該吃掉那句話 */
function PanelOwner() {
  const [open, setOpen] = useState(false);
  useAssistantComposeListener(() => setOpen(true));
  return open ? <LateAssistantBody /> : <span data-testid="closed" />;
}

describe("把話交給 Aios（assistantCompose）", () => {
  /** dispatch 是 React 之外的事件——要包 act 才會把它引發的 state 更新沖進畫面 */
  const say = (text: string) => act(() => composeToAssistant(text));

  it("面板還沒開就送出的那句話，助手掛好之後補得回來", () => {
    // 這是手機 AI-first 最常見的動線：首頁打字 → 送出 → sheet 才打開 → 助手才載。
    // 沒有補領機制的話，使用者打的第一句話會憑空消失（面板開了但輸入框是空的）。
    render(<PanelOwner />);
    expect(screen.getByTestId("closed")).toBeInTheDocument();

    say("幫我生成下一個分鏡");

    expect(screen.getByTestId("assistant-input")).toHaveTextContent("幫我生成下一個分鏡");
  });

  it("補領只發生一次——重掛不會冒出上一句舊句子", () => {
    const first = render(<PanelOwner />);
    say("查看角色");
    expect(screen.getByTestId("assistant-input")).toHaveTextContent("查看角色");
    first.unmount();

    // 切視野／換專案會讓助手重掛；那句話已經被取走，不該再出現
    render(<LateAssistantBody />);
    expect(screen.getByTestId("assistant-input")).toHaveTextContent("");
  });

  it("已經掛好的助手直接收事件（不必等補領）", () => {
    render(<LateAssistantBody />);
    say("檢查一致性");
    expect(screen.getByTestId("assistant-input")).toHaveTextContent("檢查一致性");
  });

  it("空字串不觸發任何東西", () => {
    render(<LateAssistantBody />);
    say("   ");
    expect(screen.getByTestId("assistant-input")).toHaveTextContent("");
  });
});
