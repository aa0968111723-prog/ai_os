# Adobe 製作清單盤點（從程式碼）

> **狀態**：盤點報告（不改功能）  
> **日期**：2026-08-05  
> **基礎 HEAD**：`claude/healing-migration-ai-os-erewp2`（約 #423 後）  
> **管線**：[`overall-adobe-figma-code-plan.md`](./overall-adobe-figma-code-plan.md)  
> **品牌錨點**：`client/src/brand.ts` · 資產 `client/public/brand/` · `client/public/icons/`  
> **Token 錨點**：`client/src/styles.css`（**禁止發明第二套色票**）

---

## 0. 一句話

**Adobe 產「可匯出的像素／向量素材」**；**Figma 管排版與元件狀態**；**程式已有 React + CSS 變數殼**。  
下列每一項都標三欄：**Adobe / Figma / 程式錨點**。  
**不是** Adobe 修圖 API（那是 `adobe-account-linking-pr-roadmap.md`）。

---

## 1. 現有設計系統（W0）— 必先對齊再畫

### 1.1 色與表面（`styles.css` `:root`）

| Token 群 | 代表變數 | 用途 | Adobe | Figma | 程式 |
|----------|----------|------|-------|-------|------|
| 中性文字 | `--fg` `#292524`、`--fg-secondary`、`--muted-fg`、`--soft` | 正文／meta／裝飾 | 色票 swatch | Variables 綁名 | 已契約化 |
| 表面 | `--bg` 頁底、`--card` 主卡、`--card2` 巢狀、`--field` 輸入井、`--muted` 凹陷 | 層級 | 紙質／紋理可選 | Auto-layout 表面 | `.card` / `.card--*` |
| 邊框 | `--border` / `--border-soft` / `--border-strong` | 髮絲框 | 勿另創灰 | stroke styles | 全域 |
| 品牌橘 | `--primary` `#e05a10`、`--primary-solid`、`--primary-ink`、`--primary-tint` | CTA／focus／選取 | 與 logo 橘一致 | 按鈕 variants | `Button` primary/tonal |
| 品牌彩帶 | `--brand-red`…`--brand-teal`、`--brand-ribbon` | 點綴／splash | 漸層資產可畫 | 少用大面積 | splash／品牌 |
| 語意色 | `--success` / `--danger` / `--healing` / `--gold` / `--collab` | 狀態 | 狀態 icon 填色 | Pill／Badge | `Pill` 狀態 |
| 陰影 | `--e1`…`--e4`、`--hl-top`、`--inset-well` | 浮層 | 不做假陰影圖 | effect styles | 既有 |
| 字體 | `--sans` Noto Sans TC、`--serif`、`--mono` IBM Plex Mono | 排版 | 行銷圖可嵌字 | Text styles | 已載 |
| 字級／間距／圓角 | `--fs-*`、`--sp-*`、`--radius` 14px、`--r-*` | 網格 | — | Variables | `styles.contract.test.ts` |
| 觸控／chrome | `--touch-min` 44、`--chrome-bottom`、safe-area | 手機 | — | Mobile frame 註記 | `styles.mobile-fab-01.css` |

**Adobe 立刻可做（W0 素材包）**

1. **色票板**（PNG／ASE）：上表全部 hex + 標 CSS 變數名（給 PS／Illustrator 對稿）。  
2. **紙質紋理**（可選、低對比 WebP）：貼在 `--bg`／`--card` 上，**不改對比**。  
3. **品牌 ribbon 靜態預覽**（SVG）：對應 `--brand-ribbon`。

**Figma**：Variables 名稱 = CSS 變數（含 `--` 或去掉前綴但註對照）。  
**程式**：改色只動 `styles.css` + 合約測試，不另開 theme 檔。

### 1.2 UI 基礎元件庫（`client/src/components/ui/`）

