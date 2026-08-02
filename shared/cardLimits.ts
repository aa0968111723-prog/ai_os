/**
 * 角色定裝卡／場景設定卡／素材設定卡——前後端共用上限（單一真相）。
 *
 * 生成帶入上限必須與 generation / scenes / prompts / workflows / plan 的 zod .max 一致；
 * 每專案張數上限避免 list 全量渲染被灌爆。
 */

/** 單次生成最多帶入的角色定裝卡數 */
export const MAX_GENERATE_CHARACTERS = 6;
/** 單次生成最多帶入的場景設定卡數 */
export const MAX_GENERATE_SCENE_PRESETS = 4;
/** 單次生成最多帶入的素材設定卡數（道具比場景更零碎，帶太多會把主體擠出畫面） */
export const MAX_GENERATE_PROPS = 4;

/** 每專案角色定裝卡硬上限 */
export const MAX_PROJECT_CHARACTERS = 50;
/** 每專案場景設定卡硬上限 */
export const MAX_PROJECT_SCENE_PRESETS = 50;
/** 每專案素材設定卡硬上限 */
export const MAX_PROJECT_PROPS = 50;

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

/** 素材名（道具／物件） */
export const PROP_NAME_MAX = 40;
/** 素材外觀・材質（入庫上限；視覺注入另有 cardAnchors 截短） */
export const PROP_APPEARANCE_MAX = 1000;
/** 素材用途／備註（不注入視覺，僅供知識庫與導演參考） */
export const PROP_NOTES_MAX = 1000;
