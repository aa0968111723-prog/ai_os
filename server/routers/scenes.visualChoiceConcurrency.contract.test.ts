/**
 * ⚠️ 這一份是**結構**斷言，不是行為證明。
 *
 * #725 P2 點名：原本的檔名與 describe 都叫「write concurrency」，但內容是
 * readFileSync + toContain——`applyWithRevision` 這串字在不在。字串在、行為壞掉，它照樣綠。
 *
 * 真正的併發行為由真 PostgreSQL 測試覆蓋：
 *   → `server/services/creativeVariantPointer.pg.test.ts`
 *      「面板寫入的樂觀併發（真 PostgreSQL）」3 項：過期 rev 不靜默覆蓋、
 *      各改各的欄位兩邊都保留、每次成功寫入都推進 rev。
 *   → `server/services/revisionGuard.pg.test.ts`（既有）：守衛本身的併發語意。
 *
 * 留在這裡的只有原始碼真的能回答的問題：**setCards 有沒有接上那個守衛**
 * （亦即「有沒有人繞過守衛另外寫了一條 raw update」）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "server/routers/scenes.ts"), "utf8");

describe("visual choice 寫入路徑的結構約束（行為見 *.pg.test.ts）", () => {
  it("setCards 接在既有的版本守衛上，沒有另外走一條 raw update", () => {
    const start = source.indexOf("setCards:");
    const block = source.slice(start, source.indexOf("generateInto:", start));
    expect(block).toContain("expectedRev:");
    expect(block).toContain("baseline:");
    expect(block).toContain("applyWithRevision({");
    expect(block).toContain('entity: "scene"');
  });
});
