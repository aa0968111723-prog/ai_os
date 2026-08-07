import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { willUsePersonalKey } from "./byokPredict";
import { isNimModel, MODELS } from "./models";

// 用 isNimModel 本人挑，不要用字串猜——猜錯會讓這條測試變成假綠燈
const falModel = MODELS.find((m) => !isNimModel(m));
const nimModel = MODELS.find((m) => isNimModel(m));

const activeKey = { provider: "fal", status: "active", preferUserKey: true };

describe("BYOK 生成前預測", () => {
  it("有 active 且 preferUserKey 的 fal 金鑰時，非 NIM 模型預測會用個人金鑰", () => {
    expect(willUsePersonalKey(falModel, [activeKey])).toBe(true);
  });

  // 三個否定條件各自都足以讓伺服器不用個人金鑰——任何一個漏掉，
  // 畫面就會說「不扣點」但實際扣了
  it("status 非 active 就不算", () => {
    expect(willUsePersonalKey(falModel, [{ ...activeKey, status: "error" }])).toBe(false);
    expect(willUsePersonalKey(falModel, [{ ...activeKey, status: "disabled" }])).toBe(false);
  });

  it("preferUserKey 為假就不算（使用者自己選擇走平台點數）", () => {
    expect(willUsePersonalKey(falModel, [{ ...activeKey, preferUserKey: false }])).toBe(false);
  });

  it("沒有金鑰、沒有模型時都是否", () => {
    expect(willUsePersonalKey(falModel, [])).toBe(false);
    expect(willUsePersonalKey(falModel, undefined)).toBe(false);
    expect(willUsePersonalKey(null, [activeKey])).toBe(false);
  });

  it("其他 provider 的金鑰不會被誤用（fal 以外一律不算）", () => {
    expect(willUsePersonalKey(falModel, [{ ...activeKey, provider: "openai" }])).toBe(false);
  });

  if (nimModel) {
    it("NIM 模型永遠不用個人 fal 金鑰", () => {
      expect(willUsePersonalKey(nimModel, [activeKey])).toBe(false);
    });
  }

  /**
   * 這條是特徵測試：預測與伺服器結算若有一邊改了規則，畫面就會對使用者說謊。
   * 直接讀伺服器原始碼確認那三個條件還在原處——改動時會被這條擋下來，
   * 提醒同步 shared/byokPredict.ts。
   */
  it("伺服器端的取用條件仍是 active + preferUserKey + 非 NIM", () => {
    const keys = readFileSync(resolve(process.cwd(), "server/services/userAiKeys.ts"), "utf8");
    expect(keys).toMatch(/status !== "active" \|\| !row\.preferUserKey/);
    const byok = readFileSync(resolve(process.cwd(), "server/services/byokBilling.ts"), "utf8");
    expect(byok).toMatch(/isNimModel\(model\)/);
  });
});
