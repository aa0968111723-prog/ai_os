# UI primitives 棘輪（UIUX-01）

| 欄位 | 值 |
|------|-----|
| **Document ID** | UIUX-RATCHET-2026-07 |
| **Status** | Active |
| **Date** | 2026-07-30 |
| **腳本** | `scripts/check-ui-primitives.mjs` |
| **基準線** | `docs/uiux-audit/ui-primitives-baseline.json` |
| **關聯** | `docs/product/site-wide-uiux-optimization-plan.md` §24.3 |

---

## 1. 為什麼需要這個

全站 UI/UX 優化計畫 v1.0（2026-07-29）§24.3 已經規範共用元件庫：「按鈕收斂為 Primary／Tonal／Ghost
三級」「表單統一輸入井外觀」「區分可互動 Chip 與純展示 Badge/Pill」，成功指標也明訂 **「hint ≤ 一句」**。

但那份規範收斂的是 **CSS class 的命名與外觀**，不是**元件**。`client/src/components/ui/` 在計畫發布時
並不存在，於是新功能唯一可走的路仍是手寫 `className="btn-sm primary"`、`<p className="hint">`。

實測結果（計畫發布後 80 個 commit，約一天）：

| 指標 | 計畫發布時 | 一天後 | 變化 |
|------|-----------|--------|------|
| `hint` 用量 | 464 | **505** | **+41** |
| `styles.css` | 3165 行 | **3628 行** | **+15%** |
| 使用 primitives 的檔案 | 0 | **0** | — |

**結論：規範靠人自律，而發布速度是每天約 30 個 PR。規範必然被稀釋。**
這是第四輪 UIUX 打磨前必須先解決的結構問題——否則這一輪的成果同樣會在兩週內被吃回去。

## 2. 棘輪語意

`check:ui-primitives` 是**單向棘輪**，只擋退化、不逼一次改完：

- 既有用量全部寫進 baseline，**不擋**。
- 任一檔案的某個 class 用量 **超過** baseline → CI 紅燈。
- **新檔案 baseline 視為 0** —— 新程式碼一律要用 primitives。
- 用量下降時 baseline **不會自動降**；遷移完一批後明確執行 `--write-baseline` 收緊，避免誤放行。

被接管的 class 與對應元件見腳本內 `OWNED_CLASSES`。純版面 utility 不納入，避免噪音。

## 3. 指令

```bash
npm run check:ui-primitives      # CI 用；退化則非 0 退出
npm run report:ui-primitives     # 只看現況，永遠 0
node scripts/check-ui-primitives.mjs --json            # 供其他工具消費
node scripts/check-ui-primitives.mjs --write-baseline  # 遷移完一批後收緊
```

## 4. 紅燈了怎麼辦

1. **正常情況**：從 `client/src/components/ui` 匯入對應 primitive 取代裸 class。這是預期路徑。
2. **合理例外**：在腳本的 `ALLOWLIST` 加入 `路徑::class`，並在 PR 描述說明理由。
   **這個清單長大就代表護欄失效**——比照 `docs/adr/009-import-boundaries.md` 的紀律。
3. **遷移讓總量下降**：執行 `--write-baseline` 收緊，並把更新後的 baseline 一起提交。

## 5. 非目標

- 不檢查視覺正確性（那是 `scripts/e2e-ui/audit-routes.mjs` 的職責）。
- 不檢查 `styles.css` 內容本身，只記錄行數作為趨勢觀測。
- 不管 `client/src/components/ui/` 底下的檔案——primitives 本來就該直接寫 class。
