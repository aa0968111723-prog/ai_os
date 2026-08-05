# 計畫：整體 Adobe → Figma → 程式（全產品設計轉碼）

> 狀態：**待設計稿交付後終端分波實作**（本 PR 僅計畫）  
> 分支：`plan/overall-adobe-figma-code` → base `claude/healing-migration-ai-os-erewp2`  
> 觸發：使用者確認「是要整體的」——Adobe 生素材 → Figma 排版 → AI／終端寫程式（2026-08-05）  
> 相關：#400 工作台、#402 上下文、#404 陪你做完、#408 反固著設計約束

---

## 1. 一句話

**整站視覺與版面以 Figma 為準**；素材在 Adobe 產；程式在既有 `client`（React + `styles.css` token）落地，不另起技術棧。

---

## 2. 管線（整體）

```
┌─────────────┐    ┌──────────────┐    ┌─────────────────────────┐
│ Adobe       │ →  │ Figma        │ →  │ 程式（本 repo）           │
│ 生素材／繪製 │    │ 排版／元件庫  │    │ React + CSS 變數 + 既有  │
│ Firefly/PS  │    │ 狀態／RWD    │    │ components／features     │
└─────────────┘    └──────────────┘    └─────────────────────────┘
        ↑                  │                      │
   品牌調性／圖資產      單一真相來源            PR 對稿實作
```

| 階段 | 負責人 | 產出 |
|------|--------|------|
| **素材** | 設計（Adobe） | 圖、icon、紋理、空狀態插畫、行銷圖；匯出 SVG／PNG／WebP |
| **排版** | 設計（Figma） | 全站 frame、auto-layout、元件變體、桌機＋手機、註明 token |
| **轉碼** | 終端／AI | 對齊 Figma 的元件與頁面；接既有 tRPC／權限／扣點邏輯 |

**AI（Grok／終端）不直接登入 Adobe／Figma 改檔**；需可檢視連結、匯出規格或標註截圖。

---

## 3. 範圍：整體＝哪些面

### 3.1 必須進 Figma 的產品面（優先序）

| 波次 | 產品面 | 現有程式錨點（約） |
|------|--------|-------------------|
| **W0** | 設計系統：色、字、間距、圓角、按鈕、卡片、Chip、表單 | `client/src/styles.css`、`components/ui` |
| **W1** | 專案主殼：導航、專案列表、專案頁 stage（定裝／創作／交付） | `ProjectPage`、layout |
| **W2** | AI 創作工作台（含空狀態、模式切換、目標框） | `CreationWorkbench`、modes |
| **W3** | 陪你做完共創殼（對話＋進度＋摘要） | 對齊 #404／#408 |
| **W4** | 定裝／專案上下文（世界觀、角色卡、接縫） | 對齊 #402 |
| **W5** | 分鏡與生成結果、審批、打包匯出 | scenes／generation／export |
| **W6** | 設定／點數／BYOK、登入與權限提示 | settings、PersonalAiKeyCard |
| **W7** | 行動版與窄屏（含 FAB 等既有 mobile 樣式） | `styles.mobile-fab-01.css` 等 |

### 3.2 明確不在本計畫第一期

- 重寫後端 API 契約  
- 換成 Tailwind／新 UI kit（除非 Figma 強制且另開決策）  
- 產品內嵌「Adobe／Figma 編輯器」當功能（若要做另開產品 PR）  

---

## 4. Figma 交付規範（設計側 checklist）

```
[ ] F0  檔案可檢視連結（或組織內 invite）
[ ] F1  頁面／Frame 命名對應上表 W0–W7（英文 id + 中文標）
[ ] F2  元件用 Component + Variants（default／hover／disabled／loading）
[ ] F3  主流程用 Auto layout（對應 flex）；避免純絕對定位整頁
[ ] F4  色與字綁 Variables，並註明應對現有 CSS：--primary、--fg、--card 等
[ ] F5  每個主畫面：Desktop + Mobile 兩套
[ ] F6  空狀態、錯誤、無權限、扣點確認 各至少一幀
[ ] F7  素材層：Adobe 匯入圖放 Assets；標 1x／2x 或 SVG
[ ] F8  註解「行為」：哪些按鈕只帶入不扣點、哪些要 Confirm（對齊 #408）
```

