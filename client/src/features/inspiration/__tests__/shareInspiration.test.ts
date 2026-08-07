import { describe, expect, it, vi } from "vitest";
import {
  buildInspirationShareText,
  buildInspirationShareUrl,
  shareInspirationPost,
} from "../shareInspiration";

describe("buildInspirationShareUrl", () => {
  it("points at the channel with the post id as a query param", () => {
    expect(buildInspirationShareUrl("https://aios.example", "abc-123")).toBe(
      "https://aios.example/community?post=abc-123",
    );
  });

  it("tolerates a trailing slash and escapes the id", () => {
    expect(buildInspirationShareUrl("https://aios.example/", "a b&c")).toBe(
      "https://aios.example/community?post=a%20b%26c",
    );
  });
});

describe("buildInspirationShareText", () => {
  it("adds the auto category so the receiver knows what it is before clicking", () => {
    expect(buildInspirationShareText({ title: "夜城", categoryLabel: "城市建築" })).toBe("夜城（城市建築）");
    expect(buildInspirationShareText({ title: "夜城", categoryLabel: null })).toBe("夜城");
    expect(buildInspirationShareText({ title: "夜城", categoryLabel: "  " })).toBe("夜城");
  });
});

describe("shareInspirationPost", () => {
  const input = { url: "https://x/community?post=1", title: "夜城" };

  it("uses the system share sheet when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    await expect(shareInspirationPost(input, { share })).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: "夜城", text: undefined, url: input.url });
  });

  it("treats a cancelled share sheet as success, not an error", async () => {
    // 使用者自己關掉面板時跳「分享失敗」只會嚇人
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const clipboard = { writeText: vi.fn() };
    const outcome = await shareInspirationPost(input, {
      share: vi.fn().mockRejectedValue(abort),
      clipboard,
    });
    expect(outcome).toBe("shared");
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard when the share sheet is missing or broken", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(shareInspirationPost(input, { clipboard: { writeText } })).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(input.url);

    const broken = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    await expect(
      shareInspirationPost(input, { share: broken, clipboard: { writeText } }),
    ).resolves.toBe("copied");
  });

  it("reports unavailable when neither path works", async () => {
    await expect(shareInspirationPost(input, {})).resolves.toBe("unavailable");
    await expect(
      shareInspirationPost(input, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) } }),
    ).resolves.toBe("unavailable");
    await expect(shareInspirationPost(input, undefined)).resolves.toBe("unavailable");
  });
});
