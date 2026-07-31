import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * FB-SHOT-01 的另一半：截圖修好之後，回饋面板本身不能被撐爆。
 *
 * 這些是版面契約，靠讀原始碼斷言（與 lib/keyboardInset.test.ts 同一套做法）——
 * jsdom 不做版面計算，量不出「面板長出視窗外」，但把規則寫死在這裡，
 * 之後有人把 max-height 拿掉或退回只在 ≤560px 生效時就會紅燈。
 */
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

describe("回饋面板的高度上限", () => {
  it("基礎樣式就有 max-height，不是只有 ≤560px 才有", () => {
    const styles = read("client/src/styles.css");
    const at = styles.indexOf('.fb-fab-root .card[role="dialog"]');
    expect(at, "styles.css 缺少回饋面板的基礎 max-height 規則").toBeGreaterThan(-1);

    // 必須在任何 @media 之外，否則又回到「只有某段寬度有保護」。
    // 本檔慣例：基礎規則頂格，@media 內的規則縮排兩格——用縮排判斷即可。
    expect(
      /\n\.fb-fab-root \.card\[role="dialog"\]/.test(styles),
      "規則被縮排了（八成包進 @media）——請放在基礎層頂格",
    ).toBe(true);

    const rule = styles.slice(at, styles.indexOf("}", styles.indexOf("{", at)));
    expect(rule).toContain("max-height");
    // 高度上限要扣掉鍵盤：iOS 的 dvh 不隨鍵盤縮，不扣就會被鍵盤推出畫面
    expect(rule).toContain("--kb-inset");
  });

  it("≤560px 的更緊上限仍在，且載入順序讓它蓋得過基礎規則", () => {
    const mobile = read("client/src/styles.mobile-fab-01.css");
    expect(mobile).toContain('.fb-fab-root .card[role="dialog"]');
    expect(mobile).toContain("max-height");

    const main = read("client/src/main.tsx");
    expect(main.indexOf('import "./styles.mobile-fab-01.css"')).toBeGreaterThan(
      main.indexOf('import "./styles.css"'),
    );
  });
});

describe("回饋表單的截圖行為", () => {
  const widget = () => read("client/src/feedback/FeedbackWidget.tsx");

  it("截圖預覽有高度上限（預覽圖長寬比＝視窗長寬比，手機會比面板還高）", () => {
    const src = widget();
    const img = src.slice(src.indexOf('alt="截圖預覽"'), src.indexOf('alt="截圖預覽"') + 400);
    expect(img).toContain("maxHeight");
    expect(img).toContain("objectFit");
  });

  it("送出時等擷取完成，而不是看當下有沒有結果", () => {
    const src = widget();
    // 使用者常在擷取（約 2 秒）跑完前就按送出；只讀結果會靜默附不到圖
    expect(src).toContain("await shotPromiseRef.current");
  });

  it("截圖上傳有逾時，卡住的連線不會讓純文字回饋也送不出去", () => {
    expect(widget()).toContain("AbortSignal.timeout");
  });

  it("勾了「不附截圖」就不跑擷取", () => {
    const src = widget();
    const effect = src.slice(src.indexOf("表單一開就先擷取"), src.indexOf("送出成功短暫顯示感謝"));
    expect(effect).toContain("if (noShot)");
    expect(effect).toMatch(/\[target, captureAttempt, noShot\]/);
  });

  it("截圖沒附成功時，送出後老實告知（預覽圖還在畫面上，不講會以為附了）", () => {
    expect(widget()).toContain("shotUploadFailed");
  });
});
