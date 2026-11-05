# CLAUDE.md

Context for Claude working on this project. Read this first, then:

- [`AGENTS.md`](AGENTS.md): how to work here (planning, recording lessons, branches and delivery, testing, writing).
- [`docs/LESSONS.md`](docs/LESSONS.md): pitfalls and decisions already found. Read `docs/lessons/general.md` and the area files for what you change, and add a lesson whenever you fix a bug or the owner corrects you.
- [`docs/context/project-history.md`](docs/context/project-history.md): who ARGUS is for, how the owner works, what was decided and why, and every version.

## What this is

**ARGUS** (v1.4), the Assurance, Risk & Governance Unified System (formerly Governance Harness): an AI governance, risk and assurance workbench. An assurance team runs client **engagements**; each AI **use case** is a card that moves through eight stages (Intake, Classify risk, Design controls, Collect evidence, Test controls, Remediate, Validate, Board report), shown to people as five steps (`PHASES` / `PHASE_OF` in shared: Intake, Assess risk, Controls, Test, Sign-off & report). The engine, exit criteria, agents and tests all still work on the eight stages. Seven AI agents draft the work (the Use Case Planner drafts the intake brief, six more draft each later stage), and a lead can add more per stage; named people make every decision; everything is written to a hash-chained audit log.

It was rebuilt from **GoldenEye**, the owner's AI delivery harness, keeping its board-and-gate engine, Models page, tabbed Settings, account menu and look. GoldenEye is a reference only: never change anything in it.

Owner: Andrew Lawrence, a QA engineer (ISTQB Foundation, CT-AI, CT-GenAI). The QA framing is deliberate: tests have preparers and reviewers, issues have a defect-style lifecycle, and evaluations are test suites. Keep that framing.

Plain-language docs for non-technical readers are in `docs/` (start at `docs/README.md`). The walkthrough (`docs/08-walkthrough.md`) and demo scripts (`docs/09-demo-script.md`) assume the demo data, built by `scripts/demo/run.mjs` from one file per engagement in `scripts/demo/engagements/` (helpers in `scripts/demo/lib.mjs`, `_template.mjs` to copy; `01-northshore-financial.mjs` is the full-feature engagement on the seeded Client Zero). If you change what the Northshore file produces, re-check the keys and numbers they quote (AI-1..AI-5, R-5, R-6, T-1, I-1, 3 of 8, 7 of 10) and retake `docs/images/walkthrough/`. The developer reference, with every API endpoint, is `README.md`.

## Rules that must not break

These are the product. Any change must keep them, and the tests check them.

