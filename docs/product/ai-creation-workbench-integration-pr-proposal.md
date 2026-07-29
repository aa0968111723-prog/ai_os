# AI 創作工作台整合 PR 提案

> 狀態：Proposed
>
> 適用範圍：Aios 專案頁的 AI 創作區
>
> 目標：把「問 AI、直接生成、製作範本、執行計畫、提示詞庫、生成紀錄」整合為一個清楚、連貫、適合手機操作的 AI 創作工作台。

## 1. 背景與現況

目前專案頁已經把 AI 創作能力放在同一張長頁裡，但使用者仍需要在多個大型區塊間上下捲動：

- AI 創作工作台／AI 對話
- 創作生成
- 製作範本
- 執行計畫
- 提示詞庫
- 生成紀錄

這些功能底層共享同一批專案上下文與治理規則：世界觀、角色、場景、素材、分鏡、模型、點數、核准與生成紀錄；但介面上仍像多套平行工具，造成入口重複、手機頁面過長、跨功能帶入不連續。

`ProjectPage.tsx` 目前同時匯入 `AiHub`、`ModelPicker`、`WorkflowCard`、`PromptLibrary`、`GenerationList`、`SceneList` 與大量專案上下文元件，且註解已將第二幕定義為「AI 創作中心」，表示產品方向原本就希望形成一體化工作台；本提案要完成這個收斂，而不是新增第五套入口。

## 2. 核心判斷

這些功能不是六個同層級產品，而是三種不同性質：

### 創作模式

1. **問 AI**：探索、發想、問答、拆分鏡、模型建議。
2. **直接生成**：立即產生圖片、影片或聲音。
3. **製作範本**：執行固定、可重複的自動流程。
4. **執行計畫**：執行多步驟、可估點、可核准、可背景運行的任務。

### 共用上下文

- 專案設定
- 世界觀
- 角色
- 場景
- 知識與資料來源
- 素材
- 分鏡與交付

### 共用資源與結果

- 提示詞庫
- 生成紀錄
- 執行軌跡
- 已儲存範本

因此正確的資訊架構是「一個工作台、四種模式、共享上下文、統一結果區」，而不是將每一項都做成獨立長卡片。

## 3. 目標資訊架構

```text
AI 創作工作台
├─ 目標輸入：你想完成什麼？
├─ 模式切換
│  ├─ 問 AI
│  ├─ 直接生成
│  ├─ 製作範本
│  └─ 執行計畫
├─ 共用上下文列
│  ├─ 專案設定
│  ├─ 知識
│  ├─ 資料來源
│  ├─ 素材
│  └─ 分鏡與交付
├─ 當前模式面板
└─ 資源抽屜
   ├─ 提示詞庫
   ├─ 生成紀錄
   ├─ 執行軌跡
   └─ 範本收藏
```

## 4. 使用者體驗原則

### 4.1 單一主要入口

專案頁只保留一個明確的「AI 創作工作台」主卡。使用者不需要先判斷應該往下找生成器、範本或提示詞庫。

### 4.2 模式切換不丟失輸入

使用者在「問 AI」得到分鏡提案後，可一鍵帶入「直接生成」；在直接生成設定好的提示詞、角色、場景與模型，切到「執行計畫」後仍應保留。

建議建立共享狀態：

```ts
interface CreationDraft {
  goal: string;
  mode: "ask" | "generate" | "template" | "plan";
  category?: string;
  modelId?: string;
  prompt?: string;
  sourceAssetIds: string[];
  characterIds: string[];
  scenePresetIds: string[];
  worldviewEnabled: boolean;
  templateId?: string;
}
```

此狀態至少應以 `projectId` 為鍵保存在 session 或 localStorage；未送出前不得因切換模式、收合面板或手機返回而清空。

### 4.3 手機優先

- 模式切換使用可橫向捲動的 segmented tabs，或 2×2 模式按鈕後進入單一面板。
- 同一時間只展開一個主要模式面板。
- 提示詞庫、生成紀錄與執行軌跡使用底部抽屜或次級分頁，不再各占一張超長卡片。
- 固定浮動回饋按鈕不得遮住生成、核准或抽屜操作。
- 章節導覽需能直接跳到工作台，工作台內再負責模式切換，不把每個模式都列為整頁章節。

### 4.4 漸進揭露

直接生成預設只顯示：

1. 創作類別
2. 模型
3. 提示詞
4. 使用中的世界觀／角色／場景摘要
5. 成本與生成按鈕

進階參數、來源素材、seed、比例、解析度與模型特定設定收進「進階設定」。

### 4.5 成本與付款來源一致

所有模式在執行前使用同一個成本摘要元件：

