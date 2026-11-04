# Put ARGUS online with Cloudflare

**Who:** whoever runs ARGUS. **Time:** about an hour the first time. **Cost:** the Cloudflare Workers Paid plan (US$5 a month, which includes some container time; see Cloudflare's Containers pricing page for usage above that) and a Postgres database (Neon's free plan is enough for a demo).

## How it fits together

```
Browser ──> Cloudflare Worker "argus"
              ├─ the screens (static files from apps/web/dist)
              └─ /api and /socket.io ──> ARGUS server (a Cloudflare Container, built from the Dockerfile)
                                           ├─ Postgres database (Neon), via DATABASE_URL
                                           └─ evidence files (Cloudflare R2 bucket "argus-evidence")
```

The container's own disk is wiped whenever it restarts or sleeps, so nothing that matters is kept there: the database is in Postgres and evidence files are in R2. The server sleeps after 30 minutes with nobody using it; the next visit wakes it in a few seconds. Once an hour Cloudflare wakes it briefly so scheduled evaluations and connector pulls still run.

The deployment files are in `deploy/cloudflare/` (the Worker and its settings) and the `Dockerfile` at the top of the project (the server).

## What you need on your computer

1. **Node.js 22**, which you already use for ARGUS.
2. **Docker Desktop**, running. Cloudflare builds the server image on your computer when you deploy. Install it from docker.com, start it, and wait until it says it's running.
3. A **Cloudflare account** on the **Workers Paid** plan (Workers & Pages > Plans).

## Step 0. Install the new packages

In the project folder, run `npm install` once. (v1.3 added a small package for R2, and the server image is built from your `package-lock.json`.)

## Step 1. Create the database (Neon)

1. Sign up at neon.tech and create a project called `argus`. Pick the region closest to most of your users (for the Caribbean, a US East region).
2. On the project dashboard, click **Connect** and copy the connection string. It looks like `postgresql://user:password@ep-something.us-east-2.aws.neon.tech/neondb?sslmode=require`. Keep it private: it is a password.
3. Nothing else to do: ARGUS creates its tables, and the `vector` extension it uses for meaning-based search, the first time it starts.

## Step 2. Create the evidence bucket (R2)

In a terminal in the project folder:

```
cd deploy/cloudflare
npm install
npx wrangler login
npx wrangler r2 bucket create argus-evidence
```

`wrangler login` opens your browser to sign in to Cloudflare. Then, in the Cloudflare dashboard:

1. Go to **R2 Object Storage > Manage API tokens > Create API token**.
2. Permission: **Object Read & Write**, applied to the bucket `argus-evidence` only.
3. Create it, and copy the **Access Key ID** and **Secret Access Key** (the secret is shown once). Also note your **Account ID** (shown on the R2 overview page).

## Step 3. Give the Worker its secrets

Still in `deploy/cloudflare`, run each line and paste the value when asked. Secrets are stored encrypted by Cloudflare and never appear in the code.

```
npx wrangler secret put DATABASE_URL          # the Neon connection string
npx wrangler secret put SECRET_KEY            # see below
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

For `SECRET_KEY`, make a new random key with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

It encrypts the AI provider keys and connector passwords you save in ARGUS. **Keep a copy somewhere safe** (a password manager): without it, those saved keys can't be read and must be entered again.

If a secret is asked for before the Worker exists, wrangler offers to create it: say yes.

## Step 4. Deploy

```
npm run deploy
```

This builds the screens, builds the server image with Docker, uploads both, and prints the address, for example `https://argus.<your-subdomain>.workers.dev`. The first deploy takes several minutes; later ones are quicker.

Open the address. The very first visit starts the server and creates the database, which can take up to a minute: if you see an error, wait and refresh. Then create the first admin account.

## Step 5. Load the demo (optional)

From the project folder on your computer (not `deploy/cloudflare`), with the site's address:

**PowerShell**
```
$env:BASE_URL="https://argus.<your-subdomain>.workers.dev"; $env:DEMO_PASSWORD="choose-a-strong-one"; npm run demo
```

This only works on a new site with no accounts yet. Set `DEMO_PASSWORD`: the demo accounts are on the internet now, so don't use the default password.

## Step 6. Your own address (optional)

To use an address like `argus.yourdomain.com`: in the Cloudflare dashboard, open **Workers & Pages > argus > Settings > Domains & Routes > Add > Custom domain**. Your domain must be on Cloudflare. Then put the address in `deploy/cloudflare/wrangler.jsonc` as `"PUBLIC_URL": "https://argus.yourdomain.com"` (needed for single sign-on) and run `npm run deploy` again.

## Sharing it

- Create an account for each person (Settings > Workspace Settings > People & Roles), with their own email. Don't share the admin account.
- Turn **Act As** off unless you are giving the demo yourself.
- To connect a real AI model, add it under **Models & Keys** as usual; the key is encrypted with your `SECRET_KEY`.

## Updating it

After changing ARGUS on your computer: `cd deploy/cloudflare` and `npm run deploy`. The database and evidence stay as they are; the new server applies any database changes itself when it starts.

## Watching it

- `npm run logs` (in `deploy/cloudflare`) shows live logs from the Worker and the server.
- The Cloudflare dashboard shows requests, errors and container usage under **Workers & Pages > argus** and **Containers**.

## When something goes wrong

| Problem | What to do |
| --- | --- |
| `npm run deploy` says Docker isn't running | Start Docker Desktop and wait until it is running, then deploy again |
| The site shows an error on the first visit | The server is starting for the first time. Wait a minute and refresh |
| "Couldn't save the file to R2" when adding evidence | Check the R2 secrets and that the token can write to `argus-evidence` |
| Sign-in works but you are signed out at once | The site must be opened over https (the workers.dev or custom address), not http |
| Saved AI keys stopped working | `SECRET_KEY` changed. Put the original back with `npx wrangler secret put SECRET_KEY`, or enter the keys again |
| Live updates are slow to appear | The browser fell back from WebSockets to polling; it still works, a second or two behind |
| Costs higher than expected | Remove the hourly wake-up (`triggers` in `wrangler.jsonc`) and check the container's active time on the Containers page |

## Going back to running it on your computer

Nothing changes locally: without `DATABASE_URL` and the `R2_*` settings, ARGUS keeps using the built-in database and the `data` folder, as before.
