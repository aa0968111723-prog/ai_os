/**
 * 協作中心：測的是「這一頁有沒有回答使用者的問題」，不是元件有沒有渲染。
 *
 * 三件事錯了這一頁就白做：
 *  1. 「找我」的順序若變回時間排序，它就只是另一條 feed。
 *  2. 討論若不依內容物件分組，使用者仍然要自己去翻是哪一格。
 *  3. 深連結若落在專案首頁，「找得到內容」就退化成「自己去找」。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CollaborationCenter, groupByProject, threadUrl } from "./CollaborationCenter";
import { relTime } from "../features/collaboration/CollabPanel";

const summaryQuery = vi.fn();

vi.mock("../api", () => ({
  trpc: { collaboration: { summary: { useQuery: (...a: unknown[]) => summaryQuery(...a) } } },
}));

function summary(over: Record<string, unknown> = {}) {
  return {
    groupId: "g-1",
    onlinePeers: [
      { userId: "u-wei", name: "韋澔", color: "#c2613f", projectIds: ["p-1"], projectTitles: ["挑戰營回顧影片"], zone: null },
    ],
    unreadMentions: 2,
    unreadReplies: 1,
    openAnnotations: 3,
    myTasks: 1,
    pendingApprovals: 1,
    attention: [
      { id: "n-approve", kind: "approval", title: "敏豐請你確認 V4", body: "", url: "/p/p-1?focus=task", projectId: "p-1", projectTitle: "挑戰營回顧影片", actorName: "敏豐", createdAt: "2026-08-06T00:00:00.000Z", weight: 100 },
      { id: "n-anno", kind: "annotation", title: "新的標注", body: "這裡人物眼神不自然", url: "/p/p-1?focus=annotation&mid=m1", projectId: "p-1", projectTitle: "挑戰營回顧影片", actorName: "敏豐", createdAt: "2026-08-07T00:00:00.000Z", weight: 80 },
      { id: "n-mention", kind: "mention", title: "韋澔 @ 了你", body: "", url: "/p/p-1?focus=messages", projectId: "p-1", projectTitle: "挑戰營回顧影片", actorName: "韋澔", createdAt: "2026-08-07T01:00:00.000Z", weight: 60 },
    ],
    threads: [
      { projectId: "p-1", projectTitle: "挑戰營回顧影片", refType: "scene", refId: "s-8", label: "分鏡", count: 5, openAnnotations: 1, lastAt: "2026-08-07T00:00:00.000Z" },
      { projectId: "p-1", projectTitle: "挑戰營回顧影片", refType: null, refId: null, label: "專案討論", count: 3, openAnnotations: 0, lastAt: "2026-08-06T00:00:00.000Z" },
    ],
    recentActivity: [
      { id: "a-1", kind: "annotation", actorName: "敏豐", projectId: "p-1", projectTitle: "挑戰營回顧影片", summary: "標注：這裡人物眼神不自然", at: "2026-08-07T00:00:00.000Z" },
    ],
    activeProjects: [
      { projectId: "p-1", title: "挑戰營回顧影片", messages: 8, openAnnotations: 3, onlineCount: 1, lastAt: "2026-08-07T00:00:00.000Z" },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  summaryQuery.mockReturnValue({ data: summary(), isLoading: false });
});

describe("CollaborationCenter", () => {
  it("預設停在「找我」，並依阻塞程度排序——待我核准排在被提及前面", () => {
    render(<CollaborationCenter groupId="g-1" />);
    const rows = screen.getAllByTestId("attention-row");
    // 順序是 approval > annotation > mention，不是 createdAt 由新到舊
    // （若改回時間排序，被 @ 的那則最新，會跑到第一個）
    expect(rows[0]).toHaveTextContent("敏豐請你確認 V4");
    expect(rows[1]).toHaveTextContent("新的標注");
    expect(rows[2]).toHaveTextContent("韋澔 @ 了你");
  });

  it("在線夥伴帶得出「他正在哪個專案」——這才讓在場從裝飾變成可行動資訊", () => {
    render(<CollaborationCenter groupId="g-1" />);
    const chips = screen.getByLabelText("在線夥伴");
    expect(chips).toHaveTextContent("韋澔");
    expect(chips).toHaveTextContent("挑戰營回顧影片");
  });

  it("討論分頁依內容物件分組，並各自帶討論數與未解決標注數", async () => {
    const user = userEvent.setup();
    render(<CollaborationCenter groupId="g-1" />);
    await user.click(screen.getByRole("tab", { name: /討論/ }));
    const rows = screen.getAllByTestId("thread-row");
    expect(rows[0]).toHaveTextContent("分鏡");
    expect(rows[0]).toHaveTextContent("5");
    expect(rows[0]).toHaveTextContent("1"); // 未解決標注
    expect(rows[1]).toHaveTextContent("專案討論");
  });

  it("動態與收件匣是兩件事：動態顯示發生過什麼，不因為看過就消失", async () => {
    const user = userEvent.setup();
    render(<CollaborationCenter groupId="g-1" />);
    await user.click(screen.getByRole("tab", { name: /動態/ }));
    expect(screen.getByTestId("activity-row")).toHaveTextContent("標注：這裡人物眼神不自然");
    expect(screen.getByText(/不會因為你看過就消失/)).toBeInTheDocument();
  });

  it("任務分頁只列指派給我與待我核准的，不混進一般提及", async () => {
    const user = userEvent.setup();
    render(<CollaborationCenter groupId="g-1" />);
    await user.click(screen.getByRole("tab", { name: /任務/ }));
    const rows = screen.getAllByTestId("attention-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("敏豐請你確認 V4");
  });

  it("分頁按鈕的觸控目標 >= 44px（手機是一級公民）", () => {
    render(<CollaborationCenter groupId="g-1" />);
    for (const tab of screen.getAllByRole("tab")) {
      expect((tab as HTMLElement).style.minHeight).toBe("44px");
    }
  });

  it("沒有團隊時給引導而不是紅字錯誤", () => {
    summaryQuery.mockReturnValue({ data: undefined, isLoading: false });
    render(<CollaborationCenter groupId={null} />);
    expect(screen.getByText("還沒有團隊")).toBeInTheDocument();
  });
});

describe("threadUrl（深連結）", () => {
  it("綁到分鏡的討論落在那一格，不是專案首頁", () => {
    expect(threadUrl("p-1", { refType: "scene", refId: "s-8" })).toBe("/p/p-1?focus=annotation&sceneId=s-8");
  });

  it("綁到其他內容物件時也帶得出 refId", () => {
    expect(threadUrl("p-1", { refType: "generation", refId: "g-3" })).toBe("/p/p-1?focus=generation&refId=g-3");
  });

  it("沒綁內容物件才落在專案留言區", () => {
    expect(threadUrl("p-1", { refType: null, refId: null })).toBe("/p/p-1?focus=messages");
  });
});

describe("groupByProject", () => {
  it("依專案收攏並保留伺服器給的時間順序", () => {
    const t = (projectId: string, label: string) => ({
      projectId, projectTitle: "x", refType: null, refId: null, label, count: 1, openAnnotations: 0, lastAt: "",
    });
    const out = groupByProject([t("a", "1"), t("b", "2"), t("a", "3")]);
    expect(out.map(([id]) => id)).toEqual(["a", "b"]);
    expect(out[0][1].map((x) => x.label)).toEqual(["1", "3"]);
  });
});

describe("relTime", () => {
  const now = new Date("2026-08-07T12:00:00.000Z").getTime();
  it("說人話而不是 ISO 字串", () => {
    expect(relTime("2026-08-07T11:50:00.000Z", now)).toBe("10 分鐘前");
    expect(relTime("2026-08-07T09:00:00.000Z", now)).toBe("3 小時前");
    expect(relTime("2026-08-05T12:00:00.000Z", now)).toBe("2 天前");
    expect(relTime("2026-08-07T11:59:50.000Z", now)).toBe("剛剛");
  });
  it("壞值回空字串而不是 NaN", () => {
    expect(relTime("not-a-date", now)).toBe("");
  });
});
