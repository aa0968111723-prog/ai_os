import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  root: "client",
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // vendor 拆包（QA-025）：框架與資料層各自成 chunk——App 程式碼改版時，
        // 使用者瀏覽器仍可沿用快取的 vendor chunk，不必整包重載
        manualChunks: {
          // react-dom 的實際入口是 react-dom/client——只列 "react-dom" 抓不到，主 chunk 會白白多 130kB
          "vendor-react": ["react", "react-dom", "react-dom/client"],
          "vendor-data": ["@tanstack/react-query", "@trpc/client", "@trpc/react-query", "superjson", "zod"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: devProxyTarget,
        changeOrigin: true,
        cookieDomainRewrite: "",
        secure: false,
      },
      "/ws": { target: devProxyTarget, changeOrigin: true, ws: true, secure: false },
    },
  },
});
