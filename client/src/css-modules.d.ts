/**
 * CSS 模組宣告：TS 對 side-effect 靜態 import（`import "./x.css"`）本就放行，
 * 但 `import("./x.css")`（main.tsx 的 fonts.css 非阻塞載入，MOB-G）需要模組型別。
 */
declare module "*.css";
