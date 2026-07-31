import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PresenceDot, PresenceText } from "./PresenceDot";

const NOW = new Date("2026-07-31T10:00:00.000Z").getTime();
const ago = (mins: number) => new Date(NOW - mins * 60_000);

describe("PresenceDot", () => {
  it("上線中畫實心點，並唸得出狀態（不只有顏色）", () => {
    render(<PresenceDot lastActiveAt={ago(1)} now={NOW} />);
    const dot = screen.getByRole("img", { name: "上線中" });
    expect(dot.className).toContain("presence-dot");
    expect(dot.className).toContain("online");
    expect(dot).toHaveAttribute("title", "上線中");
  });

  it("剛離開畫成另一種形狀，並帶分鐘數", () => {
    render(<PresenceDot lastActiveAt={ago(7)} now={NOW} />);
    expect(screen.getByRole("img", { name: "7 分鐘前在線" }).className).toContain("recent");
  });

  it("離線與沒有紀錄都不畫點（有沒有點本身就是訊息）", () => {
    const { container, rerender } = render(<PresenceDot lastActiveAt={ago(60)} now={NOW} />);
    expect(container.querySelector(".presence-dot")).toBeNull();
    rerender(<PresenceDot lastActiveAt={null} now={NOW} />);
    expect(container.querySelector(".presence-dot")).toBeNull();
  });
});

describe("PresenceText", () => {
  it("三態都給文字（離線也說出來，標頭不靠「沒有點」反推）", () => {
    const { rerender } = render(<PresenceText lastActiveAt={ago(1)} now={NOW} />);
    expect(screen.getByText("上線中").className).toContain("online");
    rerender(<PresenceText lastActiveAt={ago(9)} now={NOW} />);
    expect(screen.getByText("9 分鐘前在線").className).toContain("recent");
    rerender(<PresenceText lastActiveAt={null} now={NOW} />);
    expect(screen.getByText("離線").className).toContain("offline");
  });
});
