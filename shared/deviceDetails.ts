/**
 * 裝置細節的型別與呈現（前後端共用）。
 *
 * 這裡的資料**只給人看**，不參與裝置比對——因為系統更新、瀏覽器更新、顯示卡驅動更新
 * 都會讓這些值漂移。若拿去比對就會每個月要求全公司重驗一次信箱，
 * 使用者會被訓練成「看到驗證碼就無腦輸入」，那比不做驗證還危險。
 * 比對用的穩定指紋見 server/services/deviceTrust.ts 的 fingerprintOf。
 */

export interface DeviceDetails {
  /** 廠牌，如 Google／Samsung／Apple。推不出來就沒有（猜錯比不寫更糟） */
  brand?: string;
  /** 機型，如 Pixel 8／SM-S928B。Apple 裝置與桌機拿不到 */
  model?: string;
  /** 作業系統，如「Windows 11」「Android 14」「iOS 17」 */
  os?: string;
  browser?: string;
  browserVersion?: string;
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
  const rows: Array<[string, string | undefined]> = [
    ["廠牌", details.brand],
    ["機型", details.model ?? details.modelNote],
    ["系統", details.os],
    ["瀏覽器", details.browserVersion ? `${details.browser} ${details.browserVersion}` : details.browser],
    ["處理器", details.cpu],
    ["記憶體", details.memoryGb ? `${details.memoryGb} GB` : undefined],
    ["螢幕", details.screen],
    ["顯示卡", details.gpu],
  ];
  return rows.filter(([, value]) => value).map(([key, value]) => `${key}：${value}`);
}
