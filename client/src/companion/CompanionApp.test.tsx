import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const orbStates: string[] = [];
let turn: Record<string, unknown> | null = null;
const sheetProps: Record<string, unknown>[] = [];

vi.mock("./CompanionHome", () => ({
  CompanionHome: ({ onOpenTab }: { onOpenTab?: (tab: "tasks") => void }) => (
    <div>
      <span>首頁</span>
      <button type="button" onClick={() => onOpenTab?.("tasks")}>去任務</button>
    </div>
  ),
}));
vi.mock("./CompanionTasks", () => ({ CompanionTasks: () => <div>任務頁</div> }));
vi.mock("./CompanionMe", () => ({ CompanionMe: () => <div>我的頁</div> }));
vi.mock("../app/components/GlobalAssistantSheet", () => ({
  GlobalAssistantSheet: (props: Record<string, unknown>) => {
    sheetProps.push(props);
    return props.open ? <div role="dialog">助手面板</div> : null;
  },
}));
vi.mock("../lib/orbState", () => ({ setOrbState: (state: string) => orbStates.push(state) }));
vi.mock("../lib/phoneAssistantBridge", () => ({ usePhoneAssistantTurn: () => turn }));

let composeListener: ((text: string) => void) | undefined;
vi.mock("../lib/assistantCompose", () => ({
  useAssistantComposeListener: (cb: (text: string) => void) => { composeListener = cb; },
  useAssistantOpenListener: () => {},
  composeToAssistant: () => {},
  openAssistantSurface: () => {},
}));

import { CompanionApp } from "./CompanionApp";

const groups = [{ groupId: "g1", groupName: "動畫組", role: "member" }];

beforeEach(() => {
  orbStates.length = 0;
  sheetProps.length = 0;
  turn = null;
  composeListener = undefined;
});

function renderApp(over: Record<string, unknown> = {}) {
  return render(
    <CompanionApp
      groupId="g1"
      userName="小明"
      groups={groups}
      onActiveGroupIdChange={vi.fn()}
      {...over}
    />,
  );
}

describe("導航", () => {
  it("只有三格：AI／任務／我——不是桌面導覽的縮小版", () => {
    renderApp();
    const nav = screen.getByRole("navigation", { name: "主要功能" });
    expect(nav.querySelectorAll("button")).toHaveLength(3);
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("任務")).toBeInTheDocument();
    expect(screen.getByText("我")).toBeInTheDocument();
  });

  it("預設停在 AI 分頁（App 打開就看到球）", () => {
    renderApp();
    expect(screen.getByText("首頁")).toBeInTheDocument();
  });

  it("換分頁換內容", async () => {
    renderApp();
    fireEvent.click(screen.getByText("任務").closest("button")!);
    await waitFor(() => expect(screen.getByText("任務頁")).toBeInTheDocument());
    fireEvent.click(screen.getByText("我").closest("button")!);
    await waitFor(() => expect(screen.getByText("我的頁")).toBeInTheDocument());
  });

  it("首頁上滑可以跳到任務分頁", async () => {
    renderApp();
    fireEvent.click(screen.getByText("去任務"));
    await waitFor(() => expect(screen.getByText("任務頁")).toBeInTheDocument());
  });

  it("未讀時任務格有紅點與讀屏說明", () => {
    renderApp({ unreadCount: 3 });
    expect(screen.getByText("（有 3 則未讀）")).toBeInTheDocument();
  });
});

describe("助手面板", () => {
  it("Companion 自己掛一張，且預設關著", () => {
    renderApp();
    expect(sheetProps[0]).toMatchObject({ open: false, groupId: "g1" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("有人對 Aios 說話時面板打開", async () => {
    renderApp();
    fireEvent.click(screen.getByText("首頁"));
    composeListener?.("動畫做到哪了");
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it("已經在 AI 分頁時再點球＝打開面板", async () => {
    renderApp();
    fireEvent.click(screen.getByText("AI").closest("button")!);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });
});

describe("與既有小球對齊", () => {
  it("八態投影回既有四態，兩顆球不會講不同的話", async () => {
    turn = { running: true };
    renderApp();
    await waitFor(() => expect(orbStates).toContain("thinking"));
  });

  it("待確認在舊球上是 speaking", async () => {
    turn = { running: false, pendingProposals: [{ id: "p1", label: "建立任務" }] };
    renderApp();
    await waitFor(() => expect(orbStates).toContain("speaking"));
  });
});
