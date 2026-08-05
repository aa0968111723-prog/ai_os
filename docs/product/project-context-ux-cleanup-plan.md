# 整理計畫：專案上下文 UX + 與創作台／分鏡一體化

> 狀態：**C0–C2 已實作**（#405 C0、#406 C1、#407 C2 全棧；C3 待做）  
> 分支：`plan/project-context-ux-cleanup` → base `claude/healing-migration-ai-os-erewp2`  
> 觸發：使用者「專案上下文也很複雜」「連結不紮實，跟創作工作台與分鏡太不一體成型」（2026-08-04）  
> 相關：工作台本體減噪見 **#400**（`creation-workbench-ux-cleanup-plan.md`，P0–P2 已合 #403）——本計畫專攻 **① 上下文** 與 **①↔②↔③ 接縫**

---

## 1. 問題陳述

### 1.1 上下文本身太重

`ProjectPage`（~2300 行）① `#stage-context` 一次攤開：

- 世界觀：logline／message／tones／styles／taboos／audience／themes／references…
- 定裝三卡：角色、場景設定、素材（道具）
- 依據：知識庫、專案資料表、素材庫
- 管理：成員、回收桶（已較底）

雖有分組 A/B/C 與手機收合，**完整版仍像多個獨立產品疊在同一頁**。

### 1.2 連結不紮實（接縫問題）

| 接縫 | 現況 | 體感 |
|------|------|------|
| ① → ② 工作台 | `CreationContextBar` 只有「捲到區塊」chip；工作台內「帶入」chip 同樣只 scroll | 像書籤，不像同一條工作流 |
| ② → ① 定裝 | 改角色卡後，工作台 chip 數字會變，但**沒有「你正在編輯會影響下一筆生成」的連續狀態** | 改完要自己滾回生成 |
| ② ↔ ③ 分鏡 | 分鏡 `generateInto` 有注入 characterIds；工作台是另一條 `generation.submit` | 兩套出圖入口，規則要靠註解對齊 |
| 深連結 | `revealWorkbenchAnchor` / `WORKBENCH_REVEAL_EVENT` 只服務工作台 tab | 分鏡、知識、定裝沒有對等的「揭示＋捲動＋高亮」契約 |
| 空狀態 | 世界觀範例卡、簡易模式四步較完整；完整版 ①→②→③ 仍靠長頁滾動 | 新手不知道「填完這步就去生成／拆鏡」 |

### 1.3 「不一體成型」的白話

使用者心智模型應是：

> **定調（世界觀）→ 定裝（角色／場景／道具）→ 創作（工作台或分鏡）→ 交付**

實際 UI 卻是：三個 stage 垂直堆、導覽靠一排 chip、生成與分鏡各做各的。  
目標不是再做一個巨型單頁，而是 **同一條故事線上的三站，站與站有明確往返**。

---

## 2. 目標（驗收語言）

1. **最少可生成**：完整版 ① 預設只強調「會進提示詞的最少欄位」；其餘進階預設收合。  
2. **定裝可掃**：角色／場景／道具不以三條長列表同時搶首屏（Tab 或手風琴）。  
3. **往返紮實**：從工作台／分鏡點「編輯定裝」→ 展開對應卡並高亮 → 存完有「回到生成／回到分鏡」主按鈕。  
4. **狀態一句話**：① 頂部或工作台成本列上方，固定一句「本次生成會帶入：…」（與 chip 同源資料）。  
5. **不改後端契約**：worldview schema、generation.submit、scenes.generateInto、prop 歸屬邏輯維持；本階段以前端編排與導覽為主。

---

## 3. 範圍邊界

| 做 | 不做（本計畫） |
|----|----------------|
| `ProjectPage` ① 區塊資訊層級、收合、Tab | 重寫 SimpleProjectMode 業務（可對齊文案） |
| 共用「揭示定裝／揭示分鏡」導覽 helper（對齊 `workbenchNav`） | 合併 generation.submit 與 generateInto 為單一 API |
| 工作台 ContextBar／帶入 chip 的往返 UX | BYOK／開機 migration（#396／#398） |
| 分鏡列「使用專案定裝」可見性 | 大改 SceneList 剪輯時間軸 |

與 **#400** 分工：

- #400：② 工作台**內部**減噪與主路徑  
- **本計畫**：① 收斂 + **①↔②↔③ 一體化接縫**  
- 實作可並行，但 ContextBar／chip 文案請與 #400 P1 對過再改，避免互相覆蓋

---

## 4. 目標動線（一體成型）

```
                    ┌─────────────────────────┐
                    │ 專案狀態摘要（一句話）      │
                    │ 世界觀✓ · 角色n · 場景n …  │
                    └───────────┬─────────────┘
           ┌────────────────────┼────────────────────┐
           ▼                    ▼                    ▼
    【① 定調與定裝】      【② 創作工作台】      【③ 分鏡與交付】
    最少世界觀             模型+提示詞+生成        拆鏡/逐格出圖/送審
    定裝 Tab               帶入摘要 → 編輯定裝      使用同一套定裝 ids
           │                    │                    │
           └──── 揭示+高亮+「回到原處」 ◄─────────────┘
```

---

## 5. 分階段 checklist（終端機）

### C0 — 世界觀減噪（低風險）

**主要檔案：** `ProjectPage.tsx`（世界觀卡）、必要時 `WorldviewGuide` / `WorldviewPreview`

