/**
 * Presenter / Follow 的行為回歸測試。
 *
 * 每一條都對應一個「不做會傷害使用者」的規則，而不是「元件有沒有渲染」：
 *   C. 收到邀請但不接受 → 畫面不能被拉走
 *   D. 接受之後 → 語意視圖跟著走
 *   E. 跟隨者自己操作 → 暫停
 *   F. 回到主講者 → 恢復
 *   G. 主講者離線 → 明確狀態，且不自動改跟別人
 *   H. 同一使用者兩個分頁 → 跟隨者不亂跳
 */
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ViewState } from "@shared/viewState";
import { usePresenterFollow } from "./usePresenterFollow";
import { FollowStatusBar, PresenterBadge, PresenterInvite } from "./PresenterBar";
import { buildViewState, detectVisibleSection } from "./viewStateBridge";
import type { CollabPeer, CollabPresenter, PeerView, PresentEnded } from "../../realtime";

const bruce: CollabPresenter = { userId: "u-bruce", connId: "c-bruce-1", name: "Bruce", color: "#c2613f", view: { section: "storyboard" } };
const peers = (...ids: string[]): CollabPeer[] => ids.map((userId) => ({ userId, name: userId, color: "#000" }));

function views(entries: Array<[string, string, ViewState]>): Map<string, PeerView> {
  return new Map(entries.map(([connId, userId, view]) => [connId, { connId, userId, name: userId, view }]));
}

/**
 * 派發一個輸入裝置事件。
 *
 * usePresenterFollow 只聽 wheel／touchmove／pointerdown／keydown——它們只會由
 * 真實輸入裝置產生。跟隨自己造成的程式化捲動發出的是 `scroll`，而那個型別
 * **不在監聽清單裡**，所以不需要（也無法可靠地用 isTrusted）事後過濾。
 */
function dispatchInput(type: string): void {
  window.dispatchEvent(new Event(type, { bubbles: true }));
}

