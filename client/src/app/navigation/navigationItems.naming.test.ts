import { describe, expect, it } from "vitest";
import { DESTINATIONS, MOBILE_PRIMARY_NAV, accountMenuItems, mobileMoreGroups, mobileMoreReachableKeys, mobileMoreRoot, topbarNavItems } from "./navigationItems";

/**
 * 命名一致性迴歸（資料中心 P1）。
 *
 * 這一頁在站內曾同時被叫成「資料庫」「知識與資料」「資料中心」三個名字，
 * 使用者看起來像三個不同功能。DESTINATIONS 是全站唯一真相——
 * 這支測試確保它不會再長回去，也確保 route 沒有被順手改掉（深連結必須保留）。
 */
describe("導覽命名（一個地方一個名字）", () => {
  it("資料中心：顯示名統一，route 仍是 /databases（既有深連結不破）", () => {
    expect(DESTINATIONS.databases.label).toBe("資料中心");
    expect(DESTINATIONS.databases.href).toBe("/databases");
  });

  it("連接與服務：不再叫「連接的資料來源」（那一頁不只放資料來源）", () => {
    expect(DESTINATIONS.integrations.label).toBe("連接與服務");
    expect(DESTINATIONS.integrations.href).toBe("/integrations");
  });

  it("★ 站內不得再出現「資料庫」「知識與資料」當作去處名稱", () => {
    for (const d of Object.values(DESTINATIONS)) {
      expect(d.label).not.toBe("資料庫");
      expect(d.label).not.toBe("知識與資料");
    }
  });

  it("同一個去處在各選單只有一個名字（選單不自己寫字）", () => {
    for (const item of [...topbarNavItems, ...accountMenuItems]) {
      const dest = DESTINATIONS[item.key as keyof typeof DESTINATIONS];
      if (!dest) continue; // 管理／帳號類項目不在去處表內
      expect(item.label).toBe(dest.label);
      expect(item.href).toBe(dest.href);
    }
  });

  it("去處名稱互不重複——重複的名字正是「看起來像三個功能」的來源", () => {
    const labels = Object.values(DESTINATIONS).map((d) => d.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("手機底欄一級只留今日／專案／AI 助手／更多；More 第一層收斂且舊路徑仍可達", () => {
    expect([...MOBILE_PRIMARY_NAV]).toEqual(["today", "projects", "assistant", "more"]);
    expect(DESTINATIONS.planner.href).toBe("/planner");
    expect(DESTINATIONS.planner.label).toBe("筆記排程");
    expect(mobileMoreRoot.map((item) => (item.kind === "link" ? item.key : item.label))).toEqual([
      "databases", "chat", "說明中心", "進階工具",
    ]);
    const moreKeys = mobileMoreReachableKeys();
    expect(moreKeys).toEqual(expect.arrayContaining([
      "databases", "planner", "chat", "help", "models", "studio", "community", "downloads", "mcp", "integrations",
    ]));
    expect(mobileMoreGroups.map((group) => group.label)).toEqual([
      "資料中心", "私訊", "說明中心", "進階工具",
    ]);
  });
});
