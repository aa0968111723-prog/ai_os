# MOBILE_AUDIT.md — 手機版地毯式稽核（2026-08-06）

> 方法：10 維度多代理靜態掃描（shell/導航、工作台、專案頁、生成作業台、資料/排程、社交、管理、全站樣式、效能、PWA/無障礙）＋ P0 對抗式驗證。共 69 項：P0×1、P1×19、P2×49，0 項被驗證推翻。
> 狀態標記：完成打勾並在行尾註記 `done(PR#)`／`BLOCKED`／`DEFERRED`。

## 路由清冊（AppRoutes.tsx）

已登入：`/`→`/dashboard`（今日工作台）、`/admin`、`/options`、`/logs`、`/members`、`/feedback`、`/settings`、`/my-reports`、`/models`、`/help`、`/mcp`、`/integrations`、`/downloads`、`/chat`、`/chat/:peerId`、`/share-target`、`/planner`、`/databases`、`/community`、`/p/:id`（專案頁＋生成作業台）、404。
未分組：`/settings`、`/help`、`/mcp`、`/integrations`、`/chat(/:peerId)`、`/share-target`、等待頁。
登入前：Landing `/`、`/login`、`/invite/:token`；另有 `/desktop`（Tauri 桌面殼專用，不在手機範圍）。
全螢幕流程：登入、建立專案 Modal、生成確認/進度、私訊、分享收件（share_target）、強制改密碼對話框。

## 既有手機基礎（勿重工，修補時沿用）

