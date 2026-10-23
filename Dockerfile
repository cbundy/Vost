# syntax=docker/dockerfile:1

# ---------- build stage: install deps + build the client ----------
FROM node:24-alpine AS build
WORKDIR /app

# Install dependencies first so Docker can cache this layer.
COPY package.json package-lock.json ./
RUN npm ci

# Build the web client (typecheck + vite build -> client/dist).
COPY client ./client
RUN npm run build

# ---------- runtime stage: zero-dependency server + built assets ----------
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0

COPY package.json ./package.json
COPY server ./server
COPY --from=build /app/client/dist ./client/dist

# The server uses only Node built-ins — drop privileges.
USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:${PORT}/api/health > /dev/null 2>&1 || exit 1

CMD ["node", "server/index.mjs"]
