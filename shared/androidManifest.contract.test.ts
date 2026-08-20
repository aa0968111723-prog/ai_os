import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ANDROID_MAIN = path.join(__dirname, "..", "android", "app", "src", "main");
const manifest = readFileSync(path.join(ANDROID_MAIN, "AndroidManifest.xml"), "utf8");
const mainActivity = readFileSync(
  path.join(ANDROID_MAIN, "java", "app", "aios", "mobile", "MainActivity.java"),
  "utf8",
);

/**
 * Android 殼層的契約（Native v1）。
 *
 * 這裡不能編 Java（CI 的 apk workflow 才有 Android SDK），所以用 source 契約
 * 把「權限最小化」與「native bridge 有掛上」在單元層守住：
 * - 權限只准 INTERNET + RECORD_AUDIO——SYSTEM_ALERT_WINDOW 之類 overlay
 *   權限明令不得作為 Native v1 的核心依賴（任務書 B12；浮動桌寵是 v2 的事）。
 * - SpeechRecognizer 需要 Android 11+ 的套件可見性宣告，漏了它
 *   isRecognitionAvailable 永遠 false、按住 Orb 靜默退化——而且只在實機上看得出來。
 */
describe("Android manifest contract（Native v1）", () => {
  it("權限最小化：只有 INTERNET 與 RECORD_AUDIO", () => {
    const permissions = [...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map((m) => m[1]);
    // 註解裡可以提 SYSTEM_ALERT_WINDOW（紅線的記載），宣告裡不行——所以驗
    // uses-permission 的完整清單，而不是全文 not.toContain。
    expect(permissions.sort()).toEqual([
      "android.permission.INTERNET",
      "android.permission.RECORD_AUDIO",
    ]);
  });

  it("SpeechRecognizer 套件可見性（Android 11+）已宣告", () => {
    expect(manifest).toContain("android.speech.RecognitionService");
  });

  it("https App Links 帶 autoVerify；aios:// 自訂 scheme 在場", () => {
    expect(manifest).toContain('android:autoVerify="true"');
    expect(manifest).toContain('android:scheme="aios"');
  });

  it("Widget receiver 不對外（exported=false）", () => {
    const receiver = manifest.slice(manifest.indexOf("OrbWidgetProvider"));
    expect(receiver.slice(0, 400)).toContain('android:exported="false"');
  });

  it("MainActivity 註冊了兩個 native bridge 並轉譯 aios:// scheme", () => {
    expect(mainActivity).toContain("registerPlugin(OrbWidgetPlugin.class)");
    expect(mainActivity).toContain("registerPlugin(AiosSpeechPlugin.class)");
    expect(mainActivity).toContain("AiosSchemeRouter.webPathFor");
  });

  it("語音 plugin 不落地音訊、不把逐字稿寫進裝置 log（B15）", () => {
    const speech = readFileSync(
      path.join(ANDROID_MAIN, "java", "app", "aios", "mobile", "AiosSpeechPlugin.java"),
      "utf8",
    );
    // 系統 SpeechRecognizer 在裝置端辨識；plugin 不該引入任何檔案輸出或 Log 呼叫
    expect(speech).not.toContain("FileOutputStream");
    expect(speech).not.toMatch(/\bLog\.[divwe]\(/);
  });
});
