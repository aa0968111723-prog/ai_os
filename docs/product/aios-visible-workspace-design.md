# Aios Visible Creative Workspace — 設計契約

> **本文件不改後端、不定義 semantic schema。**
> Creative Direction / variant runtime / proposal runtime / generation contract 全部由 v4 主工程負責。
> 這裡只回答一個問題：**那些真相，畫面上應該長什麼樣。**

Base：`70fcbda7`（CURRENT default，含 #722 / #723）。
原型：`/prototype/visible-workspace`（PROTOTYPE ONLY，全 fixture，不呼叫任何 API）。

---

## 1. 問題陳述

底層經過 #707 / #710 / #722 / #723 / v4 多輪升級，但使用者打開 Aios 的第一眼沒有變。
原因不是「功能不夠」，是**版面把畫素分配給了錯的東西**。

### Before：實際量測（1440×900）

`AICreativeCopilot` 唯一的正式掛載點是 `GlobalAssistantSheet.tsx:168`，
桌機幾何由 `styles.css:8443-8449` 決定：

```css
@media (min-width: 821px) {
  .menu-surface.is-sheet.global-assistant {
    width: min(600px, calc(100vw - 48px));
    max-height: min(calc(100dvh - 96px), 720px);
  }
}
```

所以「打開 Aios」＝畫面中央出現一張 **600px 寬的浮動卡**，
而背後的專案內容被 scrim 刻意糊掉（`styles.css:8413-8435`，註解自陳「版面還認得出來，字讀不到」）。

聊過兩三輪後的畫素分配：

| 區塊 | 佔視窗 | 佔助手面板 | 依據 |
| --- | ---: | ---: | --- |
| 聊天逐字稿（真正的回答） | ~8% | ~26% | `.ai-copilot-bubble__text`（`styles.css:7913`） |
| **AI 狀態卡＋工作過程紀錄** | **~12%** | **~38%** | `AgentRunCard`＋`AgentWorkPanel`（`:1265-1282`） |
| 輸入框 | ~2.3% | ~8% | `.ai-copilot-input-box`（`styles.css:8005`） |
| **作品／畫面** | **0.00%** | **0%** | 見下 |
| 被糊掉的頁面 | ~70% | — | `styles.css:8413` |

**關鍵證據**：

```
AICreativeCopilot.tsx  (1633 行)  <img|<video|AssetImg|AssetVideo 出現次數：0
AgentRunCard.tsx       (  67 行)  出現次數：0
AgentWorkPanel.tsx     ( 228 行)  出現次數：0
```

**1928 行的助手介面，沒有任何一個影像元素。**
在一個創作工具裡，AI 的自我記錄（12%）佔的畫素比它給的答案（8%）還多，而作品是 0%。

輸入框的 placeholder 也不隨脈絡改變——只有兩種（`AICreativeCopilot.tsx:1568-1572`）：

```ts
messages.length > 0 ? "接著告訴 Aios…（Shift + Enter 換行）" : "告訴 Aios 你想完成什麼…"
```

沒有任何「你正在看第幾鏡」的概念。

### After：同樣量測方式，原型實測

| 區塊 | 1440×900 | 390×844 |
| --- | ---: | ---: |
| **作品舞台（現用畫面）** | **42.0%**（1043×522） | **25.7%**（369×230） |
| 生產長條（每一鏡的縮圖） | 17.5% | 16.4% |
| Aios 面板 | 7.7% | 隨內容 |
| 情境命令列 | 6.6% | 7.0% |
| 橫向溢位 | 無（scrollWidth = 1440） | 無（scrollWidth = 390） |

作品從 **0% → 42%**；AI 的自我記錄從 12% → 7.7%，而且預設收合成一行「查看詳細活動」。

---

## 2. 設計原則（依重要性排序）

