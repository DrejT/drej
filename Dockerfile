FROM oven/bun:1.3.9-slim AS base
WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY packages/core/package.json ./packages/core/
COPY packages/internal/opensandbox/package.json ./packages/internal/opensandbox/
COPY packages/sdks/typescript/package.json ./packages/sdks/typescript/

RUN bun install --frozen-lockfile

# Copy source
COPY apps/api ./apps/api
COPY packages/core ./packages/core
COPY packages/internal/opensandbox ./packages/internal/opensandbox

EXPOSE 6000

ENV PORT=6000

CMD ["bun", "run", "apps/api/src/index.ts"]
