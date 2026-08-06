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
- [todo] 批次 C（Launchpad）：新專案 Modal 走 .modal-scrim/.modal-card 契約＋巢狀 Link
- [todo] 批次 D（導航）：MobileNavigation 原生 <a> 整頁重載 → SPA 導航
- [todo] 批次 E（專案頁）：context-return-bar 遮擋、StageHead scrollMargin、TokenListEditor chip 溢位、DirectGenerateMode 確認面板可視
- [todo] 批次 F（Planner/Databases/Members/Models）：月曆點擊行為、知識地圖手機斷點、其餘觸控目標
- [todo] 批次 G（效能）：brand logo 524KB PNG、CSS @import 字型拆出、ProjectPage chunk 瘦身、首屏 JS
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

## 驗收清單對照（第 8 節）
- [todo] 全部（詳見各階段）
