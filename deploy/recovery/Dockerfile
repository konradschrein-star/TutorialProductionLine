FROM node:22-bookworm-slim AS dependencies
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
# Build workspace dependencies before consumers, with one compiler process at a
# time. A clean image cannot rely on the developer checkout's dist artifacts.
RUN pnpm --recursive --workspace-concurrency=1 --sort --filter @repo/hub-web... --filter @repo/worker-orchestrator... run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates fonts-dejavu-core fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 BIND_HOST=0.0.0.0
USER node
WORKDIR /app/apps/hub-web
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/server/index.ts"]
