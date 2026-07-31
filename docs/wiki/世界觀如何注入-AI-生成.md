# 世界觀如何注入 AI 生成

## 一句話結論

**會真的被送進模型**，但：

- 不是每一種生成都注入  
- 對 **LLM／導演／代理** 是強上下文  
- 對 **圖／影擴散模型** 是弱錨（soft bias），主控仍是當格 prompt + 風格／調性（含英文錨）

程式單一真相：`server/services/generationCore.ts` 的 `effectivePromptParts`。  
測試鎖住行為：`server/services/generationCore.test.ts`（含「正向必須含 `故事錨點`」）。

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
| 文生圖／圖生圖／文生影／圖生影 | ✅ | `formatWorldviewVisualPositive` |
| LLM（旁白、腳本等） | ✅ | `generation-llm` |
| AI 導演拆分鏡 | ✅ | `director` |
| AI 代理規劃／專案助手／留言助手 | ✅ | `brief`（`一句話：…`） |
| 交付匯出鏡頭表 | ✅（寫進文件，非模型） | `export` |
| TTS 旁白 | ❌ 原樣 prompt | 避免唸出「故事錨點」 |
| 配樂／音效（text-to-audio） | ❌ | 敘事句對音頻是雜訊 |
| 轉錄／訓練等 | ❌ | 不適用 |

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
| 調性／視覺風格 | 畫面定盤：看起來像什麼 |
| 關鍵訊息 | 主張定盤：要傳達什麼 |
| 角色／場景卡 | 外觀與光影跨鏡一致（另注入） |

**不要指望一句 logline 取代每格 prompt**；它是自動帶的背景，不是唯一旋鈕。

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
- 注入與禁忌分流：`server/services/generationCore.ts`  
- 導演：`server/routers/director.ts`  
- 代理 brief：`server/services/agentCore.ts`  

空 logline → 不出現 `故事錨點:` 那一段；其他有填的欄位仍可注入。

---

## 給非工程的檢查清單

1. 專案頁填好 **一句話故事** + 至少一項 **調性或風格**  
2. 用文生圖或 LLM 生成一次  
3. 若開「顯示實際 prompt」或查生成紀錄，應能看到 `[專案背景]` 與 `故事錨點`  
4. 用 TTS 唸旁白時，**不應**出現世界觀注入句（設計如此）
