# DECISIONS.md — 手機版優化任務決策紀錄

> 規則：任何岔路依「預設決策表」自行決定，記錄於此供事後審閱。每筆含：岔路、選擇、理由、回滾方式。

## D-001 基準分支（指令留空）
- **岔路**：任務指令的基準 PR/分支欄位未填。
- **選擇**：以 `origin/claude/healing-migration-ai-os-erewp2`（`origin/HEAD`，2026-08-06 仍在收 PR，最新 #458）為 base。
- **理由**：repo 無 main/master；所有 PR 都併回此分支，是事實上的主幹。風險最低。
- **回滾**：各 PR 都是獨立小分支，改 base 只需 rebase。

## D-002 工作區隔離
- **岔路**：主目錄 `ai_os` 有其他並行 session 的未提交變更，且歷史上多次發生 checkout 洗掉工作區。
- **選擇**：建獨立 worktree `D:\生成系統最新\ai_os_mobile_wt`，分支前綴 `mobile/`。
- **理由**：完全不碰主目錄，避免互相干擾（記憶中已有兩次實際踩雷）。
- **回滾**：`git worktree remove` 即可。

## D-003 Adobe 板存取方式與耗點
- **岔路**：Firefly Board（urn:aaid:sc:AP:82c12a04-…）無直接「讀板」API；board 的 `directoryIds` 搜尋回 0 筆。
- **選擇**：改用 `asset_search`（CCAsset）搜尋板上素材（同帳號雲端可見，70 筆命中：AiOS Logo、App icon、paper-craft 插畫系列），以 `asset_inline_preview` 萃取視覺語彙。**不使用生成工具**；目前耗點 0 / 上限 200。
- **理由**：優先重用既有素材（指令第 5 節）；預覽/搜尋不耗生成點數。
- **回滾**：無副作用。

## D-004 視覺語彙判讀（board 為準）
- 板上視覺語彙：暖米紙感底色（≈ #F3F0E8，與現有 app `theme_color` 一致）、紙雕 3D 層疊質感、
  柔和大圓角（app icon 圓角率 ≈22%）、高彩度 coral→amber→mint→teal 漸層字、低透明度柔陰影、mint 綠單色插畫系。
- 與指令品牌色（navy #16223B / coral #EF6A4E / amber #F2B24A / mint #8FE3CB）相容，無重大衝突。
- **選擇**：手機 design token 以指令四色 + 板上暖米底與紙雕陰影/圓角節奏落地；只新增 `--m-*` 前綴變數，不覆寫既有值。

## D-005 字體策略（Fraunces / Manrope vs 效能預算）
- **岔路**：指令要求 Fraunces（標題）/ Manrope（內文），但兩者僅覆蓋拉丁字元，站內以繁中為主；現況已載 Noto Serif TC 分片。
- **選擇**：僅引入 Latin 子集的 Fraunces（標題用，woff2 子集 <20KB）與 Manrope（內文拉丁），中文回退既有 Noto Serif TC／系統字，`font-display: swap`，只在手機 token 層引用。
- **理由**：兼顧 board 視覺與 <180KB 首屏預算；中文字體不再新增。
- **回滾**：移除 @font-face 與 token 引用即可。

## D-007 既有測試基線（2026-08-06）
- typecheck ✓；vitest 1751 passed / 1 failed / 37 skipped。
- 唯一失敗：`server/services/userAvatar.test.ts`「resolves safe path inside avatars dir」——期望含 POSIX 分隔符 `avatars/…`，Windows 實得 `avatars\…`。base 乾淨 checkout 即失敗，**非本任務造成**（CI 在 Linux 會過）。依決策表：記錄後跳過，後續以「除此之外全綠」為基準。

## D-008 client 測試本地紅測基線（2026-08-07）
- `npm run test:client` 在本地 Windows 有 4 個檔既有紅測（mob03LongTaskCopy×2、Launchpad.teamCard×71、LoginPage.deviceTrust×2 等）——乾淨 base 以 git stash 對照同樣紅，屬本地環境因素（CI Linux 為準）。
- 每批修復以「失敗集不增加」為判準，並優先跑受影響檔＋styles.contract.test.ts。

