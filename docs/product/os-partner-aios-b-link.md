# 深度、CUTOS 與 Aios_b 連結

Aios（本倉）是創作作業系統；[Aios_b](https://github.com/aa0968111723-prog/Aios_b) 是連動網站／App／桌面的 Sentinel 檢測倉。深度（Deepin／統信 UOS）與 CUTOS（邊緣智能 OS）則是會用 WebView／LWA **載入同一個 Aios 站** 的夥伴作業系統。

三端本來就不是三份程式碼——App 與桌面都是薄殼。深度與 CUTOS 也是同一件事：同一站、不同 UA 與能力。這份契約把那兩套 OS 與 Sentinel 寫進 Aios，避免各寫各的識別字。

## 誰認誰

| 端 | UA 識別字 | 對應 Sentinel surface | 環境變數 |
| --- | --- | --- | --- |
| 網站 | 一般瀏覽器 | `web` | `AIOS_WEB_TARGET` |
| App | `AiosApp/1.0` | `app` | `AIOS_APP_TARGET` |
| 桌面（Tauri） | `Tauri/2.0` | `desktop` | `AIOS_DESKTOP_TARGET` |
| 深度 | `AiosDeepin/1.0`（或 UA 含 `Deepin/`／`UOS`） | `desktop` | `AIOS_DEEPIN_TARGET` |
| CUTOS LWA | `AiosCutos/1.0`（或 UA 含 `CUTOS`） | `web` | `AIOS_CUTOS_TARGET` |

契約常數在 `shared/osPartnerLink.ts`。裝置清單用同一套規則（`shared/deviceNaming.ts`），深度與 CUTOS 不會被泛用 Linux 吃掉。

## 公開握手

`GET /api/os-partners`（未登入可讀，與 `/api/health` 同級）：

- 回契約版本、姊妹倉 GitHub、兩套 OS 的 UA token 與「有沒有連」
- **不回** 目標網址、本機路徑、報告內容

`/api/ready` 多一個觀察分項 `components.osPartners`，以及頂層 `osPartners` 握手物件。預設不擋 503；設 `OS_PARTNER_GATE=1` 才把「三端都要連上」當就緒條件。

## 本機跑 Sentinel

```bash
# 把 Aios_b clone 到隔壁，或設 AIOS_B_REPO
git clone https://github.com/aa0968111723-prog/Aios_b.git ../Aios_b
cd ../Aios_b && npm install && cd -

npm run sentinel                 # 預設 all --repo <本倉>
npm run sentinel -- scan --fail-on medium
```

找不到姊妹倉時結束碼 **3**（沒測到 ≠ 通過）。已設 `AIOS_DEEPIN_TARGET`／`AIOS_CUTOS_TARGET` 時，腳本會分別覆寫 Sentinel 的桌面端／網站端目標。

## 管理頁

開發者在「團隊管理」側欄看得到「深度／CUTOS／Aios_b」卡：連結狀態、最近一份 `AIOS_SENTINEL_REPORT` 的最重等級。系統自檢也有同名一項，未設不算失敗。
