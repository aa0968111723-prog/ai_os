# Google 雲端硬碟私人檔案匯入修復

## 測試發現

實際網站測試顯示：

- Google 雲端頁面顯示已連結，但私人 Google 文件匯入仍回 HTTP 401／404。
- 網站登入帳號與 Google 雲端連結帳號不同，容易把「網站帳號」誤認為「實際取得檔案權限的 Google 帳號」。
- 中斷連結後，畫面可能仍維持已連結狀態。

## 根本原因

1. Drive access token 有短期記憶體快取；Google 提前撤銷或判定 token 無效時，舊程式遇到 401 不會清除快取並重換 token。
2. 連線錯誤與檔案無權限都可能退回公開網址抓取，最後只剩沒有上下文的 HTTP 401／404。
3. 中斷連結流程先查 Google 日曆連線；若該查詢或撤銷步驟異常，可能阻止本地連線紀錄刪除。
4. 私人檔案的權限以「連結的 Google 帳戶」為準，不以 Aios 網站登入帳號為準。

## 修復內容

- Drive API 回 401 時清除 access token 快取，以 refresh token 強制換新並重試一次。
- 第二次仍為 401 時，把連線標記為失效並引導重新連結。
- `invalid_grant` 訊息補充 Google 測試授權到期／帳戶端撤銷的可能性。
- 403／404 錯誤明確顯示目前連結的 Google 帳戶，並指示把檔案分享給該帳戶或重新連結正確帳戶。
- 429／5xx 改為可理解的限流／服務暫時異常訊息。
- 中斷連結改成「外部撤銷盡力執行、本地刪除一定繼續」，避免 UI 永遠卡在已連結。
- 新增私人匯入退回政策單元測試。

## 部署設定

```env
APP_URL=https://ai-os-app.zeabur.app
INTEGRATION_TOKEN_SECRET=至少32字元且不可在部署間變動的固定密鑰
GOOGLE_CLIENT_ID=Google OAuth Client ID
GOOGLE_CLIENT_SECRET=Google OAuth Client Secret
```

Google Cloud 的重新導向 URI：

```text
https://ai-os-app.zeabur.app/api/integrations/google-drive/callback
```

## 人工驗證

1. 在「連接的資料來源」確認畫面顯示的 Google email。
2. 使用該 Google 帳戶建立一份私人 Google 文件，貼到「知識與資料」匯入。
3. 驗證匯入成功且可預覽文字。
4. 貼入另一帳戶未分享的私人文件，確認錯誤訊息指出目前連結帳戶與分享／重連方式。
5. 中斷 Google 雲端，確認本地狀態立即改為未連結。
6. 重新連結正確帳戶，再次匯入私人文件。
7. 在 Google 帳戶端撤銷 Aios 授權後重試，確認系統顯示授權失效並提供重新連結按鈕。
