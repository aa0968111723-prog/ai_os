/**
 * 操作明細的資訊密度（回饋：「操作明細有時會看到眼花撩亂」）。
 *
 * 兩處會把畫面塞爆：操作紀錄的 13 顆分類 chip 全攤開（手機上六行），
 * 以及操作洞察裡每位夥伴十幾顆分類標籤。兩者都改成「先露幾個、其餘收起來」，
 * 這裡釘住收合後仍然成立的三件事：
 * 1. 收合狀態下確實變少了，而且展開得回全部；
 * 2. 目前選中的分類就算落在收合區也一定看得到——否則會出現「有在過濾卻找不到過濾條件」；
 * 3. 少的那幾類是被收起來、不是被丟掉，展開就找得回來。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AUDIT_CATEGORIES } from "@shared/auditWording";

/** 泛用 trpc 樁：AdminPage 模組載入時會碰到 trpc，測的元件本身不打網路 */
const h = vi.hoisted(() => {
  const bag: { root: Record<string, unknown> } = { root: {} };
  let root: Record<string, unknown>;
  const makeNode = (): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      useQuery: () => ({ data: undefined, isLoading: false, isError: false, error: null }),
      useInfiniteQuery: () => ({ data: undefined, isLoading: false, error: null, hasNextPage: false }),
      useMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
      useUtils: () => root,
      invalidate: () => {},
    };
    const cache = new Map<string, Record<string, unknown>>();
    return new Proxy(base, {
      get(target, prop) {
        if (typeof prop !== "string") return Reflect.get(target, prop);
        if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
        if (prop === "then" || prop === "toJSON" || prop in Object.prototype) return undefined;
        if (!cache.has(prop)) cache.set(prop, makeNode());
        return cache.get(prop);
      },
    }) as Record<string, unknown>;
  };
  root = makeNode();
  bag.root = root;
  return bag;
});

vi.mock("../api", () => ({ trpc: h.root }));
vi.mock("wouter", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a href="#">{children}</a>,
  useLocation: () => ["/admin", () => {}],
}));
vi.mock("../components/Icon", () => ({ Icon: () => null }));

import { AuditCategoryFilter, MemberCategoryBreakdown } from "./AdminPage";

describe("分類過濾 chip 的收合", () => {
  it("預設只露幾類＋「更多分類」，展開才列出全部", async () => {
    const user = userEvent.setup();
    render(<AuditCategoryFilter value={null} onChange={() => {}} />);

    // 最後一類（系統與儲存）預設收在後面：一進畫面不該是滿屏 chip
    const last = AUDIT_CATEGORIES[AUDIT_CATEGORIES.length - 1];
    expect(screen.queryByRole("button", { name: last.label })).toBeNull();

    const more = screen.getByRole("button", { name: /更多分類/ });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);

    // 展開後每一類都在，一顆都沒少
    for (const c of AUDIT_CATEGORIES) {
      expect(screen.getByRole("button", { name: c.label })).toBeTruthy();
    }
    await user.click(screen.getByRole("button", { name: "收合分類" }));
    expect(screen.queryByRole("button", { name: last.label })).toBeNull();
  });

  it("選中的分類即使落在收合區也照樣顯示（不能有「在過濾卻看不到條件」）", () => {
    const last = AUDIT_CATEGORIES[AUDIT_CATEGORIES.length - 1];
    render(<AuditCategoryFilter value={last.key} onChange={() => {}} />);
    const chip = screen.getByRole("button", { name: last.label });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    // 它被拉出來顯示了，所以「更多分類」的數字要少算它一顆
    expect(screen.getByRole("button", { name: /更多分類/ }).textContent).toContain(
      String(AUDIT_CATEGORIES.length - 4 - 1),
    );
  });

  it("點分類會把 key 傳回去，點全部傳 null", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AuditCategoryFilter value={null} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: AUDIT_CATEGORIES[0].label }));
    expect(onChange).toHaveBeenCalledWith(AUDIT_CATEGORIES[0].key);
    await user.click(screen.getByRole("button", { name: "全部" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe("夥伴的分類分佈", () => {
  const categories = [
    { key: "external", label: "外部 AI 連線（MCP／整合）", count: 825 },
    { key: "project", label: "專案與素材", count: 291 },
    { key: "ai", label: "AI 助手與代理", count: 128 },
    { key: "account", label: "帳號與團隊", count: 121 },
    { key: "collab", label: "留言與協作", count: 108 },
  ];

  it("預設只列前三名，其餘收進「＋N 類」，展開才全部列出", async () => {
    const user = userEvent.setup();
    render(<MemberCategoryBreakdown categories={categories} />);

    expect(screen.getByText(/外部 AI 連線/)).toBeTruthy();
    expect(screen.getByText(/AI 助手與代理/)).toBeTruthy();
    expect(screen.queryByText(/帳號與團隊/)).toBeNull();

    const more = screen.getByRole("button", { name: "＋2 類" });
    await user.click(more);
    expect(screen.getByText(/帳號與團隊/)).toBeTruthy();
    expect(screen.getByText(/留言與協作/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "收合" }));
    expect(screen.queryByText(/帳號與團隊/)).toBeNull();
  });

  it("剛好三類以內就不出現展開鈕（沒有東西被藏起來）", () => {
    render(<MemberCategoryBreakdown categories={categories.slice(0, 3)} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
