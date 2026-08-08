# 頁面感知助手：現況盤點（2026-08-08）

> 五路平行代理稽核，全部 file:line 已對照現行程式碼。結論先講：
> **需要的 state 幾乎全都已經存在，缺的只是「把它報給助手」的那一層**——唯一真正缺的是分鏡多選。

## CURRENT CONTEXT（助手今天知道什麼）

- 全部只有 **`groupId` ＋ route 推導的 `projectId`**。
- `projectIdFromRoute()`（`GlobalAssistantSheet.tsx:38-41`）只認 `/p/:uuid` 與 `/studio/:uuid`；
  dashboard、planner、databases、collab、chat 一律回 null＝**零 context**。
- 送出的 payload（兩條路完全一樣，`assistantStream.ts` + `AICreativeCopilot`）：
  `{ groupId, message, history, projectId }`。
- 伺服器端唯一的頁面感知：`runGlobalAsk` 把 projectId 對到 `pN` 代號後注入一句
  「使用者目前正停在專案 pN 的頁面」；對不到就整句不注入（不洩 uuid）。
- **GlobalAssistantSheet 的 props 只有 `{open, onClose, groupId, triggerRef}`**——
  沒有任何頁面把自己的 entity/selection 傳進來的管道。

## AVAILABLE PAGE STATE（已存在、可直接讀，不得重造）

| 面 | 擁有者 | 變數 | 形狀 |
|---|---|---|---|
| 分鏡（Storyboard） | `StoryboardStage.tsx:40` | `studioSceneId` | 單一 **shot id**（開著單格工作室的那一鏡） |
| 分鏡模式 | `StoryboardStage.tsx:39` | `mode` | `simple`／`pro`，localStorage `aios.board.mode.<projectId>` |
| 分鏡編號 | `StoryboardStage.tsx:61-64` | `shotNumber` | `Map<shotId, 1-based>`（**與伺服器 sceneNo 同一算法**：orderIndex 排序後 index+1） |
| 成片（SceneList） | `SceneList.tsx` | `studioScene {id, number}` ／ `sceneFilter` | 單一 shot＋序號／`all\|ready\|missing` |
| 動畫創作室 | `useBoardSession` | `activeShotId` | 單一 shot id（null＝自由塗鴉） |
| 素材庫 | `AssetLibrary.tsx:125` | `selected: Set<string>` | **全庫唯一的實體多選**；另有 `kindFilter`／`q` |
| 資料庫 | `DatabasesPage` | `selectedId` ／ `contextProjectId` | 單一 table id／`?projectId=` |
| 筆記 | `NotesCard` | `editingId` | 事實上的「選中的筆記」 |
| 協作中心 | `CollaborationCenter` | `tab` | `TabKey` |
| 專案頁分段 | `TocNav.tsx:41-57` | `activeId` | **IntersectionObserver scroll-spy**：`stage-story`／`stage-board`／`stage-create`／`stage-deliver` |
| 生成台勾選 | `usePersistedIds` | `aios.pick.{chars,scenes,props}.<projectId>` | `string[]`（**注意：`sceneIds` 是場景設定卡，不是分鏡**） |

## MISSING CONTEXT（真正缺的）

1. **分鏡多選不存在**——全庫沒有任何 `Set<shotId>` 選取（`draftIds` 是髒標記不是選取）。
   「把這三鏡變得更有張力」today 無法成立 → 本輪新增最小可用的多選。
2. **專案頁沒有單一「目前這一鏡」**：`StoryboardStage` 與 `SceneList` 各自開自己的 SceneStudio，
   同頁兩份 open-shot state。
3. **行程沒有選中項 id**（`CalendarView.selectedKey` 是日期鍵不是 item id）。
4. **資料列沒有多選**（`GridRow` 只有 inline `editing`）。
5. **AICreativeCopilot 沒有 request epoch 守衛**（ProjectAssistant 有）——sheet 常駐、路由在底下換，
   在途回答可能落在已變的 context 上。

## PAGE TYPES（本輪支援）

`home`／`project`／`story`／`storyboard`／`create`／`deliver`／`studio`／`assets`／`tasks`／
`notes`／`schedule`／`database`／`agent_run`／`collab`／`chat`／`community`／`other`

專案頁的四段（故事／分鏡／製作／成片）是**同一長頁的錨點**，不是分頁——
由 TocNav 的 scroll-spy 決定「人在哪一段」，因此專案頁的 pageType 會隨捲動在
`story`／`storyboard`／`create`／`deliver` 之間切換。

## ENTITY TYPES

`scene`（story_scenes＝一場戲）／`shot`（**DB 表名叫 `scenes`，但它是分鏡**）／
`asset`／`task`／`note`／`schedule_item`／`generation`／`agent_run`／`database`／`script`

資料模型事實：Shot 是**獨立 UUID 列**（不是 scene+index）；`scenes.storySceneId` 掛回場；
排序用 project 全域的 `scenes.orderIndex`。`shared/story.ts` 只有 LLM 解析用的 schema，不帶 id。

## INTEGRATION POINTS

- **Context store**：`client/src/lib/assistantContext.ts`（模組級單例＋`useSyncExternalStore`，
  比照既有 `lib/orbState.ts`；全庫零 `createContext`，不動 AppShell 樹形＝不碰 hookOrder 契約測試）。
- **註冊點**：各頁 `useEffect` 呼叫 `registerAssistantContext({...})`。
- **消費點**：`AICreativeCopilot`（快捷動作＋麵包屑＋payload）、`GlobalAssistantSheet`（麵包屑）。
- **傳輸**：`requestSiteAssistantStream` body ＋ `globalAssistant.ask` input ＋
  Express `/api/assistant/site-ask` 手解析（三處都要加欄位，否則靜默丟棄）。

## HAZARDS（施工前必須知道）

1. **嚴格契約測試**：`assistantStream.site.test.ts:135-136` 用 `toEqual` 斷言**完整** body 物件；
   `assistantStream.test.ts` 用 `JSON.stringify` 字面比對三處。**加任何欄位都會紅**，必須同步改測試。
2. **伺服器 z.object 會靜默剝除未知欄位**——前端加了、後端沒加＝什麼都不會發生也不會報錯。
3. **Express SSE 端點是手解析** `req.body`，只讀白名單欄位，同樣會靜默丟棄。
4. **React effect 順序**：新頁 effect 先跑、舊頁 cleanup 後跑——註冊/撤銷必須用 token 比對，
   否則換專案時舊頁 cleanup 會把新頁的 context 清成空白（已在 store 內處理並有測試）。
5. `sceneIds` 這個名字在 ProjectPage/StoryboardStage/SceneList 指的是**場景設定卡**，不是分鏡——
   命名時務必避開。
6. `AssistantTrace`（完成後的軌跡）預設收合且測試鎖定無 `open` 屬性；
   `LiveAssistantTrace` 兩處都預設展開（`useState(true)`）——本輪要改成預設收合。
