# PostgreSQL RLS 導入計畫

> 目的：在既有應用層 ACL 之外，增加資料庫層第二道隔離。RLS 不取代現有 ACL；兩者必須同時成立。

## 威脅模型

RLS 主要降低以下風險：

- 新增 tRPC／REST／MCP 路徑時忘記套用 ACL。
- Agent／Workflow／Runner 使用 service 時漏傳 actor 或 group。
- 管理員查詢或批次功能條件寫錯。
- 原始 SQL、join 或 refactor 造成跨租戶資料外洩。
- 未來多 replica／外部整合增加入口後，應用層守衛不一致。

RLS 不能單獨解決：

- 應用角色本身被全面攻陷。
- 使用具有 `BYPASSRLS`／superuser 權限的 DB 帳號。
- secret 外洩、備份外洩或物件儲存 ACL 錯誤。
- 同一租戶內不當授權。

## 前置條件

1. 正式 App DB role 不得是 superuser，不得具有 `BYPASSRLS`。
2. Migration role 與 runtime role 分離。
3. 所有 request／background task 都能取得明確的 actor context。
4. 連線池使用 transaction-scoped context，避免 context 污染下一個 request。
5. E2E 可建立至少兩個互不相屬的租戶／組別。

## Context 設計

建議在 transaction 開始時使用 `SET LOCAL`：

```sql
select set_config('app.user_id', :user_id, true);
select set_config('app.team_id', :team_id, true);
select set_config('app.group_ids', :group_ids_csv, true);
select set_config('app.is_platform_admin', :is_platform_admin, true);
```

規則：

- 一律在 transaction 內設定。
- transaction 結束即清除，避免 pool connection context 泄漏。
- 未設定 context 時預設拒絕，而不是預設全開。
- background task 必須以原始 actor 或明確 system actor 執行。
- platform admin bypass 必須明確、可稽核，不能依賴空 context。

## 第一階段資料表

優先順序：

1. 私訊與附件：`conversations`、`conversation_members`、`conversation_messages`、`dm_attachments`。
2. 自訂資料庫：database／fields／rows／files／project links。
3. 專案與素材：projects、assets、generations、scenes、approvals。
4. 組織資料：teams、groups、memberships。
5. Audit 與點數查詢：audit logs、cost ledger；寫入仍由專用 service 控制。

實際表名依 schema 為準；導入前先產生表與 policy inventory。

## Policy 模式

### 組別資源

讀取條件：resource 的 `group_id` 必須存在於目前 context 的 group membership。

寫入條件：除了可見性，還必須由應用層角色規則確認；RLS 只做最低隔離，不承擔全部商業授權。

### 團隊資源

resource 的 `team_id` 必須等於目前 context 的 team，或 actor 具明確 platform admin context。

### 私訊

使用者必須出現在 conversation membership 中。非成員查詢應得到空集合／not found，不得洩漏 conversation 存在。

### 個人資源

owner user ID 等於目前 actor，或依既有團隊管理規則取得存取權。

## Rollout 策略

### Phase 0：Inventory 與測試基線

- 列出所有租戶資料表與存取路徑。
- 建立兩租戶負向測試。
- 找出 runtime 中沒有 transaction context 的路徑。

### Phase 1：Context Foundation

- 建立 `withDatabaseContext()`。
- tRPC、REST、MCP、Runner 全部透過同一入口設定 context。
- 此階段尚不啟用 policy，只做觀測與測試。

### Phase 2：Shadow／Restrictive Read

- 從私訊與自訂資料庫先啟用 read policy。
- 以測試與 staging 驗證正常流程。
- 監控被拒絕查詢，但不得在 log 中寫出敏感 SQL 參數。

### Phase 3：Write Policy

- 加入 INSERT／UPDATE／DELETE policy。
- 高風險操作仍保留應用層 role check 與 Audit。

### Phase 4：擴大覆蓋

- 專案、素材、生成、組織、Audit／billing read。
- 所有新租戶資料表必須附 RLS policy 才能合併。

## Migration 安全

- 使用 expand／verify／enforce，避免一次直接 `FORCE ROW LEVEL SECURITY` 造成全站中斷。
- Policy 上線前先確認 runtime role 與 migration role。
- 舊資料缺少 team／group ownership 時必須先 backfill，禁止以 null 當全站可見。
- Migration CI 要測 fresh DB 與舊資料快照升級。
- 回滾以停用 policy／forward-fix 或還原處理，不執行破壞性 down migration。

## 測試矩陣

每種資源至少驗證：

- 同組成員可讀。
- 不同組成員不可讀。
- 同團隊不同組依產品規則處理。
- 無 context 不可讀。
- 一般 member 不可透過 platform admin flag bypass。
- tRPC、REST、MCP、Agent、Workflow、Runner 結果一致。
- 連續使用同一 pool connection 時 context 不會跨 request 泄漏。
- 失敗／rollback 後 context 不殘留。

## 驗收清單

- [ ] Runtime role 無 superuser／BYPASSRLS。
- [ ] `withDatabaseContext()` 覆蓋所有入口。
- [ ] 高敏感資料表啟用 RLS。
- [ ] 無 context 預設拒絕。
- [ ] 跨租戶負向測試在 CI 執行。
- [ ] RLS 拒絕事件可觀測但不洩漏敏感資料。
- [ ] Policy 變更有 migration、review 與 Audit。
- [ ] 備份還原後 policy 與 role 權限仍正確。