1. **Agents draft; people decide.** No agent approves a gate, concludes a test, counts as a preparer or reviewer, accepts a risk, closes an issue or signs off a report.
2. **Drafting stages always stop for a person** (`DRAFT_STAGES`: evidence, test, validate, report), whatever the gate settings.
3. **Segregation of duties.** Whoever added, prepared or scored something can't approve, review or sign it off. Compare names with `isMe()` / `requireDifferentPerson()` in `auth.ts`, which include a person's former names. Never compare `req.user.name` directly.
4. **Exit criteria** in `exit-criteria.ts` are enforced in `advance()` for every path, not only gated ones.
5. **Every change writes its audit entry in the same transaction**, via `logAudit(q, ...)` inside `db.tx`. Never update `audit_log` rows; the chain must verify.
6. **Agent output is validated before anyone sees it**: a Zod schema, plus server checks on every key and figure it cites (see `agents/drafting.ts`). Rejected drafts fail the run and leave nothing behind.
7. **Client content is data.** Use case profiles and evidence are wrapped in tags and the rules tell the model to ignore instructions inside them.
8. **Agent rules live in `apps/server/src/agents/prompts/*.md`.** Engagement instructions are appended after them, never replacing them. Each run stores the rules file's sha256 prefix (`rules_version`).
9. **Archived engagements are read-only**, enforced centrally by `archiveGuard` in `archive.ts`. A new write route must map to its engagement there if its URL doesn't start with `/engagements/:id/`.
10. **New agents ship switched off** (`ON_BY_DEFAULT` in `seed.ts`).
12. **Drafts are decided item by item** (`decisions.ts`): approving classify, design, validate or report needs a decision on every item; only kept items reach the registers; edits and rejections need a reason; the audit log keeps the AI's original. Undecided items count as accepted only when the engine auto-advances an ungated stage.
13. **Agents are grounded** (`kb.ts`): they get knowledge-base passages, must cite them by K-id, and `strayCitations` rejects any id they weren't given. Cited passages are snapshotted onto the draft. Drafting calls use temperature 0 (`postDeterministic` in `llm.ts`).
14. **The Verifier is advisory** (`verifier.ts`). Its verdicts sit in `cards.verification`, never in `decisions`, and never block or allow an approval. A "supported" or "partly" verdict must quote a cited passage word for word or it is downgraded. Live checks are off by default. Billed Verifier, golden and calibration calls go into `ai_spend`, which the spend cap counts.
15. **The assistant only suggests** (`assistant.ts`, `routes-assistant.ts`). Conversations belong to the person who started them (404 for anyone else); each question carries the page and on-screen text, which is data like client content (`assistant-pages.ts` describes each page). Suggestion kinds are a whitelist (`AssistantSuggestion` in shared): decide_item, update_risk, update_control, raise_issue, rerun_agent. No approve, sign-off, conclude, accept-risk or close kinds, ever. Suggestions must name ids from the context it was shown (`checkSuggestion`). Apply replays the change through the API with the person's own cookie (and their client IP via `INTERNAL_TOKEN`), so RULES, SoD, exit criteria and audit apply unchanged.
16. **Per-engagement access is enforced centrally** (`access.ts`, before `archiveGuard`): every request, reads included, is mapped to its engagement through `OWNERS` in `archive.ts`; non-members of a members-only engagement get 404. A new route whose URL doesn't start with `/engagements/:id/` must be added to `OWNERS`. Lists (`/engagements`, `/runs`, `/audit`, judge labels) filter with `visibleIds`; `emit()` in `realtime.ts` filters live updates; `logAudit` tags `audit_log.engagement_id` (outside the hash).
17. **Connectors only read** (`connectors.ts`): GET only, credentials encrypted and never returned or audited, private and loopback addresses refused unless the admin setting `connectorsAllowPrivate` is on, every address on a redirect re-checked.
18. **SSO never creates accounts or changes roles** (`sso.ts`): pre-provisioned users only, matched by email; state, nonce and PKCE; ID token signature, issuer, audience and expiry checked with `jose`; admins always keep password sign-in.
19. **The Use Case Planner drafts; a person adds** (`planner.ts`, `routes-plans.ts`). Only `POST /plans/:id/add` creates the card, as the person (`createCard` in `cards.ts`), with `draftedByPlanner` and `editedByPerson` in the audit detail. Fields in `plans.edited` are never overwritten by the Planner (`merge`). The Planner is excluded from board dispatch (`engine.ts` pickAgent, `agentStages`). Switched off, plans fall back to manual and the chat refuses with 409.
20. **More than one agent per stage** (`roleForStage`, `routeTakes`, `routeSpecificity` in shared; `pickAgent` in engine). A new agent takes its stage's built-in role (same rules version, same output checks); routing picks the most specific enabled agent; a card no agent takes goes idle with the reason. Built-in agents can't be deleted, only turned off; custom agents (`agents.custom`) can.
21. **Act as is off by default and always recorded** (`userFromToken` in `auth.ts`, `/auth/act-as` in `routes-auth.ts`). Only a real admin, only while `allowActAs` is on, only as an active account; the acting user's role applies, never the admin's. `audit_log.real_actor` joins the hash only when present (`auditHash`), set only when the entry's actor is the person acted as. Password, name and session changes are refused while acting. Drag and drop on the board calls the same `/cards/:id/actions` (approve or advance) as the buttons.
22. **Modules hide, they never remove** (`MODULES`, `engagements.modules`, `app.mod()` in the web store). New engagements start with every module off; engagements from before v1.2 were migrated with all on. Modules only change what the UI shows; the server routes and records are unchanged, so turning one off never loses data.
11. **Generic names only.** No client firm's trademarked service or product names in the app or docs. Demo data is fictional ("Northshore Financial Group (demo)", "Kestrel Bay Telecom (demo)" and so on); scenarios may be modelled on public cases, described without naming the companies involved.

## Run it

