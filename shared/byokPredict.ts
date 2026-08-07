import { isNimModel, type ModelEntry } from "./models";

/**
 * 「這次生成會用個人金鑰嗎」——生成**前**的預測，給成本行顯示用。
 *
 * 為什麼要有這支：BYOK 的實際結算在伺服器（server/services/byokBilling.ts
 * 的 resolveByokFalKey），前端若自己另寫一套判斷，只要有一邊改了規則，
 * 畫面就會對使用者說謊——說「不扣點」卻扣了，或反過來。這支把條件寫成
 * 一份、兩邊共用，並用測試釘住它與伺服器邏輯等價。
 *
 * 伺服器端的真實條件（getDecryptedKey + resolveByokFalKey）：
 * 1. NIM 模型永遠不用個人 fal 金鑰
 * 2. 該使用者的 fal 金鑰必須 status === "active"
 * 3. 且 preferUserKey 為真（使用者自己選擇優先用個人金鑰）
 *
 * 注意這是**預測**不是保證：送出到實際執行之間，金鑰可能被停用或解密失敗。
 * 所以文案要用「這次預計」而不是「這次一定」，且生成紀錄仍以伺服器回寫的
 * usedUserKey 為準（GenerationList 已經這樣做）。
 */
export type ByokKeyStatusLike = {
  provider: string;
  status: string;
  preferUserKey: boolean;
};

export function willUsePersonalKey(
  model: ModelEntry | null | undefined,
  keys: readonly ByokKeyStatusLike[] | undefined,
): boolean {
  if (!model || isNimModel(model)) return false;
  const fal = keys?.find((k) => k.provider === "fal");
  return !!fal && fal.status === "active" && fal.preferUserKey;
}