```text
本次模式：免費額度 / 團隊贊助 / 個人點數 / 自帶金鑰
預估消耗：X 點
輸出規格：模型、解析度、秒數
是否需要核准：是 / 否
```

問 AI 的純文字發想若屬免費額度，需明確顯示「免費」；不得在不同模式使用不同的成本文案或不同估點邏輯。

## 5. 元件重構提案

### 5.1 新增工作台容器

```text
client/src/features/creation-workbench/
├─ CreationWorkbench.tsx
├─ CreationModeTabs.tsx
├─ CreationGoalInput.tsx
├─ CreationContextBar.tsx
├─ CreationResourceDrawer.tsx
├─ CreationCostSummary.tsx
├─ creationDraft.ts
├─ modes/
│  ├─ AskAiMode.tsx
│  ├─ DirectGenerateMode.tsx
│  ├─ TemplateMode.tsx
│  └─ PlanMode.tsx
└─ __tests__/
```

### 5.2 現有元件處理方式

| 現有能力 | 處理方式 |
|---|---|
| `AiHub` | 拆成 `AskAiMode` 與共用執行軌跡；保留既有 API 行為 |
| ProjectPage 內直接生成表單 | 抽成 `DirectGenerateMode`；不複製生成 mutation |
| `WorkflowCard`／製作範本 | 包進 `TemplateMode`；範本選擇與目標輸入保留 |
| 執行計畫 | 抽成 `PlanMode`；估點、核准、背景執行沿用現有流程 |
| `PromptLibrary` | 移入 `CreationResourceDrawer`；支援「帶入目前模式」 |
| `GenerationList` | 移入資源抽屜或工作台下方結果分頁 |
| `ModelPicker` | 成為直接生成與計畫模式的共用元件 |
| 世界觀／角色／場景 | 由 `CreationContextBar` 顯示摘要與快速開關，來源真相仍留在專案資料 |

### 5.3 ProjectPage 的責任

`ProjectPage.tsx` 只負責：

- 取得專案與權限脈絡
- 組裝三幕長頁
- 將必要 `projectId/groupId/readOnly/capabilities` 傳入工作台
- 處理跨幕捲動與章節導覽

不得繼續承擔每個模式的表單狀態、成本判斷與大量 JSX。

## 6. 核心互動流程

### 6.1 問 AI → 直接生成

1. 使用者輸入「給我 3 個分鏡 idea」。
2. AI 回覆三個結構化建議。
3. 每個建議提供：
   - 帶入直接生成
   - 存成分鏡草稿
   - 建立執行計畫
   - 存進提示詞庫
4. 選擇「帶入直接生成」後，切換模式並填入提示詞，不立即扣點或送出。

### 6.2 提示詞庫 → 任一模式

提示詞項目不得只提供複製文字，應提供：

- 帶入直接生成
- 帶入問 AI 繼續修改
- 作為範本目標
- 加入執行計畫

帶入時保存提示詞來源 ID，便於追蹤重用成效與版本。

### 6.3 直接生成 → 生成紀錄 → 分鏡

1. 生成完成後在工作台結果區立即出現。
2. 可查看版本、重生、收藏提示詞。
3. 可加入既有分鏡或建立新分鏡。
4. 加入分鏡後不強制把使用者捲到整頁其他位置，而是顯示成功狀態與「前往分鏡」。

### 6.4 製作範本 → 執行計畫

範本不是另一套生成系統。選擇範本並填入目標後，應建立標準化執行計畫，顯示：

- 步驟
- 每步模型
- 預估點數
- 需人工核准的位置
- 產物將寫入何處

關閉頁面後仍可在「執行軌跡」查看。

## 7. 後端與資料契約

第一階段原則上不新增資料表，不修改現有生成、工作流、代理與提示詞 API；先以前端 adapter 整合。

但需要建立統一的前端 action contract：

```ts
type CreationAction =
  | { type: "ask"; message: string }
  | { type: "generate"; draft: CreationDraft }
  | { type: "run_template"; templateId: string; goal: string }
  | { type: "create_plan"; goal: string; draft?: CreationDraft }
  | { type: "apply_prompt"; promptId: string; targetMode: CreationMode };
```

所有真正生成仍必須走既有正式生成 Command／mutation，不能因工作台整合而建立第二條扣點或核准路徑。

## 8. 權限與專案狀態

- Viewer：可問 AI、查看提示詞庫與紀錄；能否生成依既有政策決定。
- Editor：可直接生成、使用範本、建立計畫與寫入分鏡。
- archived 專案：工作台切成唯讀，允許查看、匯出與複用到新專案；禁止生成與執行計畫。
- paused 專案：依統一 Project State Machine 決定，不能只在 UI disable。
- 所有模式的權限顯示必須來自同一 capability，不得各自判斷 admin/leader/member。

