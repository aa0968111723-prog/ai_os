/**
 * 裝置資訊收集。
 *
 * ★網頁拿不到的東西（瀏覽器安全模型硬限制，沒有例外）：
 *   IMEI、手機序號、主機板／硬碟序號、MAC 位址、電腦廠牌型號（Dell/ASUS…）。
 *   只有上架 App Store／Play 商店的原生 App 才拿得到部分裝置識別碼。
 *
 * ★拿得到的（依平台而異，見 collectDeviceHint 註解）：
 *   Android 的實際機型（Pixel 8／SM-S928B…）、作業系統版本、瀏覽器品牌與版本、
 *   機身型態（手機／平板／桌機）、CPU 架構與位元數、核心數、記憶體、螢幕、顯示卡型號。
 *
 * 收到的原始值怎麼翻成人看得懂的名字（SM-S928B → Galaxy S24 Ultra）見
 * shared/deviceNaming.ts——那份前後端共用，兩邊產出的名字必然一致。
 *
 * ★資料分成兩類，用途完全不同（這是本檔最重要的設計）：
 *
 *   1. 比對用（stable*）——只放「幾乎不會變」的欄位。伺服器拿它算指紋做裝置比對。
 *      刻意不含任何版本號：Chrome 每四週自動更新、Windows 每月推更新，
 *      版本號進指紋等於每個月要求全公司重驗一次信箱，
 *      使用者會被訓練成「看到驗證碼就無腦輸入」——那比不做驗證還危險。
 *
 *   2. 顯示用（detail*）——給人看的細節，會漂移沒關係，**不進指紋**。
 *      用途是讓夥伴在「我的裝置」清單裡認得出哪台是哪台，
 *      以及收到驗證信時判斷「這是不是我剛才登入的那台」。
 */

/**
 * 欄位定義住在 shared/deviceNaming.ts（伺服器與這裡共用同一份），
 * 這裡轉出去讓既有匯入點（LoginPage／AcceptInvitePage）不用改。
 */
export type { DeviceHint } from "@shared/deviceNaming";
import type { DeviceHint } from "@shared/deviceNaming";

