import { describe, expect, it } from "vitest";
import { buildAssetLinks } from "./appLinks";

const FP_A = "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";
const FP_B = "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00";

describe("buildAssetLinks", () => {
  it("未設定指紋 → null（端點 404；App Links 驗證失敗＝連結開瀏覽器，沒有功能壞掉）", () => {
    expect(buildAssetLinks(undefined)).toBeNull();
    expect(buildAssetLinks("")).toBeNull();
    expect(buildAssetLinks("   ")).toBeNull();
  });

  it("單一指紋 → 標準 assetlinks 宣告", () => {
    const statements = buildAssetLinks(FP_A)!;
    expect(statements).toHaveLength(1);
    expect(statements[0].relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(statements[0].target.package_name).toBe("app.aios.mobile");
    expect(statements[0].target.sha256_cert_fingerprints).toEqual([FP_A]);
  });

  it("逗號分隔多把（換簽過渡期）＋去重＋正規化大寫", () => {
    const statements = buildAssetLinks(`${FP_A.toLowerCase()}, ${FP_B},${FP_A}`)!;
    expect(statements[0].target.sha256_cert_fingerprints).toEqual([FP_A, FP_B]);
  });

  it("格式壞掉的指紋整把丟棄——寧可 404 也不送出讓 Android 驗證器整份拒收的 JSON", () => {
    expect(buildAssetLinks("not-a-fingerprint")).toBeNull();
    expect(buildAssetLinks("AA:BB")).toBeNull();
    // 混雜時只留合法的
    const statements = buildAssetLinks(`garbage,${FP_A}`)!;
    expect(statements[0].target.sha256_cert_fingerprints).toEqual([FP_A]);
  });
});
