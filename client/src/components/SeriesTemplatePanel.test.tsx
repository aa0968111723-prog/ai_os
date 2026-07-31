/**
 * 母版系列面板（#255 第 1 期）與退回標籤（第 2 期）的行為測試。
 *
 * 這裡守的是 SOP 的兩條硬規則：
 *   1. 沒有母版就不能開集——組員看到的是「請組長先建立」，不是一個會生出野生專案的按鈕。
 *   2. 4 格沒填齊不能送出；送出的專案名必須是 `系列｜日期｜主題`。
 * 以及退回標籤：只能選固定 5 種，「其他」一定要另寫一句說明。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";

const h = vi.hoisted(() => {
  const bag: { queryData: Map<string, unknown>; mutations: Array<{ path: string; input: unknown }>; root: Record<string, unknown> } =
    { queryData: new Map(), mutations: [], root: {} };
  const { queryData, mutations } = bag;
  let root: Record<string, unknown>;
  const makeNode = (path: string): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      useQuery: () => ({ data: queryData.get(path), isLoading: false, isError: false, error: null, refetch: () => {} }),
      useMutation: (opts?: { onSuccess?: (d: unknown) => void }) => ({
        mutate: (input: unknown) => {
          mutations.push({ path, input });
          void opts?.onSuccess?.({});
        },
        isPending: false,
        error: null,
        data: undefined,
      }),
      invalidate: () => {},
      useUtils: () => root,
    };
    const cache = new Map<string, Record<string, unknown>>();
    return new Proxy(base, {
      get(target, prop) {
        if (typeof prop !== "string") return Reflect.get(target, prop);
        if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
        if (prop === "then" || prop === "toJSON" || prop in Object.prototype) return undefined;
        if (!cache.has(prop)) cache.set(prop, makeNode(path ? `${path}.${prop}` : prop));
        return cache.get(prop);
      },
    }) as Record<string, unknown>;
  };
  root = makeNode("");
  Object.assign(bag, { root });
  return bag;
});

vi.mock("../api", () => ({ trpc: h.root }));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("./Icon", () => ({ Icon: () => null }));

import { SeriesTemplatePanel } from "./SeriesTemplatePanel";
import { ConfirmButton } from "./interactions";
import { REWORK_TAGS } from "@shared/seriesTemplate";

const GROUP = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.queryData.clear();
  h.mutations.length = 0;
});

describe("母版系列面板", () => {
  it("還沒有母版時，組長看到建立鈕", async () => {
    h.queryData.set("projects.seriesOverview", { master: null, episodes: [] });
    render(<SeriesTemplatePanel groupId={GROUP} isLeader />);
    const btn = screen.getByRole("button", { name: /建立母版/ });
    await userEvent.click(btn);
    expect(h.mutations).toEqual([
      { path: "projects.createSeriesMaster", input: { groupId: GROUP, templateId: "weekly-dharma-60" } },
    ]);
  });

  it("還沒有母版時，組員看到的是「請組長先建立」而不是開集入口", () => {
    h.queryData.set("projects.seriesOverview", { master: null, episodes: [] });
    render(<SeriesTemplatePanel groupId={GROUP} isLeader={false} />);
    expect(screen.getByText(/請組長先建立母版/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /建立母版/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /開新的一集/ })).toBeNull();
  });

  it("4 格填齊才能開集，且送出的是驗證過的變數", async () => {
    h.queryData.set("projects.seriesOverview", { master: { id: "m1", title: "【母版】週更開示60秒" }, episodes: [] });
    render(<SeriesTemplatePanel groupId={GROUP} isLeader={false} />);
    await userEvent.click(screen.getByRole("button", { name: /開新的一集/ }));

    const submit = screen.getByRole("button", { name: "開這一集" });
    expect(submit).toHaveProperty("disabled", true);

    await userEvent.type(screen.getByLabelText("本集主題"), "留一點空隙");
    await userEvent.type(screen.getByLabelText("必留原句／出處"), "無");
    // 禁忌還沒填 → 仍不能送
    expect(screen.getByRole("button", { name: "開這一集" })).toHaveProperty("disabled", true);

    await userEvent.type(screen.getByLabelText("本集禁忌"), "無");
    await userEvent.type(screen.getByLabelText("截止日期"), "2026-08-05");

    const ready = screen.getByRole("button", { name: "開這一集" });
    expect(ready).toHaveProperty("disabled", false);
    // 專案名照 SOP 命名規則預告，使用者按下去前就知道會叫什麼
    expect(screen.getByText(/專案會叫：週更開示60秒｜2026-08-05｜留一點空隙/)).toBeTruthy();

    await userEvent.click(ready);
    expect(h.mutations).toEqual([
      {
        path: "projects.createSeriesEpisode",
        input: {
          groupId: GROUP,
          templateId: "weekly-dharma-60",
          variables: { topic: "留一點空隙", sourceQuote: "無", taboo: "無", dueDate: "2026-08-05" },
        },
      },
    ]);
  });

  it("已開的集數會列出來，點得回去", async () => {
    h.queryData.set("projects.seriesOverview", {
      master: { id: "m1", title: "【母版】週更開示60秒" },
      episodes: [{ id: "e1", title: "週更開示60秒｜2026-08-05｜留一點空隙", dueDate: "2026-08-05", topic: "留一點空隙", updatedAt: new Date().toISOString() }],
    });
    render(<SeriesTemplatePanel groupId={GROUP} isLeader={false} />);
    expect(screen.getByText("已開 1 集")).toBeTruthy();
    expect(screen.getByRole("link", { name: /留一點空隙/ }).getAttribute("href")).toBe("/p/e1");
  });
});

describe("退回標籤（固定 5 種）", () => {
  const openReject = async (onConfirm: (reason?: string, tag?: string) => void) => {
    render(
      <ConfirmButton
        title="退回這一鏡"
        confirmLabel="退回"
        reason={{
          label: "退回原因",
          tags: REWORK_TAGS,
          tagRequired: true,
          tagsNeedingNote: ["其他"],
        }}
        onConfirm={onConfirm}
      >
        退回
      </ConfirmButton>,
    );
    await userEvent.click(screen.getByRole("button", { name: "退回" }));
  };

  it("沒選標籤就按退回 → 擋下並提示", async () => {
    const onConfirm = vi.fn();
    await openReject(onConfirm);
    await userEvent.click(screen.getByRole("button", { name: "退回" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("請先選一個原因標籤");
  });

  it("選了一般標籤就能直接退回，標籤原樣往上送", async () => {
    const onConfirm = vi.fn();
    await openReject(onConfirm);
    await userEvent.click(screen.getByRole("button", { name: "結構跑掉" }));
    await userEvent.click(screen.getByRole("button", { name: "退回" }));
    expect(onConfirm).toHaveBeenCalledWith("", "結構跑掉");
  });

  it("「其他」沒寫說明會被擋下，寫了才放行", async () => {
    const onConfirm = vi.fn();
    await openReject(onConfirm);
    await userEvent.click(screen.getByRole("button", { name: "其他" }));
    await userEvent.click(screen.getByRole("button", { name: "退回" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("必須另外寫一句說明");

    await userEvent.type(screen.getByLabelText("退回原因"), "檔名要重編");
    await userEvent.click(screen.getByRole("button", { name: "退回" }));
    expect(onConfirm).toHaveBeenCalledWith("檔名要重編", "其他");
  });
});
