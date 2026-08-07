/**
 * 知識族譜卡的使用者旅程：手機上「找到某一筆並打開它」必須在清單檢視裡一路可達，
 * 不必去戳 0.39x 放射圖上的 2px 圓點。
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const setLocation = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/planner", setLocation],
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const P1 = "11111111-1111-1111-1111-111111111111";
const GRAPH = {
  projects: [{ id: P1, title: "爬山前導", status: "active", updatedAt: "2026-01-01" }],
  notes: [
    { id: "n1", projectId: P1, title: "場勘筆記", createdBy: "me", mentions: null, updatedAt: "2026-01-01T00:00:00Z" },
    { id: "n2", projectId: null, title: "組務雜記", createdBy: "me", mentions: null, updatedAt: "2026-01-01T00:00:00Z" },
  ],
  schedule: [{ id: "s1", projectId: P1, title: "始業式", startsAt: "2026-01-02T00:00:00Z", createdBy: "me", mentions: null }],
  knowledge: [{ id: "k1", projectId: P1, kind: "transcript", title: "師父開示：登山", chars: 1200, createdBy: "me", createdAt: "2026-01-01" }],
  agents: [],
  databases: [{ id: "d1", scope: "group", name: "報名名單", rowCount: 42, agentAccess: "read", createdBy: "me", updatedAt: "2026-01-01" }],
};

vi.mock("../api", () => ({
  trpc: {
    auth: { me: { useQuery: () => ({ data: { user: { id: "me" } } }) } },
    knowledgeMap: { graph: { useQuery: () => ({ data: GRAPH, isLoading: false, error: null }) } },
  },
}));

import { KnowledgeMapCard } from "./PlannerPage";

const GROUP = "group-1";
/** 卡片預設檢視在手機是清單、桌機是心智圖；jsdom 的 matchMedia 一律 false，測試自己指定 */
const renderCard = (view: "list" | "map" = "list") => {
  localStorage.setItem(`map-view-${GROUP}`, view);
  return render(<KnowledgeMapCard groupId={GROUP} initiallyOpen />);
};

/** 分支名和型別開關的名稱會撞（「資料庫」「行程」）：分支查清單容器內，型別開關查 aria-pressed 的那顆 */
const branchToggle = (name: RegExp) =>
  within(screen.getByTestId("map-list"))
    .getAllByRole("button", { name })
    // 分支頭同時有「收合鈕」與「開啟資料庫頁」，帶 aria-expanded 的才是收合鈕
    .find((el) => el.hasAttribute("aria-expanded"))!;
const typeToggle = (name: RegExp) => screen.getByRole("button", { name, pressed: true });

describe("知識族譜卡・清單檢視", () => {
  it("分支照專案分組，第一支預設展開、其餘收合", async () => {
    renderCard();
    // 分支標題都在
    expect(branchToggle(/爬山前導/)).toBeInTheDocument();
    expect(branchToggle(/組層級/)).toBeInTheDocument();
    expect(branchToggle(/資料庫/)).toBeInTheDocument();
    // 內容最多的那支預設展開
    expect(screen.getByText("場勘筆記")).toBeInTheDocument();
    expect(screen.queryByText("組務雜記")).not.toBeInTheDocument();

    await userEvent.click(branchToggle(/組層級/));
    expect(screen.getByText("組務雜記")).toBeInTheDocument();
  });

  it("每列一個節點，點下去直接開那一筆（不必先選再按前往）", async () => {
    renderCard();
    await userEvent.click(screen.getByText("師父開示：登山"));
    expect(setLocation).toHaveBeenCalledWith(`/p/${P1}`);
  });

  it("資料庫節點深連結到那張表", async () => {
    renderCard();
    await userEvent.click(branchToggle(/資料庫/));
    await userEvent.click(screen.getByText("報名名單"));
    expect(setLocation).toHaveBeenCalledWith("/databases?open=d1");
  });

  it("搜尋跨分支收斂，命中者自動展開", async () => {
    renderCard();
    await userEvent.type(screen.getByLabelText("搜尋知識族譜節點"), "組務");
    expect(screen.getByText("組務雜記")).toBeInTheDocument();
    expect(screen.queryByText("場勘筆記")).not.toBeInTheDocument();
    expect(screen.queryByText("報名名單")).not.toBeInTheDocument();
  });

  it("搜不到時給的是「找不到」而不是空白畫布", async () => {
    renderCard();
    await userEvent.type(screen.getByLabelText("搜尋知識族譜節點"), "不存在的東西");
    expect(screen.getByText(/找不到/)).toBeInTheDocument();
  });

  it("型別開關關掉行程，行程節點就從清單消失", async () => {
    renderCard();
    expect(screen.getByText("始業式")).toBeInTheDocument();
    await userEvent.click(typeToggle(/行程/));
    expect(screen.queryByText("始業式")).not.toBeInTheDocument();
  });
});

