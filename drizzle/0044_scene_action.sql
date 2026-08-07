-- 逐鏡動作走位：誰做了什麼、從哪走到哪。
-- 刻意與 prompt（畫面描述）分開：prompt 是直接送進擴散模型的字，而走位是時間性的——
-- 「從門口走到窗邊」單張圖畫不出來，混進去只會生出多重人影。分開之後才能各自注入
-- （動作只送影片類模型，純圖像模型不吃）。
-- nullable，既有分鏡不受影響。
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "action" text;
