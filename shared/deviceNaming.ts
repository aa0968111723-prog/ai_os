/**
 * 裝置辨識與命名（前後端共用的唯一一份）。
 *
 * 這裡回答的問題只有一個：「清單上這一列，是我的哪一台機器？」
 * 通知設定頁的三份清單（已連結裝置／登入裝置／信任裝置）、登入驗證信，
 * 全部從這裡取名字，措辭才會一致——同一台手機在三個地方叫三個名字，
 * 使用者根本不敢按「移除」。
 *
 * ★曾經的問題：客戶端（client/src/push.ts）與伺服器（deviceTrust.ts）各寫一套，
 *   客戶端那套只認 6 個平台、5 個瀏覽器，產出「Android・Chrome・主畫面」——
 *   一個人有兩支 Android 就分不出誰是誰。兩套合併於此，客戶端因此一併拿到
 *   機型、系統版本、瀏覽器版本。
 *
 * ★拿不到的東西（瀏覽器安全模型硬限制，不是實作缺陷）：
 *   IMEI、序號、MAC、電腦廠牌型號、Apple 裝置的機型。相關欄位一律留白並附
 *   modelNote 說明原因，免得被當成 bug。
 *
 * ★兩類資料分得很開（沿用 deviceTrust 的設計）：
 *   比對用的穩定欄位進指紋；detail* 開頭的顯示用欄位會隨更新漂移，永不進指紋。
 */

import type { DeviceDetails, DeviceKind } from "./deviceDetails";

/** 欄位分隔符。三份清單與驗證信共用，換一次就全站一起換 */
const SEP = "・";

/** 標籤長度上限（DB push_subscriptions.label／user_devices.label 都是 text，這是可讀性上限） */
const LABEL_MAX = 80;

/**
 * 前端送來的裝置特徵。
 *
 * 比對用欄位（無前綴）＝硬體特性，換機才會變，可安全進指紋；
 * detail* ＝給人看的細節，系統／瀏覽器／驅動更新都會改動它，★絕不進指紋
 * （否則每個月要求全公司重驗一次信箱，使用者會被訓練成看到驗證碼就無腦輸入）。
 */
export interface DeviceHint {
  /* ── 比對用：穩定欄位（進指紋） ── */
  /** screen.width×screen.height（用 screen 不是 window，改視窗大小不影響） */
  screen?: string;
  /** IANA 時區，如 Asia/Taipei */
  tz?: string;
  /** navigator.language */
  lang?: string;
  /** CPU 核心數 */
  cores?: number;
  /** 是否為「加到主畫面」的獨立 App（iOS 上與 Safari 是不同 cookie 空間，算兩台裝置） */
  standalone?: boolean;
  /** 裝置機型代碼（Android 給得到，如 "Pixel 8"／"SM-S928B"；桌機與 Apple 裝置為空） */
  model?: string;
  /** CPU 架構："x86" / "arm" */
  arch?: string;
  /** 位元數："64" / "32" */
  bitness?: string;
  /** 記憶體 GB（Chromium 上限回報 8） */
  memoryGb?: number;
  /** 觸控點數上限——用來區分觸控筆電與一般桌機，屬硬體特性不會變 */
  touchPoints?: number;

  /* ── 顯示用：會漂移的細節（★不進指紋） ── */
  /** 作業系統版本，如 Windows 的 "15.0.0"、Android 的 "14.0.0" */
  detailOsVersion?: string;
  /** 瀏覽器版本，如 "131.0.6778.86" */
  detailBrowserVersion?: string;
  /**
   * UA-CH 回報的瀏覽器品牌，如 "Brave"／"Microsoft Edge"／"Google Chrome"。
   * ★這是唯一能認出 Brave 的路：Brave 刻意把 UA 字串偽裝成純 Chrome 以防追蹤，
   * 但 UA-CH 的品牌清單裡仍誠實列出自己。
   */
  detailBrowserBrand?: string;
  /**
   * UA-CH 回報的平台，如 "Windows"／"macOS"／"Android"／"Chrome OS"。
   * Chrome 正在逐步凍結／精簡 UA 字串，之後平台判斷要以這個為準、UA 只作退路。
   */
  detailPlatform?: string;
  /**
   * UA-CH 的機身型態，如 "Mobile"／"Tablet"／"Desktop"。
   * 判斷平板最可靠的訊號——Android 平板的 UA 只是「少了 Mobile 這個字」，
   * 而某些手機瀏覽器的桌面模式也會拿掉它。
   */
  detailFormFactor?: string;
  /** 顯示卡型號，如 "NVIDIA GeForce RTX 4070" */
  detailGpu?: string;
  /** 螢幕像素密度倍率（Retina 為 2 或 3） */
  detailPixelRatio?: number;
}

