# 搬遷評估：從 Railway 換到其他平台

> 2026-07-16 · 依據 main 分支程式碼盤點 ＋ 各平台當前公開價格
> 結論先講：**這套系統對 Railway 的綁定非常淺，搬遷難度低（半天內可完成）。**
> 首選建議 **Zeabur**（中文介面、亞洲節點、價格與 Railway 同級）；想省到極致選 **Fly.io** 或自管 VPS。

---

## 一、現況盤點：我們到底用了 Railway 哪些東西

| 依賴項 | 程式碼位置 | 可攜性 |
|---|---|---|
| Docker 部署（Dockerfile 建置） | `Dockerfile`、`scripts/start.sh` | ✅ 任何支援 Docker 的平台都能跑 |
| PostgreSQL（`DATABASE_URL`） | `server/db/*` | ✅ 標準 Postgres，換平台只換連線字串 |
| Volume 掛載 `/data`（素材/成品落地） | `server/services/storage.ts` | ✅ 自動偵測 `/data`，也可用 `ASSET_DIR` 指到任何路徑 |
| WebSocket（協作即時通知） | `server/services/realtime.ts` | ✅ 主流平台都支援 |
| `RAILWAY_PUBLIC_DOMAIN` 環境變數 | `fal.ts:18`、`realtime.ts:103`、`projects.ts:183` | ⚠️ 只是 `APP_URL` 沒設時的備援；`APP_URL` 本來就是必填，搬家後設對即可，**不用改程式** |
| `railway.toml`（config-as-code） | 專案根目錄 | ⚠️ 平台專屬，搬家後改用新平台的設定方式（健康檢查 `/api/health`、啟動指令 `sh /app/start.sh` 照搬） |
| 健康檢查 `/api/health`、就緒檢查 `/api/ready` | `server/index.ts` | ✅ 純 HTTP，通用 |

**沒有用到**：Railway 專屬 SDK、私有網路魔法、cron、多服務編排。就是「一個容器＋一個 Postgres＋一顆磁碟」。

---

## 二、搬遷需求清單（挑平台的門檻）

1. 能跑 Dockerfile、常駐服務（不能是只有無狀態的 serverless）
2. 一鍵 PostgreSQL 或便宜的託管 Postgres
3. **持久化磁碟（Volume）**——素材與生成成品都落在本機磁碟，這是最大的篩選條件
4. WebSocket 支援
5. 亞洲節點（使用者在台灣，延遲有感）
6. 月費預算：目前 Railway 約 US$5–15/月，希望同級或更省

---

## 三、候選平台比較

### 總表

| | Zeabur ⭐首選 | Fly.io | Render | VPS＋Dokploy/Coolify | Railway（現況） |
|---|---|---|---|---|---|
| 月費估算（本系統規模） | **$5–15**（Dev 方案 $5 含 $5 用量） | **$5–10**（機器+磁碟便宜；但託管 Postgres 貴） | **$14+**（Web $7＋Postgres $6–7＋磁碟） | **$5–8**（Hetzner 小機一台全包） | $5–15 |
| 持久化 Volume | ✅ | ✅（$0.15/GB/月） | ✅（$0.25/GB/月，但掛磁碟後失去零停機部署） | ✅（就是本機硬碟） | ✅（$0.25/GB/月） |
| 一鍵 Postgres | ✅ | ⚠️ 託管版 Basic 要 $38/月；自架版便宜但要自己顧 | ✅ $6–7 起（免費版 30 天過期） | ✅（Dokploy 一鍵開，自己備份） | ✅ |
| 亞洲節點 | ✅ 有（含日本等，對台灣友善） | ✅ 東京/香港等 | ⚠️ 最近只有新加坡 | ✅ 看你租哪（可租日本/新加坡） | ✅ 東京 |
| 中文介面/文件 | ✅ **台灣團隊，全中文** | ❌ | ❌ | ⚠️ Dokploy/Coolify 英文，但一次設好就少碰 | ❌ |
| 操作體驗（接手人友善度） | ✅ 和 Railway 幾乎一樣：連 GitHub 就部署 | ⚠️ 偏工程師向（CLI、fly.toml） | ✅ 簡單 | ❌ 要自己管主機、更新、備份 | ✅ |
| 維運負擔 | 低 | 中 | 低 | **高**（安全更新、備份、監控自理） | 低 |

### 各平台細評

**Zeabur（建議首選）**
- Dev 方案 US$5/月且**內含 $5 用量**——用量不超過就只付 $5，跟 Railway Hobby 的計費邏輯一模一樣，帳單不會有驚喜。
- 台灣公司：介面、文件、客服都有中文。對照「交接報告」的定位（接手的人不一定是工程師），這點價值很高。
- 支援 Dockerfile 自動部署、Volume、一鍵 Postgres、WebSocket，與本系統需求完全對齊。
- 風險：公司規模比 Render/Fly 小。但因為我們可攜性高（見第一節），真有狀況再搬一次的成本也低。

