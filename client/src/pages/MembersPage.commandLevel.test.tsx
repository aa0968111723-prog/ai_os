/**
 * 組代理指揮權設定介面（分級授權的唯一入口）。
 *
 * 這裡測的是「入口存在且說得清楚」：等級已經在後端全面生效，先前卻只有一個布林開關，
 * 於是「可監督／可總指揮」根本設不出來。因此除了四個選項要在、送出的值要對，
 * 也驗說明文案講的是後果（可監督＝能替別人核准＝開始花點）——那句話是使用者判斷
 * 「要不要把花錢的權力交出去」的唯一依據，沒有它，選單只是四個看不懂的名詞。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 泛用 trpc 樁（比照 Launchpad.teamCard.test）：只記錄 mutation 呼叫，不真的打網路 */
const h = vi.hoisted(() => {
  const bag: { mutations: Array<{ path: string; input: unknown }>; root: Record<string, unknown> } = {
    mutations: [],
    root: {},
  };
  let root: Record<string, unknown>;
  const makeNode = (path: string): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      useQuery: () => ({ data: undefined, isLoading: false, isError: false, error: null }),
      useMutation: (opts?: { onSuccess?: (d: unknown) => void }) => ({
        mutate: (input: unknown) => {
          bag.mutations.push({ path, input });
          void opts?.onSuccess?.({});
        },
        isPending: false,
        error: null,
        variables: undefined,
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
  bag.root = root;
  return bag;
});

vi.mock("../api", () => ({ trpc: h.root }));
vi.mock("wouter", () => ({ Link: ({ children }: { children?: React.ReactNode }) => <a href="#">{children}</a> }));
vi.mock("../components/Icon", () => ({ Icon: () => null }));

import { COMMAND_LEVEL_OPTIONS, CommandLevelField, describeCommandLevel } from "./MembersPage";

const GROUP = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  h.mutations.length = 0;
});

describe("四級授權的文案", () => {
  it("四級都在，且用人話標籤（不是 none/dispatch 這種只有工程師看得懂的字）", () => {
    expect(COMMAND_LEVEL_OPTIONS.map((o) => o.value)).toEqual(["none", "dispatch", "supervise", "command"]);
    expect(COMMAND_LEVEL_OPTIONS.map((o) => o.label)).toEqual(["不可用", "可派工", "可監督", "可總指揮"]);
  });

  it("可派工說清楚「還要有人核准才花點」——這是它與可監督的整個差別", () => {
    expect(describeCommandLevel("dispatch")).toContain("核准");
    expect(describeCommandLevel("dispatch")).toContain("點");
  });

  it("可監督以上明講「能替別人核准＝開始花點」，不能只寫「可以監督」", () => {
    expect(describeCommandLevel("supervise")).toContain("核准");
    expect(describeCommandLevel("supervise")).toContain("花點");
    expect(describeCommandLevel("command")).toContain("自動核准");
  });
});

describe("CommandLevelField", () => {
  it("顯示目前等級，並列出四個可選等級", () => {
    render(<CommandLevelField groupId={GROUP} userId={USER} level="supervise" />);
    const select = screen.getByLabelText("組代理指揮權") as HTMLSelectElement;
    expect(select.value).toBe("supervise");
    expect([...select.options].map((o) => o.textContent)).toEqual(["不可用", "可派工", "可監督", "可總指揮"]);
  });

  it("選單旁邊就寫著這一級的後果（使用者不必猜「可監督」是什麼意思）", () => {
    render(<CommandLevelField groupId={GROUP} userId={USER} level="supervise" />);
    expect(screen.getByText(describeCommandLevel("supervise"))).toBeTruthy();
  });

  it("改選等級會送出 setMemberCommandLevel，帶著組、人與新等級", async () => {
    render(<CommandLevelField groupId={GROUP} userId={USER} level="none" />);
    await userEvent.selectOptions(screen.getByLabelText("組代理指揮權"), "command");
    expect(h.mutations).toEqual([
      { path: "quota.setMemberCommandLevel", input: { groupId: GROUP, userId: USER, level: "command" } },
    ]);
  });

  it("自己的等級只顯示現況、不給選單——能自升的授權等於沒有授權（後端也擋）", () => {
    render(<CommandLevelField groupId={GROUP} userId={USER} level="supervise" isSelf />);
    expect(screen.queryByLabelText("組代理指揮權")).toBeNull();
    expect(screen.getByText(/可監督/)).toBeTruthy();
    expect(h.mutations).toHaveLength(0);
  });
});
