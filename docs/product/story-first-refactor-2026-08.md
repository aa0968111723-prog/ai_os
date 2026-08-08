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
| §12 AI 助手 | 上下文操作層 | 既有 assistant 動作沿用＋新增 `direct_shot`（sceneNo＋camera/performance patch）：「這一鏡再靠近一點」直接改到資料。`mergeShotDirection` 只動被指名的欄位（缺鍵＝不動、空字串＝清掉）；`describeDirectionChange` 出 before→after 差異行當確認卡文案；套用時以「現值」重新合併，resolve 到確認之間別人改的欄位不會被吃掉 | ✅ |
| §23 雙向影響 | 改一張卡要知道牽動哪些鏡、哪些畫面會過時 | `story.entityImpact`（角色/場景/道具/造型 → 鏡數、已有畫面的鏡數、完成生成數、樣本鏡名）；`EntityImpactHint` 掛在角色／道具／場景三張卡的編輯表單。**唯讀、不自動重生成**——重生成要花點數，是使用者的決定 | ✅ |
| §14 變更預覽/版本/增量 | Change Preview、Incremental Parsing、Undo | 故事 hash 差異訊號（isDirty）＋重解不重複建卡；`storyboardPreview`（轉分鏡前規模預覽）；`story.undoRun`（撤銷解析含分鏡：Shot 進回收桶、使用者確認的實體保留、只回復「現值仍是我們寫的」欄位）；故事版本快照/還原 | ✅（MVP 範圍） |
| §19 驗收 | Golden Path 必過測試 | `scripts/e2e-story.py`（13 段斷言：貼故事→解析→確認卡→冪等→轉分鏡→環境繼承→Shot 綁定生成→Look 分層→改故事差異→Undo→版本→守門）；已入 CI e2e 迴圈與 run-e2e-local.sh | ✅ |

## 2026-08-08 追加：劇本編寫環境（全螢幕＋標注＋專業工具）＋解析改用高階模型

原本的 ① 故事只有一個 textarea。寫「故事」夠，寫「劇本」不夠——所以在不改資料模型的前提下
把它升級成編寫環境（`features/story-workspace/ScriptEditor.tsx`；規則在 `scriptTools.ts`）：

| 能力 | 落地 | 為什麼這樣做 |
|---|---|---|
| 全螢幕寫作 | 沿用 `lib/useImmersive`（body class `story-immersive`） | 與動畫創作室／知識族譜同一套：原生 Fullscreen API＋CSS 沉浸兩層，iOS 不支援元素 requestFullscreen 時按鈕仍然有反應。解析摘要與「產生分鏡」一起進全螢幕，寫作流不必為了按鈕退出來 |
| 標注（9 種） | 角色／場景／道具／造型＝插入宣告行；對白／旁白／動作／轉場／註記＝行前綴可 toggle | **標注寫進故事全文本身**，不另存中繼格式：故事是唯一來源，版本、協作、AI 解析讀的都是同一份文字。插進去的前綴就是解析引擎既有的那一套（`角色：`／`場景：`／`道具：`／`造型：角色＝描述`） |
| 註記不進解析 | `shared/story.ts` 的 `isStoryNoteLine`／`stripStoryNotes`，`runStoryParse` 送模型前剔除 | 「註：這裡待補一場追車」會被解析成一場真的追車戲。整行拿掉而不是留空行——空行是分場依據，留著會把一場切成兩場 |
| 大綱導覽 | `scriptOutline`：明寫分場（`場景：`／`# 標題`／`第 N 場`／`轉場：`）優先，沒有時退回空行分段 | 退回規則刻意與解析引擎的「一段＝一場戲」對齊，否則使用者照大綱數的場數跟解析結果對不起來 |
| 尋找／取代 | `findMatches`／`replaceAll`（不重疊；**備註行不動**） | 改主角名字是長稿必備。備註常寫著「主角原本叫小美，先別改」，一起改掉那句話就自相矛盾 |
| 統計 | 字數（不含空白與備註）、段數、預估片長（句數 × 5 秒／鏡） | 每鏡秒數取 `storyParse` 的 `durationSec` 預設值，估算才不會跟實際分鏡打架 |
| 字級／專注模式／快捷鍵 | 字級走 CSS 變數（localStorage 綁裝置）；Alt+1～9 標注、⌘F 尋找、⌘⇧F 全螢幕、⌘⇧O 大綱 | 字級不用內聯 `font-size`：手機 ≥16px 防 iOS 自動放大的守則要留在樣式表裡（`max(16px, …)`），內聯會蓋掉它。快捷鍵一律要修飾鍵——焦點就在 textarea 裡，裸鍵會讓打字誤觸插前綴 |

