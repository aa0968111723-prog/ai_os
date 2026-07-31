/**
 * 「我的回報」的欄位投影契約（FB-MINE-SHOT）。
 *
 * 回報者附了截圖卻在「我的回報」看不到——原因不在權限（/api/feedback/:id/shot 一直都
 * 允許作者本人讀取）,而在 `mine` 的 select 根本沒帶出任何「有沒有截圖」的訊號,
 * 前端於是無從得知該不該畫圖。這裡把那個訊號釘住,順便釘住「不外流儲存路徑」。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MINE_FIELDS } from "./feedbackReports";
import { schema } from "../db";

describe("feedbackReports.mine 的欄位投影", () => {
  it("帶出 hasScreenshot——沒有它,前端不可能知道這筆有圖（本次缺陷的根因）", () => {
    expect(Object.keys(MINE_FIELDS)).toContain("hasScreenshot");
  });

  it("不外流 screenshotPath：伺服器儲存路徑對前端沒有用處,只是多給一條內部結構線索", () => {
    expect(Object.keys(MINE_FIELDS)).not.toContain("screenshotPath");
    // 連帶：整份投影都不該出現任何 path 類欄位
    expect(Object.keys(MINE_FIELDS).filter((k) => /path/i.test(k))).toEqual([]);
  });

  it("hasScreenshot 是「screenshot_path 有沒有值」的布林,不是把路徑改名混出去", () => {
    // drizzle 的 sql`` 片段：queryChunks = [字面, 欄位參照, 字面]
    const chunks = (MINE_FIELDS.hasScreenshot as unknown as { queryChunks: unknown[] }).queryChunks;
    // 字面部分驗語意——是 null 判斷
    const literal = chunks
      .map((c) => (typeof c === "object" && c !== null && "value" in c ? (c as { value: unknown }).value : ""))
      .flat()
      .join("")
      .toLowerCase();
    expect(literal).toContain("is not null");
    // 參照到的欄位真的是 screenshot_path——只驗字面的話，`note is not null` 也會過
    expect(chunks).toContain(schema.feedbackReports.screenshotPath);
  });

  it("原有追蹤欄位一個都沒掉（狀態與代理回覆是這頁存在的理由）", () => {
    for (const k of ["id", "category", "pages", "targetLabel", "note", "status", "agentReviewedAt", "agentSeverity", "agentReply", "emailStatus", "createdAt"]) {
      expect(Object.keys(MINE_FIELDS)).toContain(k);
    }
  });
});

describe("GET /api/feedback/:id/shot 的權限（前端敢直接連圖的前提）", () => {
  const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf('app.get("/api/feedback/:id/shot"'));

  it("作者本人看得到自己附的截圖——「我的回報」畫縮圖完全靠這一條", () => {
    expect(handler).toContain("report.userId === auth.user.id");
  });

  it("仍要求登入,且非作者／非該組審閱者／非開發者一律擋下", () => {
    expect(handler).toContain("requireUsableSession");
    expect(handler).toContain("沒有權限看這張截圖");
  });

  it("只服務 feedback/ 目錄下的路徑（擋拿別池 asset 路徑偷讀）", () => {
    expect(handler).toContain("isFeedbackShotPath");
  });
});
