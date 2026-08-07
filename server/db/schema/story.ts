/**
 * Story-first 骨架（PE 計畫 v1.0）：故事 → 自動解析 → Scene/Shot → 生成。
 *
 * 分層（§07 核心資料模型）：
 *  - stories        故事原文（一專案一份；版本走 text_versions kind='story'）
 *  - story_scenes   一場戲（Scene）：地點＋環境狀態（天氣/時間/氛圍），Shot 繼承它
 *  - character_looks 造型（Look）：可變外觀（服裝/髮型）與固定 Identity（characters.appearance）分層，
 *                    「三年後她剪短髮」建新 Look 而非覆蓋 Identity
 *  - parse_runs     每次自動解析的紀錄：計畫（plan）、實際落庫內容（applied，供 Undo）、狀態
 *  - parse_candidates 低信心候選（<0.70 暫不落庫，只出確認卡）與已套用但標記項（0.70–0.89）
 *
 * Shot 本身沿用既有 scenes 表（它一直就是 Shot：引用式卡片綁定＋生成綁 sceneId）——
 * 新增欄位（story_scene_id/camera/performance/look_ids）在 projects.ts 的 scenes 宣告上。
 * 一律不加 FK（與全庫一致；關聯是邏輯性的，刪除由 core 服務同交易清理）。
 */
import { pgTable, uuid, text, integer, real, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { EnvironmentState, StoryParsePlan } from "../../../shared/story";

export const stories = pgTable("stories", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 一專案一份故事（unique）：PDF 的 Story 是專案的敘事來源，不是清單 */
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  content: text("content").notNull().default(""),
  /** 最近一次解析完成時間；null＝從未解析 */
  lastParsedAt: timestamp("last_parsed_at"),
  /** 最近一次解析時內容的 sha256——內容沒變就跳過重解（Idempotency + Cost Control） */
  parsedContentHash: text("parsed_content_hash"),
  updatedBy: uuid("updated_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  projectUq: uniqueIndex("stories_project_uq").on(t.projectId),
}));

export const storyScenes = pgTable("story_scenes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  title: text("title").notNull().default(""),
  summary: text("summary"),
  /** 對應的故事原文段落（provenance：解析來源可追溯） */
  storyExcerpt: text("story_excerpt"),
  /** 這場戲的地點 → scene_presets.id（邏輯關聯）；null＝未指定 */
  locationId: uuid("location_id"),
  /** 環境狀態（EnvironmentState）：天氣/時間/氛圍/備註——Shot 生成時繼承注入 */
  environment: jsonb("environment").$type<EnvironmentState>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  projectOrderIdx: index("story_scenes_project_order_idx").on(t.projectId, t.orderIndex),
}));

export const characterLooks = pgTable("character_looks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  characterId: uuid("character_id").notNull(),
  /** 造型名（米白外套、短髮時期…） */
  name: text("name").notNull(),
  /** 服裝／髮型描述——生成時作為造型錨點注入（與 Identity 的 appearance 分開） */
  costume: text("costume"),
  notes: text("notes"),
  referenceAssetId: uuid("reference_asset_id"),
  /** 來源：manual＝手動建立、parse＝自動解析建立（供追溯與 Undo） */
  source: text("source").notNull().default("manual"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  characterIdx: index("character_looks_character_idx").on(t.characterId),
  projectIdx: index("character_looks_project_idx").on(t.projectId),
}));

/**
 * parse_runs.applied 的形狀：這次解析實際寫了什麼（Undo 的依據）。
 * updated 只記「我們改過的欄位與改前值」——Undo 時僅在現值仍等於我們寫入的值才回復，
 * 使用者後來自己改過的欄位不動（不與人搶編輯）。
 */
export interface ParseRunApplied {
  createdCharacterIds?: string[];
  createdLocationIds?: string[];
  createdPropIds?: string[];
  createdLookIds?: string[];
  updated?: Array<{
    table: "characters" | "scene_presets" | "props";
    id: string;
    field: string;
    prev: string | null;
    next: string;
  }>;
  /** 轉分鏡（materialize）落庫的 id；存在＝這次 run 已建過分鏡，重按直接回同一批（冪等） */
  storyboard?: { storySceneIds: string[]; sceneIds: string[] };
}

export interface ParseRunStats {
  characters: { created: number; linked: number; pending: number };
  locations: { created: number; linked: number; pending: number };
  props: { created: number; linked: number; pending: number };
  looks: { created: number };
  scenes: number;
  shots: number;
  truncation?: { totalChars: number; sentChars: number; droppedChars: number } | null;
  mock?: boolean;
}

export const parseRuns = pgTable("parse_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  storyId: uuid("story_id").notNull(),
  /** running＝解析中（同步呼叫下短暫存在）・done＝完成・failed＝失敗・undone＝已被撤銷 */
  status: text("status", { enum: ["running", "done", "failed", "undone"] }).notNull().default("running"),
  /** 解析當下故事內容的 sha256（與 stories.parsedContentHash 對齊） */
  contentHash: text("content_hash"),
  stats: jsonb("stats").$type<ParseRunStats>(),
  /** 解析出的分鏡計畫（Scene/Shot 草案）——「產生分鏡」讀這份落庫 */
  plan: jsonb("plan").$type<StoryParsePlan>(),
  applied: jsonb("applied").$type<ParseRunApplied>(),
  error: text("error"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  projectCreatedIdx: index("parse_runs_project_created_idx").on(t.projectId, t.createdAt),
}));

/** parse_candidates.payload：建立實體所需的欄位（依 kind 取用） */
export interface ParseCandidatePayload {
  appearance?: string;
  features?: string;
  lighting?: string;
  costume?: string;
  notes?: string;
  aliases?: string[];
  ownerRef?: string;
  characterId?: string;
}

export const parseCandidates = pgTable("parse_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  runId: uuid("run_id").notNull(),
  /** character / location / prop / look（見 shared/story.ts CANDIDATE_KINDS） */
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  payload: jsonb("payload").$type<ParseCandidatePayload>().notNull().default({}),
  confidence: real("confidence").notNull().default(0),
  /**
   * pending＝低信心待確認（未落庫）・applied＝已自動套用（0.70–0.89 帶「可能需確認」標記）・
   * confirmed＝使用者確認建立・merged＝使用者併入既有實體・dismissed＝使用者略過
   */
  status: text("status", { enum: ["pending", "applied", "confirmed", "merged", "dismissed"] }).notNull().default("pending"),
  /** applied/merged 時指向實際實體 id（依 kind 對應 characters/scene_presets/props/character_looks） */
  matchedEntityId: uuid("matched_entity_id"),
  /** 來源文字片段（Traceability：每筆 AI 建立可追到來源） */
  sourceExcerpt: text("source_excerpt"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: uuid("resolved_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  projectStatusIdx: index("parse_candidates_project_status_idx").on(t.projectId, t.status),
  runIdx: index("parse_candidates_run_idx").on(t.runId),
}));
