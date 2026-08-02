# 世界觀如何注入 AI 生成

## 一句話結論

**會真的被送進模型**，但：

- 不是每一種生成都注入  
- 對 **LLM／導演／代理** 是強上下文  
- 對 **圖／影擴散模型** 是弱錨（soft bias），主控仍是當格 prompt + 風格／調性（含英文錨）

程式單一真相：`server/services/generationCore.ts` 的 `effectivePromptParts`。  
測試鎖住行為：`server/services/generationCore.test.ts`（含「正向必須含 `故事錨點`」）。

---

## 在畫面上直接看（不必再猜）

專案頁「這支片的固定設定」卡片裡有一塊 **「AI 會收到什麼？」**（`#wv-inject-preview`），
直接顯示下面這幾段字的實際內容，改一個 chip 就即時跟著變。

- 元件：`client/src/components/WorldviewPreview.tsx`
- 內容一律取自 `buildWorldviewInjectPreview`（`shared/worldview.ts`），
  它只轉手 `formatWorldviewVisualPositive` / `formatWorldviewVisualNegative` /
  `formatWorldviewForAi(…, "generation-llm")`——**與 generationCore 同一批函式**。
- 防漂移測試在 `server/services/generationCore.test.ts`：斷言預覽輸出與
  `effectivePromptParts` 實際送出的字逐字相等。任一邊改了組法，測試先紅。

定裝卡錨點只印標記與當下勾選張數，**不預組內容**——那三段由伺服器依 DB 組
（`cardAnchors.ts`），前端沒有等價輸入。

> UI 用語：這一區在畫面上叫「**這支片的固定設定**」（原「專案基調與世界觀」），
> 欄位叫「這支片在講什麼？／看完要記得哪一句？／故事走向／氣氛／畫風」。
> 程式與本文件的欄位鍵仍是 `logline` / `message` / `themes` / `tones` / `styles`。

---

## 實際送出長什麼樣？

使用者只打：`清晨安靜的室內`  
世界觀有 logline／調性／風格時，視覺模型實際 prompt 類似：

```text
清晨安靜的室內

[專案背景] 調性:溫暖(warm, gentle)|視覺風格:寫實攝影(photorealistic photography)|故事錨點:一位訪客走進安靜的工作室…|核心訊息:…
```

- **一句話故事** → `故事錨點:…`（約 **80 字**截斷，`LOGLINE_INJECT_MAX`，避免每鏡爆 token）  
- **禁忌** → 圖／影走 **negative_prompt**，不塞正向（避免合規句被畫成畫面文字）

---

## 哪些路徑會吃？

| 路徑 | 是否注入 logline／世界觀 | 格式模式 |
|------|--------------------------|----------|
| 文生圖／圖生圖／文生影／圖生影 | ✅ 快速層＋禁忌負向 | `formatWorldviewVisualPositive`（**不含**觀眾／三幕／人物） |
| LLM（旁白、腳本等） | ✅ 含短進階 | `generation-llm` |
| AI 導演拆分鏡 | ✅ 進階全文 | `director` |
| AI 代理規劃／專案助手／留言助手 | ✅ 含進階（截斷） | `brief` |
| 交付匯出鏡頭表 | ✅（寫進文件，非模型） | `export`（含參考連結） |
| TTS 旁白 | ❌ 原樣 prompt | 避免唸出「故事錨點」 |
| 配樂／音效（text-to-audio） | ❌ | 敘事句對音頻是雜訊 |
| 轉錄／訓練等 | ❌ | 不適用 |

### 進階欄位誰吃？（與 UI 徽章一致）

| 欄位 | 圖影 | 文字生成 | 助手／代理 | 導演 | 匯出 |
|------|------|----------|------------|------|------|
| 目標觀眾 | ❌ | ✅ 截斷 | ✅ 截斷 | ✅ | ✅ |
| 三幕 | ❌ | ✅ 截斷 | ✅ 截斷 | ✅ | ✅ |
| 敘事人物 | ❌（請用角色卡） | ✅ 截斷 | ✅ 截斷 | ✅ | ✅ |
| 禁忌 | ✅ 負向 | ✅ 避免 | ✅ | ✅ | ✅ |
| 參考連結 | ❌ | ❌ | ❌ | ❌ | ✅ 備註 |

