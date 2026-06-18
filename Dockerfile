# ─── Stage 1: Build React frontend ───────────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder
WORKDIR /build
COPY client/package*.json ./client/
RUN cd client && npm install
COPY client/ ./client/
RUN cd client && npm run build

# ─── Stage 2: Production image ────────────────────────────────────────────────
FROM node:20-alpine AS production
RUN apk add --no-cache curl
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Server deps
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Copy server source
COPY server/ ./server/

# Copy built frontend — identyczna struktura jak lokalnie
COPY --from=builder /build/client/dist ./client/dist

RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fs http://localhost:3000/ > /dev/null || exit 1

CMD ["node", "server/index.js"]
