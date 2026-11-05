# Demo data lessons

Read when changing `scripts/demo/`, the demo scenarios or the saved copies.

## Running against a live site

### demo-never-deletes-on-a-live-site `bug`
`npm run demo` against a hosted site only adds what is missing. Removing the seeded "Client Zero" engagement happens only with `--alone`, which only the local `demo:build` passes. **Why:** a run with `--only` once deleted an engagement on the live site.
**Enforced by:** none - review changes to run.mjs

### demo-signs-in-to-an-existing-site `bug`
When the site already has accounts, the demo signs in with `DEMO_ADMIN_EMAIL` and `DEMO_ADMIN_PASSWORD` and says clearly what is wrong if that fails or the account isn't an admin. It skips clients that already exist, so it can be run again after a dropped connection.
**Enforced by:** none - tested by hand against a fresh and an existing database

### demo-waits-for-a-sleeping-server `bug`
Calls to a hosted site retry on network errors and on 502, 503 and 504 with backoff, and wait up to two minutes for the server to answer. **Why:** the Cloudflare container sleeps and takes a few seconds to wake.
**Enforced by:** none - behaviour of lib.mjs

### seeded-client-is-not-an-existing-client `bug`
Northshore builds on the seeded engagement, so the "client already exists" check must not skip it just because the seeded engagement already carries its name.
**Enforced by:** none - review changes to run.mjs

### close-the-shell-after-a-live-demo `correction`
`BASE_URL` set in a PowerShell window stays set until the window closes, so a later `npm run demo` there writes to the live site. Close the window after loading the live demo.
**Enforced by:** none - operational

## Scenario files

### scenario-file-name-is-the-copy-name `bug`
A file in `scripts/demo/engagements/` becomes a saved copy named after the first word after its number (`05-social-support-agency.mjs` becomes `social`). Choose the file name with that in mind.
**Enforced by:** none - naming