/** Chromium 的 UA Client Hints；Safari／Firefox 沒有這個 API */
interface UADataValues {
  platform?: string;
  platformVersion?: string;
  architecture?: string;
  bitness?: string;
  model?: string;
  /** 機身型態（新版 Chromium）："Mobile"／"Tablet"／"Desktop"／"XR" */
  formFactors?: string[];
  fullVersionList?: Array<{ brand: string; version: string }>;
}
interface NavigatorUAData {
  getHighEntropyValues(hints: string[]): Promise<UADataValues>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari 專有欄位，型別定義沒有故轉型讀取
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * 把 WebGL 回傳的顯示卡字串整理成人看得懂的型號。
 *
 * Chrome 在 Windows 上回傳形如：
 *   "ANGLE (Intel, Intel(R) UHD Graphics (0x00009A60) Direct3D11 vs_5_0 ps_5_0, D3D11)"
 *   "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)"
 * 要取的是中間那段真正的型號。
 *
 * ★不用正則做整段比對：型號本身含括號（"Intel(R)"、"(0x00009A60)"），
 * 早期版本用 `[^,]+?` 搭配 `(?:,|\))` 會在 "Intel(R" 的那個 `)` 就提早收尾，
 * 顯示成「Intel(R」（此 bug 由實機資料抓到）。改成先按逗號切段再逐項清理。
 * export 供測試。
 */
export function prettyGpuName(raw: string): string {
  let s = raw.trim();
  const angle = /^ANGLE\s*\((.*)\)$/s.exec(s);
  if (angle) {
    // 依「頂層逗號」切：ANGLE 內容是 "廠商, 型號…, 後端"，型號段本身不含逗號
    const parts = angle[1].split(",");
    // 第一段是廠商（Intel／NVIDIA／Google…）、最後一段是圖形後端（D3D11／Vulkan…），
    // 中間才是型號；只有兩段時取第二段
    s = (parts.length > 2 ? parts.slice(1, -1).join(",") : parts[parts.length - 1]).trim();
  }
  return s
    // 去掉驅動層級的雜訊後綴：Direct3D11 vs_5_0 ps_5_0 / (0x00009A60) PCI id
    .replace(/\s*\(0x[0-9a-f]+\)/gi, "")
    .replace(/\s*Direct3D\d*.*$/i, "")
    .replace(/\s*vs_\d.*$/i, "")
    .replace(/\s*OpenGL ES.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * 顯示卡型號。要開一個 WebGL context 才拿得到，故只在「顯示用」路徑取一次。
 *
 * 刻意只取型號字串、不做 canvas/WebGL 繪製指紋（那是廣告商的追蹤手法，
 * 隱私侵入、瀏覽器正在封鎖、結果也不穩定）。取不到就算了，不影響任何功能。
 */
function gpuModel(): string | undefined {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
    if (!gl || !("getExtension" in gl)) return undefined;
    const ext = (gl as WebGLRenderingContext).getExtension("WEBGL_debug_renderer_info");
    if (!ext) return undefined;
    const raw = (gl as WebGLRenderingContext).getParameter(
      (ext as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL,
    );
    if (typeof raw !== "string") return undefined;
    return prettyGpuName(raw);
  } catch {
    return undefined;
  }
}

/**
 * 收集本機資訊。
 *
 * 各平台實際拿得到多細：
 * - **Android + Chrome/Edge**：機型（"Pixel 8"、"SM-S928B"＝三星 Galaxy S24 Ultra）、
 *   Android 版本、架構、核心數、記憶體 → 最詳細
 * - **Windows/macOS + Chrome/Edge**：作業系統版本（可分辨 Win10／Win11）、
 *   CPU 架構與位元數、核心數、記憶體、顯示卡型號。**電腦廠牌型號拿不到**
 * - **iPhone/iPad（Safari）**：只有 "iPhone"／"iPad" 與 iOS 版本。
 *   **機型是 Apple 刻意封鎖的**——iPhone 12 與 iPhone 16 在網頁上完全無法區分
 * - **Firefox**：不支援 UA Client Hints，只拿得到螢幕／時區／語言／核心數
 *
 * 整包用 try/catch 包住：隱私瀏覽器可能對這些 API 丟例外，
 * 收集失敗只是少了輔助訊號與細節，絕不能讓登入按鈕壞掉。
 */
export async function collectDeviceHint(): Promise<DeviceHint | undefined> {
  if (typeof window === "undefined" || typeof navigator === "undefined") return undefined;
  try {
    const hint: DeviceHint = {
      screen: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      lang: navigator.language,
      cores: navigator.hardwareConcurrency,
      standalone: isStandalone(),
      touchPoints: navigator.maxTouchPoints,
      memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
      detailPixelRatio: window.devicePixelRatio,
      detailGpu: gpuModel(),
    };

    // UA Client Hints（Chromium 專有）：機型、OS 版本、架構、位元數、完整瀏覽器版本。
    // Safari／Firefox 沒有這個 API，取不到就維持上面的基本資訊。
    const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
    if (uaData?.getHighEntropyValues) {
      try {
        const highPromise = uaData.getHighEntropyValues([
          "architecture",
          "bitness",
          "model",
          "platform",
          "platformVersion",
          // 舊版 Chromium 不認得的 hint 名稱會被忽略（不丟例外），故可以直接要
          "formFactors",
          "fullVersionList",
        ]);
        const timeoutPromise = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 200));
        const high = await Promise.race([highPromise, timeoutPromise]);
        if (high) {
          hint.model = high.model || undefined;
          hint.arch = high.architecture || undefined;
          hint.bitness = high.bitness || undefined;
          hint.detailOsVersion = high.platformVersion || undefined;
          // UA 字串正在被 Chrome 逐步精簡，平台改以 UA-CH 為準、UA 只作退路
          hint.detailPlatform = high.platform || undefined;
          // formFactors 是陣列（可能同時是 "Tablet" 與 "EInk"）；取第一個主型態即可
          hint.detailFormFactor = high.formFactors?.[0] || undefined;
          // fullVersionList 含 "Not_A Brand" 之類的防呆假品牌，取最後一個真實品牌
          // ——★這也是唯一認得出 Brave 的地方：它的 UA 字串偽裝成純 Chrome（反追蹤），
          //   只有這份品牌清單誠實列出自己。
          const real = high.fullVersionList?.filter((b) => !/not[\W_]*a[\W_]*brand/i.test(b.brand));
          const primary = real?.[real.length - 1];
          hint.detailBrowserVersion = primary?.version;
          hint.detailBrowserBrand = primary?.brand;
        }
      } catch {
        /* ignore UA client hints errors */
      }
    }
    return hint;
  } catch {
    return undefined;
  }
}
