# Audit 資料保存政策

> 狀態：第一版治理基線。此文件定義資料分類、保存期限、敏感資料限制與自動清理驗收條件；實作完成前不得宣稱 retention 已正式啟用。

## 目的

Audit Log 用來證明「誰在什麼時間，對什麼資源，執行了什麼動作，結果如何」。Retention 則決定這些紀錄保存多久、何時封存或清除，以及哪些紀錄不得由一般清理工作刪除。

Audit Log 不等於應用程式除錯 log，也不取代點數帳本。

## 分類與保存期限

| retention class | 內容 | 建議保存期限 | 到期動作 |
|---|---|---:|---|
| `standard` | 一般專案、資料庫、素材、排程與協作操作 | 365 天 | 刪除或匿名化 |
| `security` | 登入成功／失敗、session、API key、MCP key、異常限流、安全事件 | 730 天 | 先封存，再依政策刪除 |
| `privileged` | 管理員操作、角色變更、組織權限、封鎖、資料匯出、政策調整 | 3 年 | 低成本不可變封存 |
| `billing` | 點數預扣、扣款、退款、額度調整與成本核對 | 長期保存 | 不由一般 retention job 刪除 |

保存期限應由法務、組織政策與實際營運需要確認；若未完成確認，系統先採上表的保守預設。

## 必要欄位

每筆 Audit Event 至少包含：

```ts
interface AuditEvent {
  id: string;
  occurredAt: Date;
  actorUserId: string | null;
  actorType: "user" | "agent" | "system";
  action: string;
  resourceType: string;
  resourceId: string | null;
  teamId: string | null;
  groupId: string | null;
  result: "success" | "failure";
  requestId: string | null;
  retentionClass: "standard" | "security" | "privileged" | "billing";
  expiresAt: Date | null;
  metadata: Record<string, unknown>;
}
```

`billing` 可使用 `expiresAt = null` 表示不由自動清理工作刪除。

## 禁止寫入的資料

Audit metadata 不得包含：

- 密碼、密碼雜湊、重設碼
- session cookie、JWT、OAuth token
- MCP／REST／provider API key 原文
- 完整 request／response body
- 私訊本文、附件內容
- 使用者上傳文件全文
- 完整提示詞或模型輸出，除非另有明確合法目的與遮罩策略
- 不必要的 IP、裝置指紋或個人資料

需要識別 API key 時，只記 key ID 或不可逆 fingerprint，不記原文。

## 私訊與高頻事件

私訊內容不進 Audit Log。可記錄必要 metadata：

- conversation ID
- 發送者 ID
- 發送時間
- 操作結果
- 是否包含附件

不得記錄訊息本文、附件名稱或可推測內容的摘要。

高頻 read marker、typing、heartbeat 可豁免，避免 Audit table 無限膨脹；豁免清單必須文件化。

## 自動清理與封存

每日 retention job：

1. 以批次方式選取 `expiresAt < now()` 的紀錄。
2. 每批限制筆數與執行時間，避免長交易與鎖表。
3. `privileged`／`security` 若需封存，先寫入封存目的地並驗證成功。
4. 封存成功後才刪除來源資料。
5. 清理工作本身寫入 `privileged` Audit Event。
6. 任一步驟失敗必須告警，不能靜默忽略。

## 防竄改要求

第一階段：

- Audit API 只允許 append，不提供一般 update／delete。
- 清理由專用系統角色執行。
- 管理員不能透過一般 UI 修改 Audit Event。
- 對 `privileged`／`security` 封存檔建立批次雜湊與 manifest。

後續企業化：

- WORM／Object Lock 儲存
- 簽章 manifest
- 外部 SIEM
- 跨帳號或跨專案封存

## 查詢與匯出

Audit 查詢至少支援：

- 日期範圍
- actor
- action
- resource type／ID
- team／group
- success／failure
- request ID
- retention class

匯出 Audit 本身必須留下 `privileged` 稽核紀錄。

## Migration 建議

1. 新增 `retention_class`，初始預設 `standard`。
2. 新增 `expires_at`，依 action backfill。
3. 為 `(expires_at, id)` 建立批次清理索引。
4. 為常用查詢建立 `(team_id, occurred_at)`、`(actor_user_id, occurred_at)`、`(request_id)` 索引。
5. 點數帳本保持獨立，不把 cost ledger 併入可刪除 Audit table。

## 測試與驗收

- [ ] 每種 action 都能映射到唯一 retention class。
- [ ] 到期資料可分批清除，不造成長交易。
- [ ] `billing` 不會被 retention job 刪除。
- [ ] 清理失敗會產生告警。
- [ ] 清理工作留下自身 Audit Event。
- [ ] metadata secret scrub 測試覆蓋 token、cookie、密碼與私訊本文。
- [ ] 跨租戶查詢仍受 ACL／RLS 限制。
- [ ] 封存檔可驗證筆數與雜湊。
