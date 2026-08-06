import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc, createTrpcClient } from "./api";
import { App } from "./App";
import { DensityGate } from "./app/DensityGate";
import { bootstrapPwa } from "./pwa";
import { bootstrapTauriDesktop } from "./platform/tauriDesktop";
import { installKeyboardInset } from "./lib/keyboardInset";
import "./styles.css";
import "./styles.mobile-fab-01.css";
import "./splash.css";
// 中文字型 CSS（MOB-G）：兩份 fontsource variable index.css 共 ~300KB raw 的 @font-face
// 宣告，先前 @import 在 styles.css 頂端＝跟主樣式合成單一 render-blocking CSS，
// 是手機 4G 首屏 LCP 最大單一瓶頸。改動態 import：立即發起但不擋首繪；
// 全部宣告皆 font-display: swap，字型到位無縫換上（實際 woff2 仍照 unicode-range 按需下載）。
void import("./fonts.css");
import { EmptyState } from "./components/ui";
import { Icon } from "./components/Icon";
import { buildCrashReport, isChunkLoadError, type CrashReport } from "./lib/crashReport";

// 先安裝桌面橋接，讓第一個 React render 就能辨識「Aios 桌面版」與已安裝剪輯軟體。
bootstrapTauriDesktop();
bootstrapPwa();
// 貼底面板要讓開虛擬鍵盤：整個 App 生命週期都要追蹤，故不綁在任何元件上
installKeyboardInset();

/**
 * 全站錯誤邊界：任何 render 錯誤都落在設計語言內的空狀態，而非空白白畫面。
 *
 * 錯誤摘要一定要「看得見」——只寫 console 的話，手機使用者回報永遠只剩「壞了」，
 * 沒有任何可行動的資訊（Android PWA 要接 USB 除錯才看得到 console）。
 */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null; report: CrashReport | null; copied: boolean }
> {
  state: { error: Error | null; report: CrashReport | null; copied: boolean } = {
    error: null,
    report: null,
    copied: false,
  };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 讓真實 stack 出現在瀏覽器 console，方便診斷「畫面出了點狀況」
    console.error("[ErrorBoundary]", error, info.componentStack);
    this.setState({
      report: buildCrashReport(error, info.componentStack, {
        url: typeof location === "undefined" ? undefined : location.href,
        userAgent: typeof navigator === "undefined" ? undefined : navigator.userAgent,
        at: new Date().toISOString(),
      }),
    });
  }
  /** chunk 載入失敗要繞過快取重載；一般重整可能又拿到同一份壞掉的 index.html。 */
  private reload = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("_r", String(Date.now()));
    window.location.replace(url.toString());
  };
  private copy = () => {
    const text = this.state.report?.detail ?? "";
    void navigator.clipboard?.writeText(text)
      .then(() => this.setState({ copied: true }))
      .catch(() => this.setState({ copied: false }));
  };
  render() {
    if (this.state.error) {
      const report = this.state.report;
      const chunk = isChunkLoadError(this.state.error);
      return (
        <div className="app">
          <EmptyState icon={<Icon name="TriangleAlert" />} title={<>畫面出了點狀況</>} description={chunk
            ? <>這一頁的程式檔沒有載入完成——通常是網路不穩或版本剛更新。請按下方按鈕重新載入。</>
            : <>頁面載入時發生非預期錯誤——重新整理通常就能恢復。若持續發生，請把下方的錯誤詳情回報給管理員。</>} action={<><div style={{ marginTop: "var(--sp-16)" }}>
              <button className="primary" onClick={this.reload}>重新整理</button>
            </div>
            {report && (
              <details style={{ marginTop: "var(--sp-16)", textAlign: "left" }}>
                <summary>錯誤詳情（回報時請附上）</summary>
                <p className="mono" style={{ wordBreak: "break-word", marginTop: "var(--sp-8)" }}>{report.headline}</p>
                <button onClick={this.copy}>{this.state.copied ? "已複製 ✓" : "複製錯誤詳情"}</button>
                <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto", marginTop: "var(--sp-8)" }}>{report.detail}</pre>
              </details>
            )}</>} style={{ marginTop: "var(--sp-48)" }} />
        </div>
      );
    }
    return this.props.children;
  }
}

function Root() {
  /**
   * 全站 Query 預設：少重試、失敗快露臉。
   * 預設 retry:3 在 bootstrap／慢查失敗時會讓 SessionGate 長時間「載入中…」，
   * 症狀就是「除了首頁其他頁都只有載入中」。
   */
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  const [trpcClient] = useState(() => createTrpcClient());
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {/* 介面密度（引導／精簡）包在最外層：primitives 在任何頁面都讀得到偏好 */}
        <DensityGate>
          <App />
        </DensityGate>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>,
);
