import { useCallback, useEffect, useState } from "react";

/**
 * 自訂快速短語 hook。
 *
 * 情境：內建的快速短語（收到 🙏、隨喜讚歎 ✨…）貼合團隊日常，但每組的口頭禪不同——
 * 有的組愛說「阿彌陀佛 🙏」、有的組固定回「素材我來補 📎」。這個 hook 讓「組內夥伴自行增加」
 * 屬於自己的快捷聊天與表情，不必動到程式碼。
 *
 * - 每組一份清單（key 帶 groupId），存在 localStorage 的 `aios.quickphrases.` 命名空間下；
 *   純前端偏好、免後端 migration，各自瀏覽器保存自己的常用語。
 * - 短語可自由夾帶 emoji（使用者直接打字或用表情盤點入），所以「聊天」與「表情」一次滿足。
 * - 去重、去空白、限制則數與長度，避免壞資料塞爆 localStorage 或洗版短語列。
 *
 * 所有 localStorage 存取都包 try/catch（無痕模式／配額滿時不可用，自訂短語只是加分功能，
 * 不該讓元件壞掉）。
 */

const NAMESPACE = "aios.quickphrases.";
/** 單則短語上限（含 emoji）：夠寫「素材我來補 📎」這種一句話，又不至於當成長留言用 */
export const MAX_PHRASE_LEN = 24;
/** 每組自訂則數上限：短語列是「一鍵回應」不是收藏夾,太多反而找不到 */
export const MAX_PHRASES = 12;

function readPhrases(storageKey: string): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 防禦：只留字串、去空白、濾空、去重、截長度、限則數（舊資料或人為竄改都不該讓畫面壞掉）
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const v = item.trim().slice(0, MAX_PHRASE_LEN);
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
      if (out.length >= MAX_PHRASES) break;
    }
    return out;
  } catch {
    return [];
  }
}

function writePhrases(storageKey: string, phrases: string[]): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(phrases));
  } catch {
    // 無痕模式／超出配額：靜默略過。
  }
}

export function useCustomQuickPhrases(groupId: string): {
  phrases: string[];
  add: (phrase: string) => boolean;
  remove: (phrase: string) => void;
  atLimit: boolean;
} {
  const storageKey = NAMESPACE + groupId;
  const [phrases, setPhrases] = useState<string[]>(() => readPhrases(storageKey));

  // 切換組別時重讀該組的清單（首次掛載已由 lazy init 處理，這裡只處理 groupId 改變）。
  useEffect(() => {
    setPhrases(readPhrases(storageKey));
  }, [storageKey]);

  const add = useCallback(
    (phrase: string): boolean => {
      const v = phrase.trim().slice(0, MAX_PHRASE_LEN);
      if (!v) return false;
      let added = false;
      setPhrases((prev) => {
        if (prev.includes(v) || prev.length >= MAX_PHRASES) return prev;
        const next = [...prev, v];
        writePhrases(storageKey, next);
        added = true;
        return next;
      });
      return added;
    },
    [storageKey],
  );

  const remove = useCallback(
    (phrase: string) => {
      setPhrases((prev) => {
        if (!prev.includes(phrase)) return prev;
        const next = prev.filter((p) => p !== phrase);
        writePhrases(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  return { phrases, add, remove, atLimit: phrases.length >= MAX_PHRASES };
}