**Fly.io（最省方案，工程師向）**
- 小機器約 $2–4/月、Volume $0.15/GB/月，**app 本體最便宜**。
- 但託管 Postgres（MPG）Basic 就要 $38/月，遠超需求；省錢就得自架 Postgres 機器（~$2–5/月）＋自己排備份——維運回到自己身上。
- 全程 CLI＋`fly.toml`，2026 年起還新增了快照費、跨區流量費等細項。適合有工程師長期看顧的情境。

**Render（簡單但貴、且有硬傷）**
- Web $7＋Postgres $6–7＋磁碟 $0.25/GB，落在 **$14+/月**，比現在貴。
- **掛了持久磁碟的服務不能零停機部署**（每次部署會短暫斷線）；亞洲只有新加坡節點。本系統靠磁碟存素材，這個硬傷直接命中。不推薦。

**VPS ＋ Dokploy/Coolify（長期最省，自由度最高）**
- Hetzner/Vultr 小機 US$5–8/月全包：app＋Postgres＋磁碟＋流量都在裡面，**沒有按量計費的不確定性**。
- Dokploy/Coolify 給你一個「自架的 Railway 介面」：連 GitHub 自動部署、一鍵 Postgres、憑證自動續。
- 代價：主機安全更新、Postgres 備份、掛了要自己救。**除非團隊有人願意扛維運，否則不建議**基金會內部工具走這條。
- 折衷玩法：Zeabur 也支援「綁自己的伺服器」，用 Zeabur 介面管 VPS，兩者優點兼得。

**不適合的方向（順手排除）**
- **Cloud Run / DigitalOcean App Platform / Vercel**：無持久磁碟，得先把儲存層改寫成 S3/R2 物件儲存才可用。改寫不難（`storage.ts` 已隔離得很乾淨），但那是另一個工程，不是「搬家」。
- **Heroku**：同樣無持久磁碟，且價格不俐落。

---

## 四、建議結論

| 情境 | 建議 |
|---|---|
| 想要「跟 Railway 一樣簡單」＋中文＋亞洲節點 | **Zeabur Dev（$5/月含 $5 用量）** |
| 有工程師長期看顧、想壓到最低 | Fly.io（自架 Postgres）或 VPS＋Dokploy |
| 只是想省 Postgres 錢、app 不動 | 也可以只把資料庫搬去 Supabase 免費層（500MB），app 留在原地——但多一層跨服務延遲，DB 長大後仍要付費，屬過渡方案 |

**首選：Zeabur。** 費用同級、體驗同級、中文支援、亞洲節點，且本系統零程式碼修改即可落地。

---

## 五、搬遷步驟（以 Zeabur 為例，預估 2–4 小時，可隨時回退）

> 其他平台步驟相同，只有第 1、2 步的介面不同。

1. **開新環境**：Zeabur 建專案（選亞洲區域）→ 加 PostgreSQL → 加 GitHub Repo `ai_os`（自動吃 Dockerfile）→ 掛 Volume 到 `/data`。
2. **搬環境變數**（照 `railway.toml` 註解的清單）：`DATABASE_URL`（引用新 Postgres）、`APP_URL`（先填 Zeabur 給的網址）、`FAL_KEY` 等；正式站不要搬舊 `MCP_API_KEY`，個人連線金鑰已在資料庫內隨 dump 搬移。建議順手補設 `ASSET_SIGN_SECRET`（任意 64 字亂碼），簽名網址就不怕重啟作廢。
3. **搬資料庫**（資料量小，幾分鐘）：
   ```sh
   pg_dump "$RAILWAY_DATABASE_URL" --no-owner --no-privileges | psql "$ZEABUR_DATABASE_URL"
   ```
   還原後先跑 `npm run db:check`；舊備份若顯示 `legacy-untracked`，依
   `docs/資料庫遷移.md` 明確 baseline。Web 啟動不會自動建表，也不可先空跑再覆蓋資料。
4. **搬 Volume 檔案**：用 Railway CLI 進舊容器打包 `/data/assets` 下載，再上傳到新站（或寫 10 行的一次性搬運腳本走 HTTP）。素材若不多，也可接受「舊素材以資料庫紀錄為準、檔案重新上傳」的簡化路線。
5. **驗收**（照交接報告的健檢流程）：開 `新網址/api/ready` → 登入 → 團隊管理「跑系統自檢」七項全 ✅ → 抽查舊專案的分鏡與素材可開。
6. **切換**：把邀請連結、書籤、`APP_URL` 換成新網址；觀察 3–7 天沒問題後才關 Railway（**先降級不刪**，這就是你的回退方案——出事把 `APP_URL` 指回去即可）。
7. **收尾（可選）**：刪 `railway.toml`、把程式裡三處 `RAILWAY_PUBLIC_DOMAIN` 備援清掉或改成通用變數；更新 `docs/交接報告.md` 的部署章節。

### 風險與注意事項

- **切換期間的資料落差**：第 3 步 dump 之後、第 6 步切換之前，舊站若有人繼續用，新增資料不會出現在新站。建議選離峰時段，dump 前口頭通知大家停用半小時。
- **邀請連結失效**：舊邀請連結含舊網域，切換後請重發（連結本身在 DB，換 `APP_URL` 後新產生的就是新網域）。
- **fal 生成中的任務**：切換時進行中的生成會斷在舊站，點數有「失敗全額退回」機制，損失有限；保險起見切換前等佇列清空。
