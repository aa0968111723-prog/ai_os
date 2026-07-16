import { defineConfig } from "vitest/config";

// 純函式單元測試(無 DB/無網路,毫秒級):只掃 server/shared 下的 *.test.ts。
// 前端元件測試(需 jsdom)之後要加再開第二個 project,不混在這裡。
export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
  },
});