1. **作品 > AI。** 畫面上最大的東西必須是使用者的作品，任何狀態下都是。
2. **狀態要能看，不要能讀。** 「Shot 03 生成中」用縮圖＋狀態徽記表達，不是 `Ran tool…` / `Read file…`。
3. **候選要在眼前。** 生成結果不該只存在於另一個 modal 裡。
4. **自然語言不刪，但降級為命令列。** 逐字稿不是主角；輸入框跟著選取變。
5. **禁止假進度。** 沒開始的階段顯示 `—`，不畫一條假的動畫進度條。
6. **一切都是投影。** 畫面不得擁有自己的 candidate／version／current 狀態。

---

## 3. 版面

### 桌機（≥821px）

```
┌──────────────────────────────────────────────────────────────┐
│ 白日夢島 › 第一幕 › Scene 3 › Shot 08        畫面 7/12       │  脈絡列
├───────────────────────────────────────┬──────────────────────┤
│                                       │ Aios                 │
│           現用畫面（最大）            │ ● 候選 2/3           │
│                                       │ ✓ 安倢  保持         │
│                                       │ ✓ 米白外套  保持     │
│  [現用][已通過]        版本 / 工作室  │ ✓ 海邊民宿  保持     │
├───────────────────────────────────────┤ › 查看詳細活動       │
│ 創作方向                              │                      │
│ [靠近人物][低機位逆光][廣角留白]      │                      │
├───────────────────────────────────────┤                      │
│ 候選  1/3 可採用・已結算 12 點        │                      │
│ [A 可採用][B 失敗][C 待核准]          │                      │
├───────────────────────────────────────┴──────────────────────┤
│ 01 02 03 04 05 06 07 [08] 09 10 11 12   ← 生產長條（縮圖）   │
├──────────────────────────────────────────────────────────────┤
│ 告訴 Aios 想怎麼修改 Shot 08…                          [送出] │
└──────────────────────────────────────────────────────────────┘
```

### 手機（≤820px）

單欄；舞台仍是最大的一塊（25.7%）；創作方向、候選、生產長條各自水平捲動；
命令列 sticky 在底部並讓開鍵盤（`bottom: var(--kb-inset)`）。

---

## 4. 情境命令列（Chat → Command Bar）

placeholder 由選取狀態決定，不是由對話長度決定：

| 選取 | placeholder |
| --- | --- |
| 單一 Shot | `告訴 Aios 想怎麼修改 Shot 08…` |
| 多選 N 鏡 | `告訴 Aios 想怎麼調整這 N 鏡…` |
| 一幕 | `告訴 Aios 接下來這一幕要怎麼收…` |
| 無選取 | `接下來想讓 Aios 完成什麼？` |

逐字稿不刪除，改為需要時才展開；預設只留最後一則回覆。

---

## 5. Agent 活動：從工具紀錄改成生產長條

創作者關心的是「哪一鏡到哪了」，不是「跑了什麼工具」。

生產長條每一格 = 一鏡：縮圖 + 狀態徽記 + 三軌完成度（畫面／影片／配音）。
狀態語彙**直接沿用** `shared/sceneVersions.ts` 的 `SceneVersionState`，不新增第五種：

| SceneVersionState | Pill status | 文案 |
| --- | --- | --- |
| `current` | `done` | 已完成 |
| `generating` | `running` | 生成中 |
| `awaiting_approval` | `queued` | 待核准 |
| `failed` | `failed` | 失敗 |
| （無） | `neutral` | 未開始 |

詳細 agent log 收進「查看詳細活動」，預設收合。

---

## 6. 長任務（整幕）

不顯示一張長 AgentRunCard，顯示階段計數 + 真實 filmstrip：

```
分鏡 12/12 ████████████
畫面  7/12 ███████
影片  3/12 ███
配音  8/12 ████████
音效  5/12 █████
審核  2/12 ██
粗剪    —              ← 沒開始就是 —，不畫假進度
```

每個數字都能由 `scenes` 列推導，不需要新表。

---

## 7. CURRENT 元件重用對照

