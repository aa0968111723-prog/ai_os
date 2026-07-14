import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc, createTrpcClient } from "./api";
import { App } from "./App";
import "./styles.css";

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
          <div className="empty-state" style={{ marginTop: "var(--sp-48)" }}>
            <h3>畫面出了點狀況</h3>
            <p>頁面載入時發生非預期錯誤——重新整理通常就能恢復。若持續發生，請回報給管理員。</p>
            <div style={{ marginTop: "var(--sp-16)" }}>
              <button className="primary" onClick={() => window.location.reload()}>重新整理</button>
            </div>
          </div>
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
        <App />
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
