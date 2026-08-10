import { describe, expect, it } from "vitest";
import { pageTitle } from "./pageTitle";
import { DESTINATIONS } from "./navigation/navigationItems";

/**
 * 分頁標題命名一致性迴歸（與 navigationItems.naming.test.ts 同精神）。
 *
 * 分頁標題與選單共用 DESTINATIONS 當唯一真相：選單叫「資料中心」時，分頁標籤不能
 * 又冒出一個「知識資料」——那正是使用者回報「選單有點亂」的來源之一。
 * 這支測試確保 pageTitle 不會再擅自走回第二套名字。
 */
describe("pageTitle（分頁標題與去處命名一致）", () => {
  it("每個去處的分頁標題＝DESTINATIONS 的名字（不含 dashboard 特殊文案）", () => {
    for (const dest of Object.values(DESTINATIONS)) {
      if (dest.href === "/dashboard") continue; // dashboard 有自訂長文案
      expect(pageTitle(dest.href)).toBe(`${dest.label}｜Aios`);
    }
  });

  it("子路由沿用該去處的名字（/databases、/studio/:id、/chat/:peerId）", () => {
    expect(pageTitle("/databases/table-1")).toBe("資料中心｜Aios");
    expect(pageTitle("/studio/abc")).toBe("動畫創作室｜Aios");
    expect(pageTitle("/chat/peer-1")).toBe("私訊｜Aios");
  });

  it("★ 不得再出現舊名「知識資料」「訊息」", () => {
    expect(pageTitle("/databases")).not.toContain("知識資料");
    expect(pageTitle("/chat")).not.toContain("訊息");
    expect(pageTitle("/databases")).toBe("資料中心｜Aios");
    expect(pageTitle("/chat")).toBe("私訊｜Aios");
  });

  it("管理／帳號層級頁面也有專屬標題（不會只剩裸 Aios）", () => {
    const expectations: Record<string, string> = {
      "/settings": "個人設定｜Aios",
      "/admin": "團隊管理｜Aios",
      "/members": "通訊錄｜Aios",
      "/logs": "用量與活動紀錄｜Aios",
      "/my-reports": "我的回報｜Aios",
      "/feedback": "使用回饋｜Aios",
      "/collab": "協作中心｜Aios",
      "/options": "選項整理｜Aios",
      "/workflows": "自動化工作流｜Aios",
      "/share-target": "分享收件｜Aios",
    };
    for (const [path, expected] of Object.entries(expectations)) {
      expect(pageTitle(path)).toBe(expected);
    }
  });

  it("未列出的路由退回中性「Aios」（不掛錯名字）", () => {
    expect(pageTitle("/not-a-page")).toBe("Aios");
  });
});