**解析改用高階模型**（`NIM_REASONING_MODEL`，預設 `meta/llama-3.1-405b-instruct`，
可用 `NVIDIA_NIM_REASONING_MODEL` 換掉）：劇本解析要一次讀完整份稿子，同時做代名詞歸併、
既有卡比對、分場分鏡與信心評分——這是整條製作鏈的源頭，這裡漏一個角色，後面每一顆鏡都少一個錨點。
它一份劇本只跑一次，成本差距換得起品質；逐鏡生成、助手閒聊那種高頻短任務不動（貴又慢、品質差距吃不到）。
旗艦模型失敗時 `nimCompleteWithFallback` 降級一次到日常主力模型並寫進 AI 軌跡——
「解析整個失敗」比「用 70B 解析」糟得多；但金鑰無效／點數用完／流量上限不降級（換模型救不了）。
逾時同步放寬到 150 秒（旗艦模型較慢，90 秒會把成功的解析判成逾時）。

## 工程 Guardrails（§18）對應

- **Idempotency**：同文 hash 短路；強制重解全走 RESOLVE 連結（e2e 斷言零新建）；轉分鏡同 run 冪等（applied.storyboard）。
- **Traceability**：`parse_candidates.sourceExcerpt`（來源文字）＋`parse_runs.plan/applied`＋aiTrace `story_parse` session；audit 字典補齊（`shared/auditWording.ts`）。
- **Partial Failure**：解析失敗只標 run failed，不動既有資料；候選逐張處理。
- **Undo**：`story.undoRun`（AI 建立可撤、使用者確認保留、Shot 軟刪可還原）。
- **Prompt Snapshot**：生成走既有 `generations.params`＋aiTrace prepared 事件。
- **Mobile First**：分鏡卡單欄、故事編輯器 16px 防 iOS 縮放、設定 sheet 全螢幕、主 CTA 沿用 --chrome-bottom 契約。
- **Cost Control**：解析預算 12k 字（截斷透明回報）；解析/轉分鏡 0 點（NIM 免費檔）；限流 `story:parse` 6/min。
  高階模型只用在「一份劇本跑一次」的解析上，且失敗會自動降級——不讓模型檔位變成單點故障。

## 刻意不做（PDF「第一輪不要做」＋現況暫緩）

- 完整剪輯 Timeline、大量專業 Camera 參數（僅留 §10 清單內欄位）、多 Agent 編排、全自動剪輯發布、企業級 DAM、一次接完所有模型。
- **2026-08-08 已補完原 P1–P3 缺口表全部五項**：
  1. 助手逐鏡上下文動作 `direct_shot`（§12）＋單鏡 before→after 變更預覽（§14）。
  2. 造型（Look）提到 generationCore 錨點層（§14 Identity/Look）：與角色身份併成同一句
     「外觀鎖定 安倢：黑色長髮，造型鎖定：米白外套」，凍進一致性快照供重試沿用；
     同時移除 `buildShotContextPrompt` 的 prompt 層注入（同一件衣服不講兩遍）。
  3. §23 雙向影響＋**畫面過時偵測**（兼 P3 Continuity Checker 第一版）：
     `detectContinuityDrift` 比對凍結快照與現在的卡片，`story.continuityCheck` 回報，
     分鏡卡標「畫面過時」並說明原因。**不加欄位、不做 migration**；唯讀不自動重生成。
  4. 轉分鏡**逐場 diff 套用**（§22／§33）：`diffStoryboardPlan` 分 create／fill／reuse，
     預覽與實際套用共用同一支純函式；已有鏡的場一律不動。
  5. Shot 相關素材推薦（§13／§26）：`suggestAssetsForShot` 做**名稱／標籤比對**並回報命中的詞。
     刻意不做語意向量檢索、也不寫「AI 已分析」——沒有那個能力就不假裝（§60）。