```
npm install
npm run dev          # web http://localhost:5173, API http://localhost:4300
npm run typecheck
npm run db:reset     # STOP THE APP FIRST. Rebuilds data/pglite with the demo
npm run demo         # app running: 5 people, 5 client engagements (scripts/demo/run.mjs; BASE_URL for a hosted site; DEMO_ADMIN_EMAIL/PASSWORD if accounts exist; clients already there are skipped; --only=a,b picks; --alone removes Client Zero)
npm run demo:build   # app STOPPED: saved copies in demos/ (all + one per client); demo:list, demo:load -- <copy>, demo:save -- <name> (scripts/demo/library.mjs; backs up data/ first, never copies secret.key)
npm run smoke        # 66 API checks; needs a fresh db and a running server
npm run test:agents  # 30 drafting-agent checks incl. a cheating mock model
npm run test:grounding # 31 checks: knowledge base, citations, decisions, meaning search, temperature
npm run test:operations # 58 checks: PDF/Excel/Word reading, incidents, monitoring and drift, connectors, members-only access, SSO (mock IdP)
npm run test:assistant # 39 checks: assistant offline/live, conversations (new, list, search, private), page questions, workspace-default model, dropped citations and suggestions, apply under own role, discard, spend cap, JSON fallback
npm run lessons        # rebuild the index in docs/LESSONS.md after adding a lesson
npm run check:lessons  # lesson format and index, plus the code checks in scripts/checks/lesson-checks.mjs
npm run test:v12       # modules per engagement; five steps still run the stage checks; upload controls (CSV/Excel preview, import, audit)
npm run versions       # list git tags; -- use vX.Y (backs up data/), -- latest
npm run test:v11       # 65 checks: Use Case Planner (rules and mock model), new agents and routing, act as, provider service names, activity charts
npm run test:verifier  # 36 checks: golden runs, regressions, Verifier quote check, calibration, live checks, spend cap
```

- **PGlite (the embedded Postgres) allows one process at a time.** Running `db:reset` while the app runs damages the database; `reset.ts` now refuses if port 4300 answers.
- The tests create accounts (andrew@example.com etc., password `correct-horse-9`) and only pass on a fresh database. Reset after running them.
- Browser checks were done with Playwright scripts (not in the repo): set up an admin, a reviewer and a preparer, walk the flows, screenshot, and check for console errors and horizontal scroll at 390px width.

## Layout

```
packages/shared/src
  index.ts        stages, tiers, cards, risks, providers, agents (AGENT_ROLES), settings, engagements
  grc.ts          roles and permissions (can), controls, inventory and agentReadiness, tests,
                  evidence, issues, evals, assessment areas, new-engagement schema, agent draft schemas
apps/server/src
  index.ts        startup, middleware order: request context, auth, archive guard, routes
  routes.ts       engagements, board, card actions (approve/request_changes/advance/retry/reject), runs, risks, audit
  routes-config.ts settings, providers, agents, engagement create and update
  routes-auth.ts  sign-in, sessions, your account, people, act as
  planner.ts      Use Case Planner (offline rules and live); routes-plans.ts plans API; cards.ts createCard
  control-import.ts CSV/Excel parsing for POST /engagements/:id/controls/import (preview: true saves nothing)
  routes-grc.ts   library, SoA, controls, inventory, tests, evidence, issues, traceability, evals, assessment, report, kill switch
  archive.ts      read-only guard, archive, restore, export, delete
  auth.ts         scrypt passwords, sessions (12 h idle, 7 days), permission RULES, isMe, requireDifferentPerson
  audit.ts        logAudit (hash chain, client address), verifyAudit
  context.ts      per-request client address for the audit log
  engine.ts       gate engine: picks queued cards, runs agents, fallback, spend cap, applies drafts, advance()
  exit-criteria.ts checks per stage
  agents/         risk-classifier, control-designer, drafting (the other four), prompts/, pricing, types
  llm.ts          one structured-output call for Anthropic, OpenAI-compatible and Ollama; callText for evals;
                  the offline "rules" provider and demo-chatbot-v1
  library.ts      31 controls, 23 obligations, eval templates, the demo chatbot
  kb.ts           knowledge base: ingest, chunk, hybrid search (full text + pgvector, rank fusion), pluggable embeddings
  routes-kb.ts    knowledge API: browse, search, upload, reindex, test embeddings
  decisions.ts    per-item human decisions on agent drafts
  verifier.ts     the Verifier (LLM-as-a-judge): claims from a draft, rules or live judge, quote check, verifyCard
  golden.ts       golden dataset and judge labels (seeded), golden runner and scoring, calibration (kappa, false passes)
  routes-testing.ts agent testing API and POST /cards/:id/verify
  assistant.ts    the assistant: context builder (page, ids it may refer to), suggestion whitelist and checks, rules and live answers
  assistant-pages.ts what each page is for (keep in step with the router)
  routes-assistant.ts conversations per person (new, list, search, rename); apply (replayed through the API as the person) and discard
  storage.ts      evidence files: data/evidence, plus Cloudflare R2 when R2_* is set (write-through, read-back on a wiped disk)
  extract.ts      text from PDF (unpdf), Excel (exceljs), Word (mammoth) and text files, for evidence and uploads
  routes-incidents.ts incidents, notification clocks (NOTIFY_CLOCKS in shared), timeline, closing rules
  monitoring.ts   scheduler tick (suites and connectors), checkRun: below threshold, drift, run failed
  connectors.ts   read-only evidence pulls with the private-network guard; routes-connectors.ts
  access.ts       visibleIds, canSee, accessGuard, engagementOfEntity; routes-access.ts (members, open or members-only)
  sso.ts          OpenID Connect scaffold: discovery, start, callback, config, passwordAllowed
  schema.sql      idempotent schema; versions append ALTER TABLE ... IF NOT EXISTS at the end
  seed.ts         demo engagement, providers, agents, library, inventory and eval suites
apps/web/src
  App.vue         shell, engagement switcher, account menu (theme, notifications), archived banner
  stores/app.ts   session, engagement, cards, permissions (can() is false for writes on archived engagements)
  pages/          one file per page; components/CardDrawer.vue is the use case side panel
  components/     Icon (inline line icons for menus and buttons), ControlUpload, AssistantPanel (Ask), StandardsTab (plain-English framework coverage), ProviderForm (presets), VerifierBar, DraftItem
  styles.css      GoldenEye design tokens (dark first, light via data-theme or system)
docs/             plain-language docs, runbooks, diagrams (Mermaid source) and images
scripts/          smoke.mjs, agents-test.mjs, grounding-test.mjs, verifier-test.mjs, assistant-test.mjs, operations-test.mjs, mock-model.cjs, demo-data.mjs
data/             database, evidence files, secret.key (gitignored; back up together)
```

