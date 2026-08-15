import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(path.join(__dirname, "phone.ts"), "utf8");

/**
 * 手機唯讀彙總的查詢契約。
 *
 * 這幾條守的都是「查詢跑得動、但數字是錯的」那一類——它們不會丟例外、不會被
 * typecheck 抓到，只會讓畫面上的分母悄悄比專案頁多幾鏡。
 */
describe("phone router 的查詢契約", () => {
  it("分鏡計數濾掉回收桶（scenes 有 deletedAt）", () => {
    // 不濾的話，使用者刪掉的鏡仍算進「8 鏡」，而專案頁只列 6 鏡
    const sceneQueries = src.split("schema.scenes").length - 1;
    expect(sceneQueries).toBeGreaterThan(0);
    for (const block of ["inArray(schema.scenes.projectId, ids)", "eq(schema.scenes.projectId, input.projectId)"]) {
      const at = src.indexOf(block);
      expect(at, `找不到分鏡查詢：${block}`).toBeGreaterThan(-1);
      expect(
        src.slice(at, at + 200),
        `${block} 這支查詢沒有濾掉 scenes.deletedAt`,
      ).toContain("isNull(schema.scenes.deletedAt)");
    }
  });

  it("素材縮圖只取 image（那些值會直接餵進 <img>）", () => {
    expect(src).toContain('eq(schema.assets.kind, "image")');
    // url 是 NOT NULL 欄位，isNotNull 永遠為真——留著只會讓人以為有在過濾
    expect(src).not.toContain("isNotNull(schema.assets.url)");
  });

  it("素材查詢仍濾掉回收桶", () => {
    expect(src).toContain("isNull(schema.assets.deletedAt)");
  });

  it("兩支查詢都有群組守衛（不能靠 projectId 猜到別組的專案）", () => {
    expect(src).toContain("requireGroup(ctx.auth, input.groupId)");
    expect(src).toContain("requireGroup(ctx.auth, project.groupId)");
  });

  it("是唯讀 router——沒有任何 mutation", () => {
    expect(src).not.toContain(".mutation(");
  });
});
