/**
 * 裝置綁定登入的純函式測試（無 DB／無網路）。
 * DB 相關路徑（lookupDevice／trustDevice／revokeDevice）另由 e2e 與 pg 測試覆蓋。
 */
import { describe, expect, it } from "vitest";
import {
  brandOfModel,
  breakGlassActive,
  browserFamily,
  buildDeviceChallengeEmail,
  codesMatch,
  describeDevice,
  deviceLabelFrom,
  deviceTrustMisconfigured,
  fingerprintOf,
  graceActive,
  osDescription,
  osFamily,
  screenText,
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

describe("osFamily / browserFamily", () => {
  it("辨識常見平台", () => {
    expect(osFamily(UA.iphoneSafari)).toBe("iOS");
    expect(osFamily(UA.winChrome)).toBe("Windows");
    expect(osFamily(UA.macFirefox)).toBe("macOS");
    expect(osFamily(UA.androidChrome)).toBe("Android");
  });

  // Edge 的 UA 同時含 Chrome 與 Safari、Chrome 的 UA 含 Safari；比對順序錯就會全被判成 Safari。
  it("由窄到寬比對，不把 Edge/Chrome 誤判成 Safari", () => {
    expect(browserFamily(UA.winEdge)).toBe("Edge");
    expect(browserFamily(UA.winChrome)).toBe("Chrome");
    expect(browserFamily(UA.androidChrome)).toBe("Chrome");
    expect(browserFamily(UA.iphoneSafari)).toBe("Safari");
    expect(browserFamily(UA.macFirefox)).toBe("Firefox");
  });

  // Android 的 UA 也含 Linux——順序必須先判 Android
  it("Android 不被 Linux 規則吃掉", () => {
    expect(osFamily(UA.androidChrome)).not.toBe("Linux");
  });
});

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

describe("deviceLabelFrom", () => {
  it("產生看得懂的名稱", () => {
    expect(deviceLabelFrom(UA.iphoneSafari)).toBe("iPhone · Safari");
    expect(deviceLabelFrom(UA.winChrome)).toBe("Windows · Chrome");
    expect(deviceLabelFrom(UA.macFirefox)).toBe("macOS · Firefox");
  });

  it("PWA 標成主畫面App，使用者才分得出同一支手機上的兩台", () => {
    expect(deviceLabelFrom(UA.iphoneSafari, { standalone: true })).toBe("iPhone · 主畫面App");
  });

  it("拿得到機型時帶上廠牌與型號", () => {
    expect(deviceLabelFrom(UA.androidChrome, { model: "SM-S928B" })).toBe("Samsung SM-S928B · Chrome");
    expect(deviceLabelFrom(UA.androidChrome, { model: "Pixel 8" })).toBe("Google Pixel 8 · Chrome");
  });

  it("有 OS 版本時標題就帶版本（Win10／Win11 分得出來）", () => {
    expect(deviceLabelFrom(UA.winChrome, { detailOsVersion: "15.0.0" })).toBe("Windows 11 · Chrome");
    expect(deviceLabelFrom(UA.winChrome, { detailOsVersion: "10.0.0" })).toBe("Windows 10 · Chrome");
  });
});

describe("brandOfModel", () => {
  it("由原廠代碼推廠牌", () => {
    expect(brandOfModel("SM-S928B")).toBe("Samsung");
    expect(brandOfModel("Pixel 8")).toBe("Google");
    expect(brandOfModel("CPH2451")).toBe("OPPO");
    expect(brandOfModel("RMX3771")).toBe("realme");
    expect(brandOfModel("XT2315-2")).toBe("Motorola");
  });

  // 猜錯廠牌比不寫更糟——使用者會以為清單裡是別人的裝置
  it("認不出來就不猜", () => {
    expect(brandOfModel("QQQ-9999")).toBeUndefined();
    expect(brandOfModel("")).toBeUndefined();
    expect(brandOfModel(undefined)).toBeUndefined();
  });
});

describe("osDescription", () => {
  // UA 字串永遠寫 "Windows NT 10.0"，只有 UA-CH 的 platformVersion 分得出 10 與 11
  it("Windows 依 platformVersion 主版本分辨 10／11", () => {
    expect(osDescription(UA.winChrome, { detailOsVersion: "15.0.0" })).toBe("Windows 11");
    expect(osDescription(UA.winChrome, { detailOsVersion: "13.0.0" })).toBe("Windows 11");
    expect(osDescription(UA.winChrome, { detailOsVersion: "12.0.0" })).toBe("Windows 10");
    expect(osDescription(UA.winChrome)).toBe("Windows");
  });

  it("Android 帶版本、iOS 從 UA 取主版本", () => {
    expect(osDescription(UA.androidChrome, { detailOsVersion: "14.0.0" })).toBe("Android 14");
    expect(osDescription(UA.iphoneSafari)).toBe("iOS 17");
  });
});

describe("describeDevice", () => {
  it("桌機組出處理器／記憶體／螢幕／顯示卡", () => {
    const d = describeDevice(UA.winChrome, {
      screen: "2560x1440",
      cores: 16,
      arch: "x86",
      bitness: "64",
      memoryGb: 8,
      detailOsVersion: "15.0.0",
      detailBrowserVersion: "131.0.6778.86",
      detailGpu: "NVIDIA GeForce RTX 4070",
      detailPixelRatio: 1,
    });
    expect(d.os).toBe("Windows 11");
    expect(d.cpu).toBe("X86 · 64 位元 · 16 核心");
    expect(d.memoryGb).toBe(8);
    expect(d.gpu).toBe("NVIDIA GeForce RTX 4070");
    expect(d.browserVersion).toBe("131.0.6778.86");
  });

  it("Android 帶出廠牌與機型", () => {
    const d = describeDevice(UA.androidChrome, { model: "SM-S928B", detailOsVersion: "14.0.0" });
    expect(d.brand).toBe("Samsung");
    expect(d.model).toBe("SM-S928B");
    expect(d.os).toBe("Android 14");
  });

  // Apple 刻意不公開機型；要寫清楚原因，否則會被當成功能壞掉回報
  it("Apple 裝置說明為何看不到機型", () => {
    const d = describeDevice(UA.iphoneSafari, { screen: "390x844" });
    expect(d.brand).toBe("Apple");
    expect(d.model).toBeUndefined();
    expect(d.modelNote).toMatch(/Apple 不對網頁公開機型/);
  });

  it("高解析螢幕標出倍率", () => {
    const d = describeDevice(UA.iphoneSafari, { screen: "390x844", detailPixelRatio: 3 });
    expect(d.screen).toBe("390x844 @3x");
  });
});

describe("screenText", () => {
  // 實機實測：Windows 縮放 130% 時 devicePixelRatio 是 1.309999942779541，
  // 原樣顯示成「@1.309999942779541x」沒有人看得懂
  it("像素倍率四捨五入到兩位，不噴浮點數尾巴", () => {
    expect(screenText("1466x825", 1.309999942779541)).toBe("1466x825 @1.31x");
    expect(screenText("390x844", 3)).toBe("390x844 @3x");
    expect(screenText("2560x1440", 2)).toBe("2560x1440 @2x");
  });

  it("一般螢幕不加倍率（1x 沒有資訊量）", () => {
    expect(screenText("1920x1080", 1)).toBe("1920x1080");
    expect(screenText("1920x1080")).toBe("1920x1080");
    expect(screenText("1920x1080", 1.001)).toBe("1920x1080");
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
