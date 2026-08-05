# L2 free 未 success（零成本收尾完成）· 2026-08-05T07:55:54.658449+00:00

softStop=500 spent=496.0
契約健康：`{"live_ok": 65, "openapi_404": 4, "needs_source": 168, "never_probed": 7, "live_fail": 1, "live_timeout": 14, "nim_no_key": 7}`

## 可空探測但未 live_ok
共 **23**（含 timeout／fail／never／openapi_404）

- 11 `fal-ai/kling-video/v2.5-turbo/pro/text-to-video` **live_fail** — live 失敗：exit_-9
- 1 `fal-ai/diffrhythm` **live_timeout** — live 已送出但輪詢逾時（可能已計點，勿重跑）
- 2 `fal-ai/dia-tts` **live_timeout** — do not re-probe
- 5 `fal-ai/minimax-music/v2.6` **live_timeout** — poll 120s still running; is_instrumental fix accepted (no 422)
- 6 `fal-ai/cogvideox-5b` **live_timeout** — 120s+ extra poll still queued; may complete later; do not re-yes
- 8 `fal-ai/wan/v2.5/text-to-video` **live_timeout** — live 已送出但輪詢逾時（可能已計點，勿重跑）
- 8 `fal-ai/yue` **live_timeout** — live 已送出但輪詢逾時（可能已計點，勿重跑）
- 9 `fal-ai/minimax/hailuo-2.3/standard/text-to-video` **live_timeout** — live 已送出但輪詢逾時（可能已計點，勿重跑）
- 9 `fal-ai/kling-video/v1.6/standard/text-to-video` **live_timeout** — live 已送出但輪詢逾時（可能已計點，勿重跑）
- 12 `fal-ai/hunyuan-video-v1.5/text-to-video` **live_timeout** — live 已送出但輪詢逾時（可能已計點，勿重跑）
- 12 `fal-ai/hunyuan-video` **live_timeout** — live 已送出但輪詢逾時（可能已計點，勿重跑）
- 12 `fal-ai/mochi-v1` **live_timeout** — live 已送出但輪詢逾時（可能已計點，勿重跑）
- 15 `fal-ai/minimax/hailuo-2.3/pro/text-to-video` **live_timeout** — live 已送出但輪詢逾時（可能已計點，勿重跑）
- 16 `fal-ai/luma-dream-machine/ray-2` **live_timeout** — live 已送出但輪詢逾時（可能已計點，勿重跑）
- 16 `fal-ai/minimax/video-01-director` **live_timeout** — live 已送出但輪詢逾時（可能已計點，勿重跑）
- 16 `fal-ai/wan/v2.6/text-to-video` **never_probed** — OpenAPI 可連；尚未合法生成 live（pts 或 softStop 限制）
- 17 `fal-ai/kling-video/o3/pro/text-to-video` **never_probed** — OpenAPI 可連；尚未合法生成 live（pts 或 softStop 限制）
- 19 `fal-ai/bytedance/seedance/v1/pro/text-to-video` **never_probed** — OpenAPI 可連；尚未合法生成 live（pts 或 softStop 限制）
- 31 `fal-ai/veo3.1` **never_probed** — OpenAPI 可連；尚未合法生成 live（pts 或 softStop 限制）
- 47 `bytedance/seedance-2.0/text-to-video` **never_probed** — OpenAPI 可連；尚未合法生成 live（pts 或 softStop 限制）
- 78 `fal-ai/veo2` **never_probed** — OpenAPI 可連；尚未合法生成 live（pts 或 softStop 限制）
- 93 `fal-ai/minimax/voice-design` **never_probed** — OpenAPI 可連；尚未合法生成 live（pts 或 softStop 限制）
- 2 `fal-ai/bytedance/seedream/v5/text-to-image` **openapi_404** — OpenAPI queue 404：端點可能下架或 slug 錯誤

## 乾跑估價（無 --yes）

- `fal-ai/bytedance/seedream/v5/text-to-image` pts=2 health=openapi_404 → 這會真實呼叫 fal,估 2 點(約 NT$2),確認請加 --yes:
- `fal-ai/veo3.1` pts=31 health=never_probed → 這會真實呼叫 fal,估 31 點(約 NT$31),確認請加 --yes:
- `fal-ai/kling-video/v2.5-turbo/pro/text-to-video` pts=11 health=live_fail → 這會真實呼叫 fal,估 11 點(約 NT$11),確認請加 --yes:
- `fal-ai/veo2` pts=78 health=never_probed → 這會真實呼叫 fal,估 78 點(約 NT$78),確認請加 --yes:
- `fal-ai/kling-video/o3/pro/text-to-video` pts=17 health=never_probed → 這會真實呼叫 fal,估 17 點(約 NT$17),確認請加 --yes:
- `fal-ai/bytedance/seedance/v1/pro/text-to-video` pts=19 health=never_probed → 這會真實呼叫 fal,估 19 點(約 NT$19),確認請加 --yes:
- `bytedance/seedance-2.0/text-to-video` pts=47 health=never_probed → 這會真實呼叫 fal,估 47 點(約 NT$47),確認請加 --yes:
- `fal-ai/wan/v2.6/text-to-video` pts=16 health=never_probed → 這會真實呼叫 fal,估 16 點(約 NT$16),確認請加 --yes:
- `fal-ai/minimax/voice-design` pts=93 health=never_probed → 這會真實呼叫 fal,估 93 點(約 NT$93),確認請加 --yes:

## 政策

- timeout／softStop 外：不重跑 --yes
- needs／NIM：見 L2-NEEDS-SKIP.md、NIM-SKIP.md
- 契約：`npm run models:contracts`
