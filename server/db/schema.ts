/**
 * AI Director OS — 資料庫 schema（單一真相來源）
 * PostgreSQL · Drizzle（pg 方言）
 * 組織模型：開發者 → 團隊(team_admin) → 組別(leader/member)；角色是關係不是屬性。
 *
 * TD-08：表定義已拆至 server/db/schema/* 領域模組；此檔保持路徑相容。
 */
export * from "./schema/index";
