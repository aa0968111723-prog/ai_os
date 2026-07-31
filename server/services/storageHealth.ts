/**
 * 儲存層降級旗標——「素材可能會遺失」這件事的單一真相來源。
 *
 * 為什麼要獨立成一個模組：判定的人（storage.ts 的持久性偵測、開卷身分核對）與
 * 使用的人（/api/ready、系統自檢、上傳入口、素材落地）分散在整個服務裡，
 * 若把狀態掛在 storage.ts 上，上傳入口與健康檢查就得反向 import storage、
 * storage 又得 import 它們的常數，很快就會兜出循環相依。
 *
 * ★ 本模組不 import 任何專案模組（比照 errlog.ts）：任何地方引用都不會造成循環相依。
 *
 * 為什麼記憶體態就夠：這是「本次啟動的這個容器，磁碟現況安不安全」的判斷，
 * 重啟後由開機流程（assessStoragePersistence / verifyVolumeIdentity）重新判定並寫回，
 * 存進 DB 反而會把上一個容器的狀態誤帶到新容器。
 */

/**
 * 降級原因：
 * - volume-changed：卷被換掉或被清空（.volume-id 與 DB 記錄對不起來）——舊素材很可能已不在。
 * - not-persistent：素材寫在容器映像層，重新部署即全滅（過去假綠燈就是漏了這一種）。
 * - unwritable：磁碟掛著但寫不進去（滿碟、唯讀掛載、權限錯誤）。
 */
export type StorageDegradeReason = "volume-changed" | "not-persistent" | "unwritable";

export interface StorageDegradeState {
  degraded: boolean;
  reason?: StorageDegradeReason;
  /** 可直接顯示給非技術使用者的中文說明（含「該怎麼辦」） */
  note: string;
  /** 進入降級的時間（ISO 字串）；未降級時省略 */
  since?: string;
}

const HEALTHY_NOTE = "儲存層正常：素材寫在持久磁碟，重新部署不會遺失。";

let state: StorageDegradeState = { degraded: false, note: HEALTHY_NOTE };

/**
 * 標記降級。同一個原因重複標記時「不重置 since」——since 要能回答
 * 「這個問題從什麼時候開始」，每次健康檢查都刷新的話這個欄位就沒有意義了。
 * 換了原因（例如從 not-persistent 變成 volume-changed）才視為新事件、重新計時。
 */
export function setStorageDegraded(reason: StorageDegradeReason, note: string): void {
  const sameIssue = state.degraded && state.reason === reason;
  state = {
    degraded: true,
    reason,
    note,
    since: sameIssue && state.since ? state.since : new Date().toISOString(),
  };
}

/** 解除降級（管理員修好掛載、或確認「這是我刻意換的新卷」之後） */
export function clearStorageDegraded(): void {
  state = { degraded: false, note: HEALTHY_NOTE };
}

/** 目前狀態的快照（回複本，避免呼叫端改到模組內部狀態） */
export function storageDegradeState(): StorageDegradeState {
  return { ...state };
}

/**
 * 嚴格模式下的「拒收新素材」理由。
 *
 * 為什麼預設不擋：多數情況下讓使用者先把檔案傳進來、之後再搬到正確的磁碟，
 * 比當場拒絕更不傷；但正式站可以設 ASSET_STRICT=1 選擇「寧可當下擋下，也不要
 * 讓使用者以為存好了、下次部署才發現全沒了」——後者的信任損害大得多。
 *
 * 回傳的字串會直接顯示給非技術使用者，所以要講清楚「發生什麼事」「你現在該怎麼做」
 * 「管理員該怎麼做」三件事。未啟用嚴格模式或目前沒有降級時回 null（照常收檔）。
 */
export function storageWriteBlockReason(): string | null {
  if (process.env.ASSET_STRICT !== "1") return null;
  if (!state.degraded) return null;
  return (
    "為了避免你上傳的檔案在下次重新部署時消失，系統暫時停止接收新素材。" +
    `目前狀況：${state.note}` +
    " 你現在可以做的：先把檔案留在自己的電腦或手機裡，等系統恢復後再上傳（已經在系統裡的舊素材不受影響）。" +
    " 請通知管理員：到 Zeabur 的 App 服務 → Settings → Volumes，確認有掛載 Volume 且掛載路徑是 /data" +
    "（或設環境變數 ASSET_DIR 指向持久磁碟）；若是刻意更換磁碟，請到系統自檢頁確認新磁碟後解除封鎖。"
  );
}
