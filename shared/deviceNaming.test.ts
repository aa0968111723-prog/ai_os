import { describe, expect, it } from "vitest";
import {
  brandOfModel,
  browserFamily,
  browserName,
  describeDevice,
  deviceKindFrom,
  deviceLabelFrom,
  kindFromLabel,
  marketingModel,
  modelDisplayName,
  osDescription,
  osFamily,
  screenText,
} from "./deviceNaming";

/** 真實 UA 字串（實機／各家文件），不自己編——編出來的 UA 測不到真正會誤判的形狀 */
const UA = {
  winChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  winEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.86",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadSafari:
    "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  androidTabletChrome:
    "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  samsungInternet:
    "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  lineAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S928B Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 Line/14.19.0/IAB",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone15,3;FBMD/iPhone]",
  firefoxIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
};

describe("osFamily", () => {
  it("辨識常見平台", () => {
    expect(osFamily(UA.winChrome)).toBe("Windows");
    expect(osFamily(UA.macSafari)).toBe("macOS");
    expect(osFamily(UA.iphoneSafari)).toBe("iOS");
    expect(osFamily(UA.androidChrome)).toBe("Android");
    expect(osFamily(UA.linuxFirefox)).toBe("Linux");
  });

  it("Android 不被 Linux 規則吃掉（Android 的 UA 也寫著 Linux）", () => {
    expect(osFamily(UA.androidChrome)).toBe("Android");
  });

  it("UA-CH 的平台優先於 UA 字串（Chrome 正在精簡 UA）", () => {
    expect(osFamily("Mozilla/5.0 (Unknown)", { detailPlatform: "Android" })).toBe("Android");
    expect(osFamily("Mozilla/5.0 (Unknown)", { detailPlatform: "Chrome OS" })).toBe("ChromeOS");
  });
});

describe("browserFamily", () => {
  it("由窄到寬比對，不把 Edge/Chrome 誤判成 Safari", () => {
    expect(browserFamily(UA.winEdge)).toBe("Edge");
    expect(browserFamily(UA.winChrome)).toBe("Chrome");
    expect(browserFamily(UA.macSafari)).toBe("Safari");
  });

  it("iOS 上的第三方瀏覽器認得出來（UA 用 FxiOS／CriOS 而非 Firefox／Chrome）", () => {
    expect(browserFamily(UA.firefoxIos)).toBe("Firefox");
    expect(browserFamily(UA.chromeIos)).toBe("Chrome");
  });

  it("Samsung 瀏覽器不再被歸成 Chrome——那是 Android 上最常見的預設瀏覽器", () => {
    expect(browserFamily(UA.samsungInternet)).toBe("Samsung 瀏覽器");
  });

  it("內建瀏覽器單獨標出：它們正是推播啟用失敗最常見的原因", () => {
    expect(browserFamily(UA.lineAndroid)).toBe("LINE 內建瀏覽器");
    expect(browserFamily(UA.facebookIos)).toBe("Facebook 內建瀏覽器");
  });

  it("認不出來就說認不出來，不亂猜", () => {
    expect(browserFamily("curl/8.4.0")).toBe("未知瀏覽器");
  });
});

describe("browserName", () => {
  it("Brave 只有 UA-CH 認得出來（UA 字串刻意偽裝成純 Chrome）", () => {
    expect(browserFamily(UA.winChrome)).toBe("Chrome");
    expect(browserName(UA.winChrome, { detailBrowserBrand: "Brave" })).toBe("Brave");
  });

  it("品牌就是 Chrome 時沿用短名，不寫成「Google Chrome」讓清單變長", () => {
    expect(browserName(UA.winChrome, { detailBrowserBrand: "Google Chrome" })).toBe("Chrome");
  });

  it("UA 已判出具名瀏覽器時不被品牌覆寫", () => {
    expect(browserName(UA.winEdge, { detailBrowserBrand: "Microsoft Edge" })).toBe("Edge");
  });
});

