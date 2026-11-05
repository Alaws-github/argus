# Deployment lessons

Read when changing `Dockerfile`, `deploy/cloudflare/`, dependencies or the Node version.

## Building

### windows-npm-workspace-flags `bug`
In npm scripts that run on Windows, don't combine `--prefix` with `-w` (it fails with "No workspaces found"). Change directory instead: `cd ../.. && npm run build`.
**Enforced by:** check deploy-build-script

### dockerfile-node-env-after-install `bug`
In the `Dockerfile`, set `NODE_ENV=production` after `npm ci`, not before. **Why:** the server runs TypeScript with `tsx`, a dev dependency, and `npm ci` skips dev dependencies when `NODE_ENV=production`.
**Enforced by:** check dockerfile-node-env-after-install

### docker-image-builds-on-the-owners-pc `bug`
The server image can't be built in a cloud session (Docker Hub is blocked there). Validate the Worker with `npx wrangler deploy --dry-run` and type checks; the real image build happens on the owner's PC with Docker Desktop running.
**Enforced by:** none - environment

### node-22 `correction`
ARGUS is built and tested on Node 22, and the server image uses `node:22-slim`. Newer Node versions on the owner's PC are untested; suggest 22 LTS when something odd happens locally.
**Enforced by:** none - environment

## Running on Cloudflare

### hosted-state-lives-outside-the-container `design`
On Cloudflare, the database is Neon Postgres (`DATABASE_URL`) and evidence files are in R2. The container's disk is temporary. Deploying never touches the data; the server applies schema changes itself on start.
**Enforced by:** check writes-go-through-storage

### shutting-down-the-live-site `design`
To pause the site, turn off its addresses under Workers & Pages > argus > Settings > Domains & Routes (the hourly wake-up still runs unless `triggers` is removed). To remove it, run `npx wrangler delete` in `deploy/cloudflare`. Neon and R2 keep the data until they are deleted separately.
**Enforced by:** none - runbook
