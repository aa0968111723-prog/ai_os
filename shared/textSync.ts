/**
 * 文字同步的純函式（Story 共編的共用底座；client 綁 textarea、測試直接打）。
 *
 * Textarea 是「整串字串進出」的元件，而 Y.Text 要的是**差量**（在哪裡刪幾個字、
 * 插入什麼）。這裡負責兩個方向的換算：
 *  - diffToSplice：舊字串 → 新字串的最小連續改動（textarea 的單次輸入、貼上、
 *    選取取代、IME 組字結束，全部都是連續區間的改動——這是 textarea 的結構性質，
 *    不是假設）。
 *  - transformCaret：對方的改動落地後，我的游標該去哪。規則錯了的症狀是
 *    「別人一打字我的游標就跳到奇怪的地方」，那會讓人立刻放棄共編。
 */

export interface TextSplice {
  /** 從哪個索引開始改 */
  index: number;
  /** 刪掉幾個字元 */
  removed: number;
  /** 插入什麼 */
  inserted: string;
}

/**
 * 兩字串的最小連續差量。共同前綴＋共同後綴收斂後，中間就是改動區。
 *
 * 前綴先於後綴、且後綴不越過前綴（`Math.max(prefix, …)` 那道界）——
 * 少了這道界，「aa」→「aaa」這類重複字元的編輯會讓前後綴重疊、算出負的 removed。
 */
export function diffToSplice(oldText: string, newText: string): TextSplice | null {
  if (oldText === newText) return null;
  let prefix = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++;
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > prefix && newEnd > prefix && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { index: prefix, removed: oldEnd - prefix, inserted: newText.slice(prefix, newEnd) };
}

/**
 * 對方的 splice 落地後，我的游標位置。
 *  - 在改動區之前：不動。
 *  - 在改動區之後：平移（插入量 − 刪除量）。
 *  - 在改動區**之內**（我正選著的字被對方改了）：收斂到改動區之後——
 *    停在原地會落在語意已經不同的字中間，往前跳會讓人以為自己被搶走輸入權。
 */
export function transformCaret(caret: number, splice: TextSplice): number {
  if (caret <= splice.index) return caret;
  if (caret >= splice.index + splice.removed) return caret + splice.inserted.length - splice.removed;
  return splice.index + splice.inserted.length;
}

/** 共編文件的 docKey 契約：目前只有 story。格式 `story:<projectId>`。 */
export const COLLAB_DOC_KINDS = ["story"] as const;
export type CollabDocKind = (typeof COLLAB_DOC_KINDS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 解析並驗證 docKey（伺服器端 upgrade 用；形狀不對回 null，不進 DB 查詢） */
export function parseDocKey(raw: string | null | undefined): { kind: CollabDocKind; refId: string } | null {
  if (!raw) return null;
  const sep = raw.indexOf(":");
  if (sep <= 0) return null;
  const kind = raw.slice(0, sep);
  const refId = raw.slice(sep + 1);
  if (!(COLLAB_DOC_KINDS as readonly string[]).includes(kind)) return null;
  if (!UUID_RE.test(refId)) return null;
  return { kind: kind as CollabDocKind, refId };
}
