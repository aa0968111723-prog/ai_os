# AI Director OS — 容器建置（node:22-alpine 多段建置；平台中立，Zeabur/Railway 皆可直接用）
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# 建置追溯（/api/health 的 build 欄位）：平台建置時傳入 --build-arg BUILD_SHA=$(git rev-parse HEAD) 等；
# 沒傳也能建（欄位為 null），但正式部署建議一律傳，讓線上行為可對應唯一 commit
ARG BUILD_SHA=""
ARG BUILD_BRANCH=""
ARG BUILD_TIME=""
ENV BUILD_SHA=$BUILD_SHA BUILD_BRANCH=$BUILD_BRANCH BUILD_TIME=$BUILD_TIME
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# db:push 用 schema 直接同步（不走 migration 檔），故只需 schema.ts＋config，不複製 drizzle/
COPY package.json drizzle.config.ts ./
COPY server/db/schema.ts ./server/db/schema.ts
COPY scripts/start.sh ./start.sh
# 資料下載區（需求 #11）在執行期服務 docs/ 與 README 原檔——runner 也要帶著
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/README.md ./README.md
EXPOSE 3000
# 啟動腳本：檢查 DATABASE_URL → 重試建表（DB 慢就緒也扛得住）→ 啟動；log 全中文可讀
CMD ["sh", "/app/start.sh"]
