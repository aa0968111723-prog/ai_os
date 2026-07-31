# ADR-010：組代理的分級授權與獨立事件表

- 狀態：Accepted
- 日期：2026-07-31
- 適用範圍：`group_members.agent_command_level`、`group_agent_runs`、`group_agent_events`、`shared/groupAgent.ts`、`server/services/groupCommand.ts`
- 相關：`drizzle/0018_group_agent_commander.sql`、〈[組代理總指揮](../組代理總指揮.md)〉、〈[AI 代理架構與維運](../AI代理架構與維運.md)〉

## 背景

組代理原本只有唯讀分析＋提議派工：看得到全組出事，卻不能核准、不能停、不能重跑、不能改期。要讓它能下令（L1／L2）並能在無人盯著時持續下令（L3），必須先回答兩個問題：**誰可以下令**，以及**下了什麼令要留在哪**。

## 決策一：以四級指揮權取代單一布林 `canDispatchAgent`

新增 `group_members.agent_command_level`（nullable text），值域 `none < dispatch < supervise < command`，比較與解析集中在 `shared/groupAgent.ts`（`resolveCommandLevel`／`levelAtLeast`／`canRunCommand`／`COMMAND_MIN_LEVEL`），前後端共用。

### 為什麼不繼續用布林

`canDispatchAgent` 只回答一件事：**能不能生出一份待核計畫**。待核計畫不花點、不動任何資料，必須有人再按一次核准才會開始執行——這是一個相當便宜的授權，組長開起來也不會猶豫。

L1／L2 要開的權限完全不是同一個量級：

- `approve_run` ＝ **替別人按下開始花點**，而且是立刻花。
- `stop_run`／`discard_run` ＝ 處置別人正在跑或等著跑的計畫。
- `assign_task` ＝ 改別人的工作分派與期限。
- 發起 campaign ＝ 讓組代理**在無人盯著時反覆做上面這些事**。

若沿用同一個布林，等於每次有人只是想開「可以派工」，就把「可以替全組核准並花錢」一起送出去；而且組長在 UI 上完全看不出自己送出了什麼。**授權的粒度必須跟得上能力的粒度**，否則守門就只是裝飾。

分級同時讓一件事變得可能：`COMMAND_MIN_LEVEL` 成為唯一出處，router 守門、campaign 執行器、`ask` 的提議過濾、前端按鈕露出全部讀同一張表——不會出現「畫面有按鈕、後端擋下來」或更糟的反例。

campaign 的門檻另立一個常數 `CAMPAIGN_MIN_LEVEL`（＝`command`）而不是塞進 `COMMAND_MIN_LEVEL`：那張表的鍵是「一道人按下去的指令」，按一次、花一次、有人看著；campaign 是「授權組代理在無人盯著時反覆下那些指令」。第一版把兩者混用（campaign 只驗 `approve_run` ＝ `supervise`），結果是成員設定頁那段「可監督不會自動花錢」的說明對組長講了假話——被授權 supervise 的人可以直接打 API 排一份帶自動核准授權的計畫再自己核准，而組長在畫面上看不到那份計畫存在。混用的代價不是「多給一點權限」，是**授權說明失去意義**。

### 相容性（不做資料回填）

`resolveCommandLevel` 以「明確設過的等級」優先，`null` 時退回舊布林（`true` → `dispatch`，否則 `none`）。因此 migration 不需要回填、部署當下既有授權不會無聲失效，也不需要一個「所有人先變 none」的空窗期。

代價是**兩欄必須一起寫**：`quota.setMemberCommandLevel`（新）與 `quota.setMemberDispatch`（舊開關）都同時寫等級與布林。只寫一欄的話另一條讀取路徑會看到相反的答案——尤其「關掉派工權卻留著 supervise」會讓開關變成謊言。舊開關的折算規則刻意不對稱（打開不降級、關掉一律 `none`），理由見 `levelFromDispatchToggle` 的註解與單元測試 `server/routers/quota.commandLevel.test.ts`。

### 考慮過但沒採用

