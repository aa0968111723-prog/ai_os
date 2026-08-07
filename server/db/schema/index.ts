/**
 * AI Director OS — 資料庫 schema（單一真相來源）
 * PostgreSQL · Drizzle（pg 方言）
 * 組織模型：開發者 → 團隊(team_admin) → 組別(leader/member)；角色是關係不是屬性。
 *
 * 依領域拆檔（TD-08）；此 index 再匯出全部表，保持 import * as schema 相容。
 */
export * from "./auth";
export * from "./projects";
export * from "./generation";
export * from "./agents";
export * from "./databases";
export * from "./messaging";
export * from "./notifications";
export * from "./integrations";
export * from "./catalog";
export * from "./storage";
export * from "./aiTrace";
export * from "./aiSiteTrace";
export * from "./community";