```
[x] C0.1  將「建議必填／會進生成」與「進階」分層
          建議必填可視：logline（或 message）、tones、styles、taboos（對齊 isWorldviewReady）
[x] C0.2  audience / themes / references / 長說明等進 <details> 或「進階設定」預設關
[x] C0.3  頂部保留「世界觀是否就緒」一句 + 未就緒時 CTA（填範例／去填 logline）
[x] C0.4  手機既有收合行為回歸測試；桌機首屏不出現超過一屏的世界觀表單
          （WorldviewPreview 改預設收合；進階預設關，有既有敘事資料才撐開）
```

**驗收：** 新使用者開完整版，不展開進階也能看懂「最少要填什麼才能讓 AI 懂這支片」。

---

### C1 — 定裝一體（中風險，前端）

**主要檔案：** `ProjectPage.tsx` 分組 A、`CharacterCards` / `ScenePresetCards` / `PropCards` 的包裹層

```
[x] C1.1  角色／場景／道具改為同一「定裝」容器內的 Tab 或手風琴（一次主開一類）
[x] C1.2  容器 id 穩定：如 #sec-characters #sec-scenes #sec-props 仍存在（可掛在 tabpanel）
          以免既有 scrollToSelector / chip 失效
[x] C1.3  摘要列顯示三個計數（與工作台 chip 數字一致，同源 props）
[x] C1.4  自動帶入（carried props）在定裝區用固定 Hint 說明一次，勿只在生成確認才出現
```

**驗收：** 首屏定裝區高度明顯下降；深連結捲到角色／場景／道具仍可用。

---

### C2 — 接縫紮實：揭示契約 + 回到原處（核心）

**主要檔案：** 新建或擴充 `client/src/features/project-nav/`（或擴 `workbenchNav.ts`）、`CreationContextBar`、`ProjectPage`、`DirectGenerateMode` 帶入 chip、`SceneList` 入口

```
[x] C2.1  定義與 workbench 對等的事件，例如：
          - aios:project-context-reveal { projectId, target: characters|scenes|props|worldview|knowledge|assets, returnTo?: studio|scenes }
          行為：展開 ① 對應分組/Tab、高亮、scroll；記住 returnTo
[x] C2.2  工作台「帶入」chip / ContextBar 改走揭示事件，不只裸 scroll
          （若 #400 已改 ContextBar 視覺，此處接行為）
[x] C2.3  定裝編輯區出現 sticky 或段尾主按鈕：
          「回到創作台」→ revealWorkbenchAnchor(#sec-studio)
          「回到分鏡」→ #stage-deliver / SceneList 錨點
          依 returnTo 顯示一個主 CTA、另一個次要
[x] C2.4  分鏡側：逐格生成列明示「使用專案已勾選定裝（角色 n / 場景 n）」
          點了可 reveal 定裝；避免以為分鏡是另一套互不相關設定
[x] C2.5  共用摘要元件（可小）：WorldviewReady + counts → ① 頂與 ② 帶入列共用，避免文案分叉
```

**驗收：** 從生成台點「角色 2」→ 定裝角色 Tab 開啟並高亮 → 按「回到創作台」→ 工作台 generate 模式展開且捲到 #sec-studio／#gen-prompt。分鏡路徑對稱。

---

### C3 — 階段感與空專案（中低風險）

```
[ ] C3.1  「從這裡開始」步驟與 ①②③ 實際完成態對齊（已有 steps 則修文案／捲動目標）
[ ] C3.2  空世界觀：範例卡 CTA「套用後去創作台」一鍵（套用 + reveal studio）
[ ] C3.3  TocNav / 階段標題用同一套「定調 → 創作 → 交付」用語，避免 ① 叫法與工作台不一致
```

**驗收：** 空專案三步內能從範例走到可按生成；不靠自己發現長頁底部。

---

## 6. 技術注意

1. **錨點相容**：`#stage-context` `#onboard-worldview`／`#onboard-worldview-card` `#sec-characters` `#sec-scenes` `#sec-props` `#sec-knowledge` `#sec-assets` `#sec-databases` `#stage-create` `#sec-ai-hub` `#sec-studio` `#stage-deliver` —— 改結構時 id 保留或做別名。  
2. **手機**：`useMatchMedia` 收合邏輯與揭示事件要一起測（揭示時強制展開對應分組）。  
3. **測試**：ProjectPage 若缺測，至少補導覽 helper 單元測試 + 既有 workbench 測試不紅。  
4. **勿**在 C2 用 `window.location.hash` 當唯一狀態（與既有 CustomEvent 模式並存時，以 event 為準，hash 可選同步）。

---

## 7. 建議實作 PR 切法

1. `feat/context-c0-worldview-collapse`  
2. `feat/context-c1-costume-tabs`  
3. `feat/context-c2-reveal-return`（**最重要的一體化**）  
4. `feat/context-c3-empty-journey`  

C2 可依賴 C1（有 Tab 才好揭示），但 C0 可先合。

---

## 8. 與其他文件／PR

| 項目 | 關係 |
|------|------|
| #400 工作台 UX | ② 內部；本計畫接縫時讀其 ContextBar／chip 結論 |
| SimpleProjectMode | 已是一體化參考實作；完整版對齊「少輸入、有進度、有下一步」 |
| `docs/資料庫遷移.md` / #398 | 無關 |
| BYOK #396 | 無關（摘要列日後可掛徽章） |

---

## 9. 回滾

純前端；按 feat PR revert。揭示事件若被外部 bookmark 依賴，保留 no-op polyfill 或舊 scroll fallback 一版。