- **再加一個布林（`canSuperviseAgent`）**：兩個布林＝四種組合，其中「不能派工但可以核准」是沒有意義的狀態，還得在每個讀取點自行判斷優先序。有序等級把不合法組合直接消滅。
- **完整 RBAC／權限位元**：這個系統目前只有三種角色與一條能力軸線，位元遮罩會換來一個沒人記得住的權限矩陣。等級可讀、可比較、可在 UI 用一個下拉表達。
- **只讓組長以上下令（不開放給組員）**：拿掉了授權模型，但也拿掉了「組長把日常調度交給某個組員」這個真實需求。

## 決策二：組級事件用 `group_agent_events`，不共用 `agent_events`

### 為什麼不共用

1. **`agent_events.project_id` 是 NOT NULL，而組代理最重要的幾件事不屬於任何單一專案**：下令、超出授權停手、跳過整條支線、發起人失去授權、campaign 終局。要共用就得放寬那個欄位為 nullable——那會鬆掉**專案代理**軌跡最有價值的一條保證（每一筆事件都掛得回一個專案），為了組層的方便去弱化專案層的資料契約，方向是反的。
2. **外鍵與生命週期不同**：`agent_events.run_id` 指向 `agent_runs`，而組級事件的 run 是 `group_agent_runs`，另外還要記 `child_run_id`（它下令產生的專案子計畫）與 `step_id`（組級步驟）。硬塞進同一張表就得讓 `run_id` 同時可能指向兩張不同的表——沒有外鍵能表達，查詢也永遠要先問「這筆是哪一種」。
3. **查詢形狀不同**：專案軌跡幾乎都以 `project_id` 起手；組級軌跡以 `group_id`、`run_id` 起手。混在一張表會讓每個既有查詢都得多帶一個「排除組級事件」的條件——漏掉一處，專案頁的事件流就會冒出使用者看不懂的組級訊息。
4. **保留與稽核政策可能分岔**：組級事件記的是「誰對誰下了什麼令」，比較接近管理稽核；專案事件是執行軌跡。分表讓兩者的保留年限與存取權可以各自決定。

### 沿用的部分

`(run_id, event_key)` 唯一鍵、append-only、`recordGroupAgentEventSafely`（記事件失敗不影響指令本身）、事件內容只放可驗證的事實（不放 prompt、token 與 chain-of-thought）——全部沿用 `agent_events` 的既有規則，不另立第二套語義。

### 已知代價

- Postgres 的 NULL 彼此不相等，因此 `run_id IS NULL`（L1／L2 從卡片／對話框下的指令）的事件**不受唯一鍵去重**。這對指令事件是可接受的（同一道指令下兩次本來就是兩件事），但不能倚賴它做重播冪等。
- 組級事件有兩支讀取 API：`teamAssistant.campaign`（單份計畫的軌跡）與 `teamAssistant.commandLog`（全組，含 `run_id IS NULL` 的單發指令）。後者是必要的——L1／L2 從卡片按下的每一道令 `run_id` 都是 NULL，少了它「誰替誰核准了一份會花點的計畫」就只有進資料庫下 SQL 才看得到。

## 後果

### 正面

- 授權粒度與能力粒度對齊；最貴的權限（替別人花點、無人盯著時自動花點）不再搭派工權的便車。
- 等級比較只有一個出處，露出面與執行面不會分岔。
- 組級軌跡不必為了塞進專案表而扭曲欄位語義；`agent_events` 的 NOT NULL 保證保住。
- 舊授權零回填相容，部署沒有權限空窗。

### 代價

- 兩張新表與一個新欄位要維護；`group_agent_events` 目前尚無保留政策（同 `agent_events`，需監控容量）。
- 兩支寫入路徑（新等級 API 與舊開關）必須永遠同時寫兩欄，靠單元測試釘住；舊開關在既有 UI 全數改用等級之前不能刪。
- 「組級」與「專案級」兩套事件，排查時要知道去哪一張表查（已寫進〈組代理總指揮〉的維運段）。

## 驗收

- `shared/groupAgent.test.ts`：等級解析（含 `null` 退回舊布林、非法字串視為 `none`）、`canRunCommand` 對照 `COMMAND_MIN_LEVEL`。
- `server/routers/quota.commandLevel.test.ts`：兩欄一起寫、舊開關折算的兩條不對稱規則。
- `scripts/e2e-team-assistant.py`：無授權組員下令得 `FORBIDDEN`、調級後立即生效、舊開關不降級、收權後再擋、跨組 id 一律 `NOT_FOUND`、campaign 生命週期與軌跡含 `planned` 事件。
