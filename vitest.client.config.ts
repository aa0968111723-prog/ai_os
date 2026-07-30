import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["client/src/test/setup.ts"],
    include: ["client/src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Risk-based UI slice only. These numbers are not whole-frontend coverage.
      // Large route pages stay integration shells; the exercised behaviours are
      // extracted into the components/helpers listed here.
      include: [
        // Primitives 元件層（UIUX-01）：全站遷移的目標，必須維持高覆蓋，
        // 因為每個 class 契約斷言都是「遷移不會改變畫面」的保證。
        "client/src/components/ui/**/*.{ts,tsx}",
        "client/src/components/AssistantTrace.tsx",
        "client/src/components/AiHub.tsx",
        "client/src/components/assistantStream.ts",
        "client/src/components/GenerationCopy.tsx",
        "client/src/components/PlannerSection.tsx",
        "client/src/components/ChatEmptyState.tsx",
        "client/src/components/databaseTabs.ts",
        "client/src/components/DatabaseDetailTabs.tsx",
      ],
      thresholds: {
        lines: 85,
        functions: 80,
        branches: 75,
        statements: 85,
      },
    },
  },
});
