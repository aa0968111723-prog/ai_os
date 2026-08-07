/**
 * 裝置細節的型別與呈現（前後端共用）。
 *
 * 這裡的資料**只給人看**，不參與裝置比對——因為系統更新、瀏覽器更新、顯示卡驅動更新
 * 都會讓這些值漂移。若拿去比對就會每個月要求全公司重驗一次信箱，
 * 使用者會被訓練成「看到驗證碼就無腦輸入」，那比不做驗證還危險。
 * 比對用的穩定指紋見 server/services/deviceTrust.ts 的 fingerprintOf。
 *
 * 這些欄位怎麼從 UA／UA-CH 推出來，見 shared/deviceNaming.ts。
 */

/** 裝置類型（清單圖示與措辭用） */
export type DeviceKind = "phone" | "tablet" | "desktop" | "unknown";

export interface DeviceDetails {
  /** 手機／平板／電腦——清單圖示看這個（舊資料沒有時退回從標籤猜） */
  kind?: DeviceKind;
  /** 廠牌，如 Google／Samsung／Apple。推不出來就沒有（猜錯比不寫更糟） */
  brand?: string;
  /** 機型（已翻成看得懂的名字），如 Galaxy S24 Ultra／Pixel 8。Apple 裝置與桌機拿不到 */
  model?: string;
  /** 原廠機型代碼，如 SM-S928B——送修、查規格要報的是這個 */
  modelCode?: string;
  /** 作業系統，如「Windows 11」「Android 14」「iOS 17.5」 */
  os?: string;
  browser?: string;
  browserVersion?: string;
  /** 是否為「加到主畫面」的獨立 App（同一支手機上的瀏覽器與 PWA 是兩台） */
  standalone?: boolean;
  /** 如「ARM · 64 位元 · 8 核心」 */
  cpu?: string;
  memoryGb?: number;
  screen?: string;
  gpu?: string;
  /** 為什麼看不到機型（Apple 封鎖／瀏覽器不支援）——寫給使用者看，免得以為功能壞了 */
  modelNote?: string;
}

/**
 * 攤成「欄位：值」列，只列有值的。信件與「我的裝置」清單共用同一份呈現，
 * 兩邊看到的措辭才會一致。
 */
export function deviceDetailLines(details: DeviceDetails | null | undefined): string[] {
  if (!details) return [];
  const model = details.model
    ? details.modelCode ? `${details.model}（${details.modelCode}）` : details.model
    : details.modelNote;
  const rows: Array<[string, string | undefined]> = [
    ["廠牌", details.brand],
    ["機型", model],
    ["系統", details.os],
    [
      "瀏覽器",
      [details.browserVersion ? `${details.browser} ${details.browserVersion}` : details.browser,
        details.standalone ? "（主畫面 App）" : ""].filter(Boolean).join("") || undefined,
    ],
    ["處理器", details.cpu],
    ["記憶體", details.memoryGb ? `${details.memoryGb} GB` : undefined],
    ["螢幕", details.screen],
    ["顯示卡", details.gpu],
  ];
  return rows.filter(([, value]) => value).map(([key, value]) => `${key}：${value}`);
}
