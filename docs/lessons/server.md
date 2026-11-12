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

## Talking to models (v1.5)

### every-ai-caller-gets-context `correction`
Every agent that writes for people gets the engagement (client, sector, frameworks, description), its instructions box added after the built-in rules, and knowledge-base passages that match the work, including the client's own documents. A new AI feature without these is rigid by construction. **Why:** the Use Case Planner had only the conversation and couldn't tell "test" from an answer or suggest anything.
**Enforced by:** test scripts/v15-test.mjs (Planner and assistant context)

### unclear-input-is-handled-not-filed `bug`
A conversational agent first decides what the latest message is (an answer, a request, a pick from its suggestions, a question, or unusable) and never files test or unclear text into a record. Asked for ideas, it suggests, and fills nothing until the person picks one.
**Enforced by:** test scripts/v15-test.mjs (offline Planner: test message, suggestions, pick)

### model-calls-recover-before-they-fail `bug`
Model calls go through `llm.ts`, which retries 429 and 5xx with backoff (honouring Retry-After), asks again with twice the room when an answer is cut off (and says so if it still is), and swaps `max_tokens` for `max_completion_tokens` when a model refuses it. Never call a provider with a bare fetch.
**Enforced by:** test scripts/v15-test.mjs (mock-ratelimit, mock-truncate, mock-maxtok)

### repair-format-not-substance `design`
`callStructuredChecked` gives a model one chance to fix format problems (schema issues, broken JSON) by showing its answer and the problems. Citations it wasn't given, invented figures and anything the rules refuse are never repaired: the strict checks run on the corrected answer and still fail the run.
**Enforced by:** test scripts/v15-test.mjs (mock-malformed repaired, mock-bad still fails)

### agents-must-reason `correction`
ARGUS's agents are expected to work like analysts: look things up (Knowledge Base and site records), ask a person when something is missing, and check their own work before handing in. Limit what an agent may decide, never what it may find out. Any design that restricts an agent's capability (single-shot calls, fixed context, no tools) is raised with the owner before it is built. The plan is `docs/plans/v1.6-agentic-ai.md`. **Why:** v0.5 to v1.5 shipped single-shot agents without asking, and the owner needed agentic ones.
**Enforced by:** none - design review against docs/plans/v1.6-agentic-ai.md

### uploads-are-kind-upload `bug`
Documents uploaded on the Knowledge Base page are stored as kind `upload`; the engagement summary ("About <client>") is kind `client`. Any search meant to find the client's documents must include `upload`, or it only ever finds the summary. **Why:** v1.5 searched `client` only, so the Planner, Classifier, Designer and drafting agents never saw uploaded policies, and the assistant kept citing the "About" passage.
**Enforced by:** test scripts/v15-test.mjs (the Planner finds an uploaded document)

## Agents that reason (v1.6)

### agent-tools-only-read `design`
A tool given to an agent or the assistant (`tools.ts`) only reads. It lists the roles that may use it, goes through `shareable()` for anything outside the engagement (open, unarchived engagements only), and caps what it returns. A tool that writes, approves, sends or fetches from the internet is a new rule, raised with the owner first. **Why:** rules 1 and 23; an agent that can act is a different product.
**Enforced by:** test scripts/v16-test.mjs (refused tool, members-only card not found)

### questions-rerun-not-resume `design`
An agent's question stops the run (`QuestionPause`, run `waiting`, card `question`). Answering or skipping queues the card; the next run is a fresh run given every answer for that card and stage. Don't try to keep a paused model conversation alive across requests. **Why:** a restart, a sleeping container or a model change would lose it; a re-run survives all three for the cost of one more brief.
**Enforced by:** test scripts/v16-test.mjs (answer reaches the agent, skip lets it carry on)

### mocks-see-the-whole-conversation `bug`
In the agent loop, repair problems and tool results arrive as later messages, not in the first user message. A mock or a check that looks only at the first user message (`user.includes('<problems>')`) never sees them. Scan every message.
**Enforced by:** test scripts/v15-test.mjs (mock-malformed and mock-badjson repaired through the loop)

### new-uploads-not-buried-before-embedding `bug`
A passage that isn't embedded yet (a document just uploaded, while embedding runs in the background) can't appear in the meaning-search list, so plain rank fusion pushed it below passages found by both lists. `search()` counts its keyword rank twice instead. **Why:** a policy uploaded a moment ago didn't come up when searched for by its own words.
**Enforced by:** test scripts/rag-test.mjs (heading check right after upload, with an embedding model set)

