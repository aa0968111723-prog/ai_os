import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/dashboard` 與 `/p/:id` 的 Phone/Desktop 分岔契約。
 *
 * 這是整個手機重構最容易被無聲改壞的一條：任何人把分岔改成 CSS（`display: none`）
 * 都能讓畫面看起來一樣，但手機會回到「下載並掛載 234KB 桌面工作台」的老路。
 * 所以這裡驗的是**哪一個元件被掛起來**，不是畫面長什麼樣。
 */

const mounted: string[] = [];
const stub = (name: string) => () => {
  mounted.push(name);
  return <div data-testid={name} />;
};

vi.mock("./MobileHome", () => ({ MobileHome: stub("mobile-home") }));
vi.mock("./MobileProjectPage", () => ({ MobileProjectPage: stub("mobile-project") }));
vi.mock("../pages/Launchpad", () => ({ Launchpad: stub("desktop-launchpad") }));
vi.mock("../pages/ProjectPage", () => ({ ProjectPage: stub("desktop-project") }));

import { HomeRoute, ProjectRoute } from "./PhoneRoute";

/** 讓 useMatchMedia 相信視窗是某個寬度 */
function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const matches = max ? width <= Number(max[1]) : min ? width >= Number(min[1]) : false;
    return {
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  mounted.length = 0;
});

describe("首頁與專案頁的 Phone/Desktop 分岔", () => {
  // 驗收矩陣的三支手機（iPhone SE／15／15 Pro Max 級距）
  it.each([360, 390, 430])("%ipx 拿到手機版，桌面版一個元件都沒掛", async (width) => {
    setViewport(width);
    render(<HomeRoute groupId="g1" />);
    expect(await screen.findByTestId("mobile-home")).toBeInTheDocument();
    expect(mounted).not.toContain("desktop-launchpad");
  });

  // 驗收矩陣的三台平板——一律走桌面版，不做第三套 UI
  it.each([768, 820, 1024])("%ipx（平板）拿到桌面版，手機版一個元件都沒掛", async (width) => {
    setViewport(width);
    render(<HomeRoute groupId="g1" />);
    expect(await screen.findByTestId("desktop-launchpad")).toBeInTheDocument();
    expect(mounted).not.toContain("mobile-home");
  });

  it.each([1280, 1440])("%ipx（桌機）維持既有作業台", async (width) => {
    setViewport(width);
    render(<HomeRoute groupId="g1" />);
    expect(await screen.findByTestId("desktop-launchpad")).toBeInTheDocument();
  });

  it("專案頁在手機上不掛桌面工作台（那是 234KB gzip 的 chunk）", async () => {
    setViewport(390);
    render(<ProjectRoute id="p1" />);
    expect(await screen.findByTestId("mobile-project")).toBeInTheDocument();
    expect(mounted).not.toContain("desktop-project");
  });

  it("專案頁在平板與桌機上仍是既有的完整工作台", async () => {
    for (const width of [768, 1280]) {
      mounted.length = 0;
      setViewport(width);
      const view = render(<ProjectRoute id="p1" />);
      expect(await screen.findByTestId("desktop-project")).toBeInTheDocument();
      expect(mounted).not.toContain("mobile-project");
      view.unmount();
    }
  });

  it("767.98 與 768 正好是界線的兩側", async () => {
    setViewport(767.98);
    const phone = render(<HomeRoute groupId="g1" />);
    expect(await screen.findByTestId("mobile-home")).toBeInTheDocument();
    phone.unmount();

    mounted.length = 0;
    setViewport(768);
    render(<HomeRoute groupId="g1" />);
    expect(await screen.findByTestId("desktop-launchpad")).toBeInTheDocument();
  });
});