常數：`WORLDVIEW_FIELD_READERS`、`ADVANCED_INJECT_MAX`（`shared/worldview.ts`）。

注入類別集合（程式）：`text-to-image`、`image-to-image`、`text-to-video`、`image-to-video`、`llm`。

---

## 「真的有用」到什麼程度？

| 消費者 | 意義 | 強度 |
|--------|------|------|
| LLM／導演／代理 | 知道整支片在講什麼，較不易跑題 | **高** |
| 圖像／影片模型 | 多一點情境語彙當方向 | **中偏低**（長中文故事句常被當弱訊號） |
| 風格／調性 chips | 畫風一致 | 出圖往往 **比 logline 更有效**（中英雙語） |

### 分工（建議怎麼填）

| 欄位 | 作用 |
|------|------|
| 一句話故事 | 敘事定盤：整片講什麼 |
| 調性／視覺風格 | 畫面定盤：看起來像什麼（見下方 chips 規則） |
| 關鍵訊息 | 主張定盤：要傳達什麼（詳見 [世界觀與一句關鍵訊息](世界觀與一句關鍵訊息)） |
| 角色／場景卡 | 外觀與光影跨鏡一致（另注入；場景詳見 [場景設定卡](場景設定卡)） |

**不要指望一句 logline 取代每格 prompt**；它是自動帶的背景，不是唯一旋鈕。

### Chips 怎麼進 AI（主軸／調性／風格）

| 規則 | 說明 |
|------|------|
| **風格＝家族×主風格×質感** | 媒材互斥；主風格准單選；同家族質感 0～1；`stylesForVisualInject` |
| **調性／主軸順序＝優先** | 陣列第一個＝**主要**；其餘＝備選 |
| **圖影注入** | 主風格＋同家族質感（跨家族舊資料只留可解析主風格）；調性最多 **2**；主軸**不**進圖影 |
| **LLM** | 風格同注入列表、調性 2、主軸 2 |
| **導演／代理／助手** | `formatWorldviewStylesLabel`；超標／跨家族附「選項提示」 |
| **UI** | 家族分頁 + 主風格 + 質感；固定「出圖風格」；一鍵收斂舊資料 |
| **改主要（調性／主軸）** | 專案頁「改主要」列，或 Shift+點已選非主要 chip |

常數：`CHIP_SOFT_MAX`、`VISUAL_INJECT_MAX`、`LLM_INJECT_MAX`、`STYLE_FAMILY_*`（`shared/worldview.ts`）。

---

## 工程對照

```
使用者 prompt
    +
[專案背景] formatWorldviewVisualPositive / formatWorldviewForAi
    +
（視覺）[角色定裝] / [場景設定]
    →
effectivePromptParts → provider（fal 等）
```

- Schema／截斷／格式：`shared/worldview.ts`  
- **注入標記與負向組法**：`WORLDVIEW_INJECT_MARKER`、`CARD_ANCHOR_MARKERS`、
  `formatWorldviewVisualNegative`、`formatWorldviewInjectedPrompt`（`shared/worldview.ts`）——
  前後端共用，前端預覽不得自行拼字串  
- **注入類別集合**：`WORLDVIEW_INJECT_CATEGORIES`（`shared/models.ts`）  
- 注入與禁忌分流：`server/services/generationCore.ts`  
- 導演：`server/routers/director.ts`  
- 代理 brief：`server/services/agentCore.ts`  

空 logline → 不出現 `故事錨點:` 那一段；其他有填的欄位仍可注入。

---

## 給非工程的檢查清單

1. 專案頁填好 **這支片在講什麼？** + 至少一項 **氣氛或畫風**  
2. 展開該卡的 **「AI 會收到什麼？」**，先看預覽長什麼樣  
3. 用文生圖或 LLM 生成一次  
4. 查生成紀錄的 prompt，應與步驟 2 的預覽**逐字相同**（含 `[專案背景]` 與 `故事錨點`）  
5. 用 TTS 唸旁白時，**不應**出現世界觀注入句（設計如此）
