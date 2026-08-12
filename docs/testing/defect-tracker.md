# Aios AI 助手 — 21 缺陷追蹤

> 2026-08-12 源碼分析 + 功能測試發現，共 21 個缺陷，已全數開 GitHub Issues #660–#680

---

## 缺陷總覽

| 等級 | 數量 | Issues |
|---|---|---|
| 🔴 HIGH | 7 | #660–#665, #667 |
| 🟡 MEDIUM | 9 | #666, #668–#675 |
| 🟢 LOW | 5 | #676–#680 |

---

## 🔴 HIGH（7 項）

| Issue | 編號 | 缺陷 | 檔案 | 狀態 |
|---|---|---|---|---|
| [#660](https://github.com/aa0968111723-prog/ai_os/issues/660) | U1 | 簡單提問（如「幫我列出我目前有哪些專案」）被誤判為 AGENT 模式 | `shared/assistantExecution.ts:124` | OPEN |
| [#661](https://github.com/aa0968111723-prog/ai_os/issues/661) | U2 | 專案清單回覆遺漏部分專案（如「Manus 完整測試專案」） | `server/routers/globalAssistant.ts` | OPEN |
| [#662](https://github.com/aa0968111723-prog/ai_os/issues/662) | U3 | 「哪一個專案最舊」排序不正確 | `server/routers/globalAssistant.ts` | OPEN |
| [#663](https://github.com/aa0968111723-prog/ai_os/issues/663) | U11 | QUESTION_RE 缺少讀取型動詞（列出、清單、顯示、查看），導致讀取請求誤判為 DIRECT | `shared/assistantExecution.ts:124` | OPEN |
| [#664](https://github.com/aa0968111723-prog/ai_os/issues/664) | U18 | SOURCE_PICKER 互動卡無逾時機制，使用者可永久卡在 waiting_user_input | `server/routers/globalAssistant.ts:856` | OPEN |
| [#665](https://github.com/aa0968111723-prog/ai_os/issues/665) | U4 | 連續對話上下文被截斷（history 上限 8 則），跨輪無重用機制 | `server/routers/globalAssistant.ts` | OPEN |
| [#667](https://github.com/aa0968111723-prog/ai_os/issues/667) | U5 | agentCapabilityCertification 0/4 → /api/ready 503 | `server/services/agentToolRegistry.ts` | OPEN |

---

## 🟡 MEDIUM（9 項）

| Issue | 編號 | 缺陷 | 狀態 |
|---|---|---|---|
| [#666](https://github.com/aa0968111723-prog/ai_os/issues/666) | U4b | 連續對話無上下文重用機制 | OPEN |
| [#668](https://github.com/aa0968111723-prog/ai_os/issues/668) | U6 | /api/computerRuntime 回 404（實際路由為 /api/computer-runtime/live/:providerRef） | ✅ FIXED |
| [#669](https://github.com/aa0968111723-prog/ai_os/issues/669) | U7 | AGENT 工作過程步驟顯示統一一律顯示相同文案 | OPEN |
| [#670](https://github.com/aa0968111723-prog/ai_os/issues/670) | U12 | extractJsonObject 貪婪 regex 可能合併多個 JSON 物件 | OPEN |
| [#671](https://github.com/aa0968111723-prog/ai_os/issues/671) | U13 | 使用者輸入含特殊字元時助手行為異常 | OPEN |
| [#672](https://github.com/aa0968111723-prog/ai_os/issues/672) | U14 | agentCore billing 退款邏輯存在潛在免費無限呼叫漏洞 | OPEN |
| [#673](https://github.com/aa0968111723-prog/ai_os/issues/673) | U19 | 格式修復只做一次，第二次壞 JSON 直接降級純文字 | OPEN |
| [#674](https://github.com/aa0968111723-prog/ai_os/issues/674) | U20 | 成員代號 mN 兩輪之間可能漂移（尚未加 ORDER BY） | ✅ FIXED |
| [#675](https://github.com/aa0968111723-prog/ai_os/issues/675) | U21 | Google Photos 被封鎖時只顯示 blocked 但無替代路徑 | OPEN |

---

## 🟢 LOW（5 項）

| Issue | 編號 | 缺陷 | 狀態 |
|---|---|---|---|
| [#676](https://github.com/aa0968111723-prog/ai_os/issues/676) | U8 | /api/health 回 build.sha = null | OPEN |
| [#677](https://github.com/aa0968111723-prog/ai_os/issues/677) | U9 | AI 助手對話框載入時出現閃爍 | OPEN |
| [#678](https://github.com/aa0968111723-prog/ai_os/issues/678) | U10 | 手機版底部導航 active 狀態無視覺回饋 | OPEN |
| [#679](https://github.com/aa0968111723-prog/ai_os/issues/679) | U15 | assistantRunStore LRU 淘汰 O(n²) 線性掃描 | ✅ FIXED (PR #681) |
| [#680](https://github.com/aa0968111723-prog/ai_os/issues/680) | U20b | 成員代號截斷未揭露「另有 N 位未列」 | OPEN |

---

## 已修復（5 項）

| 修復 | 說明 | 驗證 |
|---|---|---|
| FIX-01 | computerRuntime 404 → 200 | AI 代理開發員確認 |
| FIX-02 | 含「嗎」問句誤判 DIRECT 自動寫入 | 44 條 live vs local 0 mismatch |
| FIX-03 | browser pattern 缺失，開啟瀏覽器請求未觸發 | 控制組驗證通過 |
| PR #681 | U15 LRU O(n²) 修復 (assistantRunStore) | 程式碼守門員審查通過 |
| PR #683 | 前端 AI 助手全功能測試 (+19 tests) | 1818 tests 全綠、tsc 無錯誤 |

### 🔴 Onboarding 新發現（2026-08-12 下午）

| # | 問題 | 嚴重度 | 對應 Issue |
|---|---|---|---|
| O1 | #677 助手載入閃爍影響 onboarding 第一印象 | 高 | #677 |
| O2 | 帳號採邀請制無自助註冊 | 中 | 待開 |
| O3 | 間歇性 502（測試期間一度全站中斷） | 中 | 追蹤中 |
| O4 | 「組」等術語缺一次性解釋 | 中 | 待開 |

---

## 源碼缺陷索引

| 檔案 | 相關 Issues |
|---|---|
| `shared/assistantExecution.ts` | #660, #663 |
| `shared/assistantSemanticResolution.ts` | #662 |
| `server/services/assistantCore.ts` | #670, #673 |
| `server/services/agentCore.ts` | #672, #674 |
| `server/routers/globalAssistant.ts` | #661, #664, #665, #675, #680 |
| `client/src/lib/assistantRunStore.ts` | #679 ✅ |
| `server/routers/agentToolRegistry.ts` | #667 |
| 部署配置 | #668 ✅, #676 |

---

*由 CubeLV CEO 直轄彙整 · 2026-08-12 · repo: aa0968111723-prog/ai_os @ f3f716f9*
