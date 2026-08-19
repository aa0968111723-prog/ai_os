/**
 * 變體端點的**架構**約束。
 *
 * 這一份刻意只斷言「原始碼層真的存在的性質」——也就是「有沒有另外長出第二條生成管線
 * 或第二個候選資料表」。這種問題讀原始碼是對的工具：它問的是結構，不是行為。
 *
 * 行為（指標不被覆寫、人類優先、partial failure、計費冪等、血緣）一律由真行為測試守：
 *   - server/services/creativeVariantPointer.pg.test.ts（真 PostgreSQL 多條件原子更新）
 *   - server/services/creativeVariantCost.pg.test.ts（真 PostgreSQL 帳本冪等）
 *   - shared/creativeVariantLifecycle.test.ts（params 往返、批次推導、血緣、相依感知）
 *
 * 為什麼要特別寫這段：v3 這支檔案原本用 readFileSync + toContain 斷言
 * `preserveScenePointer !== true` 這串字還在，就宣稱「指標受保護」。稽核實際找到的缺陷
 * （generation.decideCost 全欄覆寫 params 把該旗標洗掉）讓那個保護在執行期失效，
 * 而那串字一個字都沒變——測試全綠、行為已壞。字串在不等於不變式成立。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scenes = readFileSync(join(process.cwd(), "server/routers/scenes.ts"), "utf8");
const core = readFileSync(join(process.cwd(), "server/services/generationCore.ts"), "utf8");
const generation = readFileSync(join(process.cwd(), "server/routers/generation.ts"), "utf8");

const variantsBlock = scenes.slice(scenes.indexOf("generateVariants:"), scenes.indexOf("generateVariants:") + 6000);

describe("變體不另建第二條管線", () => {
  it("每個 slot 都走同一支 executeGenerationCommand（不是自己呼叫 submitGenerationCore）", () => {
    expect(variantsBlock).toContain("executeGenerationCommand({");
    expect(variantsBlock).not.toContain("submitGenerationCore");
    // 一個 slot 一把冪等鍵：計費／重送的收據仍然是既有那一套
    expect(variantsBlock).toContain("id: slot.row.clientRequestId");
    expect(variantsBlock).toContain("Promise.allSettled");
    expect(variantsBlock).toContain("scheduleReconcileAfterIndependentGenerate");
  });

  it("候選一律不動 current 指標，且方向與批次落在既有 params 內", () => {
    expect(variantsBlock).toContain("preserveScenePointer: true");
    expect(variantsBlock).toContain("creative: {");
    expect(variantsBlock).toContain("batchId: input.batchId");
  });

  it("沒有第二個候選資料表：批次靠 generations 的 batchId 分群，不新增 schema", () => {
    const schemaFiles = readFileSync(join(process.cwd(), "server/db/schema/generation.ts"), "utf8");
    expect(schemaFiles).not.toContain("variant_candidates");
    expect(schemaFiles).not.toContain("asset_versions");
    // 血緣沿用既有的 assetRevisions 概念與 source meta，沒有新表
    expect(scenes).not.toContain("schema.variantCandidates");
  });
});

describe("meta 全欄覆寫的回歸護欄", () => {
  it("decideCost 重寫 params 時必須攤平既有 meta（否則指標政策會蒸發）", () => {
    const start = generation.indexOf("重簽來源網址");
    const block = generation.slice(start, start + 2500);
    // 只挑幾個欄位重建 = 把其餘 meta 丟掉；必須看到 spread
    expect(block).toContain("...splitParams.meta");
  });

  it("完成回填同時受 approved 與『送出當下的指標』兩個條件保護", () => {
    expect(core).toContain("ne(schema.scenes.reviewStatus,");
    expect(core).toContain("scenePointerAtSubmit");
    expect(core).toContain("pointerGuard");
  });
});
