/**
 * 角色定裝卡／場景設定卡——前後端共用上限（單一真相）。
 *
 * 生成帶入上限必須與 generation / scenes / prompts / workflows / plan 的 zod .max 一致；
 * 每專案張數上限避免 list 全量渲染被灌爆。
 */

/** 單次生成最多帶入的角色定裝卡數 */
export const MAX_GENERATE_CHARACTERS = 6;
/** 單次生成最多帶入的場景設定卡數 */
export const MAX_GENERATE_SCENE_PRESETS = 4;

/** 每專案角色定裝卡硬上限 */
export const MAX_PROJECT_CHARACTERS = 50;
/** 每專案場景設定卡硬上限 */
export const MAX_PROJECT_SCENE_PRESETS = 50;

/** 角色名 */
export const CHAR_NAME_MAX = 40;
/** 角色外觀（入庫上限；視覺注入另有 cardAnchors 截短） */
export const CHAR_APPEARANCE_MAX = 1000;
/** 角色個性／備註 */
export const CHAR_NOTES_MAX = 1000;

/** 場景名 */
export const SCENE_NAME_MAX = 40;
/** 場景色板 */
export const SCENE_PALETTE_MAX = 500;
/** 場景光線 */
export const SCENE_LIGHTING_MAX = 500;
