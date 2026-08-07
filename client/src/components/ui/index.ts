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
 * 4. **說明與內容必須分開** —— `.hint` 在站內同時承擔「解釋」與「小灰字內容」兩種角色；
 *    前者是 Hint，後者是 Meta。混在一起就無法安全減字。
 *
 * `scripts/check-ui-primitives.mjs` 會擋住繞過這一層的新裸 class。
 */
export { cx } from "./cx";

export { Badge } from "./Badge";
export { Button, type ButtonSize, type ButtonVariant } from "./Button";
export { Card, type CardVariant } from "./Card";
export { Chip } from "./Chip";
export { EmptyState } from "./EmptyState";
export { Hint } from "./Hint";
export { Meta } from "./Meta";
export { Pill, type PillStatus } from "./Pill";
export { Skeleton } from "./Skeleton";
