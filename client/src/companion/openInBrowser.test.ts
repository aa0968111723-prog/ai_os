import { beforeEach, describe, expect, it, vi } from "vitest";
import { openCompanionDeepLink } from "./openInBrowser";

const PID = "11111111-2222-4333-8444-555555555555";

let openSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  openSpy = vi.fn(() => ({}) as Window);
  Object.defineProperty(window, "open", { configurable: true, writable: true, value: openSpy });
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe("openCompanionDeepLink", () => {
  it("組出同源的絕對網址並在新分頁開", () => {
    const url = openCompanionDeepLink({ target: "project", projectId: PID });
    expect(url).toBe(`${window.location.origin}/p/${PID}`);
    expect(openSpy).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer");
  });

  it("origin 永遠來自本機，不是來自輸入——模型不能決定要導去哪個站", () => {
    const url = openCompanionDeepLink({ target: "project", projectId: PID });
    expect(url?.startsWith(window.location.origin)).toBe(true);
  });

  it("連結不完整（缺專案）時回 null，不亂開一個首頁", () => {
    expect(openCompanionDeepLink({ target: "project" })).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("非 UUID 的專案 id 一律擋掉", () => {
    expect(openCompanionDeepLink({ target: "project", projectId: "../../admin" })).toBeNull();
  });

  it("被瀏覽器擋掉時回 null，讓呼叫端講出來", () => {
    openSpy.mockReturnValue(null);
    expect(openCompanionDeepLink({ target: "projects" })).toBeNull();
  });

  it("有 Capacitor Browser 外掛時用它開系統瀏覽器", () => {
    const open = vi.fn(() => Promise.resolve());
    (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { Browser: { open } } };
    const url = openCompanionDeepLink({ target: "studio", projectId: PID });
    expect(url).toBe(`${window.location.origin}/studio/${PID}`);
    expect(open).toHaveBeenCalledWith({ url });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("外掛失敗時退回 window.open——按鈕不能沒反應", async () => {
    const open = vi.fn(() => Promise.reject(new Error("plugin missing")));
    (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { Browser: { open } } };
    openCompanionDeepLink({ target: "projects" });
    await Promise.resolve();
    await Promise.resolve();
    expect(openSpy).toHaveBeenCalled();
  });

  it("錨點會帶進 hash", () => {
    const url = openCompanionDeepLink({ target: "storyboard", projectId: PID, anchorId: "stage-board" });
    expect(url).toBe(`${window.location.origin}/p/${PID}#stage-board`);
  });
});