## 驗收實測（2026-08-08）

- **§19 Golden Path**：`scripts/e2e-story.py` **86/86**（貼故事→解析→確認卡→冪等→轉分鏡→
  環境繼承→Shot 綁定生成→造型分層→連戲檢查→逐場 diff→素材推薦→改故事差異→Undo→版本→守門）。
- **§70 五斷點 RWD**：390／430／768／1280／1440 逐一量測——橫向溢出 0、觸控目標不足 0、
  無名按鈕 0、分鏡標題可見度 84–100%。故事編輯器 16px（防 iOS 縮放）、主 CTA 44px、
  底部固定列未遮擋主要動作。
- **§67／§99 八步驗收（真的用滑鼠走）**：空專案 → 貼故事 → 按 AI 解析 → 角色/場景/道具/造型
  自動就位（零確認卡）→ 按產生分鏡 → 2 場 3 鏡 → 點一鏡進單格工作室 → 生成落地。
  **全程沒有打開過角色庫／場景庫／素材庫／知識庫／專案設定**（§99 的核心條件）。
  送給模型的最終提示詞實測含四層錨點：
  `外觀鎖定 安倢：黑色長髮、柔和五官，造型鎖定：米白色外套`／`光影鎖定 克難坡`／`材質鎖定 紅傘`。
- **§63 舊專案相容**：重構前長相的專案（無 story／story_scenes）開得起來、資料不少、
  舊分鏡顯示「未分場」、新欄位為 null、連戲檢查不誤報、照樣能就地生成。
- **§56-F 唯讀權限**：檢視者讀得到 story.get／continuityCheck／entityImpact，
  但 save／parse／generateStoryboard／characterLooks.add／generateInto 全被擋，且越權沒改到資料。
- **假模式的邊界（誠實說明）**：`mockStoryExtract` 是**標記行驅動**（「角色：」「場景：」「道具：」），
  刻意不做中文 NER——所以 e2e 驗的是**管線**（解析→實體→場→鏡→錨點→生成→撤銷），
  不是**自然語言理解品質**；後者由真模式的 LLM 契約（Zod schema＋提示詞）負責。
  純散文在假模式下會解析出場與鏡但零實體，UI 會明說「沒有辨識出角色、場景或道具」。
- **既知豁免**：`SceneCardBinding` 的「改」鈕 37×25，命中 repo 既有且有明文理由的
  WCAG 2.5.8「行內於文字中」豁免（`.hint > .btn-ghost`），寬度仍在 repo 自訂的 24px AA 底線之上；
  該元件為既有共用元件（SceneList／ProjectPage 也在用），本次不單方面改全站政策。

- **仍未做（下一輪）**：
  - 助手一次提議多個動作時的**彙總** Change Preview（目前每個動作各自確認，粒度已足夠安全，
    但「一次看完 5 個動作的總影響」還沒有）。
  - 素材推薦升級為語意向量檢索（受 RAG roadmap 門檻約束；介面已預留 `matched` 形狀）。
  - Continuity Checker 的自動修復（目前只回報，不代按重生成——這是刻意的）。

## 資料相容

- 純新增 migration（0049，17 句皆 IF NOT EXISTS），舊專案零影響；既有分鏡（無 storySceneId）在分鏡中心顯示為「未分場」。
- 舊「定調」資料（worldview/角色/場景/道具/知識/素材）原樣沿用，只是入口移到專案設定二層。
- 舊深連結 `#stage-context` → `#stage-story` 別名；`?focus=` 全部保留。
