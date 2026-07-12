# AI Director OS — Railway 部署（node:22-alpine 多段建置，沿用驗證過的模式、無 MySQL 包袱）
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# db:push 用 schema 直接同步（不走 migration 檔），故只需 schema.ts＋config，不複製 drizzle/
COPY package.json drizzle.config.ts ./
COPY server/db/schema.ts ./server/db/schema.ts
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
EXPOSE 3000
# 啟動先自動建表（首次部署免手動 db:push）；DB 未就緒也不擋伺服器啟動——健康檢查照樣通、重試部署即可
CMD ["/app/entrypoint.sh"]
