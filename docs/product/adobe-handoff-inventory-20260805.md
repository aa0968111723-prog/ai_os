# Adobe 需要生成的清單（從程式碼盤點）

> **狀態**：設計交接 brief（本 PR 只加文件，不改功能）  
> **日期**：2026-08-05  
> **基礎**：`claude/healing-migration-ai-os-erewp2`  
> **管線**：[`overall-adobe-figma-code-plan.md`](./overall-adobe-figma-code-plan.md)（#409）  
> **品牌錨點**：`client/src/brand.ts` · 資產 `client/public/brand/` · `client/public/icons/`  
> **Token 錨點**：`client/src/styles.css`（**禁止發明第二套色票**）  
> **不是**：Adobe OAuth／修圖 API（見 [`adobe-account-linking-pr-roadmap.md`](./adobe-account-linking-pr-roadmap.md)）

---

## 0. 一句話

**Adobe 產「可匯出的像素／向量素材」**；**Figma 管排版與元件狀態**；**程式已有 React + CSS 變數殼**。  
下列每一項都標三欄：**Adobe / Figma / 程式錨點**。

### 0.1 三波交付速查

| 波次 | 何時 | 內容 |
|------|------|------|
| **第一波** | 週內 | Pack 0 品牌母版 + Pack 1 主路徑空狀態 + Pack 2 Landing |
| **第二波** | 有 Figma W1–W5 後 | 創作／定裝／分鏡／殼／設定插畫；與稿對齊再畫 |
| **第三波** | 可選 | 模型 12 類、社群牆、後台、紙質紋理、phase 小標 |

**規格硬約束（摘要）**  
1. **不要黑色**（見 §0.0）  
2. 主色僅 `--primary` `#e05a10` + 暖象牙中性  
3. 勿第二套 UI kit；SVG 優先、WebP 次之  

---

## 0.0 色與格式總則（必讀）

### 禁止黑色（硬規則）

| 禁止 | 說明 |
|------|------|
| **`#000000` / `rgb(0,0,0)` / pure black** | 畫面、描邊、文字、陰影、icon 填色皆 **不准** |
| **冷灰黑底**（如 `#111`、`#1a1a1a`、深 slate 全屏） | 產品是暖象牙紙感，不是暗色模式稿 |
| **黑白高反差插畫** | 勿用漫畫黑線條；線條用 **暖石** 或 **主色橘** |
| **黑色 mono logo** | mono 用暖石 `#292524`，**不是** black |

| 允許的「最深色」 | Hex | CSS token | 用途 |
|------------------|-----|-----------|------|
| 正文／最深描邊 | `#292524` | `--fg` | 文字、icon 預設 stroke（暖石，**不是黑**） |
| 次級文字 | `#67615b` | `--fg-secondary` | meta、hint |
| 裝飾線 | `#a79d90` | `--soft` | 僅裝飾，不作正文 |
| 陰影基準 | `rgba(28,25,23, α)` | `--e1`…`--e4` | 半透明暖褐，**不是** black 陰影 |

| 背景／紙面（請用這些，勿用純白大面積冷白或黑底） | Hex | Token |
|--------------------------------------------------|-----|-------|
| 頁底 | `#f3f0e8` | `--bg` |
| 主卡「暖白紙」 | `#fffefa` | `--card` |
| 巢狀／chip | `#f9f7f1` | `--card2` |
| 輸入井 | `#f7f5ee` | `--field` |
| 凹陷 | `#f4f1ea` | `--muted` |

| 品牌主色 | Hex | Token |
|----------|-----|-------|
| 品牌橘 | `#e05a10` | `--primary` |
| 實心鈕 | `#c23a0c` | `--primary-solid` |
| 淺底字 | `#b23508` | `--primary-ink` |
| 選取底 | `#fdeee4` | `--primary-tint` |
| 鈕上淺字 | `#fff6f0` | `--primary-fg`（僅深橘底上，**不是**大面積白底黑字） |

**插畫用色建議（空狀態／hero）**

- 底：透明 **或** `--bg` / `--card`（象牙）  
- 主點綴：`--primary` `#e05a10` 及其 tint  
- 線條／陰影形：`--fg` `#292524` 或更淡的 `--fg-secondary` / `--soft`  
- 可點綴 ribbon 六色（裝飾 only）：`#c5161b` `#f6771e` `#eba207` `#8db12a` `#078f53` `#0b9d95`  
- **禁止**：純黑填滿、黑白線稿、暗色全幅背景  

