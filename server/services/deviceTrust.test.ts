/**
 * 裝置綁定登入的純函式測試（無 DB／無網路）。
 * DB 相關路徑（lookupDevice／trustDevice／revokeDevice）另由 e2e 與 pg 測試覆蓋。
 *
 * 命名（osFamily／browserFamily／機型翻譯／標籤／細節）搬到 shared/deviceNaming.ts
 * 與前端共用之後，那些測試也一起搬到 shared/deviceNaming.test.ts——同一套判斷不該有
 * 兩份會各自漂移的期望值。這裡留下的是只有伺服器才有的東西：指紋、模式解析、驗證信。
 */
import { describe, expect, it } from "vitest";
import {
  breakGlassActive,
  buildDeviceChallengeEmail,
  codesMatch,
  deviceTrustMisconfigured,
  fingerprintOf,
  graceActive,
  resolveDeviceTrustMode,
} from "./deviceTrust";
import { deviceDetailLines } from "../../shared/deviceDetails";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  winChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  winChromeNewer:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  winEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  macFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
};

const ENV_BASE = { RATE_LIMIT_SECRET: "test-pepper", NODE_ENV: "test" } as NodeJS.ProcessEnv;

describe("fingerprintOf", () => {
  const hint = { screen: "1920x1080", tz: "Asia/Taipei", lang: "zh-TW", cores: 8 };

  // 這是整個設計最重要的穩定性保證：含版本號的話 Chrome 每四週自動更新
  // 就等於每個月要求全公司重驗一次，使用者會被訓練成看到驗證碼就無腦輸入。
  it("瀏覽器版本號升級不改變指紋", () => {
    expect(fingerprintOf(UA.winChrome, hint, ENV_BASE)).toBe(
      fingerprintOf(UA.winChromeNewer, hint, ENV_BASE),
    );
  });

  it("換瀏覽器／換平台會改變指紋", () => {
    expect(fingerprintOf(UA.winChrome, hint, ENV_BASE)).not.toBe(
      fingerprintOf(UA.winEdge, hint, ENV_BASE),
    );
    expect(fingerprintOf(UA.winChrome, hint, ENV_BASE)).not.toBe(
      fingerprintOf(UA.macFirefox, hint, ENV_BASE),
    );
  });

  it("螢幕／時區／語言任一不同即不同指紋", () => {
    const base = fingerprintOf(UA.winChrome, hint, ENV_BASE);
    expect(fingerprintOf(UA.winChrome, { ...hint, screen: "1280x720" }, ENV_BASE)).not.toBe(base);
    expect(fingerprintOf(UA.winChrome, { ...hint, tz: "America/New_York" }, ENV_BASE)).not.toBe(base);
    expect(fingerprintOf(UA.winChrome, { ...hint, lang: "en-US" }, ENV_BASE)).not.toBe(base);
  });

  // iOS 的 Safari 與「加到主畫面」是不同 cookie 空間，本來就該算兩台裝置
  it("PWA 獨立模式與瀏覽器分屬不同指紋", () => {
    expect(fingerprintOf(UA.iphoneSafari, { ...hint, standalone: true }, ENV_BASE)).not.toBe(
      fingerprintOf(UA.iphoneSafari, hint, ENV_BASE),
    );
  });

  it("pepper 不同即指紋不同（DB 外洩者無法用彩虹表反推）", () => {
    expect(fingerprintOf(UA.winChrome, hint, ENV_BASE)).not.toBe(
      fingerprintOf(UA.winChrome, hint, { ...ENV_BASE, RATE_LIMIT_SECRET: "other-pepper" }),
    );
  });

  it("前端沒送特徵也能運作（退回只用 UA）", () => {
    expect(fingerprintOf(UA.winChrome, undefined, ENV_BASE)).toHaveLength(64);
  });

  // ★本檔最重要的一組：顯示用細節（detail*）一律不得進指紋。
  // 這些值會隨系統更新、瀏覽器更新、顯示卡驅動更新而變；任何一個進指紋，
  // 就等於每個月要求全公司重驗一次信箱，使用者會被訓練成看到驗證碼就無腦輸入。
  it("作業系統版本升級不改變指紋", () => {
    const base = fingerprintOf(UA.winChrome, { ...hint, detailOsVersion: "13.0.0" }, ENV_BASE);
    expect(fingerprintOf(UA.winChrome, { ...hint, detailOsVersion: "15.0.0" }, ENV_BASE)).toBe(base);
  });

  it("瀏覽器版本、顯示卡驅動、像素倍率變動都不改變指紋", () => {
    const base = fingerprintOf(UA.winChrome, hint, ENV_BASE);
    expect(fingerprintOf(UA.winChrome, { ...hint, detailBrowserVersion: "131.0.1" }, ENV_BASE)).toBe(base);
    expect(fingerprintOf(UA.winChrome, { ...hint, detailGpu: "NVIDIA GeForce RTX 4070" }, ENV_BASE)).toBe(base);
    expect(fingerprintOf(UA.winChrome, { ...hint, detailPixelRatio: 2 }, ENV_BASE)).toBe(base);
  });

  // 反面：硬體特性換了就該是另一台，必須改變指紋
  it("機型／架構／記憶體等硬體特性不同即不同指紋", () => {
    const base = fingerprintOf(UA.androidChrome, hint, ENV_BASE);
    expect(fingerprintOf(UA.androidChrome, { ...hint, model: "Pixel 8" }, ENV_BASE)).not.toBe(base);
    expect(fingerprintOf(UA.winChrome, { ...hint, arch: "arm" }, ENV_BASE)).not.toBe(
      fingerprintOf(UA.winChrome, { ...hint, arch: "x86" }, ENV_BASE),
    );
    expect(fingerprintOf(UA.winChrome, { ...hint, memoryGb: 8 }, ENV_BASE)).not.toBe(
      fingerprintOf(UA.winChrome, { ...hint, memoryGb: 4 }, ENV_BASE),
    );
  });
});

