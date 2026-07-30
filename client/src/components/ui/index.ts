/**
 * Primitives 元件層（UIUX-01）。
 *
 * 這一層的存在理由見 `docs/uiux-audit/ui-primitives-ratchet.md`：
 * 全站計畫 §24.3 規範了共用元件庫，但規範的是 CSS class 命名；
 * 在沒有元件的情況下，每一輪 UIUX 打磨都會被後續 PR 稀釋回去。
 *
 * 設計原則：
 * 1. **輸出 class 與遷移前逐字相同** —— 換上元件不改變任何畫面，遷移零視覺風險。
 * 2. **不新增全域 CSS** —— 只消費 styles.css 既有的 token 與 class。
 * 3. **把規範變成型別** —— 例如 Pill 的狀態只能四選一、Chip 給 onClick 就自動補齊鍵盤無障礙。
 * 4. **每句說明都要宣告層級** —— Hint 的 `layer` 決定它在精簡模式下去留。
 *
 * `scripts/check-ui-primitives.mjs` 會擋住繞過這一層的新裸 class。
 */
export { cx } from "./cx";
export { DensityProvider, useDensity, type Density } from "./density";

export { Badge } from "./Badge";
export { Button, type ButtonSize, type ButtonVariant } from "./Button";
export { Card, type CardVariant } from "./Card";
export { Chip } from "./Chip";
export { EmptyState } from "./EmptyState";
export { Hint } from "./Hint";
export { Pill, type PillStatus } from "./Pill";
export { Skeleton } from "./Skeleton";
