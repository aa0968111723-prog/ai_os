# PROGRESS.md — 手機版優化進度

> 任何時間點中斷都能從此檔無縫接續。狀態：done / doing / todo / BLOCKED / DEFERRED

## 環境
- Worktree：`D:\生成系統最新\ai_os_mobile_wt`（分支 `mobile/*`，base = origin/claude/healing-migration-ai-os-erewp2）
- 建置基線：build-baseline.log（見 DECISIONS.md D-006）

## 階段一：稽核
- [done] 路由清冊（AppRoutes.tsx：19 條已登入路由＋未分組路由＋登入前頁）
- [done] 效能基線（bundle 大小；D-006）
- [done] 10 維度多代理地毯掃描＋P0 對抗驗證（69 項：P0×1/P1×19/P2×49，0 誤報）
- [done] MOBILE_AUDIT.md 彙整完成 → PR（分支 mobile/audit）

## 階段二：P0 → P1 → P2 修復（分批小 PR）
- [done] 批次 A（P0＋聊天）：P0-01 標注 picker 裁切＋P1-13 私訊輸入列 --kb-inset → PR #462（3 檔 +76/−8，契約測試 3 條）
- [done] 批次 B（CSS-only 快修 12 項）：P1-02/04/08/12/14/16＋P2-01/02/03/05/07/37 → PR #463（4 檔 +86/−4，契約測試 7 條）
- [done] 批次 C（Launchpad）：P1-03/P1-17 Modal 貼底 sheet＋P2-06 巢狀 Link → PR #464
- [done] 批次 D（導航）：P1-01 SPA 導航＋rAF 錨點捲動 → PR #465
- [done] 批次 E（專案頁）：P1-05/06/07/09 → PR #466（4 檔 +82/−4，契約測試 4 條）
- [done] 批次 F：P1-10/11/15（月曆點擊、知識地圖、比較卡 sticky）→ PR #467
- [done] 批次 G（效能）：P1-18/19 → PR #468（阻塞 CSS gzip 121→33KB；ProjectPage chunk 瘦身 DEFERRED 見 D-011）
- [todo] 批次 H（P2 掃尾，逐頁）

## 階段三：Adobe 視覺落地
- [done] 板資產存取驗證＋視覺語彙萃取（D-003/D-004；耗點 0/200）
- [todo] 手機 design token（--m-* CSS variables，不覆寫桌機）
- [todo] 手機端元件重製（Button/Input/Card/BottomSheet/Toast/Tabs/底部導航/Orb…）

## 階段四：PWA 完備（既有：manifest 完整、sw.js、offline.html、share_target）
- [todo] 稽核缺口（更新提示 UI、安裝引導、離線 fallback 驗證）→ 補齊
- [todo] Lighthouse PWA 全過＋飛航模式驗證

## 階段五：側載 APK（PWA 全數完成後）
- [todo] Capacitor/TWA 包裝＋GitHub Actions 自動 build＋INSTALL.md

## CI 觀察
- 2026-08-07 00:40：#462/#463 首輪 CI 因 GitHub Actions 基礎設施故障（Service Unavailable）失敗。
- 2026-08-07 02:10：確認 base 分支自身 CI 亦紅——(a) 同一波平台故障 (b) Launchpad.teamCard 71 測試為時間相依破損（另一並行分支 fix/launchpad-teamcard-frozen-clock 正在修），本任務所有分支繼承此紅測；已對 fix-a/b/c 觸發 rerun。判準維持「失敗集不比 base 多」。

## 驗收清單對照（第 8 節）
- [todo] 全部（詳見各階段）