### 檔案格式總則

| 類型 | 格式 | 色彩模式 | 透明 | 其他 |
|------|------|----------|------|------|
| Logo／icon 向量 | **SVG 1.1** | sRGB；填色寫 hex 或 `currentColor` | 要 | 無外部字型依賴；path 合併；viewBox 必填 |
| 柵格 logo／icon | **PNG-24** | sRGB | 要（alpha） | 勿 JPEG（會有白邊） |
| 空狀態插畫 | **WebP**（主）+ PNG 備援可選 | sRGB | **建議透明底** 或象牙底 `--bg` | 勿 JPG 黑底 |
| Landing／OG | **WebP** 或 PNG | sRGB | hero 可滿版象牙；OG 可滿版 | 勿黑底 |
| 色票 | **ASE**（AI/PS）+ **PNG 一覽圖** | sRGB | — | 每格標 CSS 變數名 |
| 紋理 | WebP | sRGB | 可 | 對比極低，不影響文字 AA |

**命名**：小寫、kebab-case、英文 id（見 §0.2 G）。  
**色空間**：全檔 sRGB；交付前關閉 CMYK。  
**不要**：AI 連結未轉曲的外字、PSD 當唯一交付、未標 1x/2x 的模糊圖。

### 逐項欄位模板（清單用）

每項交付請填（或對照下表）：

```
ID / 名稱
格式：      SVG | PNG | WebP | ASE
尺寸：      W×H px（或 viewBox）
@2x：       要 / 不要
透明底：    要 / 象牙底 #f3f0e8 / 卡面 #fffefa
主色：      只用 token hex（禁止 #000）
描邊：      暖石 #292524 或 currentColor；線寬 …
檔名：      client/public/design/...
文案對照：  EmptyState title（若有）
狀態：      新建 | 精修
```

---

## 0.2 完整 Adobe 生成 checklist（含次優先＋既有資產）

> 狀態語意：**精修**＝repo 已有可用檔，要 SVG／統一品質母版；**新建**＝程式只有 icon 文案或破圖，沒有插畫資產。  
> 建議檔名落點：`client/public/design/`（新）或既有 `client/public/brand/`、`client/public/icons/`。  
> **色：遵守 §0.0，不要黑色。**

### A. 第一波 — 必交（解鎖 W0 + 主路徑體感）

#### A 清單總表

| ID | 產出 | 狀態 | 既有／對照 | 程式錨點 |
|----|------|------|------------|----------|
| **A0-1** | CSS 色票板 ASE/PNG | **新建** | `styles.css` `:root` | 對稿用 |
| **A0-2** | Wordmark SVG 全彩 | **精修** | `logo-aios-color-v2.png` 等 | `brand.ts` |
| **A0-3** | Wordmark SVG mono（**暖石，非黑**） | **精修** | `logo-aios-mono.png` | monochrome |
| **A0-4** | App mark 1024 + maskable | **精修** | `icon-aios-v2-1024` 等 | PWA |
| **A0-5** | Favicon / Apple touch 對齊 | **精修** | favicon-v2* | `index.html` |
| **A0-6** | Icon 61 × 24px SVG | **新建套件** | `Icon.tsx` paths | `design/icons/` |
| **A1-1**…**A1-7c** | 空狀態插畫 | **新建** | 僅 icon+文案 | 見詳細格式 |
| **A2-1** | Landing hero | **新建** | Landing 文案+logo | `LandingPage` |
| **A2-2** | OG 分享圖（可選） | **新建** | — | meta |

#### A 詳細格式（逐項）

