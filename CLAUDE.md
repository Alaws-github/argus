# CLAUDE.md

Context for Claude working on this project. Read this first.

## What this is

**Governance Harness** (v0.7): an AI governance, risk and assurance workbench. An assurance team runs client **engagements**; each AI **use case** is a card that moves through eight stages (Intake, Classify risk, Design controls, Collect evidence, Test controls, Remediate, Validate, Board report). Six AI agents draft the work; named people make every decision; everything is written to a hash-chained audit log.

It was rebuilt from **GoldenEye**, the owner's AI delivery harness, keeping its board-and-gate engine, Models page, tabbed Settings, account menu and look. GoldenEye is a reference only: never change anything in it.

Owner: Andrew Lawrence, a QA engineer (ISTQB Foundation, CT-AI, CT-GenAI). The QA framing is deliberate: tests have preparers and reviewers, issues have a defect-style lifecycle, and evaluations are test suites. Keep that framing.

Plain-language docs for non-technical readers are in `docs/` (start at `docs/README.md`). The developer reference, with every API endpoint, is `README.md`.

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
11. **Generic names only.** No client firm's trademarked service or product names in the app or docs. Demo data is fictional ("Client Zero", "Northshore Financial Group (demo)").

## Run it

```
npm install
npm run dev          # web http://localhost:5173, API http://localhost:4300
npm run typecheck
npm run db:reset     # STOP THE APP FIRST. Rebuilds data/pglite with the demo
npm run smoke        # 66 API checks; needs a fresh db and a running server
npm run test:agents  # 30 drafting-agent checks incl. a cheating mock model
npm run test:grounding # 31 checks: knowledge base, citations, decisions, meaning search, temperature
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
  routes-auth.ts  sign-in, sessions, your account, people
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
  schema.sql      idempotent schema; versions append ALTER TABLE ... IF NOT EXISTS at the end
  seed.ts         demo engagement, providers, agents, library, inventory and eval suites
apps/web/src
  App.vue         shell, engagement switcher, account menu (theme, notifications), archived banner
  stores/app.ts   session, engagement, cards, permissions (can() is false for writes on archived engagements)
  pages/          one file per page; components/CardDrawer.vue is the use case side panel
  styles.css      GoldenEye design tokens (dark first, light via data-theme or system)
docs/             plain-language docs, runbooks, diagrams (Mermaid source) and images
scripts/          smoke.mjs, agents-test.mjs, grounding-test.mjs, verifier-test.mjs, mock-model.cjs
data/             database, evidence files, secret.key (gitignored; back up together)
```

## Conventions

- **Schema changes:** append `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` to `schema.sql`; never edit earlier statements. Add new tables to the drop lists in `reset.ts`, and to the export and delete in `archive.ts` if they belong to an engagement.
- **New agent:** a rules file in `prompts/`, a Zod schema in `shared`, an offline rules implementation, server checks on everything it cites, dispatch and apply in `engine.ts`, its rules version in `RULES_VERSIONS`, and tests in `scripts/agents-test.mjs`.
- **New permission or route:** add a `RULES` entry in `auth.ts` (default: GET needs read, other methods need prepare).
- **Writing (UI text, docs, comments):** plain English, short sentences, active voice, no jargon a non-technical reader wouldn't know, no marketing language, and no em dashes. Say what a thing does and why.
- **Comments:** each file starts with a short comment saying what it is for. Comment the why (a rule, a guardrail, a gotcha), not the obvious.
- **Testing:** every behaviour change gets a check in `smoke.mjs` or `agents-test.mjs`, including the negative case (the thing that must be refused). Run typecheck, both suites and a browser pass before handing over.

## Delivering to the owner's computer

The working copy lives in `~/Documents/Governance and Risk - AI/governance-harness` on the owner's Windows machine (open in VS Code). When working from a cloud session:

- Check the device copy hasn't changed since the last delivery (compare md5 sums) before overwriting.
- The connected folder doesn't allow deletes, so `tar x` must use `--overwrite`; archives go into `_to_delete/` for the owner to remove.
- Never stage files just to read them; never stage the live `data/` folder while the app may be running.

## Not built yet

Verifier coverage of the four drafting agents (it checks classify and design only); the AI assistant panel, Standards redesign and more provider presets (round 3); design refresh and demo walkthrough (round 4); connectors for the Evidence Collector; reading PDFs and spreadsheets as evidence; scheduled evals and drift monitoring; incident records; per-engagement membership; SSO and MFA; sign-in rate limiting.
