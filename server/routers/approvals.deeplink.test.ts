/**
 * 通知深連結契約（#225 補完）：推播 URL 與前端 handler 的字串契約守衛。
 * 為什麼用原始碼斷言：#225 的 scene focus 深鏈曾在 stub 還原事故（#230/#233/#235）
 * 中無聲遺失——URL 是跨層（server 發、SW 導航、client 處理）的口頭約定，
 * 任何一端掉了都不會有型別錯誤。這裡把三端鎖在同一組字面上。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("push deep-link contract", () => {
  it("approvals 送審與裁決推播都帶 focus=scene-<id>", () => {
    const src = read("server/routers/approvals.ts");
    const matches = src.match(/\?focus=scene-\$\{scene\.id\}/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2); // 送審給組長＋裁決回提交人
  });

  it("@提及推播帶 focus=messages", () => {
    expect(read("server/routers/messages.ts")).toContain("?focus=messages");
  });

  it("ProjectPage 有 focus=messages 與 focus=scene-* 的 handler（收端不再是死參數）", () => {
    const src = read("client/src/pages/ProjectPage.tsx");
    expect(src).toContain('focus === "messages"');
    expect(src).toMatch(/scene-\[0-9a-f-\]\+/); // scene id 深連結的白名單樣式
    expect(src).toContain('id="project-messages"'); // 桌機捲動錨點
  });
});
