# 手機版優化・驗證輪報告（2026-08-07）

驗證環境：本機 E2E_MOCK 全站（production build＋可攜式 PostgreSQL 16）；
**整合建置**＝b89ce68（任務起點 base）＋全部 16 個任務 PR 分支本機合併（衝突已解，等價於全數合併後的最終狀態）。
對照組＝b89ce68 原樣建置。工具：repo 內建 `audit-routes.mjs`（Playwright）＋自建 `desktop-shots.mjs`／`offline-check.mjs`／pixel diff＋Lighthouse 13.4。

## 1. 全路由×全視寬巡檢（360/390/768/1280/1440 × 17 路由）

| 指標 | Before（base） | After（整合） |
|---|---|---|
| 巡檢失敗 | **3**（/dashboard 觸控目標 <44px @360/390；/models 桌機對比度） | **1**（僅剩 /models 桌機對比度——base 既有、桌機側、非本任務範圍） |
| 橫向溢位（scrollWidth>clientWidth） | 0 | **0**（85/85 全過） |
| 無障礙 axe serious/critical（手機視寬） | 0 | **0** |

→ 手機觸控目標失敗**實測歸零**；全站無橫向捲動。

## 2. 桌機像素對比（紅線驗證；同一顆 DB 對照實驗）

`pixel-diff-samedb.json`：34 張（1280/1440 × 17 路由）。
- 8 張位元級相同；其餘差異率 0.1%–0.4%＝動態內容噪音（相對時間戳、輸入游標、在線指示）。
- 唯一結構性差異 `/options`（高度 +632px）：**歸因上游已合併功能 #457「畫風擴充」**（後期分支繼承新 base 的內建畫風清單；樣式逐像素一致、僅清單變長）——非本任務造成。
- 佐證樣本：`before-after-desktop-dashboard-1280.png`（肉眼不可辨差異）。

→ **桌機零改動紅線成立**。

## 3. PWA 驗收（任務第 7 節 A）

- 離線：SW 就緒後斷網導航 → 正確落 v3 品牌化 offline.html（`offline-check.mjs` 實測 ✓）
- manifest 完整（icons/maskable/shortcuts/share_target）✓、更新提示 UI＋背景恢復檢查 ✓、
  安裝引導（Android 橫幅＋iOS 四步驟教學）✓
- lie-fi 5s 逾時（PR #472）已入整合版

## 4. Lighthouse（行動模擬，`lighthouse-mobile.html`）

| 類別 | 分數 |
|---|---|
| Accessibility | **100** |
| Best Practices | **100** |
| Performance（模擬 4G Slow＋4x CPU） | 56（devtools 實測節流 49） |

實測節流關鍵指標：**FCP 2.5s ✓、Speed Index 3.8s、CLS 0.015 ✓（<0.1）**；
LCP 5.3s、TTI 12.2s、TBT 1.63s **未達標**。

**根因（非本任務可解）**：站台為純 client-render SPA——首屏必須下載＋執行 ~700KB raw JS
（gzip ~207KB 入口鏈）才能渲染真實內容，4x CPU 節流下 React 開機即吃掉 TBT/TTI。
本任務已把可在紅線內拿的都拿了（阻塞 CSS gzip 121→33KB、hero LCP 圖 535KB→62KB、
字型非阻塞、路由拆分本已健全）；要過 90 需 SSR/預渲染或入口重構——
與「桌機零改動、小 PR」紅線衝突，標 **DEFERRED-ARCH**（見 DECISIONS.md D-011/D-015）。

## 5. 效能資產面成果（實測）

| 項目 | Before | After |
|---|---|---|
| render-blocking CSS | 408KB raw／120.9KB gzip | **182KB raw／33.3KB gzip** |
| 手機頂欄隱藏 logo 下載 | 524KB（照下載） | **0**（不渲染） |
| Landing hero（手機 LCP 元素） | 535KB @2x PNG | **62KB WebP** |
| 部署產物 | ＋208KB 無用母版 | 已移出 public |

## 6. 深淺色

站台鎖亮色（`color-scheme: light`，v3「白紙」設計決策）——深色模式驗收項不適用（N/A），
offline.html 與 App 主題色已對齊一致。

## 7. APK 實測（第 7 節 B 驗收）

`workflow_dispatch` 觸發實跑成功，Release **apk-v0.1.2** 產出 `aios-v0.1.2.apk`（18.88 MB）。
下載回本機驗證：

| 檢查 | 結果 |
|---|---|
| APK Signing Block | 存在 |
| 簽章方案 | **v1（JAR）＋ v2 ＋ v3** 三層俱全（Android 11+ 安裝要求 ≥v2） |
| 內容 | classes.dex ✓、AndroidManifest.xml ✓、767 個 entry |

過程中修掉兩個真實 CI 缺陷：
1. tag 事件不派工（兩次 tag 推送皆無 run）→ 補 `workflow_dispatch`
2. `./gradlew: Permission denied`（Windows 產生的 commit 存成 100644）→ workflow 補 chmod ＋ repo 內模式改 100755

## 8. Orb 四態實拍

`orb-idle.png` / `orb-thinking.png` / `orb-error.png`（390 寬底部導航區）：
中央「AI 工作」分頁已抬升為 coral→amber→mint 漸層懸浮球，四態動畫只用 transform/opacity。

## 9. 手機字族策略實測（P2-42）

`font-usage-check.mjs` 量測實際下載的字型檔：

| 視寬 | serif CJK 分包 |
|---|---|
| 手機 390 | 6 → **0**（省約 250KB） |
| 桌機 1280 | **6（不變）** |

## 10. 證據檔

- `before-after-{planner,models,chat}-360.png`：手機 360 寬前後對比
- `before-after-desktop-dashboard-1280.png`：桌機無差異樣本
- `pixel-diff-samedb.json`：34 張桌機截圖逐張差異率
- `lighthouse-mobile.html`：完整 Lighthouse 報告
（完整 5 視寬×17 路由×前後共 ~200 張截圖在本機驗證產物，過大不入 repo；需要可另行打包）
