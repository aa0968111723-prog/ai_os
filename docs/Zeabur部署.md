# Zeabur 部署指南

> 現行部署平台為 **Zeabur**(自 2026-07 起,先前在 Railway)。
> 程式碼已平台中立:對外網址、Origin 白名單、儲存路徑都由環境變數決定,不寫死任何平台。
> 本文件是從零開站與從 Railway 搬遷的完整步驟;日常維運見《維運手冊》。

## 架構總覽(在 Zeabur 上長什麼樣)

一個 Zeabur 專案(Project)內放兩個服務:

| 服務 | 來源 | 用途 |
|---|---|---|
| `ai-os`(App) | GitHub 本 repo(Dockerfile 自動偵測) | Node 22 伺服器,`sh /app/start.sh` 啟動 |
| `PostgreSQL` | Zeabur 預建服務(Prebuilt) | 資料庫;建表/種子由 App 開機時自動處理(`server/db/ensure.ts`),**不需要**手動跑 migration |

另外掛一顆 **Volume 到 App 服務的 `/data`**——上傳素材與 AI 生成成品的永久儲存。

## 從零開站步驟

1. **建專案**:Zeabur Dashboard → New Project(區域選離台灣近的,如 `ap-east`)。
2. **加 PostgreSQL**:Add Service → Prebuilt → PostgreSQL。
3. **加 App**:Add Service → Git → 選本 repo 與分支(main)。Zeabur 偵測到 `Dockerfile` 會直接用它建置(多段建置,產物是 `dist/` + `docs/`),不需任何 zbpack 設定。
4. **掛 Volume**:App 服務 → Settings → Volumes → 新增,**掛載路徑填 `/data`**。
   - 沒掛 Volume 時程式會退回容器內 `./.data`,**重新部署即全部遺失**——正式站務必掛。
   - 不想掛在 `/data` 也可以,改設環境變數 `ASSET_DIR` 指到掛載路徑。
5. **開對外網域**:App 服務 → Networking → Public → 產生 `xxx.zeabur.app`(或綁自訂網域)。
6. **設環境變數**(App 服務 → Variables,清單見下節),特別是 `DATABASE_URL` 與 `APP_URL`。
7. **Redeploy**,然後打開 `https://你的網域/api/ready` 驗證:`ok: true` 且 `db` 正常 → 用管理員帳密登入 → 團隊管理頁「跑系統自檢」。

## 環境變數清單

### 必填

| 變數 | 值 | 說明 |
|---|---|---|
| `DATABASE_URL` | `${POSTGRES_CONNECTION_STRING}` | 引用同專案 PostgreSQL 服務的連線字串(Zeabur 變數參照會自動補全;沒補全就到 PostgreSQL 服務的 Connection 頁複製整串貼上)。 |
| `APP_URL` | `https://你的網域` | 對外基底網址。**未設的後果不只是連結難看**:邀請連結/假素材/範例專案縮圖會存成 `localhost` 進資料庫變永久壞連結,且正式環境的 WebSocket Origin 白名單會擋掉正常連線(協作游標/即時更新全失效)。 |
| `ASSET_SIGN_SECRET` | 長隨機字串(`openssl rand -hex 32`) | 素材簽名網址的 HMAC 金鑰。未設時每次重啟隨機生成→**重啟/重佈後所有在途簽名網址立即作廢**(fal 抓來源輸入會失敗)。設一次,永遠不要換。 |

### 建議必設

| 變數 | 說明 |
|---|---|
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | 首次啟動(空資料庫)建立的開發者帳號。未設會用程式內建預設值——**上線務必設定,換掉預設密碼**。忘記密碼自救:改這兩個變數 → Redeploy → 用新帳密登入。 |
| `FAL_KEY` | fal.ai 金鑰(fal.ai/dashboard/keys)。未設=全站假生成模式(不花錢,適合驗收流程)。 |
| `FAL_MOCK` | 測試期設 `1`:即使有 `FAL_KEY` 也走假生成。要真實生成時**刪除**此變數。 |

### 可選