describe("deviceDetailLines", () => {
  it("只列有值的欄位", () => {
    const lines = deviceDetailLines({ brand: "Samsung", model: "SM-S928B", os: "Android 14" });
    expect(lines).toEqual(["廠牌：Samsung", "機型：SM-S928B", "系統：Android 14"]);
  });

  it("沒有機型時改列說明，使用者才知道不是壞掉", () => {
    const lines = deviceDetailLines({ brand: "Apple", modelNote: "Apple 不對網頁公開機型" });
    expect(lines).toContain("機型：Apple 不對網頁公開機型");
  });

  it("空值回空陣列", () => {
    expect(deviceDetailLines(null)).toEqual([]);
    expect(deviceDetailLines(undefined)).toEqual([]);
    expect(deviceDetailLines({})).toEqual([]);
  });
});

describe("resolveDeviceTrustMode", () => {
  it("未設定或值無效一律 off（安全預設，不會意外開啟）", () => {
    expect(resolveDeviceTrustMode({} as NodeJS.ProcessEnv, true)).toBe("off");
    expect(resolveDeviceTrustMode({ DEVICE_TRUST_MODE: "yes" } as NodeJS.ProcessEnv, true)).toBe("off");
    expect(resolveDeviceTrustMode({ DEVICE_TRUST_MODE: "" } as NodeJS.ProcessEnv, true)).toBe("off");
  });

  it("大小寫與空白容錯", () => {
    expect(resolveDeviceTrustMode({ DEVICE_TRUST_MODE: " ENFORCE " } as NodeJS.ProcessEnv, true)).toBe("enforce");
  });

  // 這是最重要的一條：enforce 但寄不出信＝陌生裝置永遠收不到驗證碼＝
  // 全員（含超管）鎖死且無後門。必須自動降級，不能照做。
  it("enforce 但信箱機制未就緒時自動降級為 monitor", () => {
    expect(resolveDeviceTrustMode({ DEVICE_TRUST_MODE: "enforce" } as NodeJS.ProcessEnv, false)).toBe("monitor");
    expect(deviceTrustMisconfigured({ DEVICE_TRUST_MODE: "enforce" } as NodeJS.ProcessEnv, false)).toBe(true);
  });

  it("信箱就緒時 enforce 正常生效", () => {
    expect(resolveDeviceTrustMode({ DEVICE_TRUST_MODE: "enforce" } as NodeJS.ProcessEnv, true)).toBe("enforce");
    expect(deviceTrustMisconfigured({ DEVICE_TRUST_MODE: "enforce" } as NodeJS.ProcessEnv, true)).toBe(false);
  });

  it("monitor 不受信箱狀態影響（本來就不寄驗證碼）", () => {
    expect(resolveDeviceTrustMode({ DEVICE_TRUST_MODE: "monitor" } as NodeJS.ProcessEnv, false)).toBe("monitor");
  });
});

