# 審計完成狀態 · 2026-08-05T07:55:54.658882+00:00

## 數字
- MODELS: **266**
- softStop: **500** | spentTwd: **496.0**
- 契約健康: `{"live_ok": 65, "openapi_404": 4, "needs_source": 168, "never_probed": 7, "live_fail": 1, "live_timeout": 14, "nim_no_key": 7}`

## 零成本全部完成
- [x] OpenAPI 全量（openapi-zero-cost.json）
- [x] probe-fal-endpoints 空輸入連通
- [x] model contracts 指紋／diff／current.json
- [x] 剩餘 free 乾跑估價（ZERO-COST-DRY-REMAINING.json，無 --yes）
- [x] 模型目錄／清查清單
- [x] needs／NIM／free remaining 文件
- [x] needs 健康優先序修正（不因歷史 empty fail 蓋掉 needs_source）

## 仍要點數／人工（不做）
- softStop 外 live
- needs 素材 live
- NIM KEY live
- timeout 重跑
- verified true 自動

## 指令
```bash
npm run models:contracts
FAL_KEY=… npm run models:contracts:openapi
npm run models:docs
```
