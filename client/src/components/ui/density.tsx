import { createContext, useContext, type ReactNode } from "react";

/**
 * 介面密度＝「新手／專家分層」的單一開關。
 *
 * - `guide`（引導）：說明文字常駐顯示。第一次接觸的夥伴（義工、法師）需要它。
 * - `concise`（精簡）：說明收合成可展開的「？」。熟手創作者不必被說明牆淹沒。
 *
 * 預設為 `guide`，與導入 primitives 之前的畫面**完全一致**——
 * 這讓第一批遷移可以零視覺變化，先把結構換掉，再談減字。
 *
 * 實際的帳號偏好由 UIUX-02 接上（後端欄位 + tRPC）；在那之前
 * `DensityProvider` 只在測試與 Storybook 式場景手動指定。
 */
export type Density = "guide" | "concise";

const DensityContext = createContext<Density>("guide");

export function DensityProvider({ value, children }: { value: Density; children: ReactNode }) {
  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useDensity(): Density {
  return useContext(DensityContext);
}
