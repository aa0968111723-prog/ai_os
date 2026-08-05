# 計畫：陪你做完（共創引導 Session）

> 狀態：**G0–G1 實作中**（G0 #416 已合；G1 進度推導＋摘要）  
> 分支：`plan/co-create-guided-session` → base `claude/healing-migration-ai-os-erewp2`  
> 觸發：使用者「能不能一邊討論一邊完成作品？有時真的沒什麼靈感」＋後續「釐清與引導使用者創作」（2026-08-04）  
> 相關：工作台減噪 **#400**、上下文一體化 **#402**、既有「一起想」`ProjectAssistant`、`SimpleProjectMode`

---

## 1. 問題

沒靈感時，完整版能力其實夠（問 AI、拆分鏡、生成、定裝），但動線是：

- 討論在「一起想」Tab  
- 出圖在「直接出圖」  
- 分鏡在 ③  

使用者必須**自己懂系統、自己接下一棒**。  
簡易模式有步驟卻**沒有討論**；助手能聊、能提議動作，卻**沒有「從零陪到有成片」的預設節奏**。

### 要解決的體感

> 我不確定拍什麼 → 有人用選項幫我釐清 → 每一步作品真的往前（基調／分鏡／畫面）→ 我隨時知道做到哪、下一步按什麼。

---

## 2. 產品定義

### 名稱

**陪你做完**（內部：`CoCreateSession`／Guided Co-Create）

### 一句話

用**同一條引導對話**推進「定調 → 拆鏡 → 出圖 → 收斂」；**旁邊（或同卡）看得到作品進度**；任何扣點／寫入仍要使用者確認。

### 非目標（本計畫不做）

- 全自動一鍵成片、跳過確認  
- 無限畫布當主 UI  
- 新增多 Agent 劇組後端  
- 改 generation／quota／BYOK 契約  

### 成功標準

1. 空專案、沒靈感：從入口進「陪你做完」，**不切 Tab** 也能完成「有 logline（或等價）+ ≥1 分鏡 + 至少嘗試出圖」。  
2. 每階段有 **2～3 個可點選項** +「我自己打」。  
3. 扣點動作 100% 走既有確認（`ConfirmButton` → `runAction`）。  
4. 可隨時「退出到完整版／簡易模式」，進度不丟（以伺服器資料為準，session 只記 phase）。

---

## 3. 與既有能力對照

| 既有 | 角色 |
|------|------|
| `assistant.ask` + SSE | 引導話術、釐清問題、建議方向 |
| `assistant.runAction` | 真的改專案：`apply_worldview_chips` / `split_script` / `create_scene` / `generate` / `update_scene` / `submit_approval` / `plan_agent` / `run_workflow` |
| `CreationAction` / `SuggestionActions` | 只帶入工作台、不扣點 |
| `SimpleProjectMode` | **完成定義對齊**（四步：故事→拆鏡→出圖→送審）；共創是「對話版」同一條業務 |
| `AskAiMode` / `ProjectAssistant` | 共創 UI 可嵌在其內或包一層 shell，避免第四個互不相關聊天 |

**原則：編排 > 新 API。** 第一期以前端 session + 既有 procedure 為主；若引導品質不足，再加可選 `mode: "co_create"` 或輕量 `suggestDirections`。

---

## 4. 階段狀態機（釐清與引導的核心）

```
theme（定主題／受眾／調性）
  → structure（拆成幾鏡／大綱）
    → visuals（逐鏡或批量出圖）
      → wrap（送審／打包／結束）
```

### 各階段「釐清」話術目標

| Phase | 使用者可能卡住 | 引導產出 | 主 CTA（確認後） |
|-------|----------------|----------|------------------|
| **theme** | 不知道拍什麼 | 2～3 個主題方向；收斂成一句話 + 1～2 調性 | `apply_worldview_chips` 與／或寫 logline（既有 updateWorldview 路徑） |
| **structure** | 不知道怎麼拆 | 建議 3／4／6 鏡或貼腳本 | `split_script` 或多次 `create_scene` |
| **visuals** | 不敢按生成 | 每一鏡一句提示詞建議 + 估點 | `generate`（可帶 sceneId）或對齊 `scenes.generateInto` 若已有封裝 |
| **wrap** | 做完不知下一步 | 還缺幾格、是否送審 | `submit_approval`；導向打包（既有 Export） |

### Phase 推導（與 Simple 一致：伺服器資料為準）

```
theme 完成 ≈ isWorldviewReady 或 logline 達標
structure 完成 ≈ scenes.length >= 1（建議 >= 3）
visuals 完成 ≈ 有圖的格數達門檻或使用者略過
wrap = 可送審或已打包提示
```

前端 `CoCreateSession` 可存 `phase` 覆寫（使用者跳步），但**進度條數字只讀 API**。

---

## 5. UI 資訊架構

```
┌─ 陪你做完 ──────────────────────────────────────┐
│ 進度：定調 ✓ → 分鏡 2/4 → 畫面 0/4 → 收斂        │
│ ┌──────────────┐  ┌────────────────────────────┐ │
│ │ 對話          │  │ 作品摘要                     │ │
│ │ （選項 chips） │  │ 一句話故事 / 調性             │ │
│ │ + 輸入 + 問   │  │ 分鏡縮圖列（點可看／改）       │ │
│ │ + 確認動作    │  │ 「退出共創／切簡易／完整版」   │ │
│ └──────────────┘  └────────────────────────────┘ │
└────────────────────────────────────────────────┘
```

