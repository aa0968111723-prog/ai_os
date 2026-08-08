import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const flashAnchor = vi.fn();
const listQuery = vi.fn();
const olderPageQuery = vi.fn();

vi.mock("../discuss", () => ({
  DISCUSS_EVENT: "aios:discuss",
  flashAnchor: (...a: unknown[]) => flashAnchor(...a),
  jumpToRef: vi.fn(),
  setPlannerFocus: vi.fn(),
  takePendingDiscussRef: () => null,
}));

vi.mock("wouter", () => ({ useLocation: () => ["/p/p1", vi.fn()] }));

vi.mock("../api", () => {
  const noopMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null });
  return {
    trpc: {
      useUtils: () => ({
        messages: { list: { invalidate: vi.fn() } },
        tasks: { listByProject: { invalidate: vi.fn() } },
        decisions: { list: { invalidate: vi.fn() } },
        client: { messages: { list: { query: (...a: unknown[]) => olderPageQuery(...a) } } },
      }),
      auth: { me: { useQuery: () => ({ data: { user: { id: "me", name: "我" } }, isLoading: false }) } },
      messages: {
        list: { useQuery: (...a: unknown[]) => listQuery(...a) },
        markRead: { useMutation: noopMutation },
        post: { useMutation: noopMutation },
        postVoice: { useMutation: noopMutation },
        react: { useMutation: noopMutation },
        setPinned: { useMutation: noopMutation },
      },
      notes: { add: { useMutation: noopMutation }, list: { useQuery: () => ({ data: [] }) } },
      tasks: { create: { useMutation: noopMutation } },
      decisions: { create: { useMutation: noopMutation } },
      schedule: { add: { useMutation: noopMutation }, list: { useQuery: () => ({ data: { items: [] } }) } },
      projects: {
        listMemberRoles: {
          useQuery: () => ({ data: { members: [{ userId: "me", name: "我" }, { userId: "u2", name: "阿明" }] } }),
        },
      },
    },
  };
});

import { MessagePanel } from "./MessagePanel";

const msg = (id: string, body: string) => ({
  id,
  body,
  kind: "text",
  userId: "u2",
  userName: "阿明",
  replyToId: null,
  replyTo: null,
  pinned: false,
  refType: null,
  refId: null,
  mentions: ["me"],
  voiceStatus: null,
  reactions: [],
  createdAt: new Date("2026-07-30T10:00:00Z").toISOString(),
});

const props = { projectId: "p1", groupId: "g1", isLeader: false, canEdit: true };

beforeEach(() => {
  flashAnchor.mockReset();
  listQuery.mockReset();
  olderPageQuery.mockReset();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});

describe("MessagePanel @提及深連結（mid）", () => {
  it("目標留言已在載入範圍內：捲到並高亮該則，然後回報處理完畢", async () => {
    listQuery.mockReturnValue({ data: { items: [msg("m1", "早安"), msg("m2", "@我 看一下這鏡")], hasMore: false } });
    const onFocusHandled = vi.fn();

    render(<MessagePanel {...props} focusMessageId="m2" onFocusHandled={onFocusHandled} />);

    await waitFor(() => expect(flashAnchor).toHaveBeenCalledWith("msg-m2"));
    await waitFor(() => expect(onFocusHandled).toHaveBeenCalled());
  });

  it("每一則都有可捲動的錨點 id", () => {
    listQuery.mockReturnValue({ data: { items: [msg("m1", "早安")], hasMore: false } });
    const { container } = render(<MessagePanel {...props} />);
    expect(container.querySelector("#msg-m1")).not.toBeNull();
  });

  it("目標不在範圍且沒有更舊的頁：放棄定位但仍回報，面板照常顯示", async () => {
    listQuery.mockReturnValue({ data: { items: [msg("m1", "早安")], hasMore: false } });
    const onFocusHandled = vi.fn();

    render(<MessagePanel {...props} focusMessageId="ffffffff-dead-4000-8000-ffffffffffff" onFocusHandled={onFocusHandled} />);

    // 沒有更舊的頁可翻 → 不該無限等待，要明確收尾讓呼叫端清掉狀態
    await waitFor(() => expect(onFocusHandled).toHaveBeenCalled());
    expect(flashAnchor).not.toHaveBeenCalledWith("msg-ffffffff-dead-4000-8000-ffffffffffff");
    expect(screen.getByText("早安")).toBeInTheDocument();
    // 不該為了找不到的留言把整條歷史翻完
    expect(olderPageQuery).not.toHaveBeenCalled();
  });

  it("沒帶 mid 時完全不介入（不捲、不回報）", async () => {
    listQuery.mockReturnValue({ data: { items: [msg("m1", "早安")], hasMore: false } });
    const onFocusHandled = vi.fn();

    render(<MessagePanel {...props} onFocusHandled={onFocusHandled} />);

    await waitFor(() => expect(screen.getByText("早安")).toBeInTheDocument());
    expect(flashAnchor).not.toHaveBeenCalled();
    expect(onFocusHandled).not.toHaveBeenCalled();
  });
});
