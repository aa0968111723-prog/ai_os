# 專案知識庫與向量 RAG 路線圖

> **狀態（最後核對：2026-08-02）**：專案內長文知識庫已上線；**向量 RAG（embedding 檢索）尚未實作**。
> README 未勾項「素材知識庫（RAG：貼上文字語料→檢索引用）」指的是後者。  
> 本文件釐清現況、何時該做、最小可行範圍與明確不做什麼。

相關：[`docs/wiki/專案知識庫.md`](../wiki/專案知識庫.md) · `shared/knowledgeInject.ts` · `server/routers/knowledge.ts`

---

## 1. 一句話對照

| | **現行：專案知識庫** | **路線圖：向量 RAG** |
|--|----------------------|----------------------|
| 機制 | DB 存全文 → 依優先序與字數預算組裝進 prompt | chunk → embedding → 相似度檢索 → 再注入 |
| 適合 | 每專案數篇～數十篇、總注入可塞進預算 | 單一專案上百篇、專案內主題問答、語料持續暴增 |
| 現況 | ✅ 已上線 | ❌ 未做 |

**短期建議**：先把現行釘選／預覽／類型／回收雜訊用熟；**不要在 lag、素材持久、手機主流程未收斂前開真 RAG 為 P0**。

---

## 2. 現行能力（已交付，不是 RAG）

### 2.1 資料與類型

- 類型：`transcript`（開示／逐字稿）、`testimony`、`script`、`note`
- 單筆約 4 萬字上限；軟刪進回收桶後**不再注入 AI**
- Schema：`pinned`、`summary`（遷移 `0018`／`0019`）

### 2.2 注入組裝（`assembleKnowledgeContext`）

優先序：

1. **preferIds**（代理 `extraSourceIds`／工作台「本次知識優先」／助手 `knowledgeIds`）
2. **釘選 `pinned`**
3. **mode**（`balanced`／`script_first`／`script_only`／`flat`）
4. 同層再依建立時間新→舊
5. 預算預留約 18%：未全文納入者補 **summary**

知識長文之前會先注入角色定裝＋場景設定精簡段（`script_only` 關閉卡片）。

### 2.3 可觀測與操作

- UI「預覽 AI 會讀什麼」：`knowledge.injectPreview`（不呼叫 LLM）
- 拆分鏡可回報是否截斷
- 知識庫頂部搜尋／篩類型

### 2.4 與世界觀／卡片的分工

| | 世界觀 | 角色／場景卡 | 知識庫 |
|--|--------|--------------|--------|
| 長度 | 短 | 短錨點 | 長文 |
| 圖影生成 | 有 | 勾選才有 | **不直接灌整庫** |
| LLM 助手／代理 | brief | 卡片段 | 主上下文之一 |

---

## 3. 何時才啟動「真 RAG」

滿足**任一**再開規格與 PR，否則維持現行注入：

1. **量**：單專案常態 >50 篇有效長文，或總可注入文字穩定超過預算導致大量 summary-only／截斷抱怨。
2. **問法**：需要在**目前這一個專案內**「問一句主題、只取相關段落」，且使用者能接受不注入全文。跨專案／跨整庫問答不屬於 MVP，必須另開產品與 ACL 規格。
3. **來源**：逐字稿／外部語料**自動大量進庫**且無法靠人工釘選維護（對齊 README「逐字稿來源就緒後啟動」）。
4. **可測量痛點**：至少兩週內有可重現的「AI 沒讀到明明在庫裡的那一段」案例，且用釘選／preferIds 無法合理解決。

**不作為啟動條件**：單純想「比較 AI」、尚未有穩定語料、或想一次重寫助手架構。

---

## 4. 最小可行 RAG（若啟動）

### 4.1 範圍（MVP）

| 做 | 不做（MVP） |
|----|-------------|
| **專案範圍**檢索（同組 ACL 不變） | 全站跨租戶語意搜尋 |
| 文字 chunk + embedding + top-k | 多模態影像向量 |
| 結果併入既有 `assembleKnowledgeContext` 預算管道 | 取代釘選／preferIds |
| 只餵助手／代理／導演 LLM | 直接灌圖／影生成 prompt |
| 可關閉的 feature flag | 強制全站改 RAG |

### 4.2 建議管線

1. **Ingest**：知識列建立／更新時非同步切 chunk（固定 token 或段落邊界）；軟刪時立即把既有向量標為不可檢索，還原時重新排入 embedding，硬刪時移除索引。
2. **Embed**：選單一 embedding 供應商；金鑰走既有 Secrets 慣例；費用進觀測。
3. **Store**：pgvector（同 Postgres）或獨立向量服務；向量列必須帶 `projectId`／`groupId`／`knowledgeId`。
4. **Retrieve**：查詢 embedding → 專案／群組 ACL 過濾 → top-k → 去重 → 依下節的固定優先序與預算規則交回組裝層。
5. **Generate**：沿用現有 LLM 路徑；prompt 標明「以下為檢索片段」。
6. **Eval**：固定 20 題黃金集（命中率、拒答、延遲、$/問）。

### 4.3 工程硬規則

- **一功能一 PR**；先 schema／ingest，再 retrieve，再 UI，禁止大包一次合。
- 不新增第二套「知識真相」：向量是索引，**全文仍以 knowledge 表為準**。
- 刪除／軟刪必須同步失效向量，避免幽靈片段。
- 檢索失敗時 **降級回現行預算注入**，不可整段助手 500。
- 遵守既有 ACL：檢視者／組隔離與 knowledge router 同一口徑。

#### 組裝優先序與去重（MVP 固定規則）

RAG 只能使用 `assembleKnowledgeContext` 在卡片、使用者指定來源與釘選知識之後的**剩餘預算**，不得反向擠掉使用者明示的來源。固定順序為：