### send-back-provider-extras-on-tool-calls `bug`
When a model step returns tool calls, keep every field on each call beyond `id`, `type` and `function` (`ToolCall.extra` in `llm.ts`) and send it back unchanged in the next request. Gemini 3 on its OpenAI-compatible endpoint puts a `thought_signature` in `extra_content` and refuses the next step with a 400 without it. A tool step refused after the first step finishes the run as a single call rather than failing it. **Why:** the assistant and agents failed on Gemini with "Function call is missing a thought_signature".
**Enforced by:** test scripts/v16-test.mjs (mock-gemini)

## v1.7

### workflow-gates-are-locked `design`
In client workflows the five governance gates and the trigger can be moved but never removed, skipped or reordered, and after an agent step a person or a gate decides. The rules live once, in `packages/shared/src/workflow.ts`, and run in the browser and again on the server; saving a graph without a gate is refused, and only a workflow with no problems publishes. **Why:** the builder exists so a client's process can be modelled without losing ARGUS's governance (CLAUDE.md rule 28).
**Enforced by:** test scripts/v17-test.mjs

### show-provider-errors-people-can-act-on `bug`
A provider error reaching a person goes through `friendlyError` (`llm.ts`): what went wrong, what to do and where, with the provider's own words kept short at the end. A 5xx the route wants shown carries `expose: true`; any other 5xx is still hidden as "Something went wrong". ARGUS's own refusals (spend cap, not found) keep their status. **Why:** the general error handler hid a refused key behind "Something went wrong on the server".
**Enforced by:** test scripts/v17-test.mjs (mock-401), scripts/assistant-test.mjs (spend cap keeps its status)

### business-tools-are-read-never-written `design`
Client workflows name the business tools each step happens in, and ARGUS reads those tools only through connectors (GET, plus a token request to Microsoft or Google's identity service). Never add a connector or workflow action that creates, changes or sends anything in a client's tool without raising it with the owner: it changes CLAUDE.md rule 17. **Why:** the owner chose "map tools, read-only links" over two-way integration (v1.7.1).
**Enforced by:** none - design review; connectors.ts only sends GET to data addresses

### credentials-stay-on-their-site `bug`
When a connector follows a redirect to a different origin, it drops the Authorization header. **Why:** Microsoft Graph answers a file request with a redirect to a signed download link on another host; forwarding the bearer token there would hand the client's Microsoft 365 token to that host.
**Enforced by:** test scripts/v17-test.mjs (the mock download site refuses a request with a credential)

### sigv4-encode-each-path-segment `bug`
An S3 key with brackets or spaces failed the signature check: the canonical path must encode each segment with RFC 3986 rules (so `(` becomes `%28`), while `URL.pathname` leaves some characters as they are. `sigV4` now decodes and re-encodes each segment once, and was compared against the `aws4` reference library for plain, query-string and bracketed keys.
**Enforced by:** test scripts/v173-test.mjs (S3 read against the mock); manual comparison with aws4 recorded in this lesson

### framework-text-has-several-spellings `bug`
Engagements store their frameworks as text, and older ones say "NIST AI RMF" where newer ones say "NIST AI RMF 1.0", so matching on the full label dropped NIST from Across Frameworks for the main demo engagement. Use `frameworksIn()` in shared, which accepts the label, the label without its version and the short name.
**Enforced by:** test scripts/v173-test.mjs (coverage per framework in scope); browser check of Controls > Across Frameworks

### write-back-reads-the-audit-log `design`
Write-back sends are driven by audit entries read after commit, not by calls inside each route: one place decides what an event is (`eventOf`), a send can never roll back or change an ARGUS record, no agent path can reach it, and switching it on doesn't replay history (the cursor starts at the latest entry). Off per engagement by default; create-only (new message, ticket or record).
**Enforced by:** test scripts/v173-test.mjs (nothing sent while off, issue to webhook and Jira, audit with sha256, no write tool for agents)

### coverage-needs-the-whole-list `design`
Coverage measured against ARGUS's own references (2 NIST obligations, 26 library references) showed high percentages that meant "of what ARGUS tracks". The owner wants frameworks fully met, so coverage now counts against the complete requirement list (`FRAMEWORK_CATALOG`), and fully met needs every requirement proven or not applicable with a reason. Never show a percentage of a partial list as if it were the framework.
**Enforced by:** test scripts/v174-test.mjs (72 NIST subcategories, 65 ISO items, fully met only when all accounted for)

### deleting-a-chat-keeps-the-audit-record `design`
The owner asked to edit and delete assistant chats. A person can delete their own conversation and its messages, or edit one of their questions (which replaces it and every answer after it), but the audit log is never changed: each `assistant.answered` entry stays, and the delete or edit is itself audited. Suggestions already applied stay applied. Only the person who started a conversation can rename, edit or delete it (404 for anyone else).
**Enforced by:** test scripts/v174-test.mjs (edit replaces, answers can't be edited, others get 404, delete removes, audit kept)
