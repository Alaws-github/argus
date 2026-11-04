# The ARGUS server, for hosting (Cloudflare Containers, or any Docker host).
# The web screens are built separately and served by Cloudflare as static
# files; this image runs only the API and live updates on port 4300.
# Hosted, set DATABASE_URL (Postgres with pgvector), SECRET_KEY and the R2_*
# variables, because the container's own disk is wiped when it restarts.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# Full install: the server runs its TypeScript with tsx, a dev dependency.
RUN npm ci --no-audit --no-fund && npm cache clean --force
ENV NODE_ENV=production PORT=4300
COPY packages/shared packages/shared
COPY apps/server apps/server
EXPOSE 4300
CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]
