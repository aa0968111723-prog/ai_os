import { describe, expect, it } from "vitest";
import { assetFileUrl, toolLabel } from "./toolResultPreview";

describe("assetFileUrl", () => {
  it("一律回相對路徑，永遠不帶簽章參數", () => {
    // 簽章網址存進 trace 會被 services/aiTrace.ts 的 sanitizeUrl 整段清空 query
    //（該行為被 aiTrace.test.ts 逐字鎖住），而 trace 承諾永久保存——
    // 簽章 TTL 只有一小時，註定變死連結。
    const url = assetFileUrl("11111111-1111-4111-8111-111111111111");
    expect(url).toBe("/api/assets/11111111-1111-4111-8111-111111111111/file");
    expect(url).not.toMatch(/sig|exp|token/);
  });

  it("只有圖片才加 variant=thumb", () => {
    expect(assetFileUrl("a", { thumb: true, mediaKind: "image" })).toBe("/api/assets/a/file?variant=thumb");
  });

  it("影音與文件不加 thumb——伺服器沒有影片縮圖，加了只會回原檔白吃頻寬", () => {
    for (const mediaKind of ["video", "audio", "doc"] as const) {
      expect(assetFileUrl("a", { thumb: true, mediaKind })).toBe("/api/assets/a/file");
    }
  });

  it("沒指定 mediaKind 時不猜，直接回原檔路徑", () => {
    expect(assetFileUrl("a", { thumb: true })).toBe("/api/assets/a/file");
  });
});

describe("toolLabel", () => {
  it("已知工具回中文名", () => {
    expect(toolLabel("list_assets")).toBe("素材庫");
    expect(toolLabel("query_database")).toBe("資料庫");
  });

  it("未知工具回原名而不是「資料」——原名至少可查、可回報", () => {
    expect(toolLabel("get_project_status")).toBe("get_project_status");
  });
});