/* ── 作業系統 ────────────────────────────────── */

/**
 * 作業系統家族（不含版本號，可進指紋）。
 * 優先信 UA-CH 的 platform：Chrome 正在精簡 UA 字串，UA-CH 才是長期可靠的來源。
 */
export function osFamily(ua: string, hint?: DeviceHint): string {
  const platform = hint?.detailPlatform?.trim().toLowerCase();
  if (platform) {
    if (platform === "android") return "Android";
    if (platform === "windows") return "Windows";
    if (platform === "macos") return "macOS";
    if (platform === "chrome os" || platform === "chromeos") return "ChromeOS";
    if (platform === "ios") return "iOS";
    // 深度／CUTOS 必須在泛用 Linux 之前：兩者 UA 都帶 Linux，被吃掉就分不出夥伴殼。
    if (platform === "deepin" || platform === "uos") return "Deepin";
    if (platform === "cutos") return "CUTOS";
    if (platform === "linux") return "Linux";
  }
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/\bAiosDeepin\/|\bDeepin\/|\bUOS\b/i.test(ua)) return "Deepin";
  if (/\bAiosCutos\/|\bCUTOS\b/i.test(ua)) return "CUTOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "未知系統";
}

/**
 * Windows 的 UA-CH platformVersion 主版本 ≥ 13 代表 Windows 11，1–12 代表 Windows 10。
 * 這是微軟文件的對應方式——UA 字串本身永遠寫 "Windows NT 10.0"，分不出 10 與 11。
 */
function windowsName(platformVersion: string | undefined): string {
  const major = Number.parseInt(platformVersion?.split(".")[0] ?? "", 10);
  if (Number.isNaN(major)) return "Windows";
  return major >= 13 ? "Windows 11" : "Windows 10";
}

/**
 * UA 取 Apple 系統版本（"iPhone OS 17_5_1" → "17.5"）。
 * Safari 沒有 UA-CH，只能從 UA 撈；只取到次版本，修訂號對辨認裝置沒有幫助。
 */
function appleVersionFromUa(ua: string): string | undefined {
  const m = /OS (\d+)[_.](\d+)/.exec(ua);
  if (!m) {
    const major = /OS (\d+)/.exec(ua);
    return major?.[1];
  }
  return `${m[1]}.${m[2]}`;
}

/** 去掉版本號尾巴無資訊量的 ".0"（"14.0.0" → "14"、"15.3.1" 保留） */
function trimVersion(version: string | undefined): string | undefined {
  const v = version?.trim();
  if (!v) return undefined;
  return v.replace(/(\.0)+$/, "") || v;
}

/** 作業系統名稱＋版本，如「Windows 11」「Android 14」「iOS 17.5」「macOS 15.3.1」 */
export function osDescription(ua: string, hint?: DeviceHint): string {
  const family = osFamily(ua, hint);
  const version = trimVersion(hint?.detailOsVersion);
  if (family === "Windows") return windowsName(hint?.detailOsVersion);
  if (family === "Android") return version ? `Android ${version}` : "Android";
  if (family === "iOS") {
    const v = appleVersionFromUa(ua) ?? version;
    return v ? `iOS ${v}` : "iOS";
  }
  if (family === "macOS") {
    const v = version ?? appleVersionFromUa(ua)?.replace(/_/g, ".");
    return v ? `macOS ${v}` : "macOS";
  }
  if (family === "ChromeOS") return version ? `ChromeOS ${version}` : "ChromeOS";
  if (family === "Deepin") {
    const uos = /\bUOS\b/i.test(ua);
    const name = uos ? "UOS" : "Deepin";
    return version ? `${name} ${version}` : name;
  }
  if (family === "CUTOS") return version ? `CUTOS ${version}` : "CUTOS";
  return family;
}