1. 現行角色／場景卡（是否加入仍由 `includeCards` 與 `mode` 決定）。
2. `preferIds`，維持呼叫端指定順序。
3. `pinned`，同層維持新→舊。
4. RAG top-k 片段，依相似度高→低；`script_only` 只接受 `script` 來源，`script_first` 在同分時先排 `script`。
5. 其餘全文／摘要，沿用 `balanced`、`script_first`、`script_only`、`flat` 現行規則。

去重先用穩定鍵 `knowledgeId:startOffset:endOffset`；內容重疊時再用 `knowledgeId + normalizedTextHash`。若 `preferIds`／`pinned` 已納入同一篇的相同字元範圍，RAG 片段不重複注入。RAG 可使用的字數須有獨立上限；預算不足時依序淘汰「一般來源的摘要／全文尾段 → 最低分 RAG 片段」，**不得因加入 RAG 而縮減 `preferIds`／`pinned` 已取得的預算**。

#### Deadline、重試與降級（MVP 固定規則）

- 查詢 embedding 加向量檢索的總 deadline 為 **1,200 ms**；所有重試都必須包含在這個總期限內。
- 最多重試 **1 次**，只重試網路中斷、408／425／429 與 5xx；400／401／403／404／422、ACL 拒絕與 schema 驗證失敗不可重試。
- 逾時、超過重試上限或不可重試錯誤，一律回到現行知識注入；生成主流程不得因此回 500。
- fallback log 僅記 `projectId`、provider、deadline、attempt、errorClass、durationMs、topK，禁止記查詢原文、知識內容與憑證。
- 至少提供 `rag_retrieval_duration_ms`、`rag_retrieval_fallback_total{reason}`、`rag_retrieval_results_count` 三項 metric，讓維運能分辨「沒命中」與「服務壞掉」。

### 4.4 明確不做（直到有單獨產品決策）

- 用 RAG 取代世界觀或角色／場景卡
- 未審核的外部爬蟲整站灌庫
- 在生成台每一格圖影請求都跑一次向量檢索（成本與延遲）

---

## 5. 與成熟度／其他主線的優先序

| 優先 | 項目 | 說明 |
|------|------|------|
| P0 | 素材持久／備份演練 | 見 [`docs/素材備份與還原演練.md`](../素材備份與還原演練.md) |
| P0 | 卡頓與 PROCESS_ROLE | 可靠性先於新檢索架構 |
| P1 | 現行知識庫操作教育 | 釘選、預覽、腳本類型、清雜訊 |
| P2 | 本路線圖 MVP RAG | 僅在第 3 節條件成立後 |

---

## 6. 驗收（現行知識庫，非 RAG）

- [ ] 新腳本釘選後，`injectPreview` 顯示 full 或預期 partial
- [ ] 軟刪篇目不再出現在預覽與助手上下文
- [ ] 工作台勾「本次知識優先」時 preferIds 生效
- [ ] 拆分鏡在僅有腳本類型時走 `script_only` 行為與文件一致

## 7. 驗收（未來 RAG MVP 的發布閘門）

### 7.1 固定評估資料

- 版本化資料集 `rag-eval-v1`：固定 20 題，其中 15 題可回答、5 題應拒答；每題固定 `projectId`、允許命中的 `knowledgeId`／chunk 範圍與資料快照 hash。
- 固定 chunker、embedding 模型版本、top-k（MVP 為 `k=5`）與 feature flag；任何一項變動都產生新資料集／執行版本，不與舊結果混算。
- 在同一 commit、相同資料快照下跑 3 次；延遲取全部請求樣本，品質分數取三次平均，報告須保留原始 rank 與錯誤分類（不保存敏感全文）。

### 7.2 計算方式與最低門檻

| 指標 | 計算方式 | MVP 門檻 |
|------|----------|----------|
| Hit@5 | 15 題可回答題中，top 5 至少含一個允許 chunk 的題數 ÷ 15 | **≥ 0.85** |
| Recall@5 | 每題 `命中的允許 chunks ÷ 該題全部允許 chunks`，再對 15 題取平均 | **≥ 0.75** |
| 應拒答正確率 | 5 題不可回答題中，沒有把低分片段宣稱為答案的題數 ÷ 5 | **= 1.00** |
| ACL 洩漏 | 結果含非目前 project／group 的 chunk 數 | **= 0** |
| 檢索延遲 | 查詢 embedding＋向量查詢，不含後續 LLM；同環境樣本的 p95 | **≤ 1,200 ms** |
| 檢索成本 | query embedding 與向量服務成本 ÷ 問題數，不含後續 LLM | **≤ US$0.001／題** |

### 7.3 功能與故障驗收

- [ ] feature flag 關閉時，注入文字與現行快照完全一致。
- [ ] `preferIds`／`pinned`／四種 `mode` 的排序、去重與淘汰符合第 4.3 節；RAG 不會擠掉使用者指定知識。
- [ ] 軟刪後立即不可再新增檢索命中，既有索引在 5 分鐘內失效；還原後 5 分鐘內重新可檢索。
- [ ] 模擬 timeout、429、5xx 各只重試一次且不超過 1,200 ms；400／401／403／404／422 不重試。
- [ ] 每一種故障都成功降級到現行注入，助手不回 500，且 log／metric 含正確 `reason`、attempt、duration，不含查詢與知識全文。
- [ ] 20 題黃金集達到第 7.2 節全部門檻才可逐步開啟 feature flag；任一門檻未達即不發布。

---

## 8. 維護

- 程式與測試為準；衝突時回寫本文件與 wiki「專案知識庫」。
- 若 README 勾選 RAG 完成，須同時更新本文件狀態列與第 7 節日期。
