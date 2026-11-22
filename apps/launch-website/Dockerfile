FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches/jwks-rsa@4.1.0.patch ./patches/jwks-rsa@4.1.0.patch
COPY apps/launch-website/package.json ./apps/launch-website/package.json
RUN pnpm install --frozen-lockfile --filter @rmt/launch-website...
COPY apps/launch-website ./apps/launch-website
COPY packages/launchpad-common ./packages/launchpad-common
COPY docs/evidence/token-market/market-replay.json ./docs/evidence/token-market/market-replay.json
ENV NEXT_TELEMETRY_DISABLED=1 RMT_WEB_HOSTING=railway-read-only-v1
RUN pnpm --filter @rmt/launch-website build

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 RMT_WEB_HOSTING=railway-read-only-v1
COPY --from=build --chown=node:node /app/apps/launch-website/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/launch-website/.next/static ./apps/launch-website/.next/static
COPY --from=build --chown=node:node /app/apps/launch-website/public ./apps/launch-website/public
COPY --from=build --chown=node:node /app/apps/launch-website/railway-start.mjs ./apps/launch-website/railway-start.mjs
USER node
EXPOSE 3000
CMD ["node", "apps/launch-website/railway-start.mjs"]