- 該區手機基礎已相當完整，稽核時以下皆確認為「已被處理好」，不列缺陷：(1) 導覽關係——桌機無 Dock 元件，主導覽＝sticky .topbar（PrimaryNavigation 快捷連結＋MenuSurface 下拉）；.orb 僅是 styles.css:394 的遺留樣式（無任何 TSX 引用）。≤820px 時 styles.css:2319 隱藏全部 .topbar-nav-link，改由 AppShell.tsx:271 登入後常駐渲染的 .mobile-nav 底部五格分頁列（styles.css:5362-5477，>820 由 2126 行 display:none）與「更多」貼底面板接手，561-820px 直立平板斷點已統一。(2) 觸控目標——:root --touch-min:44px 全站生效：button/.btn/.menu-item 同時有 min-height＋min-width 44（styles.css:146-161，連 icon-only 關閉鈕都被涵蓋）、≤820 再補 status-chip/select/menu-item/chip.pick（927-940）、sheet 內 menu-item 48px（5423）。(3) 輸入防縮放——≤820 `input, textarea, select { font-size:16px !important }`（938，僅 group-select 在 ≤560 被 966 行破功，見 findings）。(4) safe-area——四向變數（131-134）確實套在 .mobile-nav（5370）、兩種 sheet（5415、5444）、≤820 topbar（908-912）、standalone 殼層（2092-2098）、LoginPage main（LoginPage.tsx:139）、回饋 FAB（1971）。(5) 鍵盤——--kb-inset 契約套用於 FAB（5431）、回饋面板（styles.mobile-fab-01.css:47）、專案訊息 sheet（3514-3586），並正確理解 iOS dvh 不縮鍵盤需顯式扣除。(6) 底部留白——--chrome-bottom 分級契約 48/100/140/200（styles.css:250-264、5364；styles.mobile-fab-01.css:12-20）單一出處。(7) 選單手機化——MenuSurface ≤820 portal 到 body 變貼底 sheet，檔頭註解明列已解掉的三個真機陷阱（backdrop-filter 包含區塊、z-index 被分頁列蓋、外點誤判），內捲 overscroll-behavior: contain 防巢狀捲動鏈。(8) hover-only——PointsBadge 的 title 細節在手機由 AccountMenu 內 PersonalQuotaSummary（AccountMenu.tsx:122-188）完整補位；landing 卡片 :hover 僅裝飾。(9) vh/dvh——除 AcceptInvitePage 一處外全面 dvh。(10) 動效——sheet/nav 動畫只用 transform/opacity，且 1392-1397 有全域 prefers-reduced-motion kill switch（0.001ms）兜底，5482-5485 另有針對性停用。(11) 登入前頁——Landing 在 ≤820/≤560 有完整收斂（2313-2337：hero 單欄、h1 clamp+overflow-wrap:anywhere、CTA grid 滿寬 48px），login-card 92vw、表單主鈕滿寬（945）、驗證碼欄 inputMode=numeric＋autoComplete=one-time-code。(12) 橫向溢位防線——html/body overflow-x: clip（210、224）、長組名 group-select max-width 截斷（505-509）、待核選單專案名 maxWidth 220 截斷（PendingApprovalsBadge.tsx:57）。
- Launchpad（今日工作台）的手機基礎相當完整，以下已被媒體查詢處理好、不算缺陷：(1) 全站觸控下限 --touch-min:44px 對 button/.btn/.menu-item 同時鎖 min-height＋min-width（styles.css:141-161），故「新專案 Modal 關閉鈕」雖宣告 32×32 實際會被撐到 44×44；(2) ≤820 全域 input/textarea/select font-size:16px !important 防 iOS 聚焦縮放，並蓋過 inline style（styles.css:936-938）；(3) 底部留白契約 --chrome-bottom（桌機 48 / ≤820 有 .mobile-nav 100 / ≤560 140 / 表單展開 200，styles.css:250-264、5362-5364、styles.mobile-fab-01.css:10-20）＋ .mobile-nav 底部分頁列本身有 safe-area 內距與毛玻璃（styles.css:5367-5374）；(4) 通用對話框契約 .modal-scrim/.modal-card：bottom:var(--kb-inset)、max-height:min(86dvh,100%)、≤560 轉貼底 sheet＋safe-bottom（styles.css:1898-1943）——ProjectCoverPicker（換封面對話框）已完整走這條契約，含 Esc 關閉與 scrim 點擊關閉；(5) Launchpad 專屬 RWD：≤560 daily-hero 直排、建立鈕全寬 48px、quick-links 橫滑＋scroll-snap＋隱藏捲軸、launch-toolbar 搜尋列全寬/兩個 select 各半、launch-grid 單欄、launch-card 轉 86px 橫排卡、封面換圖鈕改底緣小條（styles.css:4894-4970）；(6) 換圖鈕 hover 浮現在觸控裝置以 @media (hover:none){opacity:1} 常駐（styles.css:675），並有 prefers-reduced-motion 個別處理（676）；(7) 全域 reduced-motion kill-switch（styles.css:1392-1397）且動效幾乎全是 transform/opacity；(8) html/body overflow-x:clip 防 100vw 橫向溢位（styles.css:210、224）；(9) touch-action:manipulation 全域防雙擊縮放（styles.css:5359）；(10) 手機強制卡片檢視：useMatchMedia(min-width:821px)（Launchpad.tsx:112）＋ .launch-layout-toggle 於 ≤820 隱藏（styles.css:649）；(11) CursorOverlay 是 pointer-events:none＋overflow:hidden 的覆蓋層，不會產生橫向溢位（realtime.tsx:1012）；(12) 專案標題以 ellipsis／line-clamp 處理長字串（styles.css:683-684、2302-2303）。另註：TeamAssistantCard 與 TeamCommanderBlock（Launchpad.tsx:1325-2433，含 84px 寬數字輸入、maxHeight:380 對話捲動區等）目前並未在 Launchpad 的 JSX 中渲染（僅測試檔引用），屬 dead code，故其中的手機問題未列入 findings。
- 該區手機基礎相當完整，以下缺陷清單以外的項目已被涵蓋，勿重工：(1) 斷點契約——ProjectPage.tsx:91 PROJECT_MOBILE_MQ="(max-width:820px)" 與 styles.css 手機殼層同界線；mobileCompact 減負：上下文改 CtxCollapse/CtxGroup 受控 details（summary 有 44px 觸高，styles.css:3365-3372）、引導列手機預設收合（ProjectPage.tsx:747-756）、presence 收成「N 人在線」chip、桌機留言側欄改 FAB→bottom sheet。(2) 觸控與 iOS 縮放——styles.css:141-161 全站 button/input min 44×44；styles.css:938 ≤820 `input,textarea,select{font-size:16px !important}` 已蓋掉頁內所有 inline 13px 輸入框（NarrativePersonAdd/TokenListEditor/AddOptionChip 的 fs-13 因此不構成 iOS 縮放缺陷）；.tag-remove 28×28 是有註解的 WCAG 2.5.8 豁免。(3) 底部留白契約——--chrome-bottom：桌機48／≤820 100（styles.css:5364）／≤560 140（styles.mobile-fab-01.css:12-14），留言 FAB 避開分頁列與回饋 FAB（styles.css:3576-3580）。(4) 鍵盤契約——留言 sheet root `bottom: var(--kb-inset)`（styles.css:3515）＋ sheet max-height `min(85dvh,720px,100%)` 與 ≤560 `min(calc(100dvh-72px-safe),100%)` 雙保險（styles.css:3536、3588）；lib/keyboardInset.ts 有測試把關。(5) 捲動——scrollToSelector/scrollIntoViewForChrome 在手機（chrome>48）走「扣底欄、40% 拇指帶」定位並尊重 prefers-reduced-motion；TocNav 自帶 reducedMotion()；深連結 ?focus=scene-* 有輪詢等收合列可見的處理。(6) 橫向內容——html/body overflow-x:clip；.ctx-summary ≤560 橫捲、.ctx-summary--wrap 對「帶入列」特別改 wrap；wv-preview__pre 用 pre-wrap+overflow-wrap:anywhere+max-height 捲動（styles.css:5556-5568）；.table-scroll 供寬表。(7) hover——HelpTip 是點擊展開＋視窗邊緣 clamp（interactions.tsx:277-345），≤560 觸發鈕放大到 44×44（styles.css:5070-5074）；Shift+點設主要有「改主要」文字鈕 fallback（ProjectPage.tsx:1158-1181）；@media(hover:none) 已消 hover 黏滯。(8) 動效——全域 prefers-reduced-motion 0.001ms（styles.css:1392-1397）、sheet/nav 動畫只用 transform/opacity。(9) vh——body/sheet/modal 全面 dvh。
- creation-workbench 的手機基礎已相當完整，修補時應沿用而非重做：(1) 觸控與縮放——styles.css:935-938 於 ≤820px 給所有 button min-height:var(--touch-min)、input/textarea/select min-height 44 且 font-size:16px !important（壓過 inline 12-14px，防 iOS 聚焦縮放）；.chip.pick 44px 已拉到全站（styles.css:694），CreationContextBar 的 chip 都掛 pick。(2) 版面——≤920 模式分頁 2 欄（styles.css:4694）、≤560 強制 2×2 且 min-height 64（styles.css:5131-5147，有 mob03LongTaskCopy.test.ts 守衛）；confirm-actions ≤560 直排全寬 ≥44（styles.css:5151-5160）；「帶入：」列 .ctx-summary--wrap 刻意換行不橫捲（styles.css:5118-5125 QA 註解）；資源入口 [role=group] ≤560 橫捲（5162）；html/body overflow-x:clip 全站防橫向溢位（MOB-04 測試守衛）。PromptFlowMap 本來就是為手機設計的單欄直向流程、欄位 auto-fit minmax(130px,1fr)、長字串 overflowWrap:anywhere；JSON <pre> 皆 pre-wrap+break-word；AblationResultGrid 用 auto-fit minmax(140px,1fr)。(3) 底部 chrome 與鍵盤契約——--chrome-bottom 分級（≤820 有 .mobile-nav 100px、≤560 140px、表單展開 200px；styles.css:5364 + styles.mobile-fab-01.css:10-25）；--kb-inset 由 lib/keyboardInset.ts 在 main.tsx 安裝；.modal-scrim bottom:var(--kb-inset)（styles.css:1902）、≤560 modal 變貼底 sheet、圓角上緣、padding-bottom safe-area !important（1922-1938）；主路徑輸入（CreationGoalInput 兩型態、#gen-prompt）onFocus 走 focusAndReveal→scrollIntoViewForChrome（讀 --chrome-bottom/--safe-bottom/visualViewport，禁止寫死 px）。(4) 資源抽屜——inline maxHeight min(88dvh,100%)（100% 會吃到被 --kb-inset 抬高的 scrim，鍵盤下自動縮）、內部單一捲動區 + WebkitOverflowScrolling、tablist overflow-x auto、useFocusTrap（Esc + body scroll lock）＋ scrim 點擊＋ 44px 關閉鈕；GenerationList 關抽屜時仍隱藏掛載保輪詢。(5) 長任務——送出成功文案「已送出…可先離開這頁，完成會推播通知」＋「看進度」直達抽屜生成紀錄；confirm 面板 MOB-03「可關閉此頁，完成會推播到已連結裝置」（測試守衛）；收合狀態下標題列仍顯示 執行中/等待/待核准 Pills；輪詢 8s/45s 且 refetchIntervalInBackground 是 GenerationList 註解過的刻意設計（推進在伺服器 runner，輪詢只刷 UI）。(6) 動效——modal-sheet-in/fade-rise 只用 transform/opacity；styles.css:1392 全域 prefers-reduced-motion 幾乎歸零動畫；workbenchNav.scrollBehavior() 對 reduce 回 auto。(7) ＋請誰來幫忙選單走 MenuSurface，≤820 自動貼底 sheet（拖曳把手、scrim、safe-area、menu-item ≥48；styles.css:5400-5425），卡片 ≤640 min-height 108（4097-4102）。dvh 已全面採用，vh 殘留僅 AiTraceHistory 一處（見 findings）。
- 既有手機支援已相當完整，以下缺口以外的項目都已被涵蓋：(1) 全域觸控/輸入契約——styles.css:141-161 `--touch-min:44px` 對 button/.btn/.menu-item/input/textarea/select 全站生效；:883 起的 ≤820 區塊再以 `input, textarea, select { font-size: 16px !important }`（:938）防 iOS 聚焦縮放，連 DatabasesPage 兩個 inline fontSize:12 的匯入 textarea（DatabasesPage.tsx:612、936）都被 !important 蓋掉，故未列為缺陷；:5359 `touch-action: manipulation` 防雙擊縮放。(2) 版面契約——html overflow-x:clip（:210）、body 100vh→100dvh 漸進（:221-223）、safe-area 四向變數（:131-134）、`--chrome-bottom` 底部留白契約（:250-262；≤820 有 .mobile-nav 時 100px :5364；≤560 由 styles.mobile-fab-01.css 提到 140px）、`--kb-inset` 鍵盤契約用於固定面板與 FAB（:1971、:5431、mobile-fab-01:47）。(3) DatabasesPage——≤920 先縮側欄（:4693）、≤820 轉單欄主從：has-detail 隱藏側欄、非 detail 隱藏主欄、`.database-mobile-back` 返回鈕出現（:4718-4721、:2350-2355、:5012）；≤560 收斂 intro stats 並在 has-detail 時整個藏起（:5000-5011）；資料格線 table 已包 `overflowX:auto` 容器（DatabasesPage.tsx:778）、詳頁分頁列自帶 overflow-x:auto（:1177）、ConnectPanel 的 pre 有 overflow:auto、csv/ics 網址 code 有 word-break:break-all；欄位編輯列 .db-field-row 用 grid 固定四欄防「刪除鈕孤行」（:5295-5303）。(4) PlannerPage——ScheduleCard 用 useMatchMedia(≤820) 把六欄表單收成整寬「＋新增行程」鈕（PlannerPage.tsx:324、481-491）；.schedule-create-form 桌機 12 欄 grid、≤820 改 6 欄、≤560 全部單欄且 submit min-height 46（styles.css:3078-3093、4712-4717、4993-4998）；.planner-jump-grid ≤560 轉橫向 scroll-snap（:4972-4982）；月曆 .cal-cell 已有文件化的 min-width:0 豁免防 360px 溢位（:171-178）＋ ≤620 min-height 56（:1703）；知識地圖觸控時空白處保留頁面捲動（pointerType!==\"mouse\" 才平移，PlannerPage.tsx:1377）、滾輪縮放用非 passive 監聽、.map-node touch-action:none 讓手機可拖節點（:1713）；動效大多 transform/opacity 且全域有多個 prefers-reduced-motion 區塊（:247、:485、:1392 等）。兩頁自身皆無 fixed 底欄/sheet，鍵盤遮擋由整頁捲動與 --chrome-bottom 契約吸收。
- 此區的手機基礎相當完整，稽核時已排除下列「已被涵蓋」項目：(1) viewport meta（client/index.html:8）含 viewport-fit=cover 與 interactive-widget=resizes-content——Android 鍵盤自動縮版面，dvh/bottom:0 自然正確；iOS 缺口由 lib/keyboardInset.ts 寫入 --kb-inset 補。(2) 觸控下限：--touch-min:44px 全站生效（styles.css:141-161），button/.btn/.menu-item/input/textarea/select 都有 min-height，按鈕另有 min-width 44——所以 .dm-tools 的 chip 按鈕、msg-action 小叉、dm-back、送出鈕在手機都達標。(3) iOS 縮放防護：≤820 `input, textarea, select { font-size: 16px !important }`（styles.css:938），私訊輸入框、回饋表單全部吃到。(4) safe-area：--safe-* 變數（131-134）、.mobile-nav（≤820 底部分頁列，styles.css:5362-5394，safe-area 內距＋50px 觸控高）、standalone 模式 padding（2093-2098）。(5) 底部留白契約 --chrome-bottom（桌機48／≤820 100／≤560 140，styles.mobile-fab-01.css）與 --kb-inset 契約已接上 .modal-scrim、.fb-fab-root（含面板 max-height 扣鍵盤）、專案訊息 sheet，並由 styles.contract.test.ts 守護。(6) /chat 手機化：≤720 has-peer 單欄切換、dm-layout 用 dvh、氣泡 max-width 88%＋overflow-wrap:anywhere、附件 max-width min(260px,72vw)、≤560 dm-item 58px、dm-search 44px、拍照 capture=environment。(7) modal ≤560 變貼底抽屜、MenuSurface ≤820 變 bottom sheet（皆 dvh 上限＋overscroll contain）。(8) 動效：只用 transform/opacity，且 styles.css:1392 有 prefers-reduced-motion 全域 kill switch。(9) hover-only 無實質缺口：@media (hover:none) 重置 hover 樣式，chips 的 title 只是輔助、可見文字標籤都在。(10) FeedbackPage ≤560 評分 radio 5 欄格 42px＋secondary-filter-bar 轉 grid 全寬；FeedbackWidget FAB ≤560 icon-only 48×48，picker 支援觸控拖曳瞄準、提示列取消、touch-action:none、選後吞合成 click。表格/圖表在這四頁不存在（Community 的 prompt <pre> 已有 pre-wrap＋break-word＋內部捲動），無 overflow-x 缺口。
- 既有手機基礎相當完整，以下缺口以外的項目均已被涵蓋：(1) 版面——.cols 在 ≤860px 收單欄且 .cols>* { min-width:0 } 防 grid blowout（styles.css:757-761）；body overflow-x:clip（224）；.gen-row ≤560 收單欄（969）；.secondary-page 系列頁首在 ≤560 有專屬縮排版（4758-4811）。(2) 觸控——全站（不分裝置）button/.btn/.menu-item/input/select 44px min-height、button/.btn/.menu-item 另有 44px min-width（144-161），各頁 inline padding \"2px 10px\" 的小按鈕實際都被撐到 44px；/options 的上移/下移鈕在 ≤560 另補 min-width 44（4860-4861）。(3) iOS 防縮放——≤820 `input, textarea, select { font-size:16px !important }`（938），!important 蓋得過各頁 inline 12-14px 字級（AdminPage MemberNumberField、SettingsPage 等因此不觸發 iOS 聚焦縮放）。(4) safe-area／底部契約——--safe-* 變數（131-134）套用於 .app、sticky topbar、.mobile-nav、bottom sheets；--chrome-bottom 契約 48/100/140/200px 分級（250-263、5364、styles.mobile-fab-01.css）；--kb-inset 鍵盤契約套在 FAB 與各面板（1971、5431、mobile-fab 45-48）。(5) 高度單位——全面使用 dvh，未見裸 vh。(6) 動效——prefers-reduced-motion 全域 kill switch（1392-1397）。(7) 寬內容——ModelsPage 並排比較表（359）、風格 PK 表（1054）、熱力圖（.model-heatmap__scroll）、AdminPage/logs 洞察卡兩張表（1341、1411）、McpPage 設定 pre（241）都有 overflow-x:auto 容器；長字串普遍有 overflowWrap:anywhere／wordBreak:break-all。(8) 手機專屬版式——.mobile-nav 五格分頁列＋更多面板 bottom sheet（5362-5476）、選單改貼底 sheet、integration-status-grid／model-decision-tabs／support-topic-nav 在窄屏轉橫向捲動（4700-4708、4818-4855）、download-category-grid 收單欄（4857）。(9) HelpPage Faq summary 自帶 44px；ConsumptionMonitorCard summary 已修 WebKit 點不動問題。(10) hover——touch-action:manipulation＋tap-highlight 清除（5357-5359），無「hover 才出現的操作鈕」；title 提示僅剩輔助性（見 P2 findings）。ShareTargetPage、SettingsPage、MyReportsPage、HelpPage、/options（GroupOptionsEditor）、/logs（GroupQuotaSettings）逐項檢查後未發現真缺口。
- 【(a) 斷點盤點】主梯二階：≤820px「手機 App 殼層 v2」（styles.css:5362 起：.mobile-nav 底部五格分頁列、topbar 橫向捲動＋safe-area(900-921)、input/textarea/select 16px !important 防 iOS 縮放(938)、MenuSurface 選單 sheet 化(5396-5425)、更多面板 sheet(5433-5476)、.app:has(.mobile-nav) --chrome-bottom:100px(5364)）與 ≤560px「手機」（953、1922 modal 轉貼底 sheet、2326、4758、5645 等：單欄化、橫捲卡帶、44px 補強）。桌機側：≥821(279)、821-1100(297/641)、≥1200(647/1993/4682)、≥1400(197/1996)、≥1680(200)。元件級散梯：860(758 .cols)、900(5287 scene-studio)、920(4690)、880(6536)、768(6275 三幕)、720(1882 dm/2794)、640(2651/2687/4096)、620(1672/1702 月曆)、520(6143)、480(6316)。功能查詢：hover:hover+pointer:fine(226)、hover:none(675/2002)、prefers-reduced-motion×6（含 1392 全域關動效）、display-mode:window-controls-overlay(2099)。styles.mobile-fab-01.css 補 ≤560（--chrome-bottom 140/200、FAB icon-only、面板扣 --kb-inset）與 561-820（表單開啟 160）。360-430px 全落在 ≤560 梯內，無更窄專屬梯（320 未特別處理）。【(c) 寫死 px 統計】width:Npx 共 70 處，≥100px 僅 3 處且皆安全（478 login-card 400px 有 max-width:92vw、2180 landing 裝飾圓 220px、3229 database-welcome 視覺 150px）；min-width ≥100px 者：.menu 184(812)、.mention-pop 180(1469)、.table-scroll table 560px(1953) 與 .model-heatmap__table 640px(4423) 皆包在 overflow-x:auto 容器；手機橫捲卡帶的 flex:none 卡寬（145-230px，integration 230/decision-tab 190/status 145/planner-jump 210）是刻意的 scroll-snap 設計。無未防護大寬度直接撐破 360px。【(d) hover-only 清單】唯一功能性 hover 顯示是 .launch-cover__swap（671 opacity:0→hover），已由 675 行 @media(hover:none){opacity:1} 補救；其餘約 90 處 :hover 全是裝飾強化（邊框/陰影/位移），2002-2007 另有 hover:none 黏滯態重置。無殘留手機失效的 hover 功能。【(e) vh 使用處】222（100vh＋100dvh 後備，正確）、1210（.toc-rail 桌機限高，≤820 已 max-height:none）、6387（new-project-modal 90vh——已列 findings）；其餘全站一律 dvh 且知道「iOS dvh 不隨鍵盤縮」要顯式扣 --kb-inset（1986-1990、3533-3536、3585-3588 有註解＋實作，keyboardInset.test.ts 有測試護欄）。【(f) safe-area 現況】token 化（131-134 --safe-*）且覆蓋完整：.app 四邊(259-263)、≤820 topbar(908-912)、standalone PWA(2092-2098)、modal-scrim(1906-1910)、≤560 modal-card 底部(1936)、fb-fab-root(1968-1978)、project-messages-fab/sheet(3470-3593)、mobile-nav(5370)、menu/more sheet(5413/5444)、dm-layout 高度扣除(1884/5033)。僅 .skip-link(2110-2115 fixed top:8px 無 safe-top，focus 才現形) 與 new-project-modal（findings）未接。【其他既有手機基礎（勿重複修）】全域 44px 觸控下限含寬度（146-161），豁免皆有文件化理由（.tag-remove 28px、.cal-cell、行內 .btn-ghost、team-commander 行內鈕）；--chrome-bottom 底部留白契約 48→100→140→200 四階（254 註解＋mobile-fab-01 分工）；grid 防爆（761 .cols>*{min-width:0}、全站 minmax(0,1fr)）；touch-action:manipulation＋tap-highlight 移除（5357-5360）；launch-list 桌機列表已由 JS isDesktop≥821 閘控（Launchpad.tsx:35-42/771）不會在手機出現；splash.css 手機相容（88vw、reduced-motion 有靜態版）。
- 效能基線與既有手機支援（皆已到位、勿當缺陷回報）：(1) Route splitting 健全——AppRoutes.tsx:11-30 共 20 個頁面全走 lazyWithRetry（重試一次→chunk 錯誤繞快取重載一次→交給 ErrorBoundary，含 sessionStorage 冷卻防無限重整）；vite.config.ts:22-26 manualChunks 拆 vendor-react（184K/gz56K）與 vendor-data（168K/gz45K），首屏 JS 為 index 328K(gz100K)+兩支 vendor，合計約 200KB gz，屬合理範圍。(2) 重依賴治理良好——html2canvas-pro（244K chunk）只在回饋截圖時 `await import("html2canvas-pro")`（feedback/picker.ts:436）動態載入；@huggingface/tokenizers、clip-bpe-js、mammoth、pdf-parse 全部只在 server 端使用，未進 client bundle。(3) 字體策略——@fontsource 自架（CSP 考量），CJK 用可變字型＋unicode-range 105 分包按需下載（避免六種字重×整套中文字六倍下載），IBM Plex Mono 只載 latin 400/600 約 30KB；缺口只在「宣告全部擠進 blocking CSS」與「serif 全域載入」（見 findings）。(4) 首屏——index.html 有 inline『載入中…』splash（100vh+100dvh 雙寫、底色與 --bg 一致防白閃）、viewport-fit=cover、interactive-widget=resizes-content（Safari 缺口由 keyboardInset.ts 的 visualViewport 補 --kb-inset，main.tsx:21 全生命週期安裝）。(5) 手機基礎完整——styles.css:2126 起 .mobile-nav（≤820px 底部分頁列）、--chrome-bottom 契約（≤820=100px、≤560=140px、表單展開 200px，styles.mobile-fab-01.css）、--touch-min:44px（styles.css:141）、≤560px input 強制 font-size:16px !important 防 iOS 聚焦縮放（styles.css:937-938）、body overflow-x:clip（styles.css:224）擋橫向溢位、safe-area-inset 九處、dvh 為主且 iOS 鍵盤場景顯式扣 --kb-inset（styles.css:1989、mobile-fab-01.css:47）、prefers-reduced-motion 五處全域停用動效、background-attachment:fixed 只在 (hover:hover) and (pointer:fine) 桌面啟用。(6) gallery.tsx/gallery.html 為開發用展示頁，vite build input 僅 client/index.html，不進正式包（dist 無對應產物），其 minWidth:190 標籤欄等桌面式排版對行動端零影響，不構成缺陷。
- PWA 驗收四項全部已有實作，品質高於一般水準。(1) 離線 shell：sw.js 完整——precache 殼資產（sw.js:17-22）、導航 network-first→offline.html（:97-104）、/assets cache-first（:106-117）、manifest network-first 防舊圖示卡死（:121-132）、品牌資產 stale-while-revalidate 且背景更新掛 waitUntil（:140-156）、API/ws/trpc 永不攔截（:56-58）；另有 Web Share Target 收件（:65-93，SHARE_CACHE 不掛版號防 SW 換版丟檔）、push 顯示通知（:160-170）、notificationclick 聚焦既有視窗＋postMessage fallback（:172-189，AppShell.tsx:172-188 有對應 aios:navigate 監聽並擋 // 開頭路徑）、pushsubscriptionchange 自動重訂閱上報 /api/trpc/push.sync（:191-203，server/trpc.ts 有對應端點）。(2) 更新提示 UI：不自動 skipWaiting（sw.js:28）；pwa.ts waiting→使用者按「更新」→SKIP_WAITING→controllerchange 才 reload（pwa.ts:96-125、151-157），首次安裝不誤刷新；AppUpdateBanner 掛在 AppShell:251（登入前後皆渲染），role=status aria-live=polite，手機 ≤560 收斂樣式且按鈕守 --touch-min（styles.css:4879-4892）。(3) 安裝引導：beforeinstallprompt 捕捉＋deferred prompt（pwa.ts:138-142）、InstallAppBanner（Launchpad:399、LoginPage:197）帶 14 天 dismiss（pwa.ts:42-53）、AccountMenu 常駐「安裝成 App」入口不吃 dismiss（AccountMenu.tsx:52-70）。(4) iOS 引導：InstallAppBanner 內建 Safari 四步驟清單＋/help#help-install 連結（InstallAppBanner.tsx:26-38）；AccountMenu 在 iOS 改導說明頁（AccountMenu.tsx:60-63）；push.ts 對「iOS 未加入主畫面」丟人話錯誤（push.ts:154-159）；iPadOS UA 偽裝 Mac 有觸控點補判（pwa.ts:36-40）。index.html 亦齊：viewport-fit=cover＋interactive-widget=resizes-content、apple-touch-icon、theme-color、manifest 連結（index.html:8-24）。手機基礎：--touch-min 44px 全站生效含 min-width（styles.css:141-160）；≤820 輸入框 16px !important 防 iOS 聚焦縮放（:938）；safe-area 套滿 .app/.topbar/.mobile-nav/FAB/offline.html（offline.html:10 亦有）；--chrome-bottom 分級契約 48/100/140/200（styles.css:250-263、5364；styles.mobile-fab-01.css:10-20）且有 styles.contract.test.ts 守護；--kb-inset 契約（lib/keyboardInset.ts）套用於貼底面板與 sheet（styles.css:1902、1989、3515；mobile-fab-01:47）；dvh 皆有 vh fallback（styles.css:222-223）或顯式扣 kb-inset；prefers-reduced-motion 全域 kill（:1392-1397）＋pill-pulse/mobile-nav 縮放動畫個別停用（:5482-5484）；(hover:none) 重置黏 hover（:2002-2007）。UI 基元無障礙抽查：focus ring 統一 2px var(--primary)＋offset 覆蓋 button/a/select/summary/.chip/.badge/[role=button]/[role=radio]（styles.css:862-868）；Chip 給 onClick 即自動 role=button/tabIndex/Enter+Space 鍵盤啟動，aria-pressed 只在 togglable 且 role=button 時輸出、支援呼叫端覆寫 role（Chip.tsx:46-80），.chip.pick 有 44px 下限（styles.css:694）且合成鍵盤事件保留 shiftKey（全站無呼叫端讀 currentTarget，無 crash 風險）；Hint 精簡模式收合鈕有 aria-expanded/aria-controls、可見文字「說明」含入 aria-label（WCAG 2.5.3）、44×44 下限（Hint.tsx:80-91、styles.css:772-786）；Skeleton 預設 aria-hidden、呼叫端給 role/aria-label 時自動讓位（Skeleton.tsx:30-34）；文字對比在 tokens 層全數校過 AA（styles.css:40-45、63-72 註解含實測比值）；.sr-only 工具類存在（:949）。