| 元件 | 變體（程式已有） | Adobe | Figma | 程式錨點 |
|------|------------------|-------|-------|----------|
| **Button** | `neutral` / `primary` / `tonal` / `ghost` × `md`/`sm` | — | 4×2 variants + hover/disabled/loading | `ui/Button.tsx` · class `primary`/`tonal`/`btn-ghost`/`btn-sm` |
| **Card** | `default` / `primary` / `std` / `quiet`；可 `as=details` | 卡面紋理可選 | 表面 variants | `ui/Card.tsx` · `.card--*` |
| **Chip** | selected 態 | — | default/selected | `ui/Chip.tsx` |
| **Pill** | status：queued/running/done/failed… | 狀態色點 | status variants | `ui/Pill.tsx` |
| **Badge** | 計數／標籤 | — | size variants | `ui/Badge.tsx` |
| **Hint** / **Meta** | 分層說明 | — | 字級對 `--fs-12/13` | `ui/Hint.tsx` `Meta.tsx` |
| **EmptyState** | icon + title + description + **action 必備** | **插畫位** | Desktop+Mobile 空狀態幀 | `ui/EmptyState.tsx` · `.empty-state` |
| **Skeleton** | 載入占位 | — | skeleton 樣式 | `ui/Skeleton.tsx` |
| **Icon** | **61 個 SVG path**（inline） | 可重繪品牌化 icon set | Icon component | `Icon.tsx` · `ICON_NAMES` |
| **interactions** | ConfirmButton、HelpTip、useFocusTrap | — | Confirm 對話框幀（#408） | `interactions.tsx` |

**Icon 完整名單（Adobe 可統一 stroke 1.5～2、24px grid 重繪 SVG）**  
`ArrowRight, Bell, CalendarPlus, Camera, Check, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, CircleStop, Clapperboard, Clock, Copy, Database, Download, Ellipsis, FileText, Film, Gem, HardDrive, HelpCircle, Image, Info, Lightbulb, Loader, Lock, MessageCircle, Mic, Monitor, MousePointer2, Music, Package, Palette, Pause, Pencil, Play, Plus, RotateCcw, RotateCw, Scale, Search, Send, Share2, SkipBack, SkipForward, SlidersHorizontal, Smartphone, Sparkles, Square, Star, Tablet, Tag, Trash2, TriangleAlert, Trophy, Undo2, Unlock, User, Volume2, Waypoints, XCircle`

→ 匯出：`client/public/design/icons/*.svg`（建議），程式可漸進替換 `PATHS` 或保持現狀。

---

## 2. 品牌與開機（W0／行銷）

| 項目 | 現況 | Adobe | Figma | 程式錨點 |
|------|------|-------|-------|----------|
| **Wordmark 全彩** | `logo-aios-color-v2.png` (+@2x) | 精修／SVG 母版、深淺底 | Logo 元件 light/dark | `brand.ts` `BRAND_LOGO_SRC` |
| **Wordmark mono** | `logo-aios-mono.png` | 單色版 | — | `BRAND_LOGO_SRC.monochrome` |
| **Mark／App icon** | `icon-aios-v2-*.png`、`public/icons/icon-v2-*` maskable | **1024 母版 + maskable safe zone** | — | `BRAND_MARK_SRC` · PWA |
| **Favicon / Apple touch** | 既有 v2 | 與 mark 對齊一輪 | — | `client/index.html` |
| **Splash 畫面** | radial 象牙底 + logo + tagline | 背景氛圍圖（可選）、粒子勿動畫檔 | Splash frame 桌機＋手機 | `SplashScreen.tsx` · `splash.css` · `--bg` |
| **BrandReveal** | 進場動畫 | 靜態「hero 構圖」參考 | Landing hero | `BrandReveal.tsx` |
| **Landing 行銷首屏** | 文案 + brand link | **Hero 插畫／產品 mock**（WebP） | Landing desktop+mobile | `LandingPage.tsx` |
| **Login 品牌區** | BrandLogo hero | 同 splash 資產 | Login frame | `LoginPage.tsx` · `main#main-content` |

**Adobe 優先包（品牌）**  
A1 全彩 SVG wordmark · A2 mono SVG · A3 mark 1024 + maskable · A4 Landing hero 1×／2× · A5 Splash 可選背景（極淡）。

---

## 3. 產品殼與導航（W1／W7）