describe("usePresenterFollow", () => {
  it("C. 收到邀請但不接受：狀態維持 off，targetView 為 null——畫面不會被拉走", () => {
    const onNavigate = vi.fn();
    const { result } = renderHook(() =>
      usePresenterFollow({
        presenters: [bruce],
        peerViews: views([["c-bruce-1", "u-bruce", { section: "storyboard", sceneId: "11111111-1111-1111-1111-111111111111" }]]),
        peers: peers("u-bruce"),
        onNavigate,
      }),
    );
    // 有邀請
    expect(result.current.invitation?.name).toBe("Bruce");
    // 但沒有被跟隨、也沒有任何導航發生
    expect(result.current.state.status).toBe("off");
    expect(result.current.targetView).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("D. 接受之後：語意視圖跟著走，並實際導航到主講者的位置", () => {
    const onNavigate = vi.fn();
    const target: ViewState = { section: "storyboard", sceneId: "11111111-1111-1111-1111-111111111111", tab: "visual" };
    const { result } = renderHook(() =>
      usePresenterFollow({
        presenters: [bruce],
        peerViews: views([["c-bruce-1", "u-bruce", target]]),
        peers: peers("u-bruce"),
        onNavigate,
      }),
    );
    act(() => result.current.join(bruce));
    expect(result.current.state.status).toBe("following");
    expect(result.current.targetView).toEqual(target);
    expect(onNavigate).toHaveBeenCalledWith(target);
  });

  it("E. 跟隨者自己捲動 → 暫停，且不再跟著移動", () => {
    const onNavigate = vi.fn();
    const { result } = renderHook(() =>
      usePresenterFollow({
        presenters: [bruce],
        peerViews: views([["c-bruce-1", "u-bruce", { section: "storyboard" }]]),
        peers: peers("u-bruce"),
        onNavigate,
      }),
    );
    act(() => result.current.join(bruce));
    act(() => dispatchInput("wheel"));
    expect(result.current.state.status).toBe("paused");
    expect(result.current.state.pauseReason).toBe("scroll");
    expect(result.current.targetView).toBeNull();
  });

  it("E2. 程式化捲動不會暫停跟隨——`scroll` 不在監聽清單裡，跟隨才不會自我暫停", () => {
    const { result } = renderHook(() =>
      usePresenterFollow({
        presenters: [bruce],
        peerViews: views([["c-bruce-1", "u-bruce", { section: "storyboard" }]]),
        peers: peers("u-bruce"),
      }),
    );
    act(() => result.current.join(bruce));
    // scrollTo／scrollIntoView（跟隨自己造成的捲動）發出的正是這個事件。
    // 若哪天有人把 "scroll" 加進 INTERACTION_EVENTS，這條會紅——那正是它的用途。
    act(() => dispatchInput("scroll"));
    expect(result.current.state.status).toBe("following");
  });

  it("F. 回到主講者：恢復跟隨，並重新導航到他「現在」的位置（不是暫停時的位置）", () => {
    const onNavigate = vi.fn();
    const target: ViewState = { section: "storyboard", tab: "visual" };
    const { result } = renderHook(() =>
      usePresenterFollow({
        presenters: [bruce],
        peerViews: views([["c-bruce-1", "u-bruce", target]]),
        peers: peers("u-bruce"),
        onNavigate,
      }),
    );
    act(() => result.current.join(bruce));
    act(() => dispatchInput("pointerdown"));
    expect(result.current.state.status).toBe("paused");
    onNavigate.mockClear();
    act(() => result.current.resume());
    expect(result.current.state.status).toBe("following");
    // 重新導航：回去時要到他現在在的地方
    expect(onNavigate).toHaveBeenCalledWith(target);
  });

  it("G. 主講者離線：進入 presenter_gone，而且**不會自動改跟另一個在線的人**", () => {
    const { rerender, result } = renderHook(
      (props: { peers: CollabPeer[]; presenters: CollabPresenter[] }) =>
        usePresenterFollow({
          presenters: props.presenters,
          peerViews: views([
            ["c-bruce-1", "u-bruce", { section: "storyboard" }],
            ["c-wei-1", "u-wei", { section: "story" }],
          ]),
          peers: props.peers,
        }),
      { initialProps: { peers: peers("u-bruce", "u-wei"), presenters: [bruce] } },
    );
    act(() => result.current.join(bruce));
    expect(result.current.state.status).toBe("following");

    // Bruce 掉線，韋澔還在
    rerender({ peers: peers("u-wei"), presenters: [bruce] });
    expect(result.current.state.status).toBe("presenter_gone");
    // 關鍵：跟隨對象還是 Bruce，沒有被換成韋澔
    expect(result.current.state.presenterId).toBe("u-bruce");
    expect(result.current.state.presenterName).toBe("Bruce");
    expect(result.current.targetView).toBeNull();
  });

  it("H. 同一使用者兩個分頁：跟隨鎖定 connId，不會在兩個位置之間亂跳", () => {
    const onNavigate = vi.fn();
    const tabA: ViewState = { section: "story" };
    const tabB: ViewState = { section: "storyboard", tab: "visual" };
    const { result } = renderHook(() =>
      usePresenterFollow({
        presenters: [bruce],
        // Bruce 同時開著兩個分頁，兩份完全不同的位置
        peerViews: views([
          ["c-bruce-1", "u-bruce", tabB],
          ["c-bruce-2", "u-bruce", tabA],
        ]),
        peers: peers("u-bruce"),
        onNavigate,
      }),
    );
    act(() => result.current.join(bruce)); // 加入的是 connId=c-bruce-1
    // 只跟他主講的那一個分頁，另一個分頁的位置完全不影響
    expect(result.current.targetView).toEqual(tabB);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(tabB);
  });

  it("主講者按「結束主講」（reason=stopped）→ 乾淨地離開跟隨", () => {
    const { rerender, result } = renderHook(
      (props: { presenters: CollabPresenter[]; ended?: PresentEnded | null }) =>
        usePresenterFollow({
          presenters: props.presenters,
          peerViews: views([["c-bruce-1", "u-bruce", { section: "storyboard" }]]),
          peers: peers("u-bruce"),
          presentEnded: props.ended,
        }),
      { initialProps: { presenters: [bruce] as CollabPresenter[], ended: null as PresentEnded | null } },
    );
    act(() => result.current.join(bruce));
    rerender({ presenters: [], ended: { connId: "c-bruce-1", reason: "stopped", at: 1 } });
    expect(result.current.state.status).toBe("off");
  });

  it("G2. 主講者斷線（reason=disconnected）→ presenter_gone，即使在場名單還沒更新", () => {
    // 實機雙瀏覽器抓到的回歸：斷線時 `present` 與 `presence` 是兩則獨立訊息，
    // 抵達順序不保證。舊版靠「他還在不在在場名單」去推，讀到還沒更新的名單，
    // 把斷線誤判成「他自己結束的」——狀態列直接消失，跟隨者只看到畫面
    // 突然不動而沒有任何解釋。所以這裡故意讓 peers **仍然包含** Bruce。
    const { rerender, result } = renderHook(
      (props: { presenters: CollabPresenter[]; ended?: PresentEnded | null }) =>
        usePresenterFollow({
          presenters: props.presenters,
          peerViews: views([["c-bruce-1", "u-bruce", { section: "storyboard" }]]),
          peers: peers("u-bruce"), // 名單尚未更新，Bruce 還在裡面
          presentEnded: props.ended,
        }),
      { initialProps: { presenters: [bruce] as CollabPresenter[], ended: null as PresentEnded | null } },
    );
    act(() => result.current.join(bruce));
    rerender({ presenters: [], ended: { connId: "c-bruce-1", reason: "disconnected", at: 1 } });
    expect(result.current.state.status).toBe("presenter_gone");
    expect(result.current.state.presenterName).toBe("Bruce");
  });

  it("別人的主講結束不影響我正在跟的那一場（比對 connId）", () => {
    const { rerender, result } = renderHook(
      (props: { ended?: PresentEnded | null }) =>
        usePresenterFollow({
          presenters: [bruce],
          peerViews: views([["c-bruce-1", "u-bruce", { section: "storyboard" }]]),
          peers: peers("u-bruce"),
          presentEnded: props.ended,
        }),
      { initialProps: { ended: null as PresentEnded | null } },
    );
    act(() => result.current.join(bruce));
    rerender({ ended: { connId: "c-someone-else", reason: "disconnected", at: 1 } });
    expect(result.current.state.status).toBe("following");
  });

  it("已經在跟隨時不再重複邀請（那只會變成洗版）", () => {
    const { result } = renderHook(() =>
      usePresenterFollow({ presenters: [bruce], peerViews: views([]), peers: peers("u-bruce") }),
    );
    expect(result.current.invitation).not.toBeNull();
    act(() => result.current.join(bruce));
    expect(result.current.invitation).toBeNull();
  });

  it("同一個位置不重複導航——重複套用會讓畫面看起來在抖", () => {
    const onNavigate = vi.fn();
    const target: ViewState = { section: "storyboard" };
    const { rerender, result } = renderHook(
      () =>
        usePresenterFollow({
          presenters: [bruce],
          peerViews: views([["c-bruce-1", "u-bruce", target]]),
          peers: peers("u-bruce"),
          onNavigate,
        }),
    );
    act(() => result.current.join(bruce));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    rerender();
    rerender();
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

describe("PresenterBar UI", () => {
  it("邀請卡說得出「誰在帶、他在哪」，並且加入是明確的動作", async () => {
    const user = userEvent.setup();
    const onJoin = vi.fn();
    render(<PresenterInvite presenter={bruce} onJoin={onJoin} onDismiss={vi.fn()} />);
    expect(screen.getByTestId("presenter-invite")).toHaveTextContent("Bruce");
    expect(screen.getByTestId("presenter-invite")).toHaveTextContent("正在帶大家看");
    expect(screen.getByTestId("presenter-invite")).toHaveTextContent("分鏡");
    await user.click(screen.getByRole("button", { name: "加入" }));
    expect(onJoin).toHaveBeenCalledTimes(1);
  });

  it("邀請可以拒絕——「不用了」必須存在，否則它就不是邀請而是命令", () => {
    render(<PresenterInvite presenter={bruce} onJoin={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("button", { name: "不用了" })).toBeInTheDocument();
  });

  it("主講者看得到有幾個人跟著，並隨時能結束", () => {
    render(<PresenterBadge followerCount={3} onStop={vi.fn()} />);
    expect(screen.getByTestId("presenter-badge")).toHaveTextContent("主講中");
    expect(screen.getByTestId("presenter-badge")).toHaveTextContent("3 人跟著");
    expect(screen.getByRole("button", { name: "結束主講" })).toBeInTheDocument();
  });

  it("暫停時說得出原因，並提供「回到 Bruce」", async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();
    render(
      <FollowStatusBar
        state={{ status: "paused", presenterId: "u-bruce", presenterName: "Bruce", connId: "c-1", pauseReason: "scroll" }}
        onResume={onResume}
        onLeave={vi.fn()}
      />,
    );
    expect(screen.getByTestId("follow-status")).toHaveTextContent("已暫停跟隨");
    expect(screen.getByTestId("follow-status")).toHaveTextContent("你自己捲動了");
    await user.click(screen.getByRole("button", { name: "回到 Bruce" }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("主講者離線時明說是「誰」離線——而不是靜悄悄地換人", () => {
    render(
      <FollowStatusBar
        state={{ status: "presenter_gone", presenterId: "u-bruce", presenterName: "Bruce", connId: null, pauseReason: null }}
        onResume={vi.fn()}
        onLeave={vi.fn()}
      />,
    );
    expect(screen.getByTestId("follow-status")).toHaveTextContent("Bruce 暫時離線");
  });

  it("跟隨中永遠有一鍵離開", () => {
    render(
      <FollowStatusBar
        state={{ status: "following", presenterId: "u-bruce", presenterName: "Bruce", connId: "c-1", pauseReason: null }}
        onResume={vi.fn()}
        onLeave={vi.fn()}
      />,
    );
    expect(screen.getByTestId("follow-status")).toHaveTextContent("正在跟隨 Bruce");
    expect(screen.getByRole("button", { name: "停止跟隨" })).toBeInTheDocument();
  });

  it("所有主要按鈕的觸控目標 >= 44px（手機是一級公民）", () => {
    const { unmount } = render(<PresenterInvite presenter={bruce} onJoin={vi.fn()} onDismiss={vi.fn()} />);
    for (const btn of screen.getAllByRole("button")) expect((btn as HTMLElement).style.minHeight).toBe("44px");
    unmount();
    render(
      <FollowStatusBar
        state={{ status: "paused", presenterId: "u-bruce", presenterName: "Bruce", connId: "c-1", pauseReason: "scroll" }}
        onResume={vi.fn()}
        onLeave={vi.fn()}
      />,
    );
    for (const btn of screen.getAllByRole("button")) expect((btn as HTMLElement).style.minHeight).toBe("44px");
  });

  it("狀態列以 role=status 播報：畫面自己在動時，不能只靠顏色讓人知道為什麼", () => {
    render(
      <FollowStatusBar
        state={{ status: "following", presenterId: "u-bruce", presenterName: "Bruce", connId: "c-1", pauseReason: null }}
        onResume={vi.fn()}
        onLeave={vi.fn()}
      />,
    );
    const bar = screen.getByTestId("follow-status");
    expect(bar).toHaveAttribute("role", "status");
    expect(bar).toHaveAttribute("aria-live", "polite");
  });
});

describe("viewStateBridge（語意視圖 ↔ DOM）", () => {
  it("zone 對應得出區塊時以 zone 優先（他真的在那裡編輯）", () => {
    expect(buildViewState({ zone: "scenes", visibleSection: "story" })).toEqual({ section: "storyboard" });
  });

  it("沒有 zone 時退回捲動位置——使用者純瀏覽時 viewState 仍要跟著動", () => {
    // 只看 zone 的舊版在這裡回 null，跟隨者於是停在原地而畫面上看不出哪裡不對
    // （實機雙瀏覽器抓到的）。
    expect(buildViewState({ zone: null, visibleSection: "storyboard" })).toEqual({ section: "storyboard" });
  });

  it("越具體的欄位一併帶上（哪一鏡、哪一版）", () => {
    const sceneId = "11111111-1111-1111-1111-111111111111";
    const assetId = "22222222-2222-2222-2222-222222222222";
    expect(buildViewState({ zone: "scenes", sceneId, assetId, tab: "visual" })).toEqual({
      section: "storyboard",
      sceneId,
      assetId,
      tab: "visual",
    });
  });

  it("什麼都沒有就回 null——不送空封包", () => {
    expect(buildViewState({ zone: null })).toBeNull();
  });

  it("detectVisibleSection：捲過哪個階段標頭就算在看哪一段", () => {
    document.body.innerHTML = `<div id="stage-story"></div><div id="stage-board"></div>`;
    const story = document.getElementById("stage-story")!;
    const board = document.getElementById("stage-board")!;
    // ① 已捲過、② 還在下面 → 在看 ①
    story.getBoundingClientRect = () => ({ top: -100, width: 10, height: 10 }) as DOMRect;
    board.getBoundingClientRect = () => ({ top: 5000, width: 10, height: 10 }) as DOMRect;
    expect(detectVisibleSection()).toBe("story");
    // 兩個都捲過了 → 取後面那個（與人的直覺一致）
    board.getBoundingClientRect = () => ({ top: -20, width: 10, height: 10 }) as DOMRect;
    expect(detectVisibleSection()).toBe("storyboard");
    document.body.innerHTML = "";
  });

  it("detectVisibleSection：隱藏中的區塊 rect 全 0，不可被誤判成「在看它」", () => {
    document.body.innerHTML = `<div id="stage-story"></div><div id="stage-board"></div>`;
    document.getElementById("stage-story")!.getBoundingClientRect = () =>
      ({ top: -100, width: 10, height: 10 }) as DOMRect;
    // 隱藏的 ②：rect 全 0，top=0 <= probe 會誤判——必須被寬高守衛擋掉
    document.getElementById("stage-board")!.getBoundingClientRect = () =>
      ({ top: 0, width: 0, height: 0 }) as DOMRect;
    expect(detectVisibleSection()).toBe("story");
    document.body.innerHTML = "";
  });
});
