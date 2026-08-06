import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PROJECT_FORMATS } from "@shared/models";
import { FormatPicker, FormatTag } from "./FormatPicker";

describe("FormatPicker：畫面尺寸視覺化挑選", () => {
  it("模型支援的每一種比例都給使用者選（不再只有三種）", () => {
    render(<FormatPicker value="16:9" onChange={vi.fn()} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBe(PROJECT_FORMATS.length);
    expect(radios.length).toBeGreaterThan(3);
  });

  it("每個選項都標出白話用途與交付像素（挑錯尺寸＝整支重生成）", () => {
    render(<FormatPicker value="16:9" onChange={vi.fn()} />);
    expect(screen.getByTitle("9:16・Shorts / Reels / 限動・1080×1920")).toBeTruthy();
    expect(screen.getByTitle("21:9・電影寬幅・橫向大螢幕・2520×1080")).toBeTruthy();
  });

  it("目前值標成已選，點別的會回報新比例", async () => {
    const onChange = vi.fn();
    render(<FormatPicker value="9:16" onChange={onChange} />);
    expect(screen.getByRole("radio", { name: /9:16/ }).getAttribute("aria-checked")).toBe("true");

    await userEvent.click(screen.getByRole("radio", { name: /^1:1/ }));
    expect(onChange).toHaveBeenCalledWith("1:1");
  });

  it("認不得的舊值退回 16:9，不會整個挑選器空掉", () => {
    render(<FormatPicker value="42:1" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /16:9/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("FormatTag 一行顯示比例與像素（專案抬頭用）", () => {
    render(<FormatTag format="2:3" />);
    expect(screen.getByText("2:3")).toBeTruthy();
    expect(screen.getByText("1080×1620")).toBeTruthy();
  });
});
