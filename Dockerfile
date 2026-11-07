# syntax=docker/dockerfile:1
#
# Production image for the BOUNDARY Next.js app.
#   deps     install exact dependencies from package-lock.json
#   build    next build with output: "standalone" (BOUNDARY_STANDALONE=1)
#   runtime  only the traced server bundle, static assets and the migration
#            script; runs as the unprivileged `node` user
#
# Used by the `app` service in docker-compose.yml (profile "app"); see README.
# Debian slim rather than Alpine: @node-rs/argon2 ships prebuilt glibc binaries.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: nothing in the build needs install hooks, and skipping
# them keeps third-party install scripts out of the image build.
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    BOUNDARY_STANDALONE=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Application files stay root-owned and read-only to the process; only Next's
# cache directory is writable by the runtime user.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Migrations run at container start. migrate.ts is plain TypeScript run by
# Node's type stripping and needs only `pg`, which the standalone bundle
# already contains.
COPY --from=build /app/db/migrations ./db/migrations
COPY --from=build /app/scripts/migrate.ts /app/scripts/db-url.ts ./scripts/
RUN mkdir -p .next/cache && chown node:node .next/cache

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Apply pending migrations, then exec the server so it is the process that
# receives SIGTERM from `docker stop` (graceful shutdown, see src/instrumentation.ts).
CMD ["sh", "-c", "node scripts/migrate.ts && exec node server.js"]