| 用途 | 重用 | 位置 |
| --- | --- | --- |
| 按鈕三級 | `<Button variant/size>` | `client/src/components/ui/Button.tsx` |
| 狀態徽記 | `<Pill status>` | `ui/Pill.tsx`（狀態只能四選一，型別擋住第五種） |
| 可選標籤（方向／鏡格） | `<Chip selected onClick>` | `ui/Chip.tsx`（自動補 `role`/`tabIndex`/Enter・Space） |
| 卡片 | `<Card variant>` | `ui/Card.tsx` |
| 次要說明／小灰字 | `<Hint>` / `<Meta>` | `ui/Hint.tsx`、`ui/Meta.tsx` |
| 圖示 | `<Icon name size>` | `components/Icon.tsx`（名稱由 `IconName` 型別約束） |
| 版本狀態語彙 | `SceneVersionState` | `shared/sceneVersions.ts` |
| 淨點數 | `pointsOf()` 口徑 | `shared/sceneVersions.ts:105` |
| 過時提示 | `story.continuityCheck` 的 `outdated` | `server/routers/story.ts:603` |

**UIUX-01 棘輪**：新檔案 baseline = 0，原型全程只用 primitives。實測 `check:ui-primitives` 通過（裸 class 0）。

---

## 8. 給 v4 主工程的 INTEGRATION REQUIREMENTS

原型刻意不接線。要讓它變成正式頁面，需要下列**投影**（不是新功能、不是新表）：

**IR-1 逐鏡聚合（P0）**
需要一支能一次取得整個專案每一鏡的：`id / no / title / assetId+url / assetKind / state / reviewStatus / hasImage / hasVideo / hasVoice`。
理由：生產長條要畫 200 鏡。目前若每格自己查一次就是 N+1——
`ShotCard.tsx:228` 已有前例（`story.shotAssetSuggestions` 每卡一查，且 `preferDetailsOpen` 在桌機專業模式預設全開），實測會把 tRPC 批次 URL 撐到約 25 KB，在 ~130 鏡以上超過 Node 預設 16 KB header 上限。**新表面不能重蹈。**

**IR-2 Creative Direction 的呈現欄位（P0）**
每個 Direction 至少要能投影出：`id`、**≤6 字的短標籤**、`changes: string[]`（每項 ≤8 字）、`keep: family[]`。
理由：使用者要在 2 秒內看懂三個方向差在哪。若只回一段自然語言說明，這個設計不成立。
**schema 由 v4 定義，我只要求這幾個欄位取得到。**

**IR-3 候選 ↔ 方向的對應（P0）**
每個候選要能回答「我是哪個方向生成的」：`generationId → directionId`。
原型用 `directionId` 欄位表示；實作可放既有的 `generations.params.__aiosSourceMeta`（`preserveScenePointer` 的先例），不需要新表。

**IR-4 每鏡狀態必須來自 server truth（P1）**
`generating / awaiting_approval / failed` 一律由 `scenes.versions` 投影，前端不得自行推斷。
（#725 已確認 `SceneStudio` 的 `variantBatch` 是純 `useState`，F5 就消失——新表面不要複製這個模式。）

**IR-5 Reference Lock 的呈現真相（P1）**
「保持 角色／Look／Scene」必須反映**結構上真的被鎖住**（錨點層／參考圖），
不能只是提示詞裡寫了一句話。若某一項實際上只是提示詞層級，UI 必須誠實標示強度不同。

**IR-6 幕層階段計數（P2）**
`分鏡/畫面/影片/配音/音效/審核/粗剪` 的 done/total。可由 `scenes` 列推導；
若 v4 已有聚合就直接用，未開始的階段請回 `null` 而不是 `0`，UI 才畫得出「—」而不是假的 0%。

---

## 9. 本輪未做（明確標示）

- **未接線**：原型不呼叫任何 API，不讀也不寫任何 truth。
- **未改動** `SceneStudio` / `VisualChoiceTray` / `StoryboardStage` / `generationCore` / `scenes` router / `sceneVersions` / continuity / CreativeDirection backend——v4 主工程正在改。
- **未截圖**：本機 Browser pane 未顯示，無法擷取畫面；上表數字改以 `getBoundingClientRect()` 實測，量測方式與數值都列在上面可重驗。
- **Direct Manipulation**（點角色→Look、點背景→Scene）本輪只做到概念驗證層級，未實作；CURRENT 的 `SceneAnnotationLayer` 是否適合承載，需另案評估。
