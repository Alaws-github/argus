# Server lessons

Read when changing `apps/server`: routes, the database, the engine, agents, the assistant or model calls.

## Database

### pglite-is-one-process-and-hates-hard-kills `bug`
PGlite (the built-in database in `data/pglite`) allows one process at a time, and a process killed mid-write can leave it unreadable ("RuntimeError: Aborted()" from `_pg_initdb` on the next start). Stop the app with Ctrl+C, never `Stop-Process -Force` or Task Manager while it is writing. To recover: move `data/pglite` aside (not delete) and copy a good one from `demos/<copy>/pglite` or `data-backups/`. Run `npm run demo:save -- <name>` to keep local work worth keeping.
**Enforced by:** none - operational (reset.ts already refuses while port 4300 answers)

### reset-with-database-url-wipes-live `bug`
`npm run db:reset` drops every table in whatever database `DATABASE_URL` points at. With it set to the hosted Neon database, it wipes the live site. Never set `DATABASE_URL` in a terminal used for local work; it belongs only in the Cloudflare secrets.
**Enforced by:** code apps/server/src/reset.ts (refuses a hosted DATABASE_URL unless RESET_HOSTED=yes)

### schema-changes-append-only `design`
Schema changes are appended to the end of `schema.sql` as `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` or `CREATE ... IF NOT EXISTS`, with any data migration written so it can run on every start without doing anything twice. Never edit an earlier statement. New tables go into the drop list in `reset.ts`, and into the export in `archive.ts` if they belong to an engagement.
**Enforced by:** none - review; the schema runs on every start

## Storage

### files-go-through-storage-ts `bug`
Any file the server writes for later (evidence, uploads, connector pulls) goes through `storage.ts`, never straight to `data/`. **Why:** on Cloudflare the container's disk is wiped when it sleeps or restarts; `storage.ts` writes through to R2 and reads back from it.
**Enforced by:** check writes-go-through-storage

## Models and agents

### tool-schema-objects-need-properties `bug`
Every `type: 'object'` in a schema sent to a model as a tool or JSON schema must list its `properties`. **Why:** some providers (Gemini's OpenAI-compatible endpoint among them) reject an object with no properties, so the whole call fails.
**Enforced by:** check tool-schema-objects-have-properties

### assistant-falls-back-to-the-workspace-default `bug`
With no model picked for the assistant, it uses the workspace default model before falling back to the offline rules answer. **Why:** connecting a model on Models & Keys and still getting the offline answer looked like the assistant not understanding questions.
**Enforced by:** test scripts/assistant-test.mjs

### assistant-must-know-the-page `bug`
Every question to the assistant carries the page path and a text snapshot of what is on screen (`page` in the request), and the server adds the page guide from `assistant-pages.ts`. When a new page or tab is added, add it to that guide. **Why:** without it the assistant could only see the records, so "what's on this page?" got an answer about something else.
**Enforced by:** test scripts/assistant-test.mjs (page questions); none for keeping the guide complete - review when adding a route

### agents-draft-people-decide `design`
No agent, the assistant included, approves a gate, concludes a test, signs off, accepts a risk or closes an issue. New suggestion kinds or agent powers must keep that. See the rules in CLAUDE.md.
**Enforced by:** test scripts/agents-test.mjs, scripts/assistant-test.mjs
