# Story-first 重構（AIOS 影片創作系統重構 PE 計畫 v1.0）— 實作紀錄

> 依據：使用者提供的《AIOS_影片創作系統重構_PE計畫_v1.0.pdf》（2026-08-07）。
> 核心命題：**人負責故事，AI 負責結構化；分鏡成為故事、素材、角色一致性與 AI 生成之間的中心。**
> 本文件記錄 PDF 各章在本 repo 的落地位置與狀態；後續 Phase 依此文件續作。

## 一句話總結

專案頁從「定調中心」改為 **故事 → 分鏡 → 製作 → 成片** 四段創作鏈：
貼故事 → AI 自動解析（角色/場景/道具/造型自動就位，只確認低信心項）→ 產生分鏡（Scene/Shot 落地、引用共用資料）→ 從 Shot 生成（環境/鏡頭語言/造型自動注入、生成綁鏡可追溯）→ 成片交付。

## PDF 章節 → 落地對照

| PDF | 內容 | 落地 | 狀態 |
|---|---|---|---|
| §03 IA | 主導航 故事→分鏡→製作→成片；定調退出主流程 | `TocNav.DEFAULT_ITEMS` 四段＋`LEGACY_STAGE_ALIAS`（舊 #stage-context 深連結不斷）；`ProjectPage` 四 StageHead | ✅ |
| §03 專案設定二層 | 風格/角色/場景/道具/知識/素材/版本/回收桶不阻擋創作 | `ProjectPage` 的 `psettings-sheet`（portal dialog；hero＋故事區入口）；舊定調四分頁整包移入 | ✅ |
| §09 Story Workspace | 編輯器＋autosave＋解析摘要＋確認卡＋轉分鏡 CTA | `features/story-workspace/`（`StoryStage`、`storyDraft.ts`）；`stories` 表＋`story.save`（版本走 `text_versions kind='story'`） | ✅ |
| §05 自動解析 | EXTRACT→NORMALIZE→RESOLVE→CONFIDENCE→DIFF→SAVE | `server/services/storyParse.ts`＋`story.parse`；代號白名單防捏 UUID（沿用 sceneCards 別名機制）；同文 hash 短路＋重解全連結（冪等） | ✅ |
| §06 信心分級 UX | ≥0.90 自動、0.70–0.89 標記、<0.70 確認卡 | `shared/story.ts bucketConfidence`；`parse_candidates`（pending/applied/confirmed/merged/dismissed）；確認卡＝建立/併入/略過 | ✅ |
| §07 資料模型 | Story/Scene/Shot/CharacterLook/EnvironmentState；Shot 採 Reference | migration `0049_story_first`：`stories`/`story_scenes`（environment jsonb＝EnvironmentState）/`character_looks`/`parse_runs`/`parse_candidates`；既有 `scenes` 即 Shot，加 `story_scene_id/camera/performance/look_ids`（全引用、不複製） | ✅ |
| §08 繼承 | Project Style → Scene State → Shot Override | 生成時 worldview（既有）→ 場 environment → 鏡 camera/performance/look 逐層注入 | ✅ |
| §10 Storyboard Center | 分鏡卡＋簡單/專業模式 | `features/storyboard-center/`（場分組、`ShotCard`：Preview/Narrative/Refs/Direction/Performance/生成入口；`boardPrefs` 簡單/專業 per 專案持久化） | ✅ |
| §11 生成 Pipeline | Shot Context → Prompt → Adapter → 版本 | `scenes.generateInto` 升級 `buildShotContextPrompt`（場景狀態→鏡頭語言→表演→造型鎖定；Project 風格與卡片錨點沿用 generationCore）；生成綁 `sceneId`＋`sceneRole`＋版本（既有 sceneVersions 機制）；Model Adapter＝既有 `model.input()` | ✅ |
| §12 AI 助手 | 上下文操作層 | 既有 assistant 動作（create_scene/update_scene/split_script…confirm-gated）沿用；**逐鏡上下文操作與助手 Change Preview 為後續 P1**（見缺口） | ◐ |
| §14 變更預覽/版本/增量 | Change Preview、Incremental Parsing、Undo | 故事 hash 差異訊號（isDirty）＋重解不重複建卡；`storyboardPreview`（轉分鏡前規模預覽）；`story.undoRun`（撤銷解析含分鏡：Shot 進回收桶、使用者確認的實體保留、只回復「現值仍是我們寫的」欄位）；故事版本快照/還原 | ✅（MVP 範圍） |
| §19 驗收 | Golden Path 必過測試 | `scripts/e2e-story.py`（13 段斷言：貼故事→解析→確認卡→冪等→轉分鏡→環境繼承→Shot 綁定生成→Look 分層→改故事差異→Undo→版本→守門）；已入 CI e2e 迴圈與 run-e2e-local.sh | ✅ |

## 工程 Guardrails（§18）對應

- **Idempotency**：同文 hash 短路；強制重解全走 RESOLVE 連結（e2e 斷言零新建）；轉分鏡同 run 冪等（applied.storyboard）。
- **Traceability**：`parse_candidates.sourceExcerpt`（來源文字）＋`parse_runs.plan/applied`＋aiTrace `story_parse` session；audit 字典補齊（`shared/auditWording.ts`）。
- **Partial Failure**：解析失敗只標 run failed，不動既有資料；候選逐張處理。
- **Undo**：`story.undoRun`（AI 建立可撤、使用者確認保留、Shot 軟刪可還原）。
- **Prompt Snapshot**：生成走既有 `generations.params`＋aiTrace prepared 事件。
- **Mobile First**：分鏡卡單欄、故事編輯器 16px 防 iOS 縮放、設定 sheet 全螢幕、主 CTA 沿用 --chrome-bottom 契約。
- **Cost Control**：解析預算 12k 字（截斷透明回報）；解析/轉分鏡 0 點（NIM 免費檔）；限流 `story:parse` 6/min。

## 刻意不做（PDF「第一輪不要做」＋現況暫緩）

- 完整剪輯 Timeline、大量專業 Camera 參數（僅留 §10 清單內欄位）、多 Agent 編排、全自動剪輯發布、企業級 DAM、一次接完所有模型。
- **後續 P1–P3 缺口**（開工前先讀本表）：
  1. 助手逐鏡上下文動作（「Shot 04 鏡頭靠近她一點」→ 改 camera）＋AI 批次修改 Change Preview/Undo（PDF §12/§14 完整版）。
  2. 素材自動推薦掛入 Shot（§13 向量檢索；受 RAG roadmap 門檻約束）。
  3. Continuity Checker（§P3）。
  4. 造型（Look）進 generationCore 錨點層（目前在 generateInto 的 prompt 層注入）。
  5. 轉分鏡的逐場 diff 套用（目前：同 run 冪等＋附加式 append＋預覽警示）。

## 資料相容

- 純新增 migration（0049），舊專案零影響；既有分鏡（無 storySceneId）在分鏡中心顯示為「未分場」。
- 舊「定調」資料（worldview/角色/場景/道具/知識/素材）原樣沿用，只是入口移到專案設定二層。
- 舊深連結 `#stage-context` → `#stage-story` 別名；`?focus=` 全部保留。
