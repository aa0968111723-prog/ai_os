import { defineConfig } from "vitest/config";

// 後端／共享純函式測試（無 DB/無網路）：只掃 server/shared。
// 前端元件與覆蓋率門檻由 vitest.client.config.ts、npm run test:client:coverage 獨立執行。
export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
    setupFiles: ["server/test/vitest.setup.ts"],
    // Keep stress tests meaningful without letting module transforms consume
    // every core and starve their own filesystem/timer assertions on CI.
    maxWorkers: 8,
  },
});