### 與現有 token 對齊（轉碼時優先映射，勿發明第二套色）

轉碼前先讀 `client/src/styles.css` 與 `styles.contract.test.ts`：  
新視覺若改色／字級，**先改 CSS 變數與合約測試**，再改元件，避免漂移。

---

## 5. 程式轉碼規範（終端側）

```
[ ] C1  一畫面一 PR 或同波次一 PR；描述附 Figma frame 連結／截圖
[ ] C2  優先改既有元件，不複製平行實作
[ ] C3  樣式走 CSS 變數與既有 ui（Button、Card、Chip、Hint…）
[ ] C4  行為不變：權限、Confirm、quota、runAction 契約
[ ] C5  對照 #408：共創相關畫面遵守反固著（多選項、複述確認）
[ ] C6  桌機＋手機手動過一遍；跑既有 client 測試
[ ] C7  靜態資產進 repo 約定路徑（如 client/public/design/）並壓縮
```

### 轉碼輸入優先序

1. Figma 連結 + Dev Mode 規格  
2. 標註清楚的 frame 匯出 PNG＋間距表  
3. 僅截圖（最弱，僅能近似）

---

## 6. 與功能計畫的關係（整體不互相踩）

| 計畫 | 在整體管線中的位置 |
|------|-------------------|
| #400 工作台減噪 | W2 排版時一併做資訊層級；程式可與視覺同 PR 或先行為後視覺 |
| #402 上下文一體 | W4 版面表達「定裝↔工作台↔分鏡」接縫 |
| #404 陪你做完 | W3 先有流程也可先用現有殼；**建議 Figma 有稿再精修視覺** |
| #408 反固著 | 設計稿必須體現 3 chip／複述／主 CTA；轉碼 checklist 勾 D 項 |

**建議順序：**  
W0 設計系統 → W1 殼 → W2＋W3（創作主路徑）→ W4→W5→W6→W7。  
功能邏輯（#404 G0–G2）可與 W3 視覺：先可跑，再貼 Figma 視覺。

---

## 7. 里程碑

| 里程碑 | 完成定義 |
|--------|----------|
| **M0** | Figma 檔建立；W0 變數與基礎元件定稿 |
| **M1** | W1＋W2 稿可檢視；第一波轉碼 PR 合併（主殼或工作台） |
| **M2** | W3＋W4 稿＋轉碼；共創與定裝視覺一體 |
| **M3** | W5–W7；全站主路徑桌機／手機對稿通過 |

---

## 8. 風險

| 風險 | 緩解 |
|------|------|
| 稿與程式長期脫節 | 每波 PR 必附 frame；合併後在 Figma 標「已上線 commit」 |
| 第二套設計語言 | 強制映射 `styles.css`；新色先改變數 |
| 範圍爆炸 | 嚴格 W0–W7；行銷落地頁可另檔 |
| 無稿就大改 CSS | 禁止；無 Figma 時只做 #400／#404 行為，不重畫整站 |

---

## 9. 立刻需要設計側提供

1. Figma 檔連結（可先只有 W0＋W1 草稿）  
2. 品牌方向一句（既有佛系／影視工具調性是否延續）  
3. Adobe 素材是否已有（logo、空狀態圖）或需程式先用 placeholder  

有 **M0 連結** 後，終端從 W0／W1 開 `feat/design-w0-tokens` 等實作 PR。

---

## 10. 回滾

視覺 PR 應可獨立回退；不與 migration／quota 綁同一 PR。  
Feature flag 可選：新殼 class 掛 `data-design="v2"` 方便對照。