| 項目 | Adobe | Figma | 程式錨點 |
|------|-------|-------|----------|
| **App 頂欄** | 可選 brand mark 精修 | Header：logo / 組切換 / 通知 / 帳號 | `app/components/AppHeader.tsx` · `.brand` |
| **TocNav 三幕** | — | 側欄／頂部階段：①定調 ②創作 ③交付 | `TocNav.tsx` · `.toc-*` |
| **Mobile 底欄** | nav icons（可對齊 Icon set） | Bottom nav 64px + safe-area | `.mobile-nav` · `--chrome-bottom` |
| **回饋 FAB** | FAB 圖示（MessageCircle） | 右下 FAB 與底欄間距 | `FeedbackWidget` · `styles.mobile-fab-01.css` · `.fb-fab-*` |
| **Skip link** | — | a11y 幀 | `.skip-link` |
| **今日工作台 Launchpad** | 空狀態插畫、團隊卡封面可選 | 卡片網格 + 空狀態 | `Launchpad.tsx`（~2452 行，視覺密度高） |
| **二次頁 Header** | — | 返回＋標題 | `SecondaryPageHeader.tsx` |

**Adobe 優先包（殼）**  
B1 空「今日工作台」插畫 · B2 無組／等待加入插畫（`AppRoutes` 空狀態）· B3 可選頂欄 brand mark 精修。

---

## 4. 創作主路徑（W2）

| 項目 | Adobe | Figma | 程式錨點 |
|------|-------|-------|----------|
| **CreationWorkbench 殼** | — | 目標框、四 mode tabs、資源抽屜 | `CreationWorkbench.tsx` |
| **Mode tabs** | tab icons（Sparkles/Image/…） | ask / generate / template / plan | `CreationModeTabs.tsx` |
| **直接生成表單** | 模型列小圖可選 | 成本列、帶入 chip、進階收合 | `DirectGenerateMode.tsx` |
| **ContextBar／帶入摘要** | — | chip 列 + 揭示行為註解 | `CreationContextBar.tsx` · `formatBringInSummary` |
| **資源抽屜** | 空軌跡／收藏空狀態插畫 | Drawer desktop+mobile | `CreationResourceDrawer.tsx` |
| **ModelPicker** | 模型類別 icon（圖/影/音/字） | 列表＋檔位 Pill | `ModelPicker.tsx` |
| **Ablation 面板** | — | 對照網格 | `AblationPanel` / `AblationResultGrid` |
| **生成列表列** | 空列表插畫；個人金鑰徽章視覺 | gen-row 狀態 | `GenerationList.tsx` · `.gen-*` · BYOK 徽章 |
| **Prompt 庫** | — | 卡片列表 | `PromptLibrary.tsx` |

**Adobe 優先包（創作）**  
C1「還沒生成」空狀態 · C2「還沒軌跡」空狀態 · C3 媒體類型 icon 一組（image/video/audio/doc）。

---

## 5. 陪你做完共創（W3）— 對齊 #404／#408

| 項目 | Adobe | Figma | 程式錨點 |
|------|-------|-------|----------|
| **入口 CTA** | 可選輕插畫／icon | 「沒靈感？陪你做完」按鈕 | `CreationWorkbench` `data-testid=co-create-entry` |
| **共創殼** | 進度四段可選插圖 | 進度 + 本步 focus + **2–3 chips** + 退出 | `co-create/CoCreateShell.tsx` |
| **進度 VisualJourney** | — | theme→structure→visuals→wrap | `VisualJourney.tsx` · `coCreatePhases.ts` |
| **作品摘要列** | — | 設定／分鏡／畫面缺數 | `coCreateProgress.ts` · `co-create-work-summary` |
| **Confirm 扣點** | — | 確認對話（#408 中等協助） | `ConfirmButton` |
| **空靈感** | **主打插畫**：沒靈感時的溫和空狀態 | 與殼同幀 | EmptyState + chips |

**Adobe 優先包（共創）**  
D1 共創 hero／空靈感插畫 · D2 phase 四小標示（定調／分鏡／畫面／收斂）可選。

---

## 6. 定裝與專案上下文（W4）— 對齊 #402

