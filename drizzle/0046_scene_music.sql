-- 配樂：跨鏡區間，用「端點標記」表達（起／止），區間由 shared/sceneMusic.ts 掃描相鄰鏡推導。
--
-- 為什麼不存區間本身：存 sceneId 會在鏡被軟刪時懸空，存起訖秒數會在改秒數、逐鏡修剪、
-- 拖曳重排之後整條錯位。存端點之後，鏡怎麼搬動配樂自動跟著走——因為區間從來沒被存過。
--
-- music_asset_id 落在「起鏡」上，與畫面／旁白／環境音三個指標欄同構。
-- 兩欄皆 nullable，既有分鏡不受影響。
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "music" text;
--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "music_asset_id" uuid;
