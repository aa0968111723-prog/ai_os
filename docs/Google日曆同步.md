# Google 日曆直連同步（設定與運作說明）

排程不再需要手動「匯出 .ics → 匯入」：每位夥伴在「筆記排程」頁點一次
**連結 Google 日曆**，之後組排程的**新增／修改／刪除會自動出現在自己的 Google 日曆**，
另有每 15 分鐘的背景對帳收斂任何漏網（離線期間的變更、成員異動、暫時性 API 失敗）。
沒連結的人仍可用 .ics 匯出（保留為後備）。

## 站方一次性設定（管理員）

功能預設隱藏，設好以下環境變數後自動出現：

| 變數 | 說明 |
| --- | --- |
| `GOOGLE_CLIENT_ID` | GCP OAuth 2.0 用戶端 ID |
| `GOOGLE_CLIENT_SECRET` | GCP OAuth 2.0 用戶端密鑰（同時是 refresh token 落庫加密金鑰的預設種子） |
| `APP_URL` | 站台對外網址（例 `https://ai-os-app.zeabur.app`）——OAuth 回跳網址以它組成 |
| `GOOGLE_TOKEN_SECRET`（選） | 獨立的 token 加密金鑰種子；設了即優先採用，可獨立輪替 |

GCP 主控台步驟：

1. [console.cloud.google.com](https://console.cloud.google.com) 建立（或選）專案 → 「API 和服務」。
2. **啟用 Google Calendar API**（API 程式庫搜尋 Calendar）。
3. 「OAuth 同意畫面」：類型選外部（或內部，若全組織同網域）；
   範圍加入 `.../auth/calendar.app.created`（非敏感範圍，毋須送審）。
   測試模式下記得把夥伴的 Gmail 加入測試使用者。
4. 「憑證」→ 建立 OAuth 用戶端 ID → 網頁應用程式 →
   已授權的重新導向 URI 填 **`{APP_URL}/api/google/oauth/callback`**。
5. 把 ID/密鑰填進部署平台（Zeabur 服務 Variables）→ Redeploy。

## 權限與安全設計

- **最小權限範圍 `calendar.app.created`**：系統只能建立並管理「自建」的日曆
  （名為「AI Director OS・組排程」），完全碰不到使用者原有的個人日曆與事件。
- refresh token 以 **AES-256-GCM 加密落庫**（金鑰種子＝`GOOGLE_TOKEN_SECRET` 或退回
  `GOOGLE_CLIENT_SECRET`），資料庫外洩也拿不到可用憑證。
- OAuth `state` 帶 HMAC 簽章＋10 分鐘效期，callback 端驗簽並比對登入者——
  防 CSRF、也防把授權綁到別人帳上。
- 中斷連結時：撤銷 Google 授權、刪除對方帳戶裡的專屬日曆、清除本地 token 與事件對應。

## 同步模型（方向性）

- **系統是專屬日曆的唯一真相來源**：排程請回系統改；在 Google 端手改該日曆的事件，
  會在該筆排程下次變更（或事件被手動刪除後的下次對帳）時被系統覆蓋／重建。
- 觸發時機：排程增刪改後 3 秒內（連續操作合併為一次）＋每 15 分鐘全量對帳＋開機 30 秒後首輪。
- 範圍：連結者「所有所屬組」的排程都進同一本日曆，事件標題帶 `[組名]` 前綴區分。
- 事件對應與內容指紋存 `google_event_links`：內容沒變不打 API，節省配額。
- 授權失效（使用者在 Google 帳戶端撤銷）：連線標記為 error，前端顯示「重新連結」，不無效重試。

## 疑難排解

- 「站方尚未設定 Google 日曆整合」：檢查 `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` 是否已設並重新部署。
- 回跳報 `redirect_uri_mismatch`：GCP 憑證裡的重新導向 URI 必須逐字等於
  `{APP_URL}/api/google/oauth/callback`（含 https、無尾斜線）。
- 連結成功但日曆沒出現：Google 日曆左側「其他日曆」找「AI Director OS・組排程」；
  手機 App 需在「設定 → 顯示更多日曆」勾選。
- 同步錯誤：狀態列滑鼠停留可見 lastError；系統錯誤紀錄（管理頁）scope 為 `gcal:*`。
