import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  // 全域忽略
  { ignores: ["dist/", "coverage/", "node_modules/", "src-tauri/", "android/", "ios/"] },

  // 所有 TypeScript 檔案
  {
    extends: [
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
    ],
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // React Hooks：CI 提到這個是致命缺口（早退後呼叫 hook = React #310）
      ...reactHooks.configs.recommended.rules,
      // React Refresh：export 必須是 component 才能 HMR
      "react-refresh/only-export-components": "warn",

      // 團隊實務調整
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/array-type": ["error", { default: "array-simple" }],
    },
  },

  // CommonJS 檔案 (scripts/ 裡可能有 .mjs)
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
);