## Conventions

- **Schema changes:** append `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` to `schema.sql`; never edit earlier statements. Add new tables to the drop lists in `reset.ts`, and to the export and delete in `archive.ts` if they belong to an engagement.
- **New agent:** a rules file in `prompts/`, a Zod schema in `shared`, an offline rules implementation, server checks on everything it cites, dispatch and apply in `engine.ts`, its rules version in `RULES_VERSIONS`, and tests in `scripts/agents-test.mjs`.
- **New permission or route:** add a `RULES` entry in `auth.ts` (default: GET needs read, other methods need prepare).
- **Writing (UI text, docs, comments):** plain English, short sentences, active voice, no jargon a non-technical reader wouldn't know, no marketing language, and no em dashes. Say what a thing does and why.
- **Comments:** each file starts with a short comment saying what it is for. Comment the why (a rule, a guardrail, a gotcha), not the obvious.
- **Testing:** every behaviour change gets a check in `smoke.mjs` or `agents-test.mjs`, including the negative case (the thing that must be refused). Run typecheck, both suites and a browser pass before handing over.

## Hosting (Cloudflare)

`Dockerfile` (root) builds the server only. `deploy/cloudflare/` is a Worker: static assets from `apps/web/dist`, `/api` and `/socket.io` forwarded to one Cloudflare Container (`ArgusServer`, `max_instances: 1`, sleeps after 30m, hourly cron wake). Hosted state lives outside the container: `DATABASE_URL` (Neon Postgres with pgvector) and R2 (`storage.ts`). Secrets via `wrangler secret put`; never commit them. Any new code that writes files must go through `storage.ts`, never straight to `data/`, or it will be lost when the container restarts. Runbook: `docs/runbooks/deploy-to-cloudflare.md`.

## Versions and GitHub

The owner's working copy is a git repository with one tag per release (v0.3 ... v1.3). Work happens on a release branch (`release/vX.Y`), never on `main`; the owner merges and tags. Remote: https://github.com/Alaws-github/argus (the owner pushes with his own sign-in; never ask for a token). Tag each release: `git tag -a vX.Y -m "vX.Y: ..."`. Runbook: `docs/runbooks/versions-and-github.md`.

## Delivering to the owner's computer

The working copy lives in `~/Documents/Governance and Risk - AI/governance-harness` on the owner's Windows machine (open in VS Code). When working from a cloud session:

- Check the device copy hasn't changed since the last delivery (compare md5 sums) before overwriting.
- The connected folder doesn't allow deletes, so `tar x` must use `--overwrite`; archives go into `_to_delete/` for the owner to remove.
- Never stage files just to read them; never stage the live `data/` folder while the app may be running.

## Not built yet

OCR for scanned evidence; the Planner reading the knowledge base or suggesting similar existing use cases; SAML, sign-out at the provider and MFA inside the app; OAuth connectors for document stores; sign-in rate limiting; Verifier coverage of the four drafting agents; the assistant streaming answers.

The full manual is `docs/manual.md`, rendered to `docs/manual.pdf` by `scripts/build-manual.mjs` (Playwright). Rebuild the PDF after changing the manual or its screenshots.