| 項目 | Adobe | Figma | 程式錨點 |
|------|-------|-------|----------|
| **Stage ① 定調** | — | StageHead 定調 | `ProjectPage` StageHead |
| **世界觀卡** | 就緒條／範例卡小圖 | 主路徑 vs 進階 details | Worldview* · `wv-ready-strip` |
| **WorldviewExampleCard** | 範例預覽裝飾 | 空世界觀卡 | `WorldviewExampleCard.tsx` |
| **CostumePackSection** | Tab icons（角色／場景／道具） | 定裝 Tab + panel | `CostumePackSection.tsx` · `.costume-*` |
| **角色／場景／道具卡** | 卡封面占位、空列表插畫 | 卡片網格＋選取 | `CharacterCards` `ScenePresetCards` `PropCards` |
| **定裝接縫／回到原處** | — | sticky return bar | `context-return-bar` |
| **知識庫／資料庫卡** | 空庫插畫 | 列表 | `KnowledgeBase` `ProjectDatabasesCard` |
| **素材庫** | **缺檔占位圖**（MissingMedia） | 網格＋上傳區 | `AssetLibrary` · `MediaFallback` |

**Adobe 優先包（定裝）**  
E1 角色／場景／道具空狀態三張插畫 · E2 素材遺失占位（替代破圖）· E3 可選「定裝包」封面樣式。

---

## 7. 分鏡／生成結果／交付（W5）

| 項目 | Adobe | Figma | 程式錨點 |
|------|-------|-------|----------|
| **SceneList** | 分鏡格空／缺圖占位 | 時間軸式列表 | `SceneList.tsx` · scene CSS 密度高 |
| **SceneStudio** | — | 單格工作室 | `SceneStudio.tsx` |
| **StoryboardPlayer** | 播放器皮層可選 | 粗剪預覽 | `StoryboardPlayer.tsx` |
| **StoryboardScript** | — | 腳本區 | `StoryboardScript.tsx` |
| **Export 按鈕／狀態** | 匯出成功插畫可選 | 打包流程幀 | `ExportJobButton` |
| **審批狀態** | status 色已有 | pending/approved 幀 | Pill + 分鏡狀態 |

**Adobe 優先包（交付）**  
F1 分鏡空白格 · F2 匯出完成輕插畫。

---

## 8. 設定／點數／登入／回饋（W6）

| 項目 | Adobe | Figma | 程式錨點 |
|------|-------|-------|----------|
| **Login** | 同品牌 hero | 表單 + 裝置驗證 | `LoginPage.tsx` |
| **Integrations / BYOK 卡** | 金鑰「個人·0 點」徽章視覺 | 設定卡 | `PersonalAiKeyCard` 等 · GenerationList 徽章 |
| **點數／額度** | — | 額度條、不足狀態 | quota UI |
| **回饋 FAB＋表單** | — | 選單／表單 dialog | `feedback/FeedbackWidget.tsx` |
| **回饋截圖** | — | 標定框樣式 | `feedback/picker.ts`（html2canvas-pro） |
| **通知設定** | — | dialog | `NotificationSettings.tsx` |
| **Desktop companion** | 桌面連線插畫 | 連線步驟 | `DesktopCompanionPage.tsx` |

**Adobe 優先包（帳號／設定）**  
G1 桌面剪輯連接插畫 · G2 可選「金鑰已接上」小標示。

---

## 9. 其他高密度面（次優先）

| 面 | 為何進清單 | Adobe | Figma | 錨點 |
|----|------------|-------|-------|------|
| 訊息／私訊 | 空聊天、氣泡 | Chat 空狀態插畫 | 訊息列表 | `MessagePanel` `ChatEmptyState` |
| 社群靈感 | 卡片封面 | 空靈感牆 | 網格 | `CommunityPage` |
| 模型指南 | 類別視覺 | 12 類小插圖可選 | 篩選＋卡 | `ModelsPage` |
| Agent 卡 | 複雜但偏工具 | 少做插畫 | 狀態列 | `AgentCard` |
| 管理後台 | 偏表格 | 空回饋列表 | 表格幀 | `AdminPage` |
| 資料庫 | 空表 | 空庫插畫 | 表結構 | `DatabasesPage` |

