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
import { EmptyState } from "./components/ui";
import { Icon } from "./components/Icon";

// 先安裝桌面橋接，讓第一個 React render 就能辨識「Aios 桌面版」與已安裝剪輯軟體。
bootstrapTauriDesktop();
bootstrapPwa();
// 貼底面板要讓開虛擬鍵盤：整個 App 生命週期都要追蹤，故不綁在任何元件上
installKeyboardInset();

/** 全站錯誤邊界：任何 render 錯誤都落在設計語言內的空狀態，而非空白白畫面。 */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="app">
          <EmptyState icon={<Icon name="TriangleAlert" />} title={<>畫面出了點狀況</>} description={<>頁面載入時發生非預期錯誤——重新整理通常就能恢復。若持續發生，請回報給管理員。</>} action={<><div style={{ marginTop: "var(--sp-16)" }}>
              <button className="primary" onClick={() => window.location.reload()}>重新整理</button>
            </div></>} style={{ marginTop: "var(--sp-48)" }} />
        </div>
      );
    }
    return this.props.children;
  }
}

function Root() {
  const [queryClient] = useState(() => new QueryClient());
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
