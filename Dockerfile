# AI Director OS — 容器建置（node:22-alpine 多段建置；平台中立，Zeabur/Railway 皆可直接用）
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
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
# 正式映像只安裝 runtime dependencies；測試、Vite 與 TypeScript 工具不進 production layer。
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=builder /app/dist ./dist
# migration-first：runner 必須攜帶已審核 SQL、具 advisory lock 的 migration CLI 與唯讀 drift checker。
COPY drizzle.config.ts ./
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/server/db ./server/db
COPY --from=builder /app/scripts/db ./scripts/db
COPY --from=builder /app/scripts/start.sh ./start.sh
# Windows checkout 也必須產出可由 Alpine /bin/sh 執行的 LF 腳本。
RUN sed -i 's/\r$//' /app/start.sh
# 資料下載區（需求 #11）在執行期服務 docs/ 與 README 原檔——runner 也要帶著
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/README.md ./README.md
# 應用程式與預設 Volume 以非 root 執行；新掛載的 Zeabur Volume 需保留此目錄擁有權。
RUN mkdir -p /data /app/.data && chown -R node:node /app /data
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
# 容器層只做 liveness；DB、Volume 與 runner 就緒狀態由平台探測 /api/ready。
# 使用 Node 內建 fetch，避免為單一健康檢查把 curl/wget 額外裝進 production image。
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
# 啟動腳本只會套用映像內已版本化的 migration，成功通過 drift gate 後才啟動應用。
CMD ["sh", "/app/start.sh"]
