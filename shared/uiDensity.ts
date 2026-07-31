import { z } from "zod";

/**
 * 介面密度＝「新手／專家分層」的單一開關。
 *
 * 背景：全站 `hint` 說明小字實測 505 處，佔所有帶樣式元素的四分之一以上，
 * 是「文字資訊量太大、不夠視覺直覺」的主因。但直接刪除會傷到第一次接觸的
 * 夥伴（義工、法師）——他們正是靠這些說明才知道下一步。
 *
 * 因此不刪，改成分層：
 * - `guide`（引導）：說明常駐。新帳號預設，也是任何讀不到偏好時的安全值。
 * - `concise`（精簡）：說明收合成可展開的「？」，畫面回歸乾淨。
 *
 * 例外由 `<Hint layer="always">` 標記：扣點金額、錯誤修法這類「藏起來會害人
 * 做錯決定」的資訊，在兩種模式都常駐——熟練度不該換來看不見代價。
 */
export const uiDensitySchema = z.enum(["guide", "concise"]);

export type UiDensity = z.infer<typeof uiDensitySchema>;

export const UI_DENSITY_DEFAULT: UiDensity = "guide";

export const UI_DENSITY_LABEL: Record<UiDensity, string> = {
  guide: "引導模式",
  concise: "精簡模式",
};

export const UI_DENSITY_DESCRIPTION: Record<UiDensity, string> = {
  guide: "每個欄位與按鈕都附說明，適合剛上手。",
  concise: "說明收成「？」，畫面更乾淨；扣點與錯誤提示仍會顯示。",
};
