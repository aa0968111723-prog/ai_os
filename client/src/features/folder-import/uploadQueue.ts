/**
 * 有界並行的上傳佇列（Folder Import 2.0 §7）。
 *
 * 舊版是逐檔 `await`——1,284 個檔案就是 1,284 次來回，中間任何一個網路抖動都會停在那裡。
 * 直接 `Promise.all(1000 個)` 也不行：瀏覽器連線數與伺服器都撐不住。
 *
 * 所以這裡是「同時最多 N 條、每檔可重試、可取消、逐檔回報狀態」的佇列。
 * 它刻意**不知道**上傳是怎麼做的（`upload` 由呼叫端注入），才能單獨測試。
 */
import {
  FOLDER_UPLOAD_MAX_ATTEMPTS,
  clampUploadConcurrency,
  uploadRetryDelayMs,
} from "@shared/folderImport";

export interface UploadTask<T> {
  /** 佇列的穩定鍵（相對路徑）——同一個檔案不會被排兩次 */
  key: string;
  item: T;
}

export interface UploadQueueResult {
  key: string;
  status: "uploaded" | "failed" | "cancelled";
  attempts: number;
  error: string | null;
}

export interface RunUploadQueueOptions<T> {
  tasks: readonly UploadTask<T>[];
  concurrency?: number;
  maxAttempts?: number;
  /** 真正把一個檔案送出去。丟例外＝這次嘗試失敗，佇列會退避後重試。 */
  upload: (task: UploadTask<T>, attempt: number) => Promise<void>;
  /** 每次狀態變化都會呼叫（UI 逐檔顯示用） */
  onProgress?: (result: UploadQueueResult & { done: number; total: number }) => void;
  /** 取消訊號；已在進行中的那幾檔會跑完，尚未開始的不再開始 */
  signal?: AbortSignal;
  /** 測試注入用；預設 setTimeout */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/**
 * 跑完整個佇列。**永遠不會 reject**——單檔失敗是資料，不是例外；
 * 一個檔案傳不上去不該讓另外 1,283 個一起停下來。
 */
export async function runUploadQueue<T>(options: RunUploadQueueOptions<T>): Promise<UploadQueueResult[]> {
  const concurrency = clampUploadConcurrency(options.concurrency);
  const maxAttempts = Math.max(1, options.maxAttempts ?? FOLDER_UPLOAD_MAX_ATTEMPTS);
  const sleep = options.sleep ?? defaultSleep;
  const results: UploadQueueResult[] = [];
  const total = options.tasks.length;
  let cursor = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= options.tasks.length) return;
      const task = options.tasks[index]!;
      if (options.signal?.aborted) {
        const result: UploadQueueResult = { key: task.key, status: "cancelled", attempts: 0, error: null };
        results.push(result);
        done += 1;
        options.onProgress?.({ ...result, done, total });
        continue;
      }
      let attempts = 0;
      let lastError: string | null = null;
      let status: UploadQueueResult["status"] = "failed";
      while (attempts < maxAttempts) {
        attempts += 1;
        try {
          await options.upload(task, attempts);
          status = "uploaded";
          lastError = null;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : "上傳失敗";
          if (options.signal?.aborted) { status = "cancelled"; break; }
          // 重試次數用完就交還失敗——不無限重試把伺服器打爆
          if (attempts >= maxAttempts) break;
          await sleep(uploadRetryDelayMs(attempts));
        }
      }
      const result: UploadQueueResult = { key: task.key, status, attempts, error: lastError };
      results.push(result);
      done += 1;
      options.onProgress?.({ ...result, done, total });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, total)) }, () => worker()));
  return results;
}

/** 依相對路徑索引使用者剛選的檔案——續傳時只挑伺服器說「還沒傳」的那些。 */
export function indexFilesByRelativePath(files: readonly File[]): Map<string, File> {
  const out = new Map<string, File>();
  for (const file of files) {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    // 正規化交給 shared/folderImport；這裡只做最小的分隔符統一，避免 Windows 反斜線對不上
    out.set(path.replace(/\\/g, "/"), file);
  }
  return out;
}