## P0 — 破版/不可用（1 項）

- [x] **P0-01** done(PR#462)｜`client/src/pages/ChatPage.tsx:513`｜overflow-clipping/popover｜/chat
  - 問題：≤560px 手機上「標注」picker 被 .dm-tools 的橫向捲動容器整個裁掉，功能完全打不開。
  - 修法：≤560px 把 dm-ref-pop 改成 portal 到 body 的貼底 sheet（沿用 .menu-surface.is-sheet 語彙）或 position:fixed 定位，別留在 overflow-x:auto 的 .dm-tools 內。
  - 驗證註記：逐項核實：(1) ChatPage.tsx:507-513 屬實——picker 以 inline 方式渲染在 .dm-tools 內的 position:relative span 中，全檔無 createPortal/is-sheet；(2) styles.css:1468 .mention-pop 為 absolute + bottom:calc(100%+6px) 向上展開，屬實；(3) styles.css:5044 確在 4758 行起的 @media (max-width:560px) 區塊內，.dm-tools 設 overflow-x:auto——依 CSS Overflow 規範 overflow-y 隨之計算為 auto，.dm-tools 成為雙軸裁切的捲動容器；panel 的 containing block（該 span）在 .dm-tools 內，故被裁切，且上方負溢位區不可捲達（.dm-tools padding-top 8px、panel 底緣在 span 頂上 6px，最多殘留約 2px 細條）。(4) 無任何緩解：styles.css 中 .dm-tools/.dm-ref-pop/.mention-pop 規則僅 1859-1874、5044-5046，styles.mobile-fab-01.css 零匹配，.mobile-nav/--chrome-bottom/--kb-inset 區塊皆未觸及；z-index:12 無法逃脫祖先 overflow 裁切。嚴重度未誇大：≤560px 按鈕可切換狀態但面板不可見不可點，標注功能在手機上完全不可用。

## P1 — 可用但明顯難用（19 項）

- [x] **P1-01** done(PR#465)｜`client/src/app/components/MobileNavigation.tsx:104`｜navigation-full-reload｜所有已登入路由（≤820px 底部分頁列）
  - 問題：底部分頁列「專案」「AI 工作」兩顆用原生 <a> 帶 hash，從 /planner、/p/:id、/chat 等非 /dashboard 路由點擊會觸發整頁重載（重跑 bootstrap、重載所有 chunk），手機弱網下每次切分頁要等數秒。
  - 修法：改用 onClick 攔截：e.preventDefault() 後以 wouter navigate 到 /dashboard 再設 location.hash（或 navigate("/dashboard#projects") 由 wouter pushState），保留 <a> 語義但走 SPA 路由。
- [x] **P1-02** done(PR#463)｜`client/src/styles.css:966`｜input-zoom｜所有已登入路由（≤560px 頂欄組別切換器）
  - 問題：≤560px 把 .group-select 字級降到 14px !important，特異性 (0,1,0) 蓋過同為 !important 的 select 16px 防縮放契約，iPhone Safari 點組別切換器會強制放大整頁且不回彈——違反本檔 936-937 行自己寫明的規則。
  - 修法：≤560 保持 font-size 16px，改用縮 padding-inline 與 max-width 換取頂欄空間。
- [x] **P1-03** done(PR#464)｜`client/src/pages/Launchpad.tsx:435`｜keyboard/viewport｜/
  - 問題：「建立新專案」Modal 未走站內既有的 .modal-scrim/.modal-card 手機契約：置中卡片 max-height 90vh（vh 非 dvh）、backdrop 未被 --kb-inset 抬高、無 ≤560 貼底 sheet，而 #np-title 又 autoFocus 直接彈鍵盤——iOS 上表單下半（畫面尺寸、立即建立鈕）被鍵盤蓋住且捲不到，得先收鍵盤才按得到。
  - 修法：把 new-project-modal 改用（或比照）.modal-scrim/.modal-card 契約：backdrop 加 bottom: var(--kb-inset,0px) 與 overscroll-behavior:contain，卡片改 max-height:min(86dvh,100%)，≤560 轉貼底 sheet 並 padding-bottom:max(16px,var(--safe-bottom))。
- [x] **P1-04** done(PR#463)｜`client/src/styles.css:2349`｜hidden-on-mobile｜/
  - 問題：≤560px 用 `.continue-card .chip { display:none }` 把「N 待處理」角標整顆藏掉，而首頁的待核提示卡（focusState attention）只在沒有最近專案時才渲染——手機上有專案的組長在首頁完全看不到任何待核計數，正是程式註解自己點名的「首頁不顯示待核→組長漏核、組員卡住」情境。
  - 修法：手機別整顆藏：改成縮小版（小圓點或純數字 badge，例如 .continue-card .chip { padding:2px 6px; font-size:10px }），或在手機版 bento 頭部補一行「N 件待核」總計連結。
- [x] **P1-05** done(PR#466)｜`client/src/pages/ProjectPage.tsx:2172`｜fixed-element/底部遮擋｜/projects/:id（① 定調・角色與定裝分頁）
  - 問題：「回到創作台／回到分鏡」的 context-return-bar 用 position:sticky; bottom:0，在 ≤820px 會整條黏進固定底部分頁列（.mobile-nav，fixed bottom:0 z-44）底下，捲動途中看不到也點不到，sticky 常駐 CTA 的目的在手機完全失效。
  - 修法：手機給 bottom: calc(64px + max(8px, var(--safe-bottom)))（或抽成 CSS class 讀 --chrome-bottom 相關變數），讓 sticky 落點浮在分頁列之上。
- [x] **P1-06** done(PR#466)｜`client/src/pages/ProjectPage.tsx:211`｜sticky-header/錨點落點｜/projects/:id（TocNav ①②③ 階段列）
  - 問題：StageHead 的 inline scrollMarginTop 16px 蓋掉 styles.css 給 #stage-context/#stage-create/#stage-deliver 的 scroll-margin 契約（~64px+），而 ≤820 的 96px 加高清單也漏掉三個 stage id——手機點 TocNav 階段丸（block:"start"）後，階段標頭被 sticky 頂欄（52-56px）＋常駐 toc-rail（~46px）疊起來的 ~100px 蓋住，落點像跳錯位置。
  - 修法：拿掉 StageHead 的 inline scrollMarginTop，並把三個 stage id 加進 ≤820 的 96px scroll-margin 清單。
- [x] **P1-07** done(PR#466)｜`client/src/pages/ProjectPage.tsx:324`｜橫向溢位｜/projects/:id（① 定調・進階「參考連結」）
  - 問題：TokenListEditor 的 chip 沒有 max-width／overflow-wrap，參考連結是最長 100 字的無空白 URL，360px 下一顆 chip 可寬達 ~600px；html 的 overflow-x:clip 讓頁面不能橫捲，chip 尾端的移除 ✕ 被裁在畫面外，手機上該連結永遠刪不掉。
  - 修法：給 chip 補 max-width:100% 與 overflow-wrap:anywhere（或 URL 顯示截斷＋title 全文），確保 ✕ 留在可視範圍。
- [x] **P1-08** done(PR#463)｜`client/src/styles.css:2096`｜chrome-bottom 契約破口｜/projects/:id（③ 交付底部；影響所有頁）
  - 問題：安裝為 PWA（html.is-standalone）時 `.app` 的 padding-bottom 被寫死 48px+safe，特異性 (0,2,1) 蓋過 --chrome-bottom 契約的 100px/140px——手機 standalone 下固定分頁列（~64-72px）會壓住頁面最底一截（專案頁＝③ 打包／SceneList 尾端），最後一列內容捲不上來。
  - 修法：standalone 規則改寫 padding-bottom: calc(var(--chrome-bottom) + env(safe-area-inset-bottom, 0px))，回歸變數契約。
- [x] **P1-09** done(PR#466)｜`client/src/features/creation-workbench/modes/DirectGenerateMode.tsx:474`｜viewport-visibility｜/p/:id（專案頁 ② AI 創作工作台・直接出圖）
  - 問題：按「生成」後確認面板只在按鈕下方 inline 展開，未捲動也未移焦，手機上按鈕常位於視窗底部，整個 confirm-panel 落在摺線以下，看起來像按了沒反應。
  - 修法：setConfirming(true) 後 requestAnimationFrame 用既有 scrollIntoViewForChrome 捲到 .confirm-panel（或把焦點移到「確認生成」鈕），沿用 --chrome-bottom 契約。
- [x] **P1-10** done(PR#467)｜`client/src/pages/PlannerPage.tsx:695`｜觸控互動｜/planner
  - 問題：月曆任一日期格點擊必觸發 prefillFromDay：展開新增表單、smooth 捲到表單並在 280ms 後聚焦標題——手機上想「看某天的行程」會被表單搶走視角（當日清單其實渲染在月曆下方，使用者卻被捲到上方表單），Android 還會彈出鍵盤。
  - 修法：compact（≤820）時，有行程的日子第一次點擊只 setSelectedKey 展開當日清單並捲到清單；新增改由空白日點擊或另一顆明確的「＋在這天新增」觸發。
- [x] **P1-11** done(PR#467)｜`client/src/pages/PlannerPage.tsx:1232`｜觸控目標/可讀性｜/planner
  - 問題：知識地圖 SVG 固定 viewBox 920×560、CSS 只有 width:100% 等比縮放且無任何手機斷點：360px 時整圖縮到約 0.36 倍，葉節點命中區只剩 r=6 的圓（渲染後約 4–5px、文字 pointer-events:none 不算命中），節點文字 11–13px 縮成約 4px，觸控幾乎點不到也讀不到；內建縮放上限 2.5x 仍不足 44px。
  - 修法：≤820 給地圖獨立幾何：加一顆透明命中圓（r≈20）擴大觸控區，並讓 .map-wrap 改成固定較大像素寬＋overflow-x auto（或手機預設 view.s 放大）。
- [x] **P1-12** done(PR#463)｜`client/src/pages/DatabasesPage.tsx:1433`｜觸控目標｜/databases
  - 問題：`<a className="btn-sm">`（檔案列的 icon-only「下載原檔」與工具列「匯出 CSV」）缺 `btn` 基底 class，吃不到全域 44px 觸控下限（該規則只涵蓋 button/.btn/.menu-item），實際命中區約 37×27px，且夾在一排 44px 按鈕之間極易誤觸鄰鈕。
  - 修法：改用 `<Button as="a" size="sm">`（會補上 `btn` 基底）或在 className 加上 `btn`。
- [x] **P1-13** done(PR#462)｜`client/src/styles.css:5036`｜keyboard｜/chat
  - 問題：私訊輸入列未接 --kb-inset 契約：iOS 鍵盤彈出時 .dm-layout 仍按 100dvh 定高（iOS 的 dvh 不隨鍵盤縮），輸入列與最新訊息被鍵盤蓋住、只靠 Safari 自動捲動勉強補救。
  - 修法：比照 .project-messages-sheet-root，讓 .chat-page.has-peer .dm-layout 高度再扣 var(--kb-inset, 0px)（Android 因 interactive-widget=resizes-content 會算出 0，不重複位移）。
- [x] **P1-14** done(PR#463)｜`client/src/pages/MembersPage.tsx:292`｜touch-target｜/members
  - 問題：成員卡的「私訊」連結實高約 29px（<44px）：它是 <a class="btn-tonal btn-sm">，不在全域觸控下限選擇器（button/.btn/.menu-item）的涵蓋範圍。
  - 修法：className 加上 btn 基底（"btn btn-tonal btn-sm"），或把 .btn-tonal 納入 styles.css:146 的觸控下限選擇器群。
- [x] **P1-15** done(PR#467)｜`client/src/pages/ModelsPage.tsx:341`｜sticky-overlap｜/models
  - 問題：並排比較卡 sticky top 8px 未讓出手機 sticky 頂欄（~52px+safe-top）且與其同 z-index 30，DOM 較後者蓋住頂欄；且整張含 16 列比較表的卡在手機上釘住後可佔掉近整個視口，目錄內容被壓在下面難以瀏覽。
  - 修法：≤820px 改 top: calc(52px + var(--safe-top)) 並給卡 max-height（如 40dvh 內部捲動）或手機改為可收合的置頂摘要列。
- [x] **P1-16** done(PR#463)｜`client/src/styles.css:966`｜ios-zoom｜全站（頂欄組別切換器 .group-select）
  - 問題：≤560px 對 .group-select 寫 font-size:14px !important，特異性(0,1,0)壓過 938 行 select 的 16px !important 防縮放契約，iPhone Safari 聚焦 <16px 的 select 會放大整頁且不回彈。
  - 修法：刪除 966 行的 font-size 宣告（或改 16px），視覺收斂改用 padding-inline 與 max-width。
- [x] **P1-17** done(PR#464)｜`client/src/styles.css:6387`｜keyboard-overlap｜作業台 /launchpad 與 /workflows「建立專案」彈窗
  - 問題：新專案彈窗未走既有 .modal-scrim/.modal-card 契約：90vh（非 dvh）置中卡、backdrop padding 無 safe-area、完全沒接 --kb-inset，手機鍵盤彈出時表單欄位與送出鈕被蓋，且 90vh(=大視口) 在 iOS 工具列展開時超出可視高。
  - 修法：改掛 .modal-scrim/.modal-card（自動獲得 ≤560 貼底 sheet＋kb-inset＋safe-area），或把 max-height 改 min(90dvh, calc(100dvh - var(--kb-inset,0px) - 32px)) 並在 backdrop padding 套 max(20px, var(--safe-*))。
- [x] **P1-18** done(PR#468)｜`client/src/brand.ts:30`｜圖片格式與尺寸／LCP｜全站（AppHeader 頂欄，priority 載入）＋ /login hero ＋ / landing
  - 問題：首屏品牌 logo 用 524KB 的 @2x PNG（1440×632）渲染頂欄 26px 高的位置，且 ≤560px 手機上該 img 被 CSS 藏起後仍照樣下載，再疊加 132KB 的 512px mark PNG——每個手機首屏白吃約 650KB 圖片頻寬，直接搶 LCP。
  - 修法：產出貼合顯示尺寸的 WebP/AVIF 變體（頂欄 ~264×116、hero ~330×145 的 1x/2x，各約 5–20KB），responsive 模式改用 <picture media> 或 matchMedia 條件渲染，讓手機根本不輸出隱藏的 full-img。
- [x] **P1-19** done(PR#468)｜`client/src/styles.css:25`｜字體子集化／首屏 blocking CSS｜全站首屏（單一 render-blocking CSS bundle）
  - 問題：styles.css 頂端 @import 兩套 CJK 可變字型的 fontsource index.css，build 後全部併進唯一一支 render-blocking CSS——400KB（gzip 118KB）、內含 215 條 unicode-range @font-face 宣告，手機 4G 上 FCP/LCP 都要等它下載完。
  - 修法：把兩套 CJK @font-face 宣告抽成獨立非阻塞樣式表（media=print onload 或 build 後注入 preload+async），首屏先走既有 system-ui fallback 堆疊，font-display:swap 接手換字。

## P2 — 打磨（49 項）

- [x] **P2-01** done(PR#463)｜`client/src/styles.css:2357`｜horizontal-overflow｜所有已登入路由（≤560px 頂欄，360px 最窄機型）
  - 問題：≤560px 用 overflow: visible 蓋掉 ≤820 的 overflow-x: auto 橫捲逃生門，但頂欄仍 flex-wrap: nowrap 且徽章皆 flex: none；360px 上「在線＋待核徽章＋點數徽章」同時在場時總寬約 363-370px，超出部分被 html/body 的 overflow-x: clip（205-224 行）直接裁掉、右端帳號鈕被切角且捲不到。
  - 修法：≤560 改回 overflow-x: auto（MenuSurface 已 portal 到 body 不會被裁），或在 ≤400px 再壓縮 points-badge / 待核徽章寬度確保總和 <360。
- [x] **P2-02** done(PR#463)｜`client/src/pages/AcceptInvitePage.tsx:35`｜viewport-units｜/invite/:token
  - 問題：邀請頁置中容器用 70vh 而非 dvh（全站其他處已統一 dvh），手機瀏覽器網址列在場時實際可視高度小於 vh，卡片垂直位置偏下並多出些微捲動。
  - 修法：改為 minHeight: "70dvh"（或比照 LoginPage 的 calc(100dvh - N)）。
- [x] **P2-03** done(PR#463)｜`client/src/styles.css:2151`｜touch-target｜/（Landing，561–820px 直立平板）
  - 問題：公開站頂欄的「運作方式」「安全與掌控」錨點連結沒有 min-height（14px 字高＝點擊面積約 20px 高），561–820px 觸控平板上可見但難點；全域 44px 下限只涵蓋 button/.btn/.menu-item（146-161 行），不含裸 <a>，≤560 才 display:none。
  - 修法：補 `.public-header nav > a:not(.btn) { min-height: 44px; display: inline-flex; align-items: center; }`（比照 2238 行 .public-footer a 的做法）。
- [ ] **P2-04**｜`client/src/app/components/MobileNavigation.tsx:67`｜sheet-gesture｜所有已登入路由（≤820px 帳號選單 sheet／更多面板）
  - 問題：更多面板與 MenuSurface sheet 都畫了拖曳把手（grip）暗示可下滑關閉，但 app/ 目錄內完全沒有 touch/pointer 手勢處理，實際只能點 scrim、X 或 Esc 關閉——視覺承諾與行為不符。
  - 修法：在 sheet 上加最小 swipe-down dismiss（pointerdown/move 位移超過閾值即 onClose），或移除把手視覺避免誤導。
- [x] **P2-05** done(PR#463)｜`client/src/styles.css:2141`｜safe-area｜/（Landing，standalone PWA＋瀏海機）
  - 問題：登入頂欄 .topbar 在 standalone 有 safe-top 墊高（2098 行），但公開站的 .public-header 同為 sticky top:0 卻沒有對應規則——已安裝 App 內 session 過期落回 Landing 時，捲動後 header 會滑進狀態列／瀏海底下。
  - 修法：補 `html.is-standalone .public-header { padding-top: max(12px, var(--safe-top)); }`。
- [x] **P2-06** done(PR#464)｜`client/src/pages/Launchpad.tsx:606`｜touch/invalid-nesting｜/
  - 問題：「N 待處理」的 Link 巢在 continue-card 的 Link 裡（a 包 a，HTML 不合法）；點擊事件冒泡到外層 Link 後外層的 navigate 最後執行，`?focus=pending` 深連結被吃掉——在 561-820px 平板（chip 可見）點角標等於點整張卡。
  - 修法：內層改為 onClick={(e)=>e.stopPropagation()} 並移出巢狀（用 span+onClick navigate），或乾脆把角標做成純 Chip、讓整卡連結帶 ?focus=pending。
- [x] **P2-07** done(PR#463)｜`client/src/pages/Launchpad.tsx:570`｜touch-target｜/
  - 問題：「繼續創作」bento 頭部的「全部專案 (N) →」是 12px 純文字 <a>，實際點擊高度約 17px，遠低於全站 --touch-min 44px（<a> 不吃全域 button 下限）。
  - 修法：比照 styles.css:2305，給 .bento-card__head a 補 min-height: var(--touch-min); display:inline-flex; align-items:center。
- [x] **P2-08** done(PR#469)｜`client/src/pages/Launchpad.tsx:711`｜touch-target｜/
  - 問題：「顯示已封存」是 16px checkbox＋文字的 inline-flex label，實際點擊高度約 24px；checkbox 型輸入被全域 44px 下限刻意豁免，label 本身也沒補下限。
  - 修法：label 補 minHeight: "var(--touch-min)"（維持 inline-flex 置中即可，不動 checkbox 本體）。
- [x] **P2-09** done(PR#469)｜`client/src/pages/Launchpad.tsx:759`｜touch-target｜/
  - 問題：空狀態的「看怎麼用」（14px 文字 Link）是獨立操作目標而非句中行內連結，點擊高度約 21px；同樣寫法出現在 FirstRunGuide.tsx:87（「看怎麼用」）與 AddOptionInline.tsx:108（「整理全部選項」，12px）。
  - 修法：獨立動作連結統一補 minHeight: "var(--touch-min)"（inline-flex 置中），或改用 Button as="a" variant="ghost"。
- [x] **P2-10** done(PR#469)｜`client/src/styles.css:1548`｜觸控目標｜/projects/:id（定調中心子分頁）
  - 問題：.tone-studio-tab 自設 min-height:40px，class 特異性蓋過全站 button ≥44px 契約，手機主要分頁切換鈕矮於 44px 觸控下限。
  - 修法：改 min-height: var(--touch-min)（44px），padding 可維持不變。
- [x] **P2-11** done(PR#469)｜`client/src/pages/ProjectPage.tsx:1309`｜觸控目標｜/projects/:id（hero 協作在場區）
  - 問題：展開後的成員 chip 是 span role="button"（點擊切換鏡像跟隨），inline style 12px 字＋2px 直向 padding 實高僅 ~24px；「N 人在線」chip 也被 .project-presence-chip 壓到 32px——皆為手機專屬控件卻低於 44px 下限。
  - 修法：兩者補 min-height: var(--touch-min) 並用 inline-flex 置中（比照 .chip.pick 的做法）。
- [ ] **P2-12**｜`client/src/pages/ProjectPage.tsx:1634`｜鍵盤遮擋＋reduced-motion｜/projects/:id（去填一句話／用這個提示詞）
  - 問題：多處直接 el.focus()＋scrollIntoView({behavior:"smooth", block:"center"})（wv-logline、gen-prompt、sec-characters），繞過專案自建的 focusAndReveal/scrollToSelector：block:center 以 layout viewport 置中，iOS 鍵盤彈出時欄位可能落在鍵盤下；且顯式 smooth 無視 prefers-reduced-motion（CSS scroll-behavior:auto 蓋不掉 JS 顯式參數）。
  - 修法：輸入框聚焦一律改用 focusAndReveal，純捲動改 scrollToSelector（兩者已內建 reduce 與 --chrome-bottom/鍵盤補償）。
- [x] **P2-13** done(PR#470)｜`client/src/styles.css:3558`｜巢狀捲動｜/projects/:id（留言 bottom sheet）
  - 問題：.project-messages-sheet__body 缺 overscroll-behavior:contain——留言清單捲到頂/底時捲動鏈到背後的長專案頁，關掉 sheet 後頁面位置已飄走（同站的 .mobile-more-sheet、.modal-scrim 都有 contain，唯獨這裡漏掉）。
  - 修法：在 .project-messages-sheet__body 加 overscroll-behavior: contain。
- [x] **P2-14** done(PR#470)｜`client/src/styles.css:1537`｜橫向捲動可發現性｜/projects/:id（定調中心子分頁）
  - 問題：tone-studio-nav 四顆 nowrap 分頁在 360px 總寬約 480-520px，overflow-x:auto 但 scrollbar 隱藏、無漸層提示——「知識與素材」被切半、「回收桶」完全在畫面外，新手不易發現可橫滑（repo 自己在 .ctx-summary--wrap 注解就點名這種切邊看起來像壞掉）。
  - 修法：≤560px 改 2×2 grid（比照 .creation-mode-tabs 的 MOB-03 處理）或加右緣漸層淡出提示。
- [x] **P2-15** done(PR#469)｜`client/src/pages/ProjectPage.tsx:2345`｜觸控目標｜/projects/:id（③ 交付一行導引）
  - 問題：手機專屬的「做好可打包 zip 交付」是 <p role="button">，fs-12＋padding 5px 0 實高約 28px，不吃全域 button 44px 規則，低於觸控下限。
  - 修法：補 min-height: var(--touch-min) 與 display:flex 對齊（或改用 Button variant=ghost）。
- [ ] **P2-16**｜`client/src/features/creation-workbench/AiTraceHistory.tsx:29`｜vh-dvh-overlay｜/p/:id（工作台標題列「實際運作紀錄」浮層）
  - 問題：紀錄浮層用 70vh（非 dvh）且 zIndex 20 低於 .mobile-nav 的 44，手機上面板底緣被固定分頁列蓋住，最後幾列與內部捲動的下緣看不見；也沒有 scrim 或面板內關閉鈕。
  - 修法：maxHeight 改 min(70dvh, calc(100dvh - var(--chrome-bottom)))、zIndex 提到分頁列之上（或 ≤820 改走 MenuSurface 貼底 sheet），並在面板內補關閉鈕。
- [ ] **P2-17**｜`client/src/features/creation-workbench/GenerationSourcePicker.tsx:158`｜keyboard-inset｜/p/:id（直接出圖・進階設定來源欄）
  - 問題：「雲端／公開網址」input 未接 focusAndReveal，鍵盤契約只覆蓋主路徑輸入；同樣缺席的還有 KnowledgeSourceStrip.tsx:84 的搜尋框與 AiUnderstandingPanel.tsx:311/313 的覆寫 textarea，聚焦時可能停在固定底欄／鍵盤正下方。
  - 修法：這三處輸入補上 onFocus={(e) => focusAndReveal(e.currentTarget)}，與 --chrome-bottom/--kb-inset 契約對齊。
- [ ] **P2-18**｜`client/src/features/creation-workbench/PromptTokenMap.tsx:33`｜hover-only｜/p/:id（AI 怎麼理解・逐詞佔用圖）
  - 問題：ChunkPill 的補充資訊（第幾格起、「在窗口之外」「詞表裡沒有這些字」全文說明）只放在 title 屬性，手機無 hover 完全看不到；刪除線與「未知」小標雖有視覺提示，但語意解釋觸控裝置不可達。
  - 修法：改成點按顯示（popover / 展開列）或把關鍵語句移進下方既有的 Meta 摘要，title 僅留補充。
- [ ] **P2-19**｜`client/src/features/creation-workbench/MechanicsDiagram.tsx:119`｜svg-legibility｜/p/:id（這顆模型怎麼運作・結構圖）
  - 問題：SVG 以 viewBox 等比縮放，360px 容器下 5 關以上的階段標籤（fontSize 9.5 SVG 單位）縮到約 8px 難以辨識，6 關時可點格子也縮到約 40px（<44）；幸有下方同功能的階段清單按鈕備援，屬打磨項。
  - 修法：≤560 隱藏 SVG 內文字改由下方清單承擔標籤，或改用 clamp 過的 HTML 標籤列＋僅保留圖形符號。
- [x] **P2-20** done(PR#469)｜`client/src/pages/PlannerPage.tsx:253`｜觸控目標｜/planner
  - 問題：GoogleCalendarBar 的純文字 `<a>` 動作（「匯出 .ics」「連結 Google 日曆（自動同步）」「重新連結」）是 inline-flex 裸連結，高度約 22px，未達 44px 觸控下限，且它們是同步工具列的主要動作而非句中行內連結。
  - 修法：改成 `<Button as="a">`（拿到 .btn 基底與 44px 下限）或補 `btn` class。
- [ ] **P2-21**｜`client/src/pages/PlannerPage.tsx:556`｜橫向空間/佈局｜/planner
  - 問題：排程與筆記列用 inline style 寫死 gridTemplateColumns，特異性蓋掉 styles.css 為 ≤560 準備的 `.gen-row { grid-template-columns: 1fr }` 堆疊規則——360px 時排程列仍是「時間｜內容｜刪除」三欄，標題欄只剩約 110px，長標題＋專案 Chip 擠成多行窄柱。
  - 修法：把欄位模板改成修飾 class（如 .gen-row--schedule）由 CSS 定義，讓 ≤560 媒體查詢能接手堆疊。
- [x] **P2-22** done(PR#470)｜`client/src/pages/DatabasesPage.tsx:948`｜橫向溢位｜/databases
  - 問題：批次匯入的欄位對應列是無 flexWrap 的 flex row，來源表頭 select 寬 auto 且無 max-width/min-width:0——CSV 表頭很長時 select 的 min-content 撐破 360px 容器，被 html 的 overflow-x:clip 直接裁掉、選單右半不可見。
  - 修法：label 加 flexWrap:"wrap"，select 加 maxWidth:"100%"、minWidth:0（或 flex:"1 1 140px"）。
- [ ] **P2-23**｜`client/src/pages/PlannerPage.tsx:373`｜動效/reduced-motion｜/planner
  - 問題：prefillFromDay 的 scrollIntoView 無條件 behavior:"smooth"，不尊重 prefers-reduced-motion；同檔 revealPlannerSection 已示範正確寫法，兩處不一致。
  - 修法：沿用 revealPlannerSection 的 reduced-motion 三元判斷。
- [x] **P2-24** done(PR#469)｜`client/src/pages/CommunityPage.tsx:389`｜touch-target｜/community
  - 問題：「開媒體」是 fs-12 裸 <a>（約 40×18px），夾在一排 44px 按鈕之間，手機難以精準點按。
  - 修法：改 <Button as="a" size="sm" variant="ghost">（as="a" 非 ghost 會補 .btn 基底）或直接給 .btn class。
- [x] **P2-25** done(PR#469)｜`client/src/feedback/FeedbackWidget.tsx:348`｜touch-target｜全站（回饋 widget）
  - 問題：表單裡的「重選」是 span role="button" 行內小字（約 26×18px），全域 button 觸控下限吃不到，手指難點中。
  - 修法：改用 <Button variant="ghost" size="sm">重選</Button> 或補 inline-flex + min-height/padding 撐到 ≥44px 高。
- [x] **P2-26** done(PR#470)｜`client/src/feedback/picker.ts:226`｜safe-area｜全站（回饋 widget）
  - 問題：選取模式的提示列（手機上唯一的取消入口）fixed top:16px 未加 env(safe-area-inset-top)，PWA standalone／瀏海機上會被狀態列壓住而難以點取消。
  - 修法：top 改為 `calc(env(safe-area-inset-top, 0px) + 16px)`。
- [x] **P2-27** done(PR#470)｜`client/src/styles.css:1845`｜nested-scroll｜/chat
  - 問題：訊息列表 .dm-scroll 沒有 overscroll-behavior: contain，手機捲到頂/底會鏈到整頁捲動（standalone PWA 還可能誤觸下拉刷新）。
  - 修法：在 .dm-scroll 補 `overscroll-behavior: contain`（.dm-list 一併補）。
- [x] **P2-28** done(PR#470)｜`client/src/pages/CommunityPage.tsx:273`｜horizontal-overflow/long-string｜/community
  - 問題：貼文標題與描述沒有 overflow-wrap，長無空白字串（URL、英文長 token）在 360px 會撐出卡片、被 html 的 overflow-x:clip 硬切掉。
  - 修法：在標題/描述容器補 overflow-wrap:anywhere（promptText 的 <pre> 已有 break-word，不必動）。
- [x] **P2-29** done(PR#469)｜`client/src/pages/AdminPage.tsx:502`｜touch-target｜/admin, /logs
  - 問題：DetailBlock 的 <summary>（專案與負責人／組資料庫／團隊資料庫展開鈕）觸控高約 20px，全域 --touch-min 規則只涵蓋 button/.btn/.menu-item/input/select、不含 summary（消耗監控卡 summary 也只有 minHeight 32）。
  - 修法：summary 補 minHeight: "var(--touch-min)"（或在 styles.css 為互動 summary 增列 44px 下限）。
- [x] **P2-30** done(PR#470)｜`client/src/pages/AdminPage.tsx:2286`｜overflow｜/admin
  - 問題：邀請連結列（唯讀 input＋複製＋分享鈕）flex row 沒有 flexWrap，input 最小內容寬（size=20 約 170px）＋兩顆 flex:none 按鈕在 360px（內容寬約 308px）會超出，分享鈕被 body overflow-x:clip 裁掉。
  - 修法：該列加 flexWrap: "wrap"（比照 McpPage.tsx:231 金鑰列的寫法）。
- [x] **P2-31** done(PR#470)｜`client/src/pages/McpPage.tsx:174`｜overflow｜/mcp
  - 問題：連線位置卡的端點 URL 是不可斷行的 <code> 長字串（origin+/api/mcp 常 >40 字元），360px 卡內寬約 308px 時尾端被裁掉且整卡無 overflowWrap／word-break（金鑰 token 有 break-all、這行沒有）。
  - 修法：code 加 style={{ overflowWrap: "anywhere" }}（或 wordBreak: "break-all"）。
- [x] **P2-32** done(PR#463，a.btn-sm 規則涵蓋)｜`client/src/pages/IntegrationsPage.tsx:138`｜touch-target｜/integrations
  - 問題：「連結 Google 雲端」與 148 行「重新連結」是裸 <a className="btn-sm …">，沒有 .btn 基底 class，吃不到全域 button/.btn 的 44px 觸控下限，實高約 27px。
  - 修法：改用 <Button as="a" size="sm">（自動帶 .btn）或 className 補上 btn。
- [x] **P2-33** done(PR#469)｜`client/src/pages/DownloadsPage.tsx:172`｜touch-target｜/downloads
  - 問題：文件清單每列唯一動作「下載」是無 class 純文字 <a>，觸控高約 20px、不受 44px 下限保護，手機上是每列的主操作卻最難點。
  - 修法：改 <Button as="a" size="sm" variant="tonal" download> 或加 btn btn-sm class 取得 44px 下限。
- [x] **P2-34** done(PR#469)｜`client/src/pages/ModelsPage.tsx:741`｜touch-target｜/models
  - 問題：目錄卡「看底層」<details> 的 summary（.model-catalog-card__base > summary）觸控高約 22px，styles.css 該選擇器無 min-height，summary 也不在全域 44px 下限名單。
  - 修法：.model-catalog-card__base > summary 補 min-height: var(--touch-min) 與 align-items: center。
- [x] **P2-35** done(PR#470)｜`client/src/pages/ModelsPage.tsx:920`｜hover-only｜/models
  - 問題：HealthBadge 的完整健康說明（healthNote／meta.hint）只放在 title 屬性，手機無 hover 看不到；完整目錄卡另有行內 healthNote（755 行）補救，但並排比較表與三題精靈結果只剩 title 一途。
  - 修法：比較表健康列與精靈結果在徽章旁補一行 Meta 顯示 note，或改用站內點擊展開的 HelpTip。
- [x] **P2-36** done(PR#462，與 P1-13 同源重複發現)｜`client/src/styles.css:5036`｜keyboard-overlap｜/chat 私訊（對話輸入列）
  - 問題：dm-layout 高度用 100dvh 減固定常數但沒扣 --kb-inset；iOS 鍵盤不縮 dvh，貼底的 .dm-compose 輸入列與送出鈕會被鍵盤壓住（站內其他貼底面板都有顯式扣除）。
  - 修法：兩處高度式各再減 var(--kb-inset, 0px)。
- [x] **P2-37** done(PR#463)｜`client/src/styles.css:2357`｜horizontal-overflow｜全站頂欄（≤560）
  - 問題：≤560 把 ≤820 的 topbar overflow-x:auto 改回 overflow:visible，但 flex-wrap 仍是 nowrap 且徽章皆 flex:none——當徽章齊備（mock 徽章＋點數＋在線＋說明/快速圖示＋帳號，各含 44px 下限）總寬可超過 360px，body 的 overflow-x:clip 會直接裁掉尾端動作且無法捲回。
  - 修法：≤560 保留 overflow-x:auto（選單已 portal 到 body，2364 行註解證實不需 visible），或在 360px 實測徽章全開時的總寬。
- [x] **P2-38** done(PR#470)｜`client/src/styles.css:752`｜text-overflow｜專案頁留言區／生成結果文字
  - 問題：.msg 與 .result-text 沒有長字串斷行保護，留言或 AI 生成文字含長網址/長英數 token 時撐出容器，被 body overflow-x:clip 直接裁掉看不到。
  - 修法：比照 .dm-bubble：給 .msg 的文字子層加 min-width:0 與 overflow-wrap:anywhere，.result-text 加 overflow-wrap:anywhere。
- [x] **P2-39** done(PR#469)｜`client/src/styles.css:3761`｜touch-target｜專案頁分鏡總覽／專案頁 presence／定調中心
  - 問題：三處以顯式 min-height 覆寫全域 44px 觸控下限且無文件化豁免理由：.scene-filter 34px、.project-presence-chip 32px、.tone-studio-tab 40px，均為手機可見的可點控件。
  - 修法：改為 min-height: var(--touch-min)，視覺密度用 padding 縮、或用透明 hit-area 擴大。
- [x] **P2-40** done(PR#469)｜`client/src/styles.css:4223`｜touch-target｜/models 模型型錄（「用這個模型」連結）
  - 問題：全域 44px 下限選擇器只涵蓋 button/.btn/.menu-item/input/textarea/select，<a> 不在內：.model-use-cta 實高約 22px（11px 字＋2px padding），同型還有 .bento-card__head a。
  - 修法：為這兩個連結補 min-height: var(--touch-min)（inline-flex 已置中），或比照 2238/2305 行的 `min-height:44px; display:inline-flex` 模式。
- [x] **P2-41** done(PR#470)｜`client/src/styles.css:6666`｜nested-scroll｜今日工作台 AI 創作助理（AICreativeCopilot）
  - 問題：對話 feed 是固定 max-height:420px 的巢狀捲動區，沒有 overscroll-behavior:contain，手機捲到底/頂會連動整頁捲動；420px 在小手機也佔掉過多首屏。
  - 修法：加 overscroll-behavior: contain 與 -webkit-overflow-scrolling: touch，≤560 改 max-height: min(420px, 48dvh)。
- [ ] **P2-42**｜`client/src/styles.css:26`｜字體子集化｜全站首屏標題（h1、empty-state、launch cover、landing 數字）
  - 問題：Noto Serif TC 可變字型整套全域載入，但實際只用在 13 處標題與裝飾數字——首屏每個標題字都要在 sans 之外再多下載一份 serif 的 CJK 字形分包（單一分包平均 ~47KB），行動網路下是可感的重複成本。
  - 修法：評估標題改用 Noto Sans TC 高字重（650/750 可變軸已支援），或 serif 只保留 landing/login hero 場景載入，減少同字雙字族下載。
- [ ] **P2-43**｜`client/src/app/AppRoutes.tsx:28`｜route splitting／重依賴｜/project/:id（行動端主要作業頁）
  - 問題：ProjectPage 單一 lazy chunk 476KB（gzip 150KB）是全站最大 JS，手機弱網下載入慢且最容易 chunk 失敗——lazyWithRetry 的註解自己就點名它是最常中招的一支。
  - 修法：把 ProjectPage 內的重分頁（分鏡／生成／審稿等 tab 級區塊）再往下 dynamic import，讓進頁先載骨架與當前 tab。
- [ ] **P2-44**｜`client/public/manifest.webmanifest:33`｜圖片格式與尺寸｜PWA 安裝流程（manifest icons）＋部署產物
  - 問題：manifest 掛 1024px 圖示兩張（any 520K＋maskable 244K），PWA 安裝時多抓約 760KB；另 client/public/brand/source/ 的 208K 母版 PNG 跟著部署但無人引用。
  - 修法：1024 圖示以 oxipng/pngquant 重壓（同尺寸可壓到 <150K）或直接移除 1024 檔位只留 512；brand/source/ 移出 public 改放 repo 文件目錄。
- [ ] **P2-45**｜`client/public/offline.html:6`｜pwa-brand-consistency｜/offline.html（離線 fallback 頁）
  - 問題：offline.html 仍用 v2 舊品牌色（theme-color/底色 #e9e3d8、按鈕 #b0542f），與 v3「ribbon-light」tokens 及 index.html 的 theme-color #f3f0e8 不一致，離線瞬間狀態列與按鈕會跳回舊皮膚
  - 修法：把 offline.html 的 theme-color/底色/按鈕色換成 v3 值（#f3f0e8／#c23a0c），並依 sw.js 註解慣例評估是否同步升 CACHE_VERSION
- [ ] **P2-46**｜`client/src/pwa.ts:175`｜pwa-update｜全站（SW 更新提示）
  - 問題：SW 更新檢查只掛 window focus 事件；手機 PWA 從背景恢復時 focus 不一定觸發（iOS standalone 尤其），更新提示可能延到下次冷啟才出現——站內其他前景邏輯都是用 visibilitychange
  - 修法：加掛 document visibilitychange（visible 時呼叫 registration.update()），與 focus 並存
- [ ] **P2-47**｜`client/public/sw.js:99`｜offline-shell｜全站（離線 shell 導航）
  - 問題：導航 network-first 沒有逾時：lie-fi（有訊號但極慢）時使用者會白屏等到瀏覽器層 fetch 自然逾時（可達數十秒）才 fallback 到 offline.html
  - 修法：用 Promise.race 加 3–5 秒逾時（或啟用 navigation preload），逾時即回 offline.html
- [ ] **P2-48**｜`client/public/manifest.webmanifest:32`｜pwa-install-ui｜全站（安裝對話框）
  - 問題：manifest 缺 screenshots 欄位，Android/桌面 Chrome 的安裝提示只會顯示簡易小卡，拿不到含預覽圖的富安裝 UI
  - 修法：補 screenshots 陣列（form_factor: narrow 與 wide 各至少一張）
- [x] **P2-49** done(PR#469)｜`client/src/components/ui/Button.tsx:45`｜touch-target｜全站（UI 基元 Button）
  - 問題：Button as="a" variant="ghost" 輸出 `<a class="btn-ghost">`，不在全域 44px 觸控下限選擇器名單內（只涵蓋 button/.btn/.menu-item），實高僅約 26-28px——目前僅測試檔用到此組合，屬潛在缺口
  - 修法：在 styles.css 給 `a.btn-ghost` 補 min-height: var(--touch-min)（保留 p/.hint/.error 內的行內豁免），或在 Button 禁止 ghost+anchor 組合

## 效能基線（2026-08-06 build，gzip；詳 DECISIONS.md D-006）

| 項目 | 現況 | 門檻 | 判定 |
|---|---|---|---|
| 首屏 JS（index+vendor-react+vendor-data） | ≈206.5KB | <180KB | ✗ 超標 |
| ProjectPage route chunk | 151.0KB（raw 486KB） | <100KB | ✗ 超標 |
| 全站單一 CSS（render-blocking，含 @import 兩套 CJK 字型 index.css） | 120.9KB（raw 408KB） | — | ✗ 需拆 |
| html2canvas-pro chunk | 63.8KB | lazy | 已獨立 chunk（用時載入） |
| Noto Serif TC | unicode-range 分片，單片 ≤116KB | 子集化 | ✓ 已分片 |
| Route splitting | 20 頁全 lazyWithRetry＋vendor 拆分 | — | ✓ 健全 |

## 禁改清單（桌機專用／契約，動了即違反紅線）

- client/src/app/components/PrimaryNavigation.tsx——桌機頂欄快捷列，≤820 已整組隱藏（styles.css:2319），改它只會動到桌機
- client/src/styles.css:279-315 @media (min-width:821px) 頂欄單列規則（含 821-1100 窄筆電收斂）——桌機專用
- client/src/styles.css:807-820 .menu 桌機下拉幾何 與 client/src/app/components/MenuSurface.tsx:93-113 的 --menu-avail-h 量測（開頭即 `if (!open || compact) return`，純桌機路徑）
- client/src/styles.css:394 .orb——桌機品牌遺留樣式（無 TSX 引用），與手機無關，勿順手改
- client/src/styles.css:2099-2106 @media (display-mode: window-controls-overlay) 桌面 PWA titlebar 拖曳區
- client/src/styles.css:364-367 html.is-tauri-desktop 規則 與 SessionGate.tsx:156 的 /desktop（DesktopCompanionPage）路由——Tauri 桌面殼專用
- client/src/styles.css:2364-2367 的註解禁令：勿把 .topbar .menu { position: fixed } 加回來（backdrop-filter 包含區塊陷阱）
- client/src/app/components/MenuSurface.tsx 的 portal 條件（第 168 行 compact 才 portal）——桌機依賴留在 .menu-wrap 內做 absolute 錨定，不可改成無條件 portal
- client/src/styles.css .launch-list 與 .launch-list-row* 全組選擇器（570-646 行）——桌面列表檢視，JS 端已以 isDesktop 守門，手機永遠不渲染
- client/src/styles.css .launch-layout-toggle（541-567 行）與 649 行的 ≤820 隱藏規則——檢視切換僅桌面
- client/src/styles.css @media (min-width:821px) and (max-width:1100px) 的 .launch-list-row__main 欄位縮減（641-646 行）
- client/src/styles.css @media (min-width:1200px)/(min-width:1400px) 的 .launch-grid/.cols 桌面加寬區塊（647、1993-1998、4682-4688 行）
- client/src/pages/Launchpad.tsx 的 isDesktop/layout/listMode 分支（112-117、687-708、771-787、791-837 行）——列表模式為桌面專用契約
- client/src/styles.css :root --touch-min 契約與 144-170 行全域觸控下限（含行內豁免清單）——只能沿用不可覆寫縮小
- client/src/styles.css 250-264、5362-5364 與 styles.mobile-fab-01.css 的 --chrome-bottom/--kb-inset 變數契約及 .mobile-nav/.mobile-more-sheet 殼層——修任何底部遮擋一律調變數，不得另寫死 padding-bottom
- client/src/styles.css 1392-1397 全域 prefers-reduced-motion kill-switch
- client/src/styles.css:279-315 @media(min-width:821px) 桌面頂欄單列規則——桌機專用
- client/src/styles.css:1205-1212 .toc-layout/.toc-rail 桌機側欄 grid 與 sticky（含 4687 的 ≥1200 欄寬）——手機已由 1371-1389 與 4723-4755 另行接管
- client/src/pages/ProjectPage.tsx:2367-2380 桌機 MessagePanel 側欄與 #project-messages 錨點——註解明言此錨點已被平行 PR 弄丟兩次（#246/#251），絕不可動
- client/src/pages/ProjectPage.tsx CtxCollapse/CtxGroup 的 compact=false 分支（98-131、137-189）——「桌機版面不變」契約
- client/src/styles.css:226-228 @media(hover:hover) body background-attachment:fixed——刻意只給桌面，手機改 fixed 會閃爍耗電
- client/src/styles.css:1234-1240 桌機 scroll-margin 錨點清單——可增列 id、不可改既有 offset
- client/src/lib/keyboardInset.ts 與 client/src/lib/scrollIntoViewForChrome.ts——契約檔且有測試（keyboardInset.test.ts、panel.test.ts）鎖規則，只能沿用不能繞開
- client/src/styles.css:5362-5477 手機殼層 v2（.mobile-nav/.mobile-more-sheet/.menu-surface.is-sheet）——全站共用底盤，專案頁修正應讀其變數而非改它
- client/src/styles.css @media (min-width: 1200px)/(min-width: 1400px) 區塊（.cols 兩欄、.launch-grid、.card--primary 桌機間距，L1993-1998）——桌機專用，行動修補不得動
- client/src/styles.css .creation-mode-tabs 基準 4 欄 grid（L3791-3796）——行動已有 ≤920/≤560 覆寫，改基準會破桌機
- client/src/styles.css .modal-card 基準寬 min(460px,100%)（L1914-1921）與 .modal-card.scene-studio 桌機兩欄工作室（L5170-5199）——抽屜已用 inline style 覆寫，勿改共用基準
- --chrome-bottom / --kb-inset / --safe-* 變數契約（styles.css :root L131-139 與 ≤560 區塊、styles.mobile-fab-01.css 全檔、client/src/lib/keyboardInset.ts、client/src/lib/scrollIntoViewForChrome.ts）——只能調變數與走既有 helper，元件內禁止寫死 88/100/140px
- client/src/features/creation-workbench/__tests__/mob03LongTaskCopy.test.ts 守衛的字串與選擇器：DirectGenerateMode「可關閉此頁，完成會推播到已連結裝置」與 confirm-actions class、≤560 的 .creation-mode-tabs 2×2 / overflow:visible / scroll-snap-type:none 規則——改動必須同步測試，不可順手重寫
- client/src/styles.css .ctx-summary--wrap 不橫捲的決策（L5118-5125 QA 註解：帶入確認列漏看會生錯圖）——勿回退成橫向捲動
- 桌機 :hover 增強規則（button:hover、.chip.pick:hover、.creation-skill-card:hover 等）——皆為冗餘增強而非唯一入口，行動修補不需也不應移除
- styles.css:141-193 全域 --touch-min 契約與其豁免區（p>.btn-ghost 行內豁免、.cal-cell min-width:0、.tag-remove 28px）——豁免有實測依據，勿加回 min-width 或改動下限
- styles.css:936-938（≤820）`input, textarea, select { font-size: 16px !important }` 防 iOS 縮放規則——勿降特異性或移除 !important
- styles.css:250-262 與 :5362-5474 `--chrome-bottom`／`.mobile-nav` 手機殼層契約（含 .app:has(.mobile-nav) 覆寫）
- styles.mobile-fab-01.css 整檔（≤560 chrome-bottom 140/200px、FAB icon-only、鍵盤 inset 面板高度）——與 styles.css 以載入順序協作，勿在頁面修復時覆寫
- styles.css:2308-2311、3126-3135、4690-4693 `.database-layout` 桌機雙欄與 `.database-sidebar.card` sticky/max-height(100dvh) 桌機規則
- styles.css:3078-3093 `.schedule-create-form` 桌機 12 欄 grid 與 :4712-4717 平板 6 欄 span——手機修改只能落在 ≤560 區塊
- styles.css:226-246 `@media (hover: hover) and (pointer: fine)` 桌機專用背景/懸停效果
- PlannerPage.tsx:1375-1379 觸控不平移畫布（pointerType 判斷）——是「保留頁面捲動」的刻意設計，修地圖時勿改成觸控平移
- client/src/styles.contract.test.ts 守護的字面宣告：`--chrome-bottom: 48px`、`.app:has(.mobile-nav) { --chrome-bottom: 100px; }`、`button.menu-surface__scrim:hover`/`button.mobile-more-scrim:hover` 併列、`.menu { max-height: var(--menu-avail-h, none); overflow-y: auto }`——改寫字面即弄破測試
- styles.css @media (min-width: 821px) 的桌機頂欄區（279-311）與 (min-width:1200/1400/1680) 寬螢幕規則（197-202、1993-1998、4682）——純桌機，不可為手機改動
- styles.css:1762-1766 與 3264-3291 的 .dm-layout/.dm-list 基礎雙欄（flex: 0 0 280px／320px）——桌機主從式佈局，手機已由 ≤720/≤560 覆寫接管
- styles.css:3126-3138 .database-layout 桌機 grid 與 .database-sidebar sticky——非本區但同檔相鄰，勿動
- styles.css:5306-5309 .menu-surface__scrim { display:none } 與 .menu-surface--stretch——桌機下拉基礎態，手機 sheet 版靠 ≤820 覆寫，動基礎態會讓桌機長出 scrim
- styles.css:226-228 @media (hover: hover) and (pointer: fine) 的 body background-attachment: fixed——iOS 效能豁免的反向條件，勿併入手機塊
- client/src/feedback/picker.ts 的 z-index 階梯（2147483000-2147483002）與 WIDGET_ATTR/ignoreElements 截圖排除機制、stop() 的 350ms 吞 click overlay——跨裝置行為契約，picker.test.ts/panel.test.ts 有守門
- styles.css:936-938 的 16px !important 註解與規則——是 iOS 防縮放契約本體，任何頁面想改小字級都不可繞過它
- styles.css @media (min-width: 821px) 的 .topbar/.topbar-actions 桌機單列規則（279-297）——手機頂欄另有 ≤820 版本，勿動
- styles.css .cols { grid-template-columns: 1fr 340px }（757）桌機雙欄值——只能動 ≤860 分支
- styles.css @media (min-width: 1200px/1400px/1680px) 寬螢幕區塊（197-202、647、1993-1998、4682-4688）
- styles.css @media (hover: hover) and (pointer: fine) body background-attachment: fixed（226-228）
- styles.css .menu 桌機下拉（806-825）——手機已由 .menu-surface.is-sheet 接手，桌機下拉行為勿改
- styles.css @media (display-mode: window-controls-overlay) 桌面 PWA WCO 區塊（2099）
- styles.mobile-fab-01.css 的 --chrome-bottom 分級值（100/140/160/200px）——是既有 M2/#294 契約，只能整體調整不可局部寫死 padding-bottom 復活
- styles.css 144-190 全域 --touch-min 規則與其豁免清單（p > .btn-ghost、.cal-cell、.tag-remove）——多頁依賴，勿為單頁改動
- client/src/styles.css:394 .orb（頂欄品牌球，conic-gradient 桌機視覺語彙）
- client/src/styles.css:279-315 @media(min-width:821px) 桌機頂欄單列規則（含 297-315 窄筆電 821-1100 收斂）
- client/src/styles.css:197-202、647、1993-1998、4682-4688 min-width 1200/1400/1680 桌機加寬區塊
- client/src/styles.css:568-646 .launch-list / .launch-list-row*（桌機列表檢視；JS 以 isDesktop≥821 閘控，手機永遠 grid）
- client/src/styles.css:317-367 .desktop-companion* 與 html.is-tauri-desktop（Tauri 桌面殼）
- client/src/styles.css:1242-1364 .desktop-handoff-* / .desktop-editor-*（/desktop 桌面剪輯連接卡）
- client/src/styles.css:2099-2106 @media(display-mode:window-controls-overlay)（桌面 PWA 標題列拖曳區）
- client/src/styles.css:226-228 @media(hover:hover) and (pointer:fine) body background-attachment:fixed（刻意只給桌機，iOS 會閃爍）
- client/src/styles.css:1205-1212 .toc-layout/.toc-rail 桌機 sticky 側欄基礎規則（手機已由 1371-1389、4724-4756 接管）
- client/src/styles.css:3126-3139 .database-layout 桌機主從格線＋.database-sidebar.card sticky（≤820 已 display:block 接管）
- client/src/styles.css:2140-2237 .landing-* 桌機著陸頁版面基礎規則（820/560 已有覆寫）
- client/src/styles.css:5170-5286 .modal-card.scene-studio 桌機兩欄基礎（≤900 已單欄覆寫）
- client/src/styles.css:2364-2367 註解護欄：`.topbar .menu { position: fixed }` 已移除，明文禁止加回
- client/src/gallery.tsx 與 client/gallery.html——開發用 primitives 展示頁，不進正式包，是 Figma Library 的視覺基準，勿為手機改動
- vite.config.ts 的 manualChunks 區塊（QA-025 vendor 快取契約；含 react-dom/client 必須顯式列出的註記），勿增刪項目
- client/src/lib/lazyWithRetry.ts 的重試／繞快取重載／冷卻邏輯——chunk 韌性契約，有測試鎖定（lazyWithRetry.test.tsx）
- styles.css `@media (hover: hover) and (pointer: fine)` 的 body background-attachment:fixed——刻意桌機限定（iOS 捲動閃爍／耗電），勿放寬到觸控裝置
- client/src/feedback/picker.ts 的 html2canvas-pro 動態 import——有測試鎖定不得改回靜態 import 或原版 html2canvas（picker.test.ts:38-55）
- client/public/brand/source/——母版資產僅供再製，內容勿改（搬離 public 屬部署調整，不動檔案本身）
- index.html 的 inline splash div 與 viewport meta（interactive-widget=resizes-content 契約），與 keyboardInset.ts 成對，勿單獨改動
- styles.css :root 色彩 tokens 區（37-142 行）——全部對比值經 WCAG AA 校準且全站連動，勿為單點調色
- styles.css @media (hover: hover) and (pointer: fine) 區塊（226 行起）——桌機指標專用，手機稽核勿動
- styles.css .toc-rail/.toc-layout sticky 側欄（1205-1232 行）——桌機章節導覽，≤窄寬已自行收成 display:block（1374-1375）
- styles.css .app-update-banner 基礎規則（2421-2452 行）——桌機狀態列版；手機已由 4879-4892 覆寫，勿在基礎層改尺寸
- styles.css --chrome-bottom 契約字面（255-263、5364 行）與 styles.mobile-fab-01.css 12-20 行——被 styles.contract.test.ts 逐字鎖定，改字面即破測試
- manifest.webmanifest display_override 的 window-controls-overlay——桌面 PWA 專屬特性，勿因手機稽核移除
- client/src/styles.contract.test.ts、client/src/lib/keyboardInset.ts、client/src/lib/scrollIntoViewForChrome.ts——底部留白／鍵盤 inset 契約的單一真相與守護測試