| ID | 名稱 | 格式 | 尺寸 / viewBox | 透明／底 | 用色（禁止 #000） | 檔名建議 |
|----|------|------|----------------|----------|-------------------|----------|
| **A0-1** | 色票板 | ASE + PNG 一覽 | PNG 一覽 ≥ 1200px 寬；每色方塊標 token 名 | 淺象牙底 `#f3f0e8` | 只含 token 色；**不放 #000** | `design/swatches/aios-tokens.ase` + `aios-tokens.png` |
| **A0-2** | Logo 全彩 | **SVG**（主）+ PNG 720×316 可選 | viewBox 對齊現有約 **720×316**；@2x PNG 1440×632 可選 | **透明底** | 品牌橘＋ribbon 點綴；文字／圖形 **勿黑** | `design/brand/logo-aios-color.svg` |
| **A0-3** | Logo mono | **SVG** | 同 A0-2 比例 | **透明底** | **單色 `#292524`（--fg）**，禁止 black mono | `design/brand/logo-aios-mono.svg` |
| **A0-4** | App mark | PNG-24 | **1024×1024**；另出 maskable：重要內容在中心 **約 80%** safe zone | 透明或象牙；maskable 可滿版淺底 | 同品牌；**背景不要黑** | `design/brand/mark-aios-1024.png` · `mark-aios-1024-maskable.png` |
| **A0-5** | Favicon 套 | PNG | 32、16、180（apple）、192、512 與既有 v2 對齊 | 透明 | 同 mark；**不要黑底 favicon** | 可覆寫 `favicon-v2*` 前先出 v3 母版 |
| **A0-6** | UI Icons | **SVG** ×61 | viewBox **`0 0 24 24`**；視覺對齊 24px grid；stroke **1.5–2** | 透明 | stroke/fill = **`currentColor`**（執行時吃 `--fg` 暖石）；**禁止寫死 #000** | `design/icons/{name}.svg` |
| **A1-1** | 空·還沒有素材 | WebP（主） | 顯示寬 **320–640** CSS px；出圖 **≥640px** 寬（@1x）；可選 @2x | **透明** 或底 `#f3f0e8` / `#fffefa` | 線與形：`#292524` / `#67615b` / `#e05a10`；**無黑色塊** | `design/empty/no-assets.webp` |
| **A1-2** | 空·還沒有資料庫 | 同 A1-1 | 同 | 同 | 同 | `design/empty/no-database.webp` |
| **A1-3** | 空·筆記／排程 | 同 A1-1 | 同 | 同 | 同 | `design/empty/no-planner.webp` |
| **A1-4** | 空·沒靈感（主打） | 同 A1-1 | 可略大至 **800px** 寬 | 同 | 溫暖引導；**禁止 AI 機器人+黑底** | `design/empty/no-inspiration.webp` |
| **A1-5** | 空·素材遺失 | 同 A1-1 | 同 | 同 | 與 A1-1 **構圖可區分**（如裂縫／缺角），仍非黑色驚嘆 | `design/empty/media-missing.webp` |
| **A1-6** | 空·回饋／社群 | 同 A1-1 | 同 | 同 | 同 | `design/empty/no-feedback.webp` |
| **A1-7a** | 空·還沒有角色 | 同 A1-1 | 同；**三張一組風格統一** | 同 | 同 | `design/empty/no-character.webp` |
| **A1-7b** | 空·還沒有場景 | 同 | 同 | 同 | 同 | `design/empty/no-scene.webp` |
| **A1-7c** | 空·還沒有道具 | 同 | 同 | 同 | 同 | `design/empty/no-prop.webp` |
| **A2-1** | Landing hero | WebP 或 PNG | **桌 1440×810**（約 16:9）· **手機 390×844** 或 390 寬×自高 | 滿版象牙／紙感；**禁止黑全幅** | 主視覺橘＋象牙；字若進圖用 `#292524` | `design/marketing/landing-hero-desktop.webp` · `…-mobile.webp` |
| **A2-2** | OG 圖（可選） | PNG 或 WebP | **1200×630** | 滿版淺底 | 同品牌；**禁止黑底白字** | `design/marketing/og.png` |

**A0-6 Icon 名單（61）**（檔名 kebab；SVG 內 `currentColor`，**不要黑色**）：  
`arrow-right, bell, calendar-plus, camera, check, check-circle-2, chevron-down, chevron-right, chevron-up, circle-stop, clapperboard, clock, copy, database, download, ellipsis, file-text, film, gem, hard-drive, help-circle, image, info, lightbulb, loader, lock, message-circle, mic, monitor, mouse-pointer-2, music, package, palette, pause, pencil, play, plus, rotate-ccw, rotate-cw, scale, search, send, share-2, skip-back, skip-forward, sliders-horizontal, smartphone, sparkles, square, star, tablet, tag, trash-2, triangle-alert, trophy, undo-2, unlock, user, volume-2, waypoints, x-circle`

### B. 第二波 — 創作／殼／定裝／分鏡（有 Figma 後對齊）

