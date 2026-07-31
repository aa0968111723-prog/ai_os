import { createContext, useContext, type ReactNode } from "react";
import { UI_DENSITY_DEFAULT, type UiDensity } from "@shared/uiDensity";

/**
 * 介面密度的 React context。語意與預設值的單一真相在 `shared/uiDensity.ts`。
 *
 * 這一層刻意只做 context，不碰儲存——primitives 不該知道偏好存在哪裡。
 * 把偏好接上來的是 `client/src/app/DensityGate.tsx`。
 *
 * 預設 `guide` 讓任何未被 Gate 包住的子樹（測試、gallery、未來的獨立入口）
 * 都表現得跟導入 primitives 之前完全一樣。
 */
export type Density = UiDensity;

const DensityContext = createContext<Density>(UI_DENSITY_DEFAULT);

export function DensityProvider({ value, children }: { value: Density; children: ReactNode }) {
  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useDensity(): Density {
  return useContext(DensityContext);
}