describe("breakGlassActive", () => {
  const now = new Date("2026-07-31T12:00:00Z");
  const future = { DEVICE_TRUST_BREAKGLASS_UNTIL: "2026-07-31T13:00:00Z" } as NodeJS.ProcessEnv;

  it("只對超管生效——一般帳號的救援走管理員預先授信", () => {
    expect(breakGlassActive(true, future, now)).toBe(true);
    expect(breakGlassActive(false, future, now)).toBe(false);
  });

  it("過期即失效", () => {
    expect(
      breakGlassActive(true, { DEVICE_TRUST_BREAKGLASS_UNTIL: "2026-07-31T11:00:00Z" } as NodeJS.ProcessEnv, now),
    ).toBe(false);
  });

  it("未設定或格式壞掉都不放行（壞值不可當成永久後門）", () => {
    expect(breakGlassActive(true, {} as NodeJS.ProcessEnv, now)).toBe(false);
    expect(
      breakGlassActive(true, { DEVICE_TRUST_BREAKGLASS_UNTIL: "not-a-date" } as NodeJS.ProcessEnv, now),
    ).toBe(false);
  });
});

describe("graceActive", () => {
  const now = new Date("2026-07-31T12:00:00Z");
  it("未設定／已過期都不放行", () => {
    expect(graceActive(null, now)).toBe(false);
    expect(graceActive(undefined, now)).toBe(false);
    expect(graceActive(new Date("2026-07-31T11:59:00Z"), now)).toBe(false);
  });
  it("時窗內放行", () => {
    expect(graceActive(new Date("2026-07-31T12:30:00Z"), now)).toBe(true);
  });
});

describe("codesMatch", () => {
  it("相同才為真", () => {
    expect(codesMatch("abc123", "abc123")).toBe(true);
    expect(codesMatch("abc123", "abc124")).toBe(false);
  });

  // timingSafeEqual 對長度不等會直接丟例外——必須先擋，否則驗證流程會 500 而非回「碼不對」
  it("長度不同回 false 而非丟例外", () => {
    expect(() => codesMatch("abc", "abcdef")).not.toThrow();
    expect(codesMatch("abc", "abcdef")).toBe(false);
    expect(codesMatch("", "x")).toBe(false);
  });
});

describe("buildDeviceChallengeEmail", () => {
  const mail = buildDeviceChallengeEmail("iPhone · Safari", "483920", new Date("2026-07-31T06:35:00Z"));

  it("主旨帶驗證碼，手機通知列直接看得到", () => {
    expect(mail.subject).toContain("483920");
  });

  it("內文寫明裝置與驗證碼", () => {
    expect(mail.text).toContain("iPhone · Safari");
    expect(mail.text).toContain("483920");
  });

  // 使用者收到非本人觸發的驗證信時，必須當場知道「密碼已外洩、要去改密碼」
  it("內文告訴使用者不是本人時該怎麼辦", () => {
    expect(mail.text).toContain("改密碼");
  });

  // 06:35 UTC → 台北 14:35：夥伴看到的時間必須是自己的時區，否則無從判斷「這是不是我剛才登的」
  it("時間以台北時區呈現", () => {
    expect(mail.text).toMatch(/2026年7月31日\s*下午\s*2:35/);
  });
});