## 9. 可存取性

- 模式切換使用 `role="tablist"`、`role="tab"`、`aria-selected` 與對應 `tabpanel`。
- 支援方向鍵切換模式。
- 抽屜開啟後鎖定焦點，關閉後把焦點還給原按鈕。
- 成本、錯誤、生成完成與核准狀態使用適當 live region。
- `prefers-reduced-motion` 下取消非必要滑動與轉場。
- 200% 字級與 360px 寬度下不得出現水平頁面溢出。

## 10. 分階段 PR 拆分

### WB-00：行為基線與手機 UX 測試

- 為 AiHub、直接生成、範本、提示詞庫建立現況測試。
- 鎖定生成、估點、核准、加入分鏡與提示詞重用行為。
- 新增 360px、390px、桌面寬度的關鍵畫面測試。
- 不改 UI。

### WB-01：建立工作台 Shell 與模式切換

- 新增 `CreationWorkbench`、模式 tabs、目標輸入與共享草稿。
- 將原區塊以 adapter 嵌入四種模式。
- 不改 API，不刪除舊元件。

### WB-02：抽出直接生成模式

- 從 `ProjectPage.tsx` 抽離生成表單與模型選擇。
- 共用成本摘要。
- 保持所有 mutation、點數與核准行為不變。

### WB-03：整合 AI 建議與跨模式帶入

- AI 回覆支援帶入生成、分鏡、計畫、提示詞庫。
- 共享草稿不因切換模式而遺失。
- 加入結構化 action 測試。

### WB-04：整合製作範本與執行計畫

- 範本執行統一呈現為計畫預覽。
- 估點、核准、背景執行與執行軌跡一致。
- 關閉頁面後可恢復追蹤。

### WB-05：提示詞庫與結果抽屜

- 提示詞庫、生成紀錄、執行軌跡移入統一資源抽屜。
- 支援帶入任一模式。
- 手機頁面不再出現多張重複長卡。

### WB-06：刪除重複入口與收斂 ProjectPage

- 移除舊平行區塊。
- `ProjectPage.tsx` 僅保留頁面組裝。
- 更新 TocNav、說明文案與 E2E。

## 11. 第一個實作 PR 的嚴格範圍

本提案合併後，第一個實作應為 **WB-00**，不應直接把整頁重寫。

WB-00 必須先證明：

- 問 AI 目前如何建立分鏡／計畫。
- 直接生成如何估點、核准、提交與顯示結果。
- 範本如何執行與追蹤。
- 提示詞庫如何存取、排序與帶入。
- viewer/editor/archived 在各入口的行為。
- 手機浮動回饋、章節導覽與長頁捲動的實際衝突。

## 12. 驗收標準

### 資訊架構

- 專案頁只有一個 AI 創作工作台主入口。
- 四個創作模式在同一工作台內切換。
- 提示詞庫、生成紀錄與執行軌跡不再是平行大型主區塊。

### 行為一致性

- 重構前後生成結果、點數、核准、權限與稽核不變。
- 任一模式送出的生成都走同一正式生成路徑。
- 跨模式帶入不會自動送出或扣點。

### 手機體驗

- 360px 寬度可完成四種模式的主要流程。
- 使用者不必跨越多個大型卡片才能從想法走到生成。
- 固定浮動元件不遮住主要操作。
- 切換模式、返回頁面與收合工作台不遺失草稿。

### 維護性

- `ProjectPage.tsx` 不再保存所有模式的局部狀態。
- 新增創作模式只需接入工作台 contract，不需再新增整頁區塊。
- 所有模式共用成本摘要、專案上下文與權限能力。

## 13. 非目標

- 本輪不重寫後端生成系統。
- 不在同一 PR 導入 Beam Serverless GPU。
- 不重做角色、場景、素材與分鏡資料模型。
- 不把工作台改成無限畫布或節點式編輯器。
- 不取消進階使用者直接操作模型與提示詞的能力。

## 14. Codex 執行指令

1. 先閱讀本提案、`ProjectPage.tsx`、`AiHub.tsx`、`PromptLibrary.tsx`、`WorkflowCard.tsx` 與現有 client tests。
2. 先執行 WB-00，建立可失敗的行為與響應式測試。
3. 不得在第一個 PR 同時重構 API、資料庫、權限與 UI。
4. 所有搬移採 adapter-first：先包裝，確認測試，再移除舊入口。
5. 搜尋並列出所有生成 submission、estimate、approval、prompt save、scene add caller。
6. 不複製 mutation 或商業規則到新工作台元件。
7. 每個 WB PR 需列出：已遷移模式、尚未遷移 caller、手機驗證、回退方式。
8. 執行 typecheck、client tests、相關 server/shared tests、build 與 E2E。