| ID | 產出 | 狀態 | 程式錨點／文案 |
|----|------|------|----------------|
| **B1** | 今日工作台空（還沒有專案） | 新建 | `FirstRunGuide` / Launchpad 空 |
| **B2** | 未分組「還差一步」 | 新建 | `AppRoutes` Ungrouped「你已成功加入 ✓ 還差一步」 |
| **B3** | 還沒有生成紀錄 | 新建 | `GenerationList` |
| **B4** | 還沒有執行軌跡 | 新建 | `CreationResourceDrawer` |
| **B5** | 還沒有提示詞 | 新建 | `PromptLibrary` |
| **B6** | 還沒有素材知識 | 新建 | `KnowledgeBase` |
| **B7** | 媒體類型 icon 一組（image / video / audio / doc） | 新建 | `ModelPicker` 類別 |
| **B8** | 分鏡：這一格還沒有畫面／版本 | 新建 | `SceneStudio` |
| **B9** | 分鏡列表：此狀態無分鏡 | 新建 | `SceneList` |
| **B10** | 匯出完成輕插畫（可選） | 新建 | `ExportJobButton` |
| **B11** | 桌面版連接插畫 | 新建 | `DesktopCompanionPage`「需要 Aios 桌面版」 |
| **B12** | 私訊／聊天空狀態 | 新建 | `ChatEmptyState`「選一位夥伴開始聊」 |
| **B13** | 頂欄 brand mark 精修（可選） | 精修 | `AppHeader` / `.brand` |
| **B14** | Splash 極淡背景氛圍（可選） | 新建／精修 | `SplashScreen` · `splash.css` |
| **B15** | 錯誤邊界「畫面出了點狀況」輕插畫（可選） | 新建 | `main.tsx` ErrorBoundary |
| **B16** | 金鑰已接上／個人·0 點 小標示（可選） | 新建 | BYOK / Integrations 徽章 |

#### B 詳細格式

| ID | 格式 | 尺寸 | 底／透明 | 用色 | 檔名建議 |
|----|------|------|----------|------|----------|
| **B1–B6, B8–B12, B15** | WebP | 同 A1：顯示 320–640、出圖 ≥640 寬 | 透明或 `#f3f0e8` / `#fffefa` | 暖石+橘；**無 #000** | `design/empty/no-project.webp`、`no-group.webp`、`no-generations.webp`、`no-trace.webp`、`no-prompts.webp`、`no-knowledge.webp`、`scene-empty.webp`、`scene-list-empty.webp`、`export-done.webp`、`desktop-connect.webp`、`chat-empty.webp`、`error-boundary.webp` |
| **B7** | SVG ×4 | viewBox 24×24 或 32×32 | 透明 | `currentColor` 或 `#292524`；**勿黑** | `design/icons/type-image.svg` 等 |
| **B10** | WebP 可選 | 同空狀態 | 同 | 成功可用 `--success` `#12934f` 點綴，仍非黑 | 見上 |
| **B13** | PNG/SVG | 與 mark 一致 | 透明 | 同 A0-4 | brand 精修 |
| **B14** | WebP | 桌 1920 寬可選；極淡 | 象牙系 | 幾乎無對比；**禁止暗色 splash** | `design/marketing/splash-wash.webp` |
| **B16** | SVG 小標 | 16–20px | 透明 | primary tint + ink | `design/icons/badge-byok.svg` |

### C. 第三波 — 可選加深

| ID | 產出 | 備註 |
|----|------|------|
| **C1** | 模型指南 ~12 類小插圖 | `ModelsPage`；工作量大、優先低 |
| **C2** | 社群靈感牆空狀態精修 | 可與 A1-6 共用或變體 |
| **C3** | 紙質紋理 WebP（低對比，不改可讀對比） | 貼 `--bg`／`--card` |
| **C4** | Brand ribbon 靜態 SVG 預覽 | `--brand-ribbon` |
| **C5** | 共創四 phase 小標示 | theme→structure→visuals→wrap |
| **C6** | 定裝包封面樣式 | CostumePack 可選 |
| **C7** | 地圖還是空的（Planner 關係圖） | `PlannerPage` |
| **C8** | 沒有符合的模型（搜尋空） | `ModelsPage`；多半不必插畫 |
| **C9** | 範本收藏即將推出 | drawer 占位；可延後 |
| **C10** | 世界觀範例卡裝飾 | `WorldviewExampleCard` |

