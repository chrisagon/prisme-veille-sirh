# syntax=docker/dockerfile:1.7

# ---- Stage 1: deps ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# Install only prod deps for the slim build
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --omit=dev

# ---- Stage 2: build (client + server bundle) ----
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Need devDeps for tsc/esbuild/vite
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY server.ts ./
# Public Firebase Web client config — required by src/lib/firebase.ts at build time
COPY firebase-applet-config.json ./

ENV NODE_ENV=production
RUN npm run build

# ---- Stage 3: prod runtime ----
FROM node:20-bookworm-slim AS prod
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

# Run as non-root
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs --no-create-home prisme

# Bring in prod deps + built artifacts
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

USER prisme

EXPOSE 8080

# Cloud Run expects the process to bind to $PORT and respond on it.
# Healthcheck is required by Cloud Run. We probe the root path — Express
# serves the SPA shell there (HTTP 200) which proves both API + static
# bundles are wired up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/server.cjs"]
