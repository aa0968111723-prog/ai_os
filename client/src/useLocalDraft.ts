import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 本地草稿自動保存 hook。
 *
 * 情境：剪輯夥伴把長逐字稿貼進輸入框，若還沒按「加入知識庫」就重整／當機／離開頁面，
 * 內容全沒了。這個 hook 讓輸入內容邊打邊寫進 localStorage（去抖 ~500ms），
 * 重新掛載時自動還原；送出成功後呼叫 clearDraft() 清掉。
 *
 * - key：呼叫端自訂的邏輯鍵（例如帶 projectId），實際存的鍵會加上 `aios.draft.` 命名空間。
 * - initial：沒有草稿時的初始值。
 * - 回傳 [value, setValue, clearDraft]：
 *     setValue 立即更新畫面值，並去抖寫入 localStorage；
 *     clearDraft 取消待寫、清掉 localStorage，並把值還原成 initial。
 *
 * 所有 localStorage 存取都包在 try/catch（無痕模式／配額滿時不可用，草稿只是加分功能，
 * 不該讓輸入卡住或整個元件壞掉）。
 */

const NAMESPACE = "aios.draft.";
const DEBOUNCE_MS = 500;

function readDraft(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeDraft(storageKey: string, value: string): void {
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // 無痕模式／超出配額：靜默略過。
  }
}

function removeDraft(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // 同上：忽略。
  }
}

export function useLocalDraft(
  key: string,
  initial: string,
): [string, (next: string) => void, () => void] {
  const storageKey = NAMESPACE + key;

  // initial 只在首次掛載時採用（clearDraft 也還原到這個值）。
  const initialRef = useRef(initial);
  // 待寫入的去抖計時器；pendingRef 保存尚未落地的最新值，供切換 key／卸載時補寫。
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);
  // 卸載時要用「當下」的 storageKey 補寫，用 ref 讓卸載清理讀得到最新值。
  const storageKeyRef = useRef(storageKey);
  storageKeyRef.current = storageKey;

  const [value, setValue] = useState<string>(() => {
    const saved = readDraft(storageKey);
    // 空字串視同沒草稿，回落 initial（避免把使用者清空後的殘留值當草稿還原）。
    return saved !== null && saved !== "" ? saved : initialRef.current;
  });

  const flushPending = useCallback((targetKey: string) => {
    const pending = pendingRef.current;
    if (pending === null) return;
    pendingRef.current = null;
    if (pending === "") removeDraft(targetKey);
    else writeDraft(targetKey, pending);
  }, []);

  const setDraft = useCallback(
    (next: string) => {
      setValue(next);
      pendingRef.current = next;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flushPending(storageKey);
      }, DEBOUNCE_MS);
    },
    [storageKey, flushPending],
  );

  const clearDraft = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    removeDraft(storageKey);
    setValue(initialRef.current);
  }, [storageKey]);

  // key 改變（例如切換專案）：先把舊 key 的待寫補完，再讀新 key 的草稿。首次掛載不跑（lazy init 已處理）。
  const didMountRef = useRef(false);
  const prevKeyRef = useRef(storageKey);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    flushPending(prevKeyRef.current);
    prevKeyRef.current = storageKey;
    const saved = readDraft(storageKey);
    setValue(saved !== null && saved !== "" ? saved : initialRef.current);
  }, [storageKey, flushPending]);

  // 卸載時若還有待寫（最後幾個字尚在去抖窗內），立即補寫，確保「離開頁面前」也不掉字。
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        flushPending(storageKeyRef.current);
      }
    };
  }, [flushPending]);

  return [value, setDraft, clearDraft];
}