/* ── 瀏覽器 ────────────────────────────────── */

/**
 * UA → 瀏覽器家族（不含版本號，可進指紋）。
 *
 * ★順序就是正確性：Edge 的 UA 同時含 Chrome 與 Safari、Chrome 的 UA 含 Safari，
 *   由窄到寬比對，否則全部會被誤判成 Safari。
 *
 * ★內建瀏覽器（LINE／Facebook／Instagram／微信）特別標出來，不併進 Chrome/Safari：
 *   它們是這個站最常見的「推播啟用失敗」原因，看到名字就知道要請對方
 *   「用外部瀏覽器開啟」，而不是去查通知權限。
 */
export function browserFamily(ua: string): string {
  // 內建瀏覽器：本體多半是系統 WebView，UA 尾巴才掛自己的識別字，必須先驗
  if (/\bLine\//i.test(ua)) return "LINE 內建瀏覽器";
  if (/\bFBAN\/|\bFBAV\//i.test(ua)) return "Facebook 內建瀏覽器";
  if (/\bInstagram\b/i.test(ua)) return "Instagram 內建瀏覽器";
  if (/MicroMessenger/i.test(ua)) return "微信內建瀏覽器";
  if (/\bThreads\b/i.test(ua)) return "Threads 內建瀏覽器";
  // 具名 Chromium 衍生瀏覽器
  if (/SamsungBrowser\//i.test(ua)) return "Samsung 瀏覽器";
  if (/\bEdg\/|EdgA\/|EdgiOS\//i.test(ua)) return "Edge";
  if (/\bOPR\/|OPiOS\/|\bOpera\b/i.test(ua)) return "Opera";
  if (/\bVivaldi\//i.test(ua)) return "Vivaldi";
  if (/\bYaBrowser\//i.test(ua)) return "Yandex";
  if (/\bWhale\//i.test(ua)) return "Whale";
  if (/\bUCBrowser\//i.test(ua)) return "UC 瀏覽器";
  if (/DuckDuckGo\//i.test(ua)) return "DuckDuckGo";
  if (/\bFirefox\/|FxiOS\//i.test(ua)) return "Firefox";
  if (/CriOS\//i.test(ua)) return "Chrome";
  if (/HeadlessChrome\//i.test(ua)) return "Headless Chrome";
  if (/Chrome\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua)) return "Safari";
  return "未知瀏覽器";
}

/**
 * 顯示用的瀏覽器名稱：在 UA 判定之上，補 UA-CH 才看得到的品牌。
 *
 * Brave 是唯一真的需要這條的：它把 UA 字串偽裝成純 Chrome（反追蹤），
 * 只有 UA-CH 的品牌清單會誠實說自己是 Brave。其餘品牌（"Google Chrome"、
 * "Microsoft Edge"）UA 已經判得出來，就沿用上面的短名，不讓清單變得又臭又長。
 */
export function browserName(ua: string, hint?: DeviceHint): string {
  const brand = hint?.detailBrowserBrand?.trim();
  const family = browserFamily(ua);
  if (brand && family === "Chrome" && !/^google chrome$|^chromium$|^chrome$/i.test(brand)) {
    // 只在「UA 看起來是純 Chrome、品牌卻另有其名」時採信——這正是 Brave 的情形
    return brand.slice(0, 24);
  }
  return family;
}

/** 瀏覽器主版本（"131.0.6778.86" → "131"）；標籤只放主版本，小數位對辨認裝置沒有幫助 */
function majorVersion(version: string | undefined): string | undefined {
  const major = version?.trim().split(".")[0];
  return major && /^\d+$/.test(major) ? major : undefined;
}

/* ── 機型 ────────────────────────────────── */

/**
 * 三星機型代碼 → 行銷名稱。
 *
 * UA-CH 給的是原廠代碼："SM-S928B" 沒有人看得懂，"Galaxy S24 Ultra" 一眼就認得，
 * 而分辨「哪一台是我的」正是這整份清單存在的理由。
 *
 * ★只收有把握的對應，寧缺勿猜：認不出來就顯示 "Samsung SM-XXXX"（仍可比對），
 *   猜錯機型比不寫更糟——使用者會以為那是別人的裝置而按下移除。
 * ★鍵是「去掉地區尾碼的前 8 碼」：同一機型有 B/U/N/0/W 等多種地區版本
 *   （SM-S928B 歐版、SM-S928U 美版、SM-S9280 中國版），機型是同一台。
 */
const SAMSUNG_MODELS: Readonly<Record<string, string>> = {
  // Galaxy S 系列
  "SM-S938": "Galaxy S25 Ultra", "SM-S936": "Galaxy S25+", "SM-S931": "Galaxy S25",
  "SM-S928": "Galaxy S24 Ultra", "SM-S926": "Galaxy S24+", "SM-S921": "Galaxy S24",
  "SM-S918": "Galaxy S23 Ultra", "SM-S916": "Galaxy S23+", "SM-S911": "Galaxy S23",
  "SM-S908": "Galaxy S22 Ultra", "SM-S906": "Galaxy S22+", "SM-S901": "Galaxy S22",
  "SM-G998": "Galaxy S21 Ultra", "SM-G996": "Galaxy S21+", "SM-G991": "Galaxy S21",
  "SM-G988": "Galaxy S20 Ultra", "SM-G986": "Galaxy S20+", "SM-G981": "Galaxy S20",
  // 摺疊機
  "SM-F958": "Galaxy Z Fold7", "SM-F956": "Galaxy Z Fold6", "SM-F946": "Galaxy Z Fold5",
  "SM-F936": "Galaxy Z Fold4", "SM-F926": "Galaxy Z Fold3",
  "SM-F766": "Galaxy Z Flip7", "SM-F741": "Galaxy Z Flip6", "SM-F731": "Galaxy Z Flip5",
  "SM-F721": "Galaxy Z Flip4", "SM-F711": "Galaxy Z Flip3",
  // Note 系列
  "SM-N986": "Galaxy Note20 Ultra", "SM-N981": "Galaxy Note20",
  // A 系列（銷量最大的中階線）
  "SM-A566": "Galaxy A56", "SM-A556": "Galaxy A55", "SM-A546": "Galaxy A54",
  "SM-A536": "Galaxy A53", "SM-A528": "Galaxy A52s", "SM-A356": "Galaxy A35",
  "SM-A346": "Galaxy A34", "SM-A336": "Galaxy A33", "SM-A256": "Galaxy A25",
  "SM-A155": "Galaxy A15",
  // 平板（Tab S 系列——機型判定也靠它，見 deviceKindFrom）
  "SM-X930": "Galaxy Tab S10 Ultra", "SM-X820": "Galaxy Tab S10+",
  "SM-X910": "Galaxy Tab S9 Ultra", "SM-X916": "Galaxy Tab S9 Ultra",
  "SM-X810": "Galaxy Tab S9+", "SM-X816": "Galaxy Tab S9+",
  "SM-X710": "Galaxy Tab S9", "SM-X716": "Galaxy Tab S9",
  "SM-X900": "Galaxy Tab S8 Ultra", "SM-X800": "Galaxy Tab S8+", "SM-X700": "Galaxy Tab S8",
};

/**
 * 由機型代碼推廠牌。
 *
 * 這裡只做「有把握的前綴對應」——猜錯廠牌比不寫更糟（使用者會以為是別人的裝置）。
 */
export function brandOfModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const m = model.trim();
  if (!m) return undefined;
  if (/^Pixel|^Nexus/i.test(m)) return "Google";
  if (/^SM-|^GT-|^SCH-|^SPH-/i.test(m)) return "Samsung";
  if (/^iPhone|^iPad|^Mac/i.test(m)) return "Apple";
  if (/^Mi\b|^Redmi|^POCO|^M20\d{2}|^2[2-6]\d{6}/i.test(m)) return "Xiaomi";
  if (/^CPH\d|^OPPO/i.test(m)) return "OPPO";
  if (/^V\d{4}|^vivo/i.test(m)) return "vivo";
  if (/^RMX\d/i.test(m)) return "realme";
  if (/^Nokia/i.test(m)) return "Nokia";
  if (/^ASUS|^ZS\d|^AI\d{4}/i.test(m)) return "ASUS";
  if (/^HTC/i.test(m)) return "HTC";
  if (/^LM-|^LG-/i.test(m)) return "LG";
  if (/^Mate|^P\d{2}|^ELS-|^ANA-|^NOH-/i.test(m)) return "HUAWEI";
  if (/^moto|^XT\d{4}/i.test(m)) return "Motorola";
  if (/^Nothing|^A0\d{2}/i.test(m)) return "Nothing";
  return undefined;
}

/**
 * 機型代碼 → 看得懂的名字（認不出來就原樣回傳）。
 * Pixel 的代碼本身就是行銷名（"Pixel 8 Pro"），只有三星需要查表。
 */
export function marketingModel(model: string | undefined): string | undefined {
  const m = model?.trim();
  if (!m) return undefined;
  if (/^SM-/i.test(m)) {
    const key = m.toUpperCase().slice(0, 7);
    if (SAMSUNG_MODELS[key]) return SAMSUNG_MODELS[key];
  }
  return m;
}

/** 廠牌＋機型的完整顯示名，如「Samsung Galaxy S24 Ultra」「Google Pixel 8」 */
export function modelDisplayName(model: string | undefined): string | undefined {
  const pretty = marketingModel(model);
  if (!pretty) return undefined;
  const brand = brandOfModel(model);
  // 行銷名本身已含廠牌（"Galaxy…" 之於 Samsung 除外）就不重複前綴
  if (!brand || pretty.toLowerCase().startsWith(brand.toLowerCase())) return pretty;
  return `${brand} ${pretty}`;
}

/* ── 裝置類型 ────────────────────────────────── */

/**
 * 手機／平板／電腦。
 *
 * 判斷順序即可靠度：UA-CH 的 formFactor（原廠自陳）→ 機型代碼 → UA →
 * 觸控點數。單看 UA 的老方法會把 Android 平板判成手機（差別只在 UA 少一個
 * "Mobile" 字），也會把桌面模式的手機判成電腦。
 */
export function deviceKindFrom(ua: string, hint?: DeviceHint): DeviceKind {
  const form = hint?.detailFormFactor?.trim().toLowerCase();
  if (form === "mobile") return "phone";
  if (form === "tablet") return "tablet";
  if (form === "desktop") return "desktop";

  const model = hint?.model?.trim() ?? "";
  // 三星平板一律 SM-X／SM-T 開頭；Pixel Tablet 自己寫在名字裡
  if (/^SM-[XT]/i.test(model) || /tablet|tab\b/i.test(model)) return "tablet";

  if (/iPhone|iPod/i.test(ua)) return "phone";
  // iPadOS 13+ 的 UA 偽裝成 Mac——用觸控點數補判（Mac 沒有觸控螢幕）
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && (hint?.touchPoints ?? 0) > 1)) return "tablet";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "phone" : "tablet";

  const family = osFamily(ua, hint);
  if (family === "Windows" || family === "macOS" || family === "Linux" || family === "ChromeOS" || family === "Deepin" || family === "CUTOS") return "desktop";
  if (family === "iOS") return "phone";
  return (hint?.touchPoints ?? 0) > 1 ? "tablet" : "unknown";
}

/**
 * 從已存的標籤字串反推類型。
 *
 * 清單列拿不到對方的 UA，只有當初存下的標籤——新資料改看 details.kind（精準），
 * 這條是舊資料與 details 缺漏時的退路，故連舊格式（「Android・Chrome」）一起認。
 */
export function kindFromLabel(label: string | null | undefined): DeviceKind {
  if (!label) return "unknown";
  if (/iPad|平板|Tablet|Galaxy Tab|SM-[XT]/i.test(label)) return "tablet";
  if (/iPhone|Android|Galaxy|Pixel|Redmi|POCO|moto/i.test(label)) return "phone";
  if (/Windows|Mac|Linux|ChromeOS|Deepin|UOS|CUTOS|深度|桌面/i.test(label)) return "desktop";
  return "unknown";
}

/* ── 螢幕 ────────────────────────────────── */

/**
 * 螢幕描述。像素倍率要四捨五入到小數點後兩位再去掉尾隨的 0——
 * Windows 縮放 130% 時 devicePixelRatio 是 1.309999942779541，
 * 原樣顯示成「@1.309999942779541x」沒有人看得懂（實機實測抓到）。
 */
export function screenText(screen: string, pixelRatio?: number): string {
  if (!pixelRatio || Math.abs(pixelRatio - 1) < 0.01) return screen;
  const rounded = Number(pixelRatio.toFixed(2));
  return `${screen} @${rounded}x`;
}

/* ── 組裝 ────────────────────────────────── */

/**
 * 裝置的主要名稱（標籤的第一段）：能講機型就講機型，講不出來才退回系統名稱。
 * iPhone／iPad 直接用產品名而非「iOS 17.5」——那才是使用者對它的稱呼。
 */
function primaryName(ua: string, hint?: DeviceHint): string {
  const model = modelDisplayName(hint?.model);
  if (model) return model;
  if (/iPhone|iPod/i.test(ua)) return "iPhone";
  // 第二個條件是 iPadOS 13+：它的 UA 偽裝成 Mac，只有觸控點數揭穿它
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && (hint?.touchPoints ?? 0) > 1)) return "iPad";
  return osDescription(ua, hint);
}

/**
 * 給人看的裝置標籤，如：
 *   「Samsung Galaxy S24 Ultra・Chrome 131・主畫面」
 *   「Windows 11・Chrome 131」
 *   「iPhone・Safari 17.5」
 *   「Android 14・LINE 內建瀏覽器」
 *
 * 「主畫面」是加到主畫面的獨立 App——同一支手機上的瀏覽器與 PWA 是兩份 cookie 空間、
 * 兩筆推播訂閱，不標出來會看到兩列一模一樣的名字。
 * ★瀏覽器名稱保留（舊版把 PWA 的瀏覽器整個換成「主畫面App」）：
 *   知道是哪個瀏覽器裝的，才知道要去哪裡解除安裝。
 */
export function deviceLabelFrom(ua: string, hint?: DeviceHint): string {
  const browser = browserName(ua, hint);
  const version = majorVersion(hint?.detailBrowserVersion);
  const parts = [
    primaryName(ua, hint),
    version ? `${browser} ${version}` : browser,
    hint?.standalone ? "主畫面" : undefined,
  ].filter(Boolean) as string[];
  return parts.join(SEP).slice(0, LABEL_MAX);
}

/**
 * 完整的裝置細節（給人看，不參與比對）。
 *
 * 各平台實際能有多細差很多，故 modelNote 會直接寫明「為什麼看不到機型」，
 * 免得使用者以為功能壞了。
 */
export function describeDevice(ua: string, hint?: DeviceHint): DeviceDetails {
  const family = osFamily(ua, hint);
  const details: DeviceDetails = {
    kind: deviceKindFrom(ua, hint),
    os: osDescription(ua, hint),
    browser: browserName(ua, hint),
    browserVersion: hint?.detailBrowserVersion,
    standalone: hint?.standalone ? true : undefined,
    memoryGb: hint?.memoryGb,
    screen: hint?.screen ? screenText(hint.screen, hint.detailPixelRatio) : undefined,
    gpu: hint?.detailGpu,
  };

  if (hint?.cores) {
    details.cpu = [
      hint.arch ? hint.arch.toUpperCase() : undefined,
      hint.bitness ? `${hint.bitness} 位元` : undefined,
      `${hint.cores} 核心`,
    ].filter(Boolean).join(" · ");
  }

  if (hint?.model) {
    // 這裡的機型刻意不含廠牌（標籤才用 modelDisplayName）——細節清單上一行就是「廠牌」，
    // 兩行都寫 Samsung 只是佔版面
    details.model = marketingModel(hint.model);
    details.brand = brandOfModel(hint.model);
    // 查得到行銷名時把原廠代碼一併留著：送修、查規格要報的是代碼
    const raw = hint.model.trim();
    if (details.model && details.model !== raw) details.modelCode = raw;
  } else if (family === "iOS" || family === "macOS") {
    // Apple 刻意不對網頁公開機型——iPhone 12 與 iPhone 16 的 UA 完全相同。
    // 這不是我們的實作缺陷，寫清楚免得被當成 bug 回報。
    details.brand = "Apple";
    details.modelNote = "Apple 不對網頁公開機型（各代 iPhone／iPad 無法區分）";
  } else if (family === "Android") {
    details.modelNote = "這個瀏覽器沒有提供機型（換用 Chrome 或 Edge 可顯示）";
  }
  return details;
}
