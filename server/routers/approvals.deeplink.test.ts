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

  it("生成完成/失敗/待核推播帶 focus=generation-<id>，ProjectPage 有對應 handler", () => {
    const core = read("server/services/generationCore.ts");
    const matches = core.match(/\?focus=generation-\$\{(gen|gated)\.id\}/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3); // 完成＋失敗＋待核
    const page = read("client/src/pages/ProjectPage.tsx");
    expect(page).toMatch(/generation-\[0-9a-f-\]\+/);
    expect(page).toContain('revealWorkbenchAnchor("#sec-generations"'); // 走既有抽屜 reveal 通道
  });

  it("focus=scene/pending 的手機配套：SceneList 會展開收合、切待審篩選；彙總入口帶 focus=pending", () => {
    const sceneList = read("client/src/components/SceneList.tsx");
    expect(sceneList).toContain('focus === "pending"');
    expect(sceneList).toContain("setSceneListExpanded(true)"); // 深連結目標在第 5 格以後也要可見
    expect(read("client/src/app/components/PendingApprovalsBadge.tsx")).toContain("?focus=pending");
    expect(read("client/src/pages/Launchpad.tsx")).toContain("?focus=pending");
  });

  it("session 過期點深連結：登入後回原目標（returnTo，防 open-redirect）", () => {
    const gate = read("client/src/app/SessionGate.tsx");
    expect(gate).toContain("safeNextPath");
    expect(gate).toContain('raw.startsWith("//")'); // 同源白名單
    expect(gate).toContain("RedirectFromLogin");
  });
});