| 變數 | 預設 | 說明 |
|---|---|---|
| `PUBLIC_DOMAIN` | (無) | 平台注入的公開網域(不含 https://)。`APP_URL` 已設時通常不需要;綁了自訂網域又想讓 `xxx.zeabur.app` 也能連 WebSocket 時設定。 |
| `ALLOWED_ORIGINS` | (無) | 逗號分隔的額外網域白名單(自訂網域、CDN 並存時用),供 WebSocket Origin 檢查。 |
| `TOTAL_BUDGET_POINTS` | 5000 | 首次啟動的總預算種子值(之後在系統內調)。 |
| `WEEKLY_QUOTA_POINTS` | 300 | 每人每週點數種子值(之後在系統內調)。 |
| `DAILY_QUOTA_POINTS` | (無) | 每人每日點數上限。 |
| `MCP_API_KEY` | (無) | 設定後開啟 `/api/mcp`,外部 AI 代理(Claude 等)可直接操作系統。 |
| `ASSET_DIR` | `/data`(存在時) | 素材儲存根目錄;Volume 掛在別處時指過去。 |
| `ASSET_MAX_MB` | 100 | 單檔上傳上限。 |
| `MOCK_BILLING` | (無) | `1`=假生成也真扣點(e2e 驗證額度護欄用,正式站不用設)。 |
| `SEED_ADMIN_*` 之外的種子值 | — | 見上表。 |

### 絕對不要設

| 變數 | 原因 |
|---|---|
| `AUTH_MODE` | `dev` 是免密後門(僅非 production 生效,但不要留任何機會)。 |
| `PORT` | Zeabur 會自動注入,程式已讀取;手動設反而衝突。 |
| `TZ` | 週點數界線以「台北時間」在程式內換算,與容器時區無關;改 TZ 徒增混亂。 |

## 從 Railway 搬遷資料

1. **資料庫**(在任何裝得下 pg 16 client 的機器):
   ```sh
   pg_dump "$RAILWAY_DATABASE_URL" --no-owner --no-privileges -Fc -f aios.dump
   pg_restore -d "$ZEABUR_DATABASE_URL" --no-owner --no-privileges aios.dump
   ```
   還原後先別開放使用,做第 2 步。
2. **素材檔案**(Railway Volume `/data` → Zeabur Volume `/data`):
   - 舊站跑 `railway ssh` 或一次性端點把 `/data` 打包(`tar czf /tmp/data.tgz -C /data .`)下載;
   - 新站以同路徑解開(Zeabur 服務可用 Web Terminal 上傳解包,或暫時開個管理端點)。
   - 資料庫裡素材列的 `storagePath` 是相對檔名,兩邊掛載路徑一致即可無痛接手。
3. **環境變數**:按上面清單在 Zeabur 重建;`ASSET_SIGN_SECRET` 沿用舊值(在途簽名網址不作廢)。
4. **切換**:改 `APP_URL` 為新網域 → Redeploy → `/api/ready` 綠燈、登入自檢通過後,再把舊 Railway 服務停掉(建議留存 一週作為回滾點)。

## 已知差異與注意事項

- `railway.toml` 只有 Railway 會讀,Zeabur 忽略之;保留在 repo 作為歷史參考。
- Zeabur 的 Dockerfile 部署會注入 `PORT`(預設 8080),程式讀 `process.env.PORT` 自動適配,`EXPOSE 3000` 只是文件性宣告,不影響。
- 健康檢查:Zeabur 沒有 Railway 式的 HTTP healthcheck 設定;部署後以 `/api/health`(不等 DB)與 `/api/ready`(含 DB/authMode 診斷)人工或外部監控驗證。
- 假生成模式的成品網址以 `APP_URL` 為基底——`APP_URL` 設錯,假素材與範例縮圖會 404。
- 重佈不影響資料:資料庫在獨立服務、素材在 Volume;但**刪除服務會連 Volume 一起刪**,刪前先備份。

## 部署後驗收清單

1. `/api/ready` → `ok: true`、`db` 正常、`authMode: normal`。
2. 管理員登入 → 團隊管理「跑系統自檢」全綠(含儲存層寫入測試、AUTH_MODE 警示)。
3. 上傳一張圖到任一專案素材庫 → Redeploy → 圖仍在(驗 Volume 掛對)。
4. 建一筆假生成(FAL_MOCK)→ 成品可預覽、可進交付包(驗 APP_URL 基底)。
5. 兩個瀏覽器開同一專案 → 協作游標互見(驗 WebSocket Origin 白名單)。
