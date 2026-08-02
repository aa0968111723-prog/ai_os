import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorldviewPreview } from "./WorldviewPreview";
import {
  worldviewSchema,
  buildWorldviewInjectPreview,
  formatWorldviewVisualPositive,
  formatWorldviewForAi,
} from "@shared/worldview";

/**
 * 這個元件唯一的價值是「顯示的字＝AI 實際收到的字」。
 * 所以測試不驗畫面長相，只驗**逐字等於 shared formatter 的輸出**——
 * 一旦有人在元件裡自己拼字串，這裡就會紅。
 */

const wv = worldviewSchema.parse({
  logline: "一位訪客在晨光禪堂點起一炷香",
  message: "把心交給佛，日子就有了呼吸",
  tones: ["溫暖", "療癒"],
  styles: ["手繪插畫"],
  themes: ["禪修日常"],
  taboos: ["不得使用「治癒/治療/療效」等醫療宣稱字眼"],
});

describe("WorldviewPreview：顯示的字＝實際送出的字", () => {
  it("出圖那段逐字包含 formatWorldviewVisualPositive 的輸出", () => {
    render(<WorldviewPreview wv={wv} />);
    const expected = formatWorldviewVisualPositive(wv);
    expect(expected).not.toBe("");
    const blocks = document.querySelectorAll("pre");
    const texts = Array.from(blocks).map((b) => b.textContent ?? "");
    expect(texts.some((t) => t.includes(expected))).toBe(true);
  });

  it("寫字 AI 那段逐字包含 generation-llm 模式的輸出", () => {
    render(<WorldviewPreview wv={wv} />);
    const expected = formatWorldviewForAi(wv, "generation-llm");
    const texts = Array.from(document.querySelectorAll("pre")).map((b) => b.textContent ?? "");
    expect(texts.some((t) => t.includes(expected))).toBe(true);
  });

  it("帶上 [專案背景] 標記，且標記來自 shared 常數", () => {
    render(<WorldviewPreview wv={wv} />);
    const texts = Array.from(document.querySelectorAll("pre")).map((b) => b.textContent ?? "");
    expect(texts.some((t) => t.includes("[專案背景]"))).toBe(true);
  });

  it("禁忌走負向並附上「只有支援負向的模型」但書", () => {
    render(<WorldviewPreview wv={wv} />);
    const preview = buildWorldviewInjectPreview(wv);
    const texts = Array.from(document.querySelectorAll("pre")).map((b) => b.textContent ?? "");
    expect(texts).toContain(preview.visual.negative);
    expect(screen.getByText(/只有支援負向的模型/)).toBeTruthy();
  });

  it("沒有禁忌時不渲染負向區塊", () => {
    const noTaboo = worldviewSchema.parse({ ...wv, taboos: [] });
    render(<WorldviewPreview wv={noTaboo} />);
    expect(screen.queryByText(/只有支援負向的模型/)).toBeNull();
  });
});

describe("WorldviewPreview：空狀態與定裝卡尾註", () => {
  it("世界觀全空時給人話，不留空的 pre", () => {
    const blank = worldviewSchema.parse({ taboos: [] });
    render(<WorldviewPreview wv={blank} />);
    expect(screen.getByText(/現在是空的/)).toBeTruthy();
    expect(document.querySelectorAll("pre").length).toBe(0);
  });

  it("定裝卡尾註只印張數與標記，不含任何卡片內容", () => {
    render(<WorldviewPreview wv={wv} cardCounts={{ characters: 2, scenes: 1, props: 3 }} />);
    const note = screen.getByText(/你在生成台勾的定裝卡/);
    expect(note.textContent).toContain("角色 2");
    expect(note.textContent).toContain("場景 1");
    expect(note.textContent).toContain("素材 3");
    expect(note.textContent).toContain("[角色定裝]");
    // 錨點內容由伺服器依 DB 組（cardAnchors.ts），前端不得猜
    expect(note.textContent).not.toContain("外觀鎖定");
    expect(note.textContent).not.toContain("光影鎖定");
  });

  it("沒給 cardCounts 就不出現尾註", () => {
    render(<WorldviewPreview wv={wv} />);
    expect(screen.queryByText(/你在生成台勾的定裝卡/)).toBeNull();
  });

  it("永遠標明配音／配樂不吃這段", () => {
    render(<WorldviewPreview wv={wv} />);
    expect(screen.getByText(/配音（TTS）、配樂音效、轉檔類不會帶這段/)).toBeTruthy();
  });
});

describe("WorldviewPreview：複製", () => {
  const stubClipboard = (impl: () => Promise<void>) => {
    const writeText = vi.fn(impl);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    return writeText;
  };

  it("複製的是注入片段本身（不含「〈你打的那句話〉」佔位）", async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    render(<WorldviewPreview wv={wv} />);
    await userEvent.click(screen.getAllByRole("button", { name: "複製" })[0]!);
    expect(writeText).toHaveBeenCalledWith(buildWorldviewInjectPreview(wv).visual.positive);
    expect(await screen.findByText("已複製")).toBeTruthy();
  });

  it("被瀏覽器擋下時顯示複製失敗", async () => {
    stubClipboard(() => Promise.reject(new Error("blocked")));
    render(<WorldviewPreview wv={wv} />);
    await userEvent.click(screen.getAllByRole("button", { name: "複製" })[0]!);
    expect(await screen.findByText("複製失敗")).toBeTruthy();
  });
});