describe("知識族譜卡・檢視切換", () => {
  it("心智圖／清單可互切，選擇記在這台裝置", async () => {
    renderCard("map");
    expect(screen.getByRole("group", { name: /知識地圖/ })).toBeInTheDocument();

    const tabs = screen.getByRole("tablist", { name: "檢視" });
    await userEvent.click(within(tabs).getByRole("tab", { name: /清單/ }));
    expect(screen.queryByRole("group", { name: /知識地圖/ })).not.toBeInTheDocument();
    expect(screen.getByText("場勘筆記")).toBeInTheDocument();
    expect(localStorage.getItem(`map-view-${GROUP}`)).toBe("list");
  });
});

/**
 * 全螢幕：卡片裡的族譜在手機上只有一小塊（0.39x 後字剩 4px），要看得懂得攤開整個視窗。
 * jsdom 沒有 Fullscreen API，所以這裡守的是「沒有原生全螢幕時 CSS 沉浸那一層仍然成立」——
 * 只做 requestFullscreen 的話，iOS Safari 使用者按下按鈕會完全沒反應。
 */
describe("知識族譜卡・全螢幕", () => {
  const fullscreenButton = () => screen.getByRole("button", { name: /全螢幕/ });
  const host = () => document.querySelector(".map-host")!;

  it("按鈕在清單與心智圖都在，按下去就進沉浸（不依賴原生 Fullscreen API）", async () => {
    renderCard("map");
    expect(host()).not.toHaveClass("is-immersive");

    await userEvent.click(fullscreenButton());
    expect(host()).toHaveClass("is-immersive");
    // 全站浮動殼層（頂欄、分頁列、私訊球、回饋浮標）靠這個 body 類別讓開
    expect(document.body).toHaveClass("map-immersive");
    expect(fullscreenButton()).toHaveAttribute("aria-pressed", "true");
  });

  it("搜尋與檢視切換一起進全螢幕——不必退出來才能改條件", async () => {
    renderCard("map");
    await userEvent.click(fullscreenButton());
    const wrapper = host();
    expect(wrapper.querySelector('[aria-label="搜尋知識族譜節點"]')).toBeInTheDocument();
    expect(wrapper.querySelector('[role="tablist"][aria-label="檢視"]')).toBeInTheDocument();
    expect(wrapper.querySelector('[role="group"][aria-label^="知識地圖"]')).toBeInTheDocument();
  });

  it("Esc 退得出去（iOS Safari 只有 CSS 沉浸那一層，瀏覽器不會幫忙）", async () => {
    renderCard("map");
    await userEvent.click(fullscreenButton());
    expect(host()).toHaveClass("is-immersive");

    await userEvent.keyboard("{Escape}");
    expect(host()).not.toHaveClass("is-immersive");
    expect(document.body).not.toHaveClass("map-immersive");
  });

  it("離開卡片時把 body 類別拆掉——殘留的話全站頂欄與分頁列會永久消失", async () => {
    const { unmount } = renderCard("map");
    await userEvent.click(fullscreenButton());
    expect(document.body).toHaveClass("map-immersive");

    unmount();
    expect(document.body).not.toHaveClass("map-immersive");
  });
});
