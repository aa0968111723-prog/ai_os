/**
 * 粗剪預覽台：全域播放頭模型、鍵盤鍵位、以及 I／O 寫回修剪的語義。
 *
 * 重點不在畫面長相，而在「播放頭 → 素材位置」這個換算——它錯了，標出來的入出點就會
 * 落在素材的別處，而交付包會忠實照著那個錯誤位置剪。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StoryboardPlayer, type StoryboardPlayerScene } from "./StoryboardPlayer";

// jsdom 沒有實作媒體播放；沒有這些 stub，元件一掛載就會丟未實作例外
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

const scene = (over: Partial<StoryboardPlayerScene> = {}): StoryboardPlayerScene => ({
  id: "s1",
  title: "第一鏡",
  durationSec: 4,
  voiceover: null,
  assetUrl: "https://example.test/a.mp4",
  assetKind: "video",
  ...over,
});

/** 時間軸 slider：全域播放頭的唯一真相，測試一律讀它 */
const track = () => screen.getByRole("slider", { name: /時間軸播放頭/ });

describe("全域播放頭", () => {
  it("片長是各鏡修剪後長度的總和（影格）", () => {
    render(
      <StoryboardPlayer
        scenes={[
          scene({ id: "a", durationSec: 4 }), // 120 影格
          scene({ id: "b", durationSec: 8, trimStartMs: 2000, trimEndMs: 5000 }), // 修剪成 90 影格
        ]}
      />,
    );
    expect(track()).toHaveAttribute("aria-valuemax", "210");
  });

  it("→ 走一影格、Shift+→ 走一秒；播放頭不會退到負數或超出片長", () => {
    render(<StoryboardPlayer scenes={[scene({ durationSec: 2 })]} />); // 60 影格
    const t = track();
    expect(t).toHaveAttribute("aria-valuenow", "0");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(t).toHaveAttribute("aria-valuenow", "1");

    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    expect(t).toHaveAttribute("aria-valuenow", "31");

    // 往回超出開頭 → 夾在 0
    fireEvent.keyDown(window, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(window, { key: "ArrowLeft", shiftKey: true });
    expect(t).toHaveAttribute("aria-valuenow", "0");

    // End 到片尾
    fireEvent.keyDown(window, { key: "End" });
    expect(t).toHaveAttribute("aria-valuenow", "60");
  });

  it("播放頭跨過鏡界時，顯示的鏡次跟著換", () => {
    render(<StoryboardPlayer scenes={[scene({ id: "a", title: "甲", durationSec: 1 }), scene({ id: "b", title: "乙", durationSec: 1 })]} />);
    expect(screen.getByText("甲")).toBeInTheDocument();
    // 第一鏡佔 0..29 影格，第 30 格起是第二鏡
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    expect(screen.getByText("乙")).toBeInTheDocument();
    expect(track().getAttribute("aria-valuetext")).toContain("第 2 鏡");
  });
});

describe("I／O 標入出點寫回修剪", () => {
  it("標出點：把播放頭換算成素材位置後寫 trimEndMs", () => {
    const onTrim = vi.fn();
    render(<StoryboardPlayer scenes={[scene({ durationSec: 4 })]} onTrim={onTrim} />);
    // 播放頭走到 1 秒；未修剪的鏡入點是 0，所以素材位置也是 1 秒
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(window, { key: "o" });
    expect(onTrim).toHaveBeenCalledWith("s1", { trimEndMs: 1000 });
  });

  it("標入點會一併固化出點——只改入點會變成整段位移，不是剪掉頭", () => {
    const onTrim = vi.fn();
    render(<StoryboardPlayer scenes={[scene({ durationSec: 4 })]} onTrim={onTrim} />);
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true }); // 1 秒
    fireEvent.keyDown(window, { key: "i" });
    // 出點固化為原本的實際出點（0 + 4 秒）
    expect(onTrim).toHaveBeenCalledWith("s1", { trimStartMs: 1000, trimEndMs: 4000 });
  });

  it("已修剪的鏡：播放頭 0 對應的是素材的入點，不是素材開頭", () => {
    const onTrim = vi.fn();
    // 素材取 2.0s–5.0s：時間軸第 0 格＝素材第 2 秒
    render(<StoryboardPlayer scenes={[scene({ durationSec: 8, trimStartMs: 2000, trimEndMs: 5000 })]} onTrim={onTrim} />);
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true }); // 時間軸 1 秒 → 素材 3 秒
    fireEvent.keyDown(window, { key: "o" });
    expect(onTrim).toHaveBeenCalledWith("s1", { trimEndMs: 3000 });
  });

  it("入點不得晚於出點、出點不得早於入點——零長度剪輯會讓 NLE 匯入報錯", () => {
    const onTrim = vi.fn();
    render(<StoryboardPlayer scenes={[scene({ durationSec: 4 })]} onTrim={onTrim} />);
    // 播放頭在 0：標出點會讓出點＝入點，必須被擋下
    fireEvent.keyDown(window, { key: "o" });
    expect(onTrim).not.toHaveBeenCalled();
    // 播放頭在片尾：標入點會讓入點＝出點，同樣擋下
    fireEvent.keyDown(window, { key: "End" });
    fireEvent.keyDown(window, { key: "i" });
    expect(onTrim).not.toHaveBeenCalled();
  });

  it("非影片鏡不給修剪（靜態圖沒有「取素材哪一段」可言）", () => {
    const onTrim = vi.fn();
    render(<StoryboardPlayer scenes={[scene({ assetKind: "image", assetUrl: "https://example.test/a.jpg" })]} onTrim={onTrim} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "o" });
    expect(onTrim).not.toHaveBeenCalled();
    expect(screen.getByText(/此鏡不是影片/)).toBeInTheDocument();
  });

  it("沒給 onTrim＝唯讀預覽，修剪列整個不出現", () => {
    render(<StoryboardPlayer scenes={[scene()]} />);
    expect(screen.queryByRole("button", { name: "標記修剪起點" })).not.toBeInTheDocument();
  });
});

describe("既有行為保留", () => {
  it("沒有分鏡時顯示引導，不是空白畫面", () => {
    render(<StoryboardPlayer scenes={[]} onClose={() => {}} />);
    expect(screen.getByText(/還沒有分鏡可以預覽/)).toBeInTheDocument();
  });

  it("Esc 關閉", () => {
    const onClose = vi.fn();
    render(<StoryboardPlayer scenes={[scene()]} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("配音詞疊在畫面上（交付的 SRT 燒進去就是這個位置）", () => {
    render(<StoryboardPlayer scenes={[scene({ voiceover: "第一句話" })]} />);
    expect(screen.getByText("第一句話")).toBeInTheDocument();
  });

  it("已修剪的鏡在標頭標示出來", () => {
    render(<StoryboardPlayer scenes={[scene({ trimStartMs: 500, trimEndMs: 2000 })]} />);
    expect(screen.getByTitle("這一鏡已修剪")).toBeInTheDocument();
  });
});