---

## 10. 建議交付順序（給 Adobe／Figma）

### Pack 0 — 週內可交（解鎖 W0）
| ID | Adobe 產出 | 規格 | 程式落點 |
|----|------------|------|----------|
| P0-1 | CSS 色票板 | ASE/PNG 標 `--primary` 等名 | 對稿用 |
| P0-2 | Logo SVG 全彩 + mono | 透明、viewBox | `public/brand/` |
| P0-3 | App icon 1024 + maskable | safe zone 80% | `public/icons/` |
| P0-4 | Icon set 24px SVG（上列 61） | 1.5–2px stroke、單色 currentColor | 可替 `Icon.tsx` |

### Pack 1 — 空狀態插畫（解鎖 W1–W5 體感）
| ID | 場景文案（現有 EmptyState） | 建議構圖 |
|----|---------------------------|----------|
| P1-1 | 還沒有素材 | 相機／畫板溫和空 |
| P1-2 | 還沒有資料庫 | 表格輪廓 |
| P1-3 | 還沒有筆記／排程 | 日曆空白 |
| P1-4 | 沒靈感／陪你做完 | 溫暖引導，非「AI 機器人」 |
| P1-5 | 素材遺失 | 與「未生成」可區分 |
| P1-6 | 還沒有回饋／社群空 | 輕插畫 |
| P1-7 | 角色／場景／道具空定裝 | 三張一組 |

規格：SVG 或 WebP；**主色僅用 `--primary` / 中性**；淺底 `--bg`/`--card`；寬 320–640 CSS px；2x 可選。

### Pack 2 — 行銷／Landing
| ID | 產出 |
|----|------|
| P2-1 | Landing hero（桌 1440、手機 390） |
| P2-2 | OG／分享圖（可選） |

### Pack 3 — Figma 優先（Adobe 輔助）
W0 元件庫 → W1 殼 → W2 工作台 → W3 共創 → W4 定裝 → W5 分鏡 → W6 設定 → W7 手機。

每幀：**Desktop + Mobile**；空／錯／無權／Confirm 各一（計畫 F6）。

---

## 11. 明確「不要交給 Adobe」

| 類型 | 原因 |
|------|------|
| tRPC／權限／quota／runAction 流程圖（產品邏輯） | 屬規格／工程，非視覺素材 |
| 模型目錄商業資料 | 內容非設計 |
| PLACEHOLDER 危險 PR 視覺 | 禁止 |
| 第二套色系／新 UI kit | 違反 token 單一真相 |
| 即時 3D／Lottie 大動畫（第一期） | 除非 Figma 指定且體積可控 |

---

## 12. 程式已有「設計 gallery」入口

- `client/src/gallery.tsx`：EmptyState／Button 等樣品  
→ 設計對稿時可對照實際 DOM class。

---

## 13. 給設計的一頁摘要（可直接貼 brief）

**產品**：Aios（AI 創作作業系統）— 暖象牙底、赤陶橘 CTA、紙質卡面。  
**請做**：  
1）色票對齊 CSS 變數；2）Logo／App icon 精修 SVG；3）61 icon 統一；4）7+ 空狀態插畫；5）Landing hero。  
**請在 Figma**：W0 元件庫 + 主路徑（定調／創作／交付／共創）桌機＋手機。  
**不要**：改後端流程；另起 Tailwind 色票。

**程式聯絡錨點**：  
`styles.css` · `brand.ts` · `components/ui/*` · `features/creation-workbench/*` · `features/co-create/*` · `ProjectPage` · `SceneList` · `GenerationList` · `CostumePackSection`。

---

## 14. 下一步（非本任務）

1. 設計回覆：Figma 連結（可先 W0+W1）+ 是否延續佛系影視調性。  
2. Adobe 交 Pack 0＋Pack 1。  
3. 終端開 `feat/design-w0-tokens` 僅在有稿後改 CSS／資產路徑。

---

*本檔由程式碼盤點產生；行為與 API 以現有實作為準。*