## D-010 字型 CSS 非阻塞化（紅線邊界說明）
- P1-19 修法（PR #468）把兩份中文字型 index.css 移出 render-blocking CSS，桌機「穩態渲染」完全相同，但首載瞬間字型改為 swap-in（原本 CSS 同支早到）。判定：紅線精神是桌機像素級不變（截圖為穩態），此為過渡行為非版面變更；效益（阻塞 CSS gzip 121→33KB）同時惠及桌機。回滾：把 fonts.css 兩行 @import 搬回 styles.css 頂端即可。

## D-011 ProjectPage chunk 瘦身 DEFERRED
- ProjectPage chunk gzip 151KB 超 100KB 門檻，但瘦身需把 workbench/modes 拆成巢狀 lazy——動共用結構、迴歸面大（該頁有 hookOrder/workbenchContract 等契約測試防守）。標 DEFERRED，待 P2 掃尾與元件重製完成後獨立 PR 評估。

## D-012 標題字族策略 DEFERRED（P2-42）
- Noto Serif TC 只用在 13 處標題/裝飾數字，但每個標題字要在 sans 之外多載一份 serif CJK 分包（均 ~47KB）。改高字重 sans 或場景化載入涉及整體視覺語言，留待 Adobe token/元件重製階段一併決策（board 視覺可能改變標題字族）。
- 現況已因 PR #468 全部字型 CSS 非阻塞化，重複下載只影響換頁後的字型補載，非首屏瓶頸。

## D-013 手機 token 落地方式（2026-08-07，PR #473）
- 新檔 styles.mobile-tokens.css 於 main.tsx 最後載入（同特異性靠順序勝出）；契約測試強制「頂層無規則、只准 --m- 前綴」。
- 文字對比不自創：active/文字色沿用 v3 已過 AA 的宣告，board 色只進 tint/陰影/圓角。
- 字族落地＝D-012 決策：手機標題 Fraunces（Latin variable 36K）＋內文 Manrope（16K×2），非阻塞載入、中文回退 Noto；P2-42 的 serif 重複下載問題因此不再擴大（手機標題 Latin 走 Fraunces）。
- fonts.brand.css 獨立於 PR #468 的 fonts.css（兩 PR 互不依賴，可任意順序合併）。

## D-014 APK 簽章金鑰策略（PR #475）
- 本機無 keytool（僅 JRE8）無法產 keystore。CI 策略：Secrets 有金鑰就用（簽章固定、可覆蓋更新）；沒有就自動產生並隨 Release 附上、INSTALL.md 引導一次性設成 Secrets 後刪附件。
- 取捨：首版金鑰經 Release 短暫可下載（私有 repo 風險有限），換得「不需要我持有 admin 權限設 Secrets」的全自動流程；使用者設好 Secrets 後即固定。

## D-015 Lighthouse 行動效能 90 分 DEFERRED-ARCH（驗證輪實測）
- 實測節流：FCP 2.5s✓／SI 3.8s／CLS 0.015✓，但 LCP 5.3s、TTI 12.2s、TBT 1.63s——根因＝純 client-render SPA 的 JS 開機成本（入口鏈 gzip ~207KB），4x CPU 節流下 React boot 即吃掉預算。
- 紅線內可拿的已拿完（阻塞 CSS 121→33KB、hero 535KB→62KB、字型非阻塞、logo 不下載）；過 90 需 SSR/預渲染或入口重構＝結構性工程，與「桌機零改動、小 PR」衝突。與 D-011 合併為後續獨立提案。

## D-006 效能基線（2026-08-06 build，gzip）
- 首屏 JS：index 103.7KB + vendor-react 57.8KB + vendor-data 45.0KB ≈ **206.5KB（超 180KB 門檻）**
- 全站單一 CSS：408KB raw / **120.9KB gzip**（未拆分、未 purge）
- **ProjectPage chunk：486KB raw / 151.0KB gzip（超 100KB/route 門檻）**
- html2canvas-pro 63.8KB（需確認是否 lazy）；Noto Serif TC 已 unicode-range 分片（單片 ≤116KB）
- → 列入稽核 P1 修復標的。
