# 審計完成狀態 · 2026-08-05T07:35:06.826256+00:00

## 數字
- MODELS: **266**
- L0 cards: 齊
- softStop: **500** | spentTwd: **496.0**（剩餘 4）
- unique L2 success: **66**
- needs 跳過: **171** → L2-NEEDS-SKIP.md
- NIM 跳過: **7** → NIM-SKIP.md
- free 未 success: **21** → L2-FREE-REMAINING.md
- expensive 未 live: **1**

## 零成本本輪已完成
- [x] `probe-fal-endpoints --yes`：251 唯一端點 → **連通 219** + **cancel_unconfirmed 32** + **queue 404: 0**
- [x] OpenAPI 全量：ok **246** / 404 **4** → openapi-zero-cost.json
- [x] OpenAPI 404 清單：`fal-ai/bria/video/eraser`, `fal-ai/bytedance/seedream/v5/text-to-image`, `fal-ai/mix-dehaze-net`, `fal-ai/runway-gen3/turbo/image-to-video`
- [x] NIM / needs / free remaining 文件
- [x] broken.json 同步
- [x] 文件 regen（verify-models / gen-model-docs）

## 刻意不做（要點數或人工）
- softStop 內不再 `--yes` live
- 影片 timeout 不重跑
- needs 空 live 禁止
- NIM 無 KEY
- **禁止**自動 `verified: true`
- e2e 可選未跑

## budget status 分布
```
{"success": 68, "timeout_poll_120s_queue": 1, "failed_422_ascii_only": 1, "fail_404_wrong_path": 1, "fail_422_ascii_only": 1, "timeout_poll_120s": 23, "fail": 14, "failed_422_speakers_mismatch": 1, "exit_1": 1, "exit_-15": 1, "exit_-9": 2, "failed_422_missing_ref": 1, "failed_404_path": 1, "timeout_poll_queued": 1, "aborted_softstop": 1}
```