#### C 詳細格式

| ID | 格式 | 尺寸 | 用色／注意 |
|----|------|------|------------|
| **C1** | WebP 或 SVG | 64–128px 顯示 | 12 類一組；淺底；**勿黑卡** |
| **C2** | 同 A1 | 同 A1 | 同 A1-6 變體 |
| **C3** | WebP 可 tile | 512×512 tile | 低對比象牙噪點；**不要變灰黑** |
| **C4** | SVG | 寬 240–480 | 僅 ribbon 六色漸層，無黑 |
| **C5** | SVG ×4 | 24–32px | 暖石線 + primary 現在步驟 |
| **C6–C10** | WebP/SVG | 視場景 | 一律遵守 §0.0 禁黑 |

### D. 程式 EmptyState 文案 ↔ 插畫對照（盤點日）

下列皆為 **EmptyState 元件實際 title**（方便設計對 copy）：

| 文案 | 建議插畫 ID |
|------|-------------|
| 還沒有素材—— | A1-1 |
| 還沒有資料庫 | A1-2 |
| 還沒有資料表關聯到這個專案 | A1-2 變體 |
| 還沒有筆記 / 接下來沒有排程 / 還沒有任何行程 | A1-3 |
| 還沒有角色 / 還沒有場景 / 還沒有素材設定 | A1-7a–c |
| 還沒有生成紀錄—— | B3 |
| 還沒有執行軌跡—— | B4 |
| 還沒有提示詞—— | B5 |
| 還沒有素材知識 | B6 |
| 這一格還沒有畫面 / 還沒有版本 | B8 |
| 這個狀態目前沒有分鏡 | B9 |
| 選一位夥伴開始聊 | B12 |
| 這項功能需要 Aios 桌面版 | B11 |
| 你已成功加入 ✓ 還差一步 | B2 |
| 還沒有回饋 | A1-6 |
| 畫面出了點狀況 | B15 |
| 這張地圖還是空的 | C7 |
| 沒有符合的模型 | C8 |
| 範本收藏（即將推出） | C9 |
| 不知道要填什麼？先抄這一份 | C10（裝飾即可） |

### E. 既有品牌檔（精修時勿丟版本）

| 路徑 | 說明 |
|------|------|
| `client/public/brand/logo-aios-color-v2.png` (+@2x) | 現行全彩 wordmark |
| `client/public/brand/logo-aios-color-embedded.svg` | 已有 SVG 形，需否精修由設計評 |
| `client/public/brand/logo-aios-mono.png` | 單色 |
| `client/public/brand/icon-aios-v2-{192,512,1024}.png` | mark 柵格 |
| `client/public/icons/icon-v2-*-maskable.png` | PWA maskable |
| `client/public/favicon-v2*` · `apple-touch-icon-v2.png` | 瀏覽器／iOS |

**精修原則**：新檔用 `-v3` 或替換後改 `brand.ts` 路徑；保留一版舊檔直到上線驗證。

### F. 不要交給 Adobe（再強調）

| 不做 | 原因 |
|------|------|
| **任何純黑／#000／黑底白字稿** | 違反 §0.0；產品是暖象牙紙，不是暗色模式 |
| tRPC／權限／quota／DAG 流程圖 | 工程規格 |
| 模型價目／供應商目錄圖 | 商業資料常變 |
| 第二套色系、Tailwind 新 kit | token 單一真相 |
| 重 Lottie／3D 第一期 | 體積與維護 |
| Adobe OAuth 修圖 UI 重做 | 屬 #224 產品整合，非本 brief |

### G. 建議交付檔名（第一波）

```
client/public/design/
  swatches/aios-tokens.ase          # 或 .png 色票板
  brand/logo-aios-color.svg
  brand/logo-aios-mono.svg
  brand/mark-aios-1024.png
  brand/mark-aios-1024-maskable.png
  icons/{arrow-right,sparkles,...}.svg   # 61
  empty/no-assets.webp
  empty/no-database.webp
  empty/no-planner.webp
  empty/no-inspiration.webp
  empty/media-missing.webp
  empty/no-feedback.webp
  empty/no-character.webp
  empty/no-scene.webp
  empty/no-prop.webp
  marketing/landing-hero-desktop.webp
  marketing/landing-hero-mobile.webp
  marketing/og.png                    # 可選
```

