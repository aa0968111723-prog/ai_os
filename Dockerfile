# AI Director OS — Railway 部署（node:20-alpine 多段建置，沿用驗證過的模式、無 MySQL 包袱）
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY package.json drizzle.config.ts ./
COPY server/db/schema.ts ./server/db/schema.ts
EXPOSE 3000
CMD ["node", "dist/index.js"]
