/**
 * 頂欄「誰在線」：不必進私訊就能看到上線夥伴。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import { OnlinePresenceMenu } from "./OnlinePresenceMenu";

const h = vi.hoisted(() => {
  const bag: {
    presence: Array<{ userId: string; name: string; lastActiveAt: Date | null }>;
    presenceError: Error | null;
    presenceLoading: boolean;
    root: Record<string, unknown>;
  } = { presence: [], presenceError: null, presenceLoading: false, root: {} };
  const makeNode = (path: string): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      useQuery: () => {
        if (path === "dm.presence") {
          return {
            data: bag.presenceLoading ? undefined : bag.presence,
            isLoading: bag.presenceLoading,
            error: bag.presenceError,
            refetch: () => {},
          };
        }
        return { data: undefined, isLoading: false, error: null, refetch: () => {} };
      },
      useMutation: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
      invalidate: () => {},
      useUtils: () => bag.root,
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
  bag.root = makeNode("");
  return bag;
});

vi.mock("../../api", () => ({ trpc: h.root }));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useLocation: () => ["/", () => {}],
}));

vi.mock("../../components/Icon", () => ({ Icon: () => null }));

/** MenuSurface 在測試裡直接渲染 children，略過 portal／定位 */
vi.mock("./MenuSurface", () => ({
  MenuSurface: ({ open, children, label }: { open: boolean; children?: React.ReactNode; label?: string }) =>
    open ? <div role="dialog" aria-label={label}>{children}</div> : null,
}));

const NOW = Date.parse("2026-08-01T12:00:00Z");
const ago = (mins: number) => new Date(NOW - mins * 60_000);

describe("OnlinePresenceMenu", () => {
  beforeEach(() => {
    h.presence = [];
    h.presenceError = null;
    h.presenceLoading = false;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("觸發器顯示上線人數，不必先開私訊", () => {
    h.presence = [
      { userId: "u1", name: "阿光", lastActiveAt: ago(1) },
      { userId: "u2", name: "小美", lastActiveAt: ago(1) },
      { userId: "u3", name: "老王", lastActiveAt: ago(60) },
    ];
    render(<OnlinePresenceMenu />);
    const btn = screen.getByRole("button", { name: /在線/ });
    expect(btn).toHaveTextContent("2");
    expect(btn).toHaveTextContent("在線");
  });

  it("點開列出上線與剛離開的人，並可連到私訊", async () => {
    h.presence = [
      { userId: "u1", name: "阿光", lastActiveAt: ago(1) },
      { userId: "u2", name: "小美", lastActiveAt: ago(7) },
    ];
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<OnlinePresenceMenu />);
    await user.click(screen.getByRole("button", { name: /在線/ }));
    expect(screen.getByRole("dialog", { name: "誰在線" })).toBeInTheDocument();
    expect(screen.getByText("上線中 · 1")).toBeInTheDocument();
    expect(screen.getByText("剛離開 · 1")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /阿光/ })).toHaveAttribute("href", "/chat/u1");
    expect(screen.getByRole("menuitem", { name: /小美/ })).toHaveAttribute("href", "/chat/u2");
    expect(screen.getByRole("menuitem", { name: /開啟私訊/ })).toHaveAttribute("href", "/chat");
  });

  it("沒人在線時觸發器顯示 0，展開給空狀態說明", async () => {
    h.presence = [{ userId: "u3", name: "老王", lastActiveAt: ago(60) }];
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<OnlinePresenceMenu />);
    expect(screen.getByRole("button", { name: /在線/ })).toHaveTextContent("0");
    await user.click(screen.getByRole("button", { name: /在線/ }));
    expect(screen.getByText(/目前沒有夥伴在線或剛離開/)).toBeInTheDocument();
  });
});