- **手機**：上進度 + 摘要收合；下對話為主。  
- **桌機**：左右或上摘要下對話。  
- 入口：  
  - 工作台空狀態／目標框旁：**「沒靈感？陪你做完」**  
  - 簡易模式旁可互切  
  - 勿與「一起想」完全重複：共創 = 預設 phase 引導；一起想 = 自由問答（可共用 `ProjectAssistant` 底層）

---

## 6. 釐清策略（產品規則）

1. **先選項、後空白** — 每輪至少 2 個方向 chip，降低冷啟動。  
2. **一次只推進一個產物** — 本輪目標寫在對話頂：「這一步會幫你定下《一句話故事》」。  
3. **複述確認** — 套用前用一句話複述：「我將把基調設成…」再出 Confirm。  
4. **允許糊弄** — 「先隨便一個，之後再改」也是合法選項。  
5. **花費透明** — 生成類 CTA 顯示估點；提問維持預設免費檔（與助手一致）。  
6. **不假裝靈感** — 避免空洞雞湯；給具體可選的主題／鏡頭／提示詞。

---

## 7. 實作階段（終端 checklist）

### G0 — 入口與殼（低風險）

```
[x] G0.1  工作台空狀態或 CreationGoal 區加 CTA「沒靈感？陪你做完」
[x] G0.2  進入後展開共創殼（可為 CreationWorkbench 內 mode 或 full-width 子視圖）
[x] G0.3  進度條四段，點擊可跳 phase（進階使用者）
[x] G0.4  「退出共創」回工作台預設；資料已寫入者保留
```

### G1 — 狀態機 + 作品摘要（中）

```
[x] G1.1  CoCreateSession 狀態：phase、可選 local flags；完成條件讀 projects/scenes query
[x] G1.2  作品摘要：logline／tones、scene 縮圖、缺圖數（複用 scenes.listByProject）
[x] G1.3  與 SimpleProjectMode 完成定義對照表寫進註解，避免兩套「做完」定義
```

### G2 — 引導對話接 runAction（核心）

```
[ ] G2.1  嵌入或包一層 ProjectAssistant：共創模式下預設快捷句改為階段相關
          theme:「給我三個適合弘法短片的主題方向」等（文案可配置）
[ ] G2.2  確保 AI 回傳 actions 時 UI 清楚標 phase 建議主按鈕（已有 ConfirmButton）
[ ] G2.3  theme→ 成功 apply worldview / logline 後自動建議進入 structure
[ ] G2.4  structure→ split_script / create_scene 成功後進 visuals
[ ] G2.5  visuals→ generate 成功 invalidate scenes；摘要縮圖更新
[ ] G2.6  wrap→ 提示送審／打包；可只導航不新 API
```

### G3 — 引導品質（可選後端）

```
[ ] G3.1  若純前端快捷句不夠：assistant.ask 增加 optional mode: "co_create" + phase
          系統提示要求：短句、給選項、結尾建議 action 類型
[ ] G3.2  或新增 suggestDirections procedure（唯讀、免費）回 3 個 { title, loglineHint, tones }
[ ] G3.3  測試：檢視者唯讀不可寫入；編輯者確認前不扣點
```

### G4 — 接縫（依 #402 進度）

```
[ ] G4.1  摘要上「編輯定裝」走 project-context-reveal，returnTo=co_create
[ ] G4.2  回到共創時恢復 phase 與捲動位置
```

---

## 8. 建議 PR 切法

1. `feat/cocreate-g0-shell-entry`  
2. `feat/cocreate-g1-session-summary`  
3. `feat/cocreate-g2-guided-actions`  
4. `feat/cocreate-g3-ask-mode`（可選）  

---

## 9. 測試要點

```bash
npm run test:client -- ProjectAssistant CreationWorkbench
# 新增：CoCreateSession phase 推導純函式測試（不依賴 LLM）
```

手動：

1. 空專案 → 陪你做完 → 只靠選項走到有分鏡  
2. 生成確認框有點數；取消不扣點  
3. 中途退出再進，phase 與伺服器資料一致  
4. 手機進度可讀、對話可操作  

---

## 10. 與其他 PR

| PR | 關係 |
|----|------|
| #400 工作台 UX | 入口與主路徑減噪；共創殼不要被進階面板擠掉 |
| #402 上下文一體化 | G4 揭示返回；定裝與共創同一 Context Pack 心智 |
| SimpleProjectMode | 同一「做完一支」定義；入口互切，不互搶數據 |
| #396 BYOK / #398 開機 | 無關 |

---

## 11. 回滾

純前端 session + 入口；feature flag（如 `VITE_CO_CREATE=1` 或帳戶偏好）可預設關。  
後端若加 `co_create` mode，須保持舊客戶端忽略未知欄位仍可用。

---

## 12. 研究依據（摘要）

- 對話應貼在**作品進度旁**（Xmind AI、畫布側助手類產品），避免純 Tab 聊天。  
- **階段 + 可回頭**（ID.8、StoryEnsemble）適合沒靈感使用者。  
- **選項化 CTA + 確認執行** 符合本專案既有安全模型。  
- 影視管線共識：**先有可寫入的設定／分鏡，再生成**；共創 phase 順序與之對齊。  