第一波完成定義：**A0-\* + A1-\* + A2-1** 可下載；Figma 可先只有 W0 變數綁這些資產。

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

> **完整逐項 ID（A0–C10、EmptyState 對照、既有檔、建議檔名）見 §0.2。**  
> 下表是 Pack 別名，與 §0.2 第一波對齊。

### Pack 0 — 週內可交（解鎖 W0）＝ §0.2 A0-\*
| ID | Adobe 產出 | 規格 | 程式落點 |
|----|------------|------|----------|
| P0-1 (=A0-1) | CSS 色票板 | ASE/PNG 標 `--primary` 等名 | 對稿用 |
| P0-2 (=A0-2/3) | Logo SVG 全彩 + mono | 透明、viewBox | `public/brand/` |
| P0-3 (=A0-4/5) | App icon 1024 + maskable | safe zone 80% | `public/icons/` |
| P0-4 (=A0-6) | Icon set 24px SVG（上列 61） | 1.5–2px stroke、單色 currentColor | 可替 `Icon.tsx` |

### Pack 1 — 空狀態插畫（解鎖 W1–W5 體感）＝ §0.2 A1-\*
| ID | 場景文案（現有 EmptyState） | 建議構圖 |
|----|---------------------------|----------|
| P1-1 (=A1-1) | 還沒有素材 | 相機／畫板溫和空 |
| P1-2 (=A1-2) | 還沒有資料庫 | 表格輪廓 |
| P1-3 (=A1-3) | 還沒有筆記／排程 | 日曆空白 |
| P1-4 (=A1-4) | 沒靈感／陪你做完 | 溫暖引導，非「AI 機器人」 |
| P1-5 (=A1-5) | 素材遺失 | 與「未生成」可區分 |
| P1-6 (=A1-6) | 還沒有回饋／社群空 | 輕插畫 |
| P1-7 (=A1-7a–c) | 角色／場景／道具空定裝 | 三張一組 |

規格：SVG 或 WebP；**主色僅用 `--primary` / 中性**；淺底 `--bg`/`--card`；寬 320–640 CSS px；2x 可選。

### Pack 2 — 行銷／Landing ＝ §0.2 A2-\*
| ID | 產出 |
|----|------|
| P2-1 (=A2-1) | Landing hero（桌 1440、手機 390） |
| P2-2 (=A2-2) | OG／分享圖（可選） |

### Pack 3 — 第二／三波 + Figma ＝ §0.2 B\* / C\* + overall W0–W7
W0 元件庫 → W1 殼 → W2 工作台 → W3 共創 → W4 定裝 → W5 分鏡 → W6 設定 → W7 手機。  
Adobe 第二波插畫（生成紀錄、軌跡、分鏡格、桌面連線、私訊…）見 **§0.2 B**；可選加深見 **§0.2 C**。

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

**產品**：Aios（AI 創作作業系統）— **暖象牙底**、赤陶橘 CTA、紙質卡面。  

**請做**（詳細格式見 **§0.0 + §0.2 A 詳細格式表**）：  
1）色票對齊 CSS 變數；2）Logo／App icon 精修 SVG；3）61 icon 統一（`currentColor`）；4）空狀態插畫；5）Landing hero。  

**顏色（最重要）**：  
- **不要黑色**（不要 `#000`、不要黑底、不要黑白線稿）  
- 最深只用暖石 **`#292524`**（`--fg`）  
- 底用 **`#f3f0e8` / `#fffefa`**；主色 **`#e05a10`**  

**請在 Figma**：W0 元件庫 + 主路徑（定調／創作／交付／共創）桌機＋手機。  
**不要**：改後端流程；另起 Tailwind 色票；暗色模式全套。

**程式聯絡錨點**：  
`styles.css` · `brand.ts` · `components/ui/*` · `features/creation-workbench/*` · `features/co-create/*` · `ProjectPage` · `SceneList` · `GenerationList` · `CostumePackSection`。

---

## 14. 下一步（非本任務）

1. 設計回覆：Figma 連結（可先 W0+W1）+ 是否延續佛系影視調性。  
2. Adobe 交 Pack 0＋Pack 1。  
3. 終端開 `feat/design-w0-tokens` 僅在有稿後改 CSS／資產路徑。

---

*本檔由程式碼盤點產生；行為與 API 以現有實作為準。*
