import { useEffect, useState, type ReactNode } from "react";
import { DensityProvider } from "../components/ui";
import { readUiDensity, subscribeUiDensity } from "../lib/densityPreference";
import type { UiDensity } from "@shared/uiDensity";

/**
 * 把「介面密度」偏好接到 primitives 的 context 上。
 *
 * 分工刻意切開：`components/ui/density.tsx` 只提供 context（primitives 不該知道
 * 偏好存在哪裡），這裡負責讀取、訂閱變更並重新供應。之後若把偏好改成跟著帳號走，
 * 只要換 `lib/densityPreference.ts` 的實作，這個檔案與所有 primitives 都不必改。
 *
 * 初始值直接同步讀取，避免第一幀先用預設值渲染再閃一次（會讓精簡模式使用者
 * 每次進站都看到說明牆閃過去）。
 */
export function DensityGate({ children }: { children: ReactNode }) {
  const [density, setDensity] = useState<UiDensity>(() => readUiDensity());
  useEffect(() => subscribeUiDensity(setDensity), []);
  return <DensityProvider value={density}>{children}</DensityProvider>;
}