describe("osDescription", () => {
  it("Windows 依 platformVersion 主版本分辨 10／11（UA 字串永遠寫 NT 10.0）", () => {
    expect(osDescription(UA.winChrome, { detailOsVersion: "15.0.0" })).toBe("Windows 11");
    expect(osDescription(UA.winChrome, { detailOsVersion: "13.0.0" })).toBe("Windows 11");
    expect(osDescription(UA.winChrome, { detailOsVersion: "12.0.0" })).toBe("Windows 10");
    expect(osDescription(UA.winChrome, { detailOsVersion: "10.0.0" })).toBe("Windows 10");
    expect(osDescription(UA.winChrome)).toBe("Windows");
  });

  it("Android 帶版本；iOS 從 UA 取到次版本", () => {
    expect(osDescription(UA.androidChrome, { detailOsVersion: "14.0.0" })).toBe("Android 14");
    expect(osDescription(UA.iphoneSafari)).toBe("iOS 17.5");
  });

  it("macOS 用 UA-CH 版本（UA 字串停在 10_15_7 不再更新）", () => {
    expect(osDescription(UA.macSafari, { detailOsVersion: "15.3.1" })).toBe("macOS 15.3.1");
  });
});

describe("marketingModel / modelDisplayName", () => {
  it("三星代碼翻成行銷名——SM-S928B 沒有人看得懂，Galaxy S24 Ultra 一眼認得", () => {
    expect(marketingModel("SM-S928B")).toBe("Galaxy S24 Ultra");
    expect(modelDisplayName("SM-S928B")).toBe("Samsung Galaxy S24 Ultra");
  });

  it("同機型的各地區版本（B／U／0）視為同一台", () => {
    expect(marketingModel("SM-S928U")).toBe("Galaxy S24 Ultra");
    expect(marketingModel("SM-S9280")).toBe("Galaxy S24 Ultra");
  });

  it("查不到的代碼原樣保留（猜錯機型比不寫更糟）", () => {
    expect(marketingModel("SM-A999X")).toBe("SM-A999X");
    expect(modelDisplayName("SM-A999X")).toBe("Samsung SM-A999X");
    expect(modelDisplayName("CPH2451")).toBe("OPPO CPH2451");
  });

  it("Pixel 的代碼本身就是行銷名，不重複前綴", () => {
    expect(modelDisplayName("Pixel 8 Pro")).toBe("Google Pixel 8 Pro");
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

  it("認不出來就不猜", () => {
    expect(brandOfModel("ABC-123")).toBeUndefined();
    expect(brandOfModel("")).toBeUndefined();
    expect(brandOfModel(undefined)).toBeUndefined();
  });
});

describe("deviceKindFrom", () => {
  it("UA-CH 的機身型態最可靠，優先採用", () => {
    expect(deviceKindFrom(UA.androidChrome, { detailFormFactor: "Tablet" })).toBe("tablet");
    expect(deviceKindFrom(UA.winChrome, { detailFormFactor: "Mobile" })).toBe("phone");
  });

  it("Android 平板與手機分得出來（差別只在 UA 少一個 Mobile 字）", () => {
    expect(deviceKindFrom(UA.androidChrome)).toBe("phone");
    expect(deviceKindFrom(UA.androidTabletChrome)).toBe("tablet");
    expect(deviceKindFrom(UA.androidChrome, { model: "SM-X710" })).toBe("tablet");
  });

  it("iPadOS 13+ 偽裝成 Mac，用觸控點數揭穿", () => {
    expect(deviceKindFrom(UA.macSafari, { touchPoints: 5 })).toBe("tablet");
    expect(deviceKindFrom(UA.macSafari, { touchPoints: 0 })).toBe("desktop");
  });

  it("iPhone／桌機", () => {
    expect(deviceKindFrom(UA.iphoneSafari)).toBe("phone");
    expect(deviceKindFrom(UA.ipadSafari)).toBe("tablet");
    expect(deviceKindFrom(UA.winChrome)).toBe("desktop");
    expect(deviceKindFrom(UA.linuxFirefox)).toBe("desktop");
  });
});

describe("deviceLabelFrom", () => {
  it("拿得到機型時講機型與瀏覽器版本——這才分得出兩支一樣的手機", () => {
    expect(
      deviceLabelFrom(UA.androidChrome, {
        model: "SM-S928B",
        detailOsVersion: "14.0.0",
        detailBrowserVersion: "131.0.6778.86",
      }),
    ).toBe("Samsung Galaxy S24 Ultra・Chrome 131");
  });

  it("沒有機型就退回系統名稱（Win10／Win11 分得出來）", () => {
    expect(deviceLabelFrom(UA.winChrome, { detailOsVersion: "15.0.0", detailBrowserVersion: "131.0.0.0" }))
      .toBe("Windows 11・Chrome 131");
    expect(deviceLabelFrom(UA.iphoneSafari)).toBe("iPhone・Safari");
  });

  it("PWA 標「主畫面」但保留瀏覽器名——不知道是哪個瀏覽器裝的就不知道去哪裡移除", () => {
    expect(deviceLabelFrom(UA.androidChrome, { standalone: true })).toBe("Android・Chrome・主畫面");
  });

  it("內建瀏覽器直接寫在名字上", () => {
    expect(deviceLabelFrom(UA.lineAndroid, { detailOsVersion: "14.0.0" })).toBe("Android 14・LINE 內建瀏覽器");
  });

  it("iPadOS 偽裝成 Mac 時仍叫 iPad", () => {
    expect(deviceLabelFrom(UA.macSafari, { touchPoints: 5 })).toBe("iPad・Safari");
  });

  it("標籤長度有上限（DB 欄位與版面都放不下無限長的字串）", () => {
    const label = deviceLabelFrom(UA.androidChrome, { model: "X".repeat(200) });
    expect(label.length).toBeLessThanOrEqual(80);
  });
});

describe("kindFromLabel", () => {
  it("認得新舊兩種標籤格式（舊資料沒有 details.kind）", () => {
    expect(kindFromLabel("iPhone・Safari")).toBe("phone");
    expect(kindFromLabel("Android・Chrome")).toBe("phone");
    expect(kindFromLabel("Samsung Galaxy S24 Ultra・Chrome 131")).toBe("phone");
    expect(kindFromLabel("Samsung Galaxy Tab S9・Chrome 131")).toBe("tablet");
    expect(kindFromLabel("iPad・Safari")).toBe("tablet");
    expect(kindFromLabel("Windows 11・Chrome 131")).toBe("desktop");
    expect(kindFromLabel(null)).toBe("unknown");
  });
});

describe("screenText", () => {
  it("像素倍率四捨五入到兩位，不噴浮點數尾巴", () => {
    expect(screenText("1920x1080", 1.309999942779541)).toBe("1920x1080 @1.31x");
  });

  it("一般螢幕不加倍率（1x 沒有資訊量）", () => {
    expect(screenText("1920x1080", 1)).toBe("1920x1080");
    expect(screenText("1920x1080")).toBe("1920x1080");
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
    });
    expect(d.kind).toBe("desktop");
    expect(d.os).toBe("Windows 11");
    expect(d.cpu).toBe("X86 · 64 位元 · 16 核心");
    expect(d.memoryGb).toBe(8);
    expect(d.gpu).toBe("NVIDIA GeForce RTX 4070");
    expect(d.browserVersion).toBe("131.0.6778.86");
    expect(d.screen).toBe("2560x1440");
  });

  it("高解析螢幕標出倍率", () => {
    const d = describeDevice(UA.iphoneSafari, { screen: "390x844", detailPixelRatio: 3 });
    expect(d.screen).toBe("390x844 @3x");
  });

  it("Android 帶出廠牌、行銷名與原廠代碼（送修要報代碼）", () => {
    const d = describeDevice(UA.androidChrome, { model: "SM-S928B", detailOsVersion: "14.0.0" });
    expect(d.brand).toBe("Samsung");
    // 機型不重複廠牌——上一行就是「廠牌：Samsung」
    expect(d.model).toBe("Galaxy S24 Ultra");
    expect(d.modelCode).toBe("SM-S928B");
    expect(d.os).toBe("Android 14");
    expect(d.kind).toBe("phone");
  });

  it("認不出來的代碼原樣顯示，不另外列一次重複的代碼", () => {
    const d = describeDevice(UA.androidChrome, { model: "Pixel 8" });
    expect(d.model).toBe("Pixel 8");
    expect(d.modelCode).toBeUndefined();
  });

  it("Apple 裝置說明為何看不到機型，免得被當成 bug", () => {
    const d = describeDevice(UA.iphoneSafari, { screen: "390x844" });
    expect(d.brand).toBe("Apple");
    expect(d.modelNote).toContain("Apple 不對網頁公開機型");
    expect(d.model).toBeUndefined();
  });

  it("PWA 記在 standalone 欄位，瀏覽器欄位仍寫真正的瀏覽器", () => {
    const d = describeDevice(UA.androidChrome, { standalone: true });
    expect(d.standalone).toBe(true);
    expect(d.browser).toBe("Chrome");
  });
});
