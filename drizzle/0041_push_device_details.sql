-- 已連結裝置的細節：推播裝置清單原本只存一句標籤（「Android・Chrome・主畫面」），
-- 同型號的兩支手機、辦公室裡的每一台 Windows 因此長得一模一樣，要移除哪一台只能猜。
-- 信任裝置（user_devices.details）早就存廠牌／機型／處理器／螢幕／顯示卡，這裡補齊，
-- 兩份清單看到的資訊才一致（型別見 shared/deviceDetails.ts）。
-- nullable：既有訂閱與尚未更新的前端維持 null，清單只是少列那幾行，不影響推播本身。
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "details" jsonb;
