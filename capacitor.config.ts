import type { CapacitorConfig } from "@capacitor/cli";

/**
 * 側載 APK（任務第 7 節 B）：Capacitor 薄殼直連線上站。
 *
 * server.url 模式＝WebView 載入部署站（同 TWA 思路）：
 * - App 內容永遠跟著網站更新，不必為每版網站重發 APK；
 * - webDir 只是 cap sync 的形式需求（server.url 在場時不會被打包進 App）。
 * 權限最小化：Capacitor Android 模板預設僅 INTERNET。
 */
const config: CapacitorConfig = {
  appId: "app.aios.mobile",
  appName: "Aios",
  webDir: "dist/public",
  server: {
    url: "https://ai-os-app.zeabur.app",
    androidScheme: "https",
  },
  android: {
    // 讓網站自己的返回邏輯（SPA 路由）處理 back，殼層只在無歷史時退出
    appendUserAgent: "AiosApp/1.0",
  },
  backgroundColor: "#f3f0e8",
};

export default config;
