# Aios 手機 App 安裝指南

Aios 不上架商店，提供兩種裝法：**PWA（建議，iPhone 唯一途徑）** 與 **Android 側載 APK**。
兩者內容完全相同（都連線上站），差別只在安裝途徑與更新方式。

---

## A. PWA：加入主畫面（Android＋iPhone 都適用）

### Android（Chrome）
1. 用 Chrome 開 https://ai-os-app.zeabur.app 並登入。
2. 站內會出現「把 Aios 裝成應用程式」橫幅——點「安裝 Aios」即可；
   沒看到橫幅時：Chrome 右上「⋮」→「安裝應用程式」。
3. 完成後主畫面出現 Aios 圖示，開啟即全螢幕、支援離線開啟與推播。

### iPhone／iPad（必須用 Safari）
1. 用 **Safari** 開 https://ai-os-app.zeabur.app 並登入。
2. 點底部**分享**按鈕（方框加向上箭頭）。
3. 選「**加入主畫面**」→「加入」。
4. 從主畫面的 Aios 圖示開啟——全螢幕執行，且只有這樣開才能啟用 iOS 推播通知。

**更新方式**：PWA 自動跟站上最新版走；有新版時 App 內會出現「立即更新」橫幅，點一下即可。

---

## B. Android 側載 APK

### 下載
1. 到 repo 的 **GitHub Releases** 頁（標籤 `apk-v*` 的 Release）。
2. 下載 `aios-apk-v*.apk`。

### 安裝（未知來源）
1. 用手機開啟下載的 `.apk`。
2. 系統跳出「不允許安裝不明應用程式」時：點**設定** → 允許「此來源的應用程式」→ 返回繼續安裝。
   （路徑依機型略異：設定 → 應用程式 → 特殊存取權 → 安裝不明應用程式 → 選你的瀏覽器／檔案管理員 → 允許）
3. 安裝完成後開啟 Aios 登入即可。App 是線上站的原生殼（狀態列／啟動畫面已品牌化、
   支援 `https://ai-os-app.zeabur.app/*` 深層連結），內容永遠跟著網站更新，
   **不必為每次網站改版重裝 APK**。

### 更新 APK 本體
- 直接下載新版 `.apk` 覆蓋安裝（資料不會消失）。
- **前提是簽章一致**：見下方維護者說明。若提示「應用程式未安裝」或簽章衝突，先解除安裝舊版再裝新版。

### iPhone 為什麼沒有 APK？
iOS 不允許側載 APK（那是 Android 格式）；iPhone 請走上面的 **PWA** 途徑，體驗等同。

---

## 維護者：發佈新 APK 與簽章金鑰

1. 打 tag 即自動建置並發佈：
   ```bash
   git tag apk-v1.0.0 && git push origin apk-v1.0.0
   ```
2. **首次發佈**（repo Secrets 未設定時）：workflow 會自動產生一把簽章金鑰，並把
   `aios-release.keystore` 附在該 Release。請立刻下載並到 repo **Settings → Secrets and
   variables → Actions** 新增：
   - `ANDROID_KEYSTORE_B64`：`base64 -w0 aios-release.keystore` 的輸出
   - `ANDROID_KEYSTORE_PASSWORD`：Release 說明中的密碼（產生後請改存密碼管理器）
   - `ANDROID_KEY_ALIAS`：`aios`
   - `ANDROID_KEY_PASSWORD`：同 keystore 密碼
   設定完成後**刪除 Release 上的 keystore 附件**。之後每版都用同一把金鑰簽，使用者可直接覆蓋更新。
3. 深層連結未設 App Links 驗證（側載 App 無法通過 assetlinks 驗證），使用者首次點站內連結會出現「用哪個應用程式開啟」選單，屬預期行為。
