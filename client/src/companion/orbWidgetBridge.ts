import { useEffect, useRef } from "react";
import type { OrbState } from "@shared/companionOrb";

/**
 * 把 Orb 狀態推給 Android 桌面 Widget。
 *
 * ## 單向，而且只有一個方法
 *
 * Web 端是權威：狀態機、優先序、文案全部在 `shared/companionOrb.ts`。
 * 原生層只是一個顯示器（見 android/.../OrbWidgetState.java 檔頭）。
 * 因此這裡只送出、不讀回——多一個讀取方向，就會多一個「哪一份才算數」的爭論。
 *
 * ## 沒有外掛時完全無感
 *
 * 手機瀏覽器、桌機、以及還沒裝上 Widget 的 App 都拿不到這個外掛。
 * 那不是錯誤，是常態，所以整條路徑安靜失敗——**絕不能**讓一顆桌面小球
 * 的更新失敗變成使用者看得到的錯誤。
 */
interface OrbWidgetPluginLike {
  setState?: (options: { state: string; label: string }) => Promise<unknown>;
}

function plugin(): OrbWidgetPluginLike | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as {
    Capacitor?: { Plugins?: { AiosOrbWidget?: OrbWidgetPluginLike } };
  }).Capacitor;
  return cap?.Plugins?.AiosOrbWidget ?? null;
}

/** Widget 上那一行字：講**現在有什麼在等你**，不是講狀態機的名字。 */
export function widgetLabel(state: OrbState, counts: { awaiting: number; failed: number; running: number }): string {
  if (counts.awaiting > 0) return `${counts.awaiting} 件等你確認`;
  if (counts.failed > 0) return `${counts.failed} 個生成失敗了`;
  if (counts.running > 0) return `${counts.running} 個生成進行中`;
  if (state === "thinking") return "我正在想…";
  return "點一下跟 Aios 說話";
}

export function pushOrbStateToWidget(state: OrbState, label: string): void {
  const api = plugin();
  if (!api?.setState) return;
  void api.setState({ state, label }).catch(() => undefined);
}

/**
 * 狀態或文案真的變了才推。
 *
 * Orb 每秒可能重算好幾次（進度、音量），而每一次 `setState` 都是一趟
 * JS→原生 bridge ＋ 一次 launcher 重畫。只在**使用者看得到差別**時才推。
 */
export function useOrbWidgetSync(state: OrbState, label: string): void {
  const last = useRef<string>("");
  useEffect(() => {
    const key = `${state}|${label}`;
    if (last.current === key) return;
    last.current = key;
    pushOrbStateToWidget(state, label);
  }, [state, label]);
}
