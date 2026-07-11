# AI Director OS

釋迦牟尼佛救世基金會 · 弘法內容創作與協作系統（內部工具）。

一套「懂我們素材」的團隊 AI：讓夥伴做影片不必反覆餵資料，在受控成本下生成、協作、審批。

## 定案原則（2026-07）

- **可行實用優先**，簡單操作，不做複雜功能
- AI 供應商**只接 Fal.ai**；無金鑰自動進「**假生成模式**」（不花錢測全流程）
- **全部部署在 Railway**（App 服務＋Postgres 服務）
- 站內留言簡化（輪詢）；瀏覽器桌面為主
- **登入系統最後做**：開發期用假身分（測試帳號／總管理），資料表已留 user/group 欄位
- 點數制：1 點 ≈ NT$1，總預算 5,000 點；先扣預估、失敗全額退回
- 開示引用僅作建議，須組長審核（斷章取義防線）

## 本機開發

```bash
npm install
cp .env.example .env        # 填 DATABASE_URL（本機 Postgres 或 Railway 的）
npm run db:push             # 建立資料表
npm run dev                 # server :3000 + client :5173
```

打開 http://localhost:5173 —— 沒填 FAL_KEY 就是假生成模式，可直接測「建專案 → 設世界觀 → 生成 → 點數扣退 → 留言」整條流程。

## 部署（Railway）

1. Railway 新增專案 → 加 **Postgres** 服務
2. 加 **App 服務**連此 repo（自動用 Dockerfile 建置）
3. 環境變數：`DATABASE_URL`（引用 Postgres 服務）、`FAL_KEY`（可後補）、`FAL_MOCK=1`（測試期建議開）
4. 首次部署後在本機對正式 DB 跑一次 `npm run db:push`（或用 Railway shell）

## 結構

```
client/   React 前端（黏土療癒設計 tokens）
server/   Express + tRPC + Drizzle
shared/   模型註冊表 · 世界觀 schema（前後端共用，零漂移）
docs/     規劃文件
```

## 已完成 / 路線圖

- [x] 階段 0 骨架：tRPC + Drizzle + 假身分 + 健康檢查 + CI + Railway 部署設定
- [x] 專案（平台→格式自動帶）＋世界觀快速層（logline／關鍵訊息／主軸／調性＋內建禁語）
- [x] 生成台：Fal queue＋輪詢、**世界觀自動注入提示詞**、成品自動入素材庫
- [x] 點數帳本：先扣預估／失敗退回／週額度／總預算守門
- [x] 站內留言（輪詢）
- [ ] 分鏡排序＋交付素材包（zip：01_視頻素材…05_文件）
- [ ] 審批三態機（待審／需修改／通過，Frame.io 模式）
- [ ] 素材知識庫（RAG：貼上文字語料→檢索引用；逐字稿來源就緒後啟動）
- [ ] AI 導演建議（引用僅建議＋組長審核）
- [ ] 真登入＋RLS（交付測試前最後一步）
