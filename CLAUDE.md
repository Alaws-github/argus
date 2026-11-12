# CLAUDE.md

Context for Claude working on this project. Read this first, then:

- [`AGENTS.md`](AGENTS.md): how to work here (planning, recording lessons, branches and delivery, testing, writing).
- [`docs/LESSONS.md`](docs/LESSONS.md): pitfalls and decisions already found. Read `docs/lessons/general.md` and the area files for what you change, and add a lesson whenever you fix a bug or the owner corrects you.
- [`docs/context/project-history.md`](docs/context/project-history.md): who ARGUS is for, how the owner works, what was decided and why, and every version.

**v1.7** added the dashboard look (KPI tiles on every working page), client workflows (a builder around the governance gates) and an assistant that shows its steps live. v1.6 built `docs/plans/v1.6-agentic-ai.md`; "What v1.6 simplified" below says where it differs. **Releases from here are numbered 1.7.1, 1.7.2 and so on.** v1.7.1 put workflow steps in the client's business tools (`packages/shared/src/tools-catalog.ts`): Microsoft 365, ServiceNow, Jira, Google Workspace, Slack and others, read through read-only connectors, never written to. v1.7.2 moved connector management to Settings > Connected tools (with the engagement's `clientTools`), opens the connector form in place from a workflow step (`components/ConnectorForm.vue`), made Tests and Evidence > From Client Tools a read-only view, added the optional wizard step "How does the client work?" (template draft workflow and client tools, no credentials), and renamed the Settings tab Workflow to Approval gates. v1.7.3 gave client steps a proof (`proof`, `proofStatus` on a workflow node) checked per use case through connectors (`client-steps.ts`, `components/ClientSteps.vue`), added opt-in write-back (`outbound.ts`, `components/WriteBackCard.vue`), evidence pushed from pipelines (`ingest.ts`, `components/PipelinesCard.vue`), S3 (SigV4) and Azure Blob (SAS) reads, FDA GMLP and HIPAA (`library-health.ts`), and Controls > Across Frameworks (`harmonize.ts`, `components/HarmonizeTab.vue`). Shared types for these are in `packages/shared/src/integrations.ts`. Client steps inform the people at the gates; they never move a card. v1.7.4 added the complete requirement list per framework (`packages/shared/src/framework-catalog.ts`, `requirements.ts`, `components/RequirementsTab.vue`: Controls > Every Requirement), plainer sources and Verifier wording (`describeSource`, `VERDICT_ADVICE`), `cards.workflow_mode` (auto, none, pinned) with `engagements.client_steps_default`, tracked-only client steps, scheduled checks (`checkDueSteps`), `workflows.require_steps` (a sign-off exit criterion) and the Client tools and workflows module (the `connectors` module key).

**Every change updates its records** (checklist in AGENTS.md): `CHANGELOG.md`, the version in `package.json` for a release, the manual and its screenshots when the UI changes, this file and `README.md`, `assistant-pages.ts` for new pages, and a lesson for every bug, correction or design decision. **UI and UX are part of the job**: check every screen change in the browser, dark mode first, at desktop and phone widths.

## What this is

**ARGUS** (v1.7), the Assurance, Risk & Governance Unified System (formerly Governance Harness): an AI governance, risk and assurance workbench. An assurance team runs client **engagements**; each AI **use case** is a card that moves through eight stages (Intake, Classify risk, Design controls, Collect evidence, Test controls, Remediate, Validate, Board report), shown to people as five steps (`PHASES` / `PHASE_OF` in shared: Intake, Assess risk, Controls, Test, Sign-off & report). The engine, exit criteria, agents and tests all still work on the eight stages. Seven AI agents draft the work (the Use Case Planner drafts the intake brief, six more draft each later stage), and a lead can add more per stage; named people make every decision; everything is written to a hash-chained audit log.

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
8. **Agent rules live in `apps/server/src/agents/prompts/*.md`.** Engagement instructions are appended after them, never replacing them (the Planner too since v1.5; the assistant gets workspace instructions from `assistantInstructions`). Every agent that writes for people gets the engagement description (`about`). Each run stores the rules file's sha256 prefix (`rules_version`).
9. **Archived engagements are read-only**, enforced centrally by `archiveGuard` in `archive.ts`. A new write route must map to its engagement there if its URL doesn't start with `/engagements/:id/`.
10. **New agents ship switched off** (`ON_BY_DEFAULT` in `seed.ts`).
12. **Drafts are decided item by item** (`decisions.ts`): approving classify, design, validate or report needs a decision on every item; only kept items reach the registers; edits and rejections need a reason; the audit log keeps the AI's original. Undecided items count as accepted only when the engine auto-advances an ungated stage.
13. **Agents are grounded** (`kb.ts`): they get knowledge-base passages (the drafting agents also search the client's own documents), must cite them by K-id, and `strayCitations` rejects any id they weren't given. A repair attempt (`callStructuredChecked`) fixes only format problems; stray citations and invented figures stay hard failures. Cited passages are snapshotted onto the draft. Drafting calls use temperature 0 (`postDeterministic` in `llm.ts`).
14. **The Verifier is advisory** (`verifier.ts`). Its verdicts sit in `cards.verification`, never in `decisions`, and never block or allow an approval. A "supported" or "partly" verdict must quote a cited passage word for word or it is downgraded. Live checks are off by default. Billed Verifier, golden and calibration calls go into `ai_spend`, which the spend cap counts.
15. **The assistant only suggests** (`assistant.ts`, `routes-assistant.ts`). Conversations belong to the person who started them (404 for anyone else); each question carries the page and on-screen text, which is data like client content (`assistant-pages.ts` describes each page). Suggestion kinds are a whitelist (`AssistantSuggestion` in shared): decide_item, update_risk, update_control, raise_issue, rerun_agent. No approve, sign-off, conclude, accept-risk or close kinds, ever. Suggestions must name ids from the context it was shown (`checkSuggestion`). Apply replays the change through the API with the person's own cookie (and their client IP via `INTERNAL_TOKEN`), so RULES, SoD, exit criteria and audit apply unchanged.
16. **Per-engagement access is enforced centrally** (`access.ts`, before `archiveGuard`): every request, reads included, is mapped to its engagement through `OWNERS` in `archive.ts`; non-members of a members-only engagement get 404. A new route whose URL doesn't start with `/engagements/:id/` must be added to `OWNERS`. Lists (`/engagements`, `/runs`, `/audit`, judge labels) filter with `visibleIds`; `emit()` in `realtime.ts` filters live updates; `logAudit` tags `audit_log.engagement_id` (outside the hash).
17. **Connectors only read** (`connectors.ts`): GET only (S3 reads are signed with SigV4 by `sigV4`; an Azure SAS token is added to the address only at read time, `withSas`) (the one POST is a token request to Microsoft or Google's identity service for `azure_ad` and `google_sa` sign-ins, v1.7.1), a credential is never passed on to another site on a redirect, credentials encrypted and never returned or audited, private and loopback addresses refused unless the admin setting `connectorsAllowPrivate` is on, every address on a redirect re-checked.
18. **SSO never creates accounts or changes roles** (`sso.ts`): pre-provisioned users only, matched by email; state, nonce and PKCE; ID token signature, issuer, audience and expiry checked with `jose`; admins always keep password sign-in.
19. **The Use Case Planner drafts; a person adds** (`planner.ts`, `routes-plans.ts`). Only `POST /plans/:id/add` creates the card, as the person (`createCard` in `cards.ts`), with `draftedByPlanner` and `editedByPerson` in the audit detail. Fields in `plans.edited` are never overwritten by the Planner (`merge`). The Planner is excluded from board dispatch (`engine.ts` pickAgent, `agentStages`). Switched off, plans fall back to manual and the chat refuses with 409.
20. **More than one agent per stage** (`roleForStage`, `routeTakes`, `routeSpecificity` in shared; `pickAgent` in engine). A new agent takes its stage's built-in role (same rules version, same output checks); routing picks the most specific enabled agent; a card no agent takes goes idle with the reason. Built-in agents can't be deleted, only turned off; custom agents (`agents.custom`) can.
21. **Act as is off by default and always recorded** (`userFromToken` in `auth.ts`, `/auth/act-as` in `routes-auth.ts`). Only a real admin, only while `allowActAs` is on, only as an active account; the acting user's role applies, never the admin's. `audit_log.real_actor` joins the hash only when present (`auditHash`), set only when the entry's actor is the person acted as. Password, name and session changes are refused while acting. Drag and drop on the board calls the same `/cards/:id/actions` (approve or advance) as the buttons.
22. **Modules hide, they never remove** (`MODULES`, `engagements.modules`, `app.mod()` in the web store). New engagements start with every module off; engagements from before v1.2 were migrated with all on. Modules only change what the UI shows; the server routes and records are unchanged, so turning one off never loses data.
23. **Agent tools only read** (`tools.ts`). Every tool reads; none writes, approves or sends. Each tool lists the roles that may use it, an agent's tick list (`agents.tools`, groups in `agent-loop.ts` `GROUPS`) narrows that, and a call to anything else is refused and logged. Look-ups across engagements see only open, unarchived ones (`shareable`); members-only engagements are never read from another engagement. Tool results are wrapped as data with an ignore-instructions note, like client content (rule 7).
24. **Every step is recorded.** Each look-up, question, self-check and repair is a line in `run_events`; runs store `mode` and `steps`. The assistant's look-ups are returned as its `trail`.
25. **Citations come from the run's ledger.** An agent may cite a passage it was given or found with `search_knowledge` in that run (the ledger), nothing else; `strayCitations` checks against the ledger. The Report Writer may quote a figure from its data or from a record it looked up (`seen`), nothing else.
26. **Loops are bounded** (`runLoop` in `agent-loop.ts`): at most `max_steps` model steps (2 to 20; the last step forces the final tool), the run's time limit, one format repair, one self-check, two nudges. Models without tool calls and the offline rules run as one call (`mode` single).
27. **Questions pause; they don't decide** (`ask_person`, `agent_questions`, `/cards/:id/questions/:qid/answer|skip`). A question stops the run as `waiting` and the card as `question`; anyone who can prepare answers or skips under their own name, audited; the card is queued again and the next run gets every answer for that stage. At most `MAX_QUESTIONS` (2) per card and stage. An answer is data for the draft; it never approves, concludes or moves anything. The Planner and the assistant never ask (they talk to the person already); golden runs can't.
28. **Workflows can't route round governance** (`packages/shared/src/workflow.ts`, `routes-workflows.ts`). The five gates and the trigger can be moved but never removed (a save without them is refused); every path from the trigger to an end passes every gate in order; after an agent step a person or a gate decides before an end; rework arrows are the only way back. `validateWorkflow` runs in the browser and again on the server before a publish; only a workflow with no problems publishes, and each publish keeps a version. Every create, save, publish, restore and retirement is audited.
29. **The assistant's live steps go only to the person asking** (`emitToUser` in `realtime.ts`, keyed by the browser's `requestId`). Ratings belong to the asker (404 for anyone else) and are audited. Links in AI text are kept only for paths inside ARGUS (`markdown.ts`); anything else shows as text.
30. **Write-back is opt-in, event-driven and create-only** (`outbound.ts`, v1.7.3; the owner chose to allow it). Off per engagement until a lead switches on `engagements.write_back`; each target sends only its ticked events. Events are read from the audit log after commit (`dispatchOutbound`, on the monitoring tick, with a cursor), so a send never changes ARGUS and no agent can trigger one: `tools.ts` has no write tool. Sends only POST a new message, ticket or record; never edit, close or delete. Same private-network check as connectors, no redirects followed, credentials and channel webhook addresses encrypted, every send and failure audited with the payload's SHA-256, never the secret.
31. **Pipeline tokens only add evidence** (`ingest.ts`, v1.7.3). `POST /api/ingest/evidence` is mounted before session sign-in and accepts only a Bearer ingest token; the token is shown once and stored as SHA-256; it can add evidence to its own engagement and nothing else; archived engagements refuse; each push is audited as `Pipeline: <name> (IT-n)`.
32. **Client step checks inform; they don't decide** (`client-steps.ts`, v1.7.3). A check reads the step's connector (the same guards as a pull), matches records by the use case key with a word boundary (AI-3 never matches AI-30), checks against the published version's graph, and files what proved a pass as evidence once per distinct content. It never moves a card or approves anything; a person confirming a step by hand must give a link or a note, audited.
33. **Fully met means every requirement** (`requirements.ts`, v1.7.4). A framework is fully met only when every requirement in `FRAMEWORK_CATALOG` is proven (a control meeting it, through its own or its library control's references, with a passing test, evidence and no failure) or not applicable with a reason of at least 10 characters, set by a lead or admin and audited. Catalogue titles are ARGUS's own words and official numbers only, never a standard's text (ISO/IEC 42001 above all).
34. **A required client step blocks sign-off but never signs off** (`exit-criteria.ts` `report`, `stepsBlockingSignOff`). Only for a workflow published with `require_steps`; only steps with a proof count; a person still approves.
11. **Generic names only.** No client firm's trademarked service or product names in the app or docs. Demo data is fictional ("Northshore Financial Group (demo)", "Kestrel Bay Telecom (demo)" and so on); scenarios may be modelled on public cases, described without naming the companies involved.

## Run it

```
npm install
npm run dev          # web http://localhost:5173, API http://localhost:4300
npm run typecheck
npm run db:reset     # STOP THE APP FIRST. Rebuilds data/pglite with the demo
npm run demo         # app running: 5 people, 5 client engagements (scripts/demo/run.mjs; BASE_URL for a hosted site; DEMO_ADMIN_EMAIL/PASSWORD if accounts exist; clients already there are skipped; --only=a,b picks; --alone removes Client Zero)
npm run demo:topup   # app running: adds the v1.7.3 and v1.7.4 demo pieces to Northshore and Palmcrest on a site built before them (BASE_URL, DEMO_ADMIN_EMAIL/PASSWORD); only adds, safe to run again (scripts/demo/topup-v174.mjs)
npm run demo:build   # app STOPPED: saved copies in demos/ (all + one per client); demo:list, demo:load -- <copy>, demo:save -- <name> (scripts/demo/library.mjs; backs up data/ first, never copies secret.key)
npm run smoke        # 68 API checks; needs a fresh db and a running server
npm run test:agents  # 30 drafting-agent checks incl. a cheating mock model
npm run test:grounding # 31 checks: knowledge base, citations, decisions, meaning search, temperature
npm run test:operations # 58 checks: PDF/Excel/Word reading, incidents, monitoring and drift, connectors, members-only access, SSO (mock IdP)
npm run test:assistant # 39 checks: assistant offline/live, conversations (new, list, search, private), page questions, workspace-default model, dropped citations and suggestions, apply under own role, discard, spend cap, JSON fallback
npm run lessons        # rebuild the index in docs/LESSONS.md after adding a lesson
npm run check:lessons  # lesson format and index, plus the code checks in scripts/checks/lesson-checks.mjs
npm run test:v15       # flaky providers (429, max_tokens, truncation, malformed and broken JSON, rules fallback), Planner context, unclear input and suggestions, assistant instructions, golden runs with an engagement's context
npm run test:v16       # 34 checks: agent loop (look-ups logged, ledger citations, single-call mode, no-tools fallback), step limit, refused tools, members-only records, self-check, questions (pause, answer, skip, viewer refused, audit), assistant trail and basis, golden runs by mode
npm run test:v174      # 35 checks: module, no workflow and the default, tracked-only steps, confirm only manual steps, scheduled checks, Verifier wording, every requirement (server with MONITOR_TICK_MS=1000)
npm run test:v173      # 58 checks: healthcare frameworks, across frameworks, pipeline pushes and tokens, S3 and Azure Blob, client step proof, write-back (server with MONITOR_TICK_MS=1000)
npm run test:v17       # 41 checks (start the server with ARGUS_MS_TOKEN_URL=http://localhost:4401/ms/{tenant}/token ARGUS_GOOGLE_TOKEN_URL=http://localhost:4401/google/token for the sign-in checks, or they are skipped): client workflows (template, gates can't be removed, bypass and agent-without-person blocked, publish, versions, restore, retire, permissions, audit), KPI read, assistant steps, @ tags, ratings, errors a person can act on
npm run test:rag       # 8 checks: retrieval recall@5/10 and MRR (keyword, and with meaning search), heading-aware chunks with overlap, per-document cap
npm run test:v12       # modules per engagement; five steps still run the stage checks; upload controls (CSV/Excel preview, import, audit)
npm run versions       # list git tags; -- use vX.Y (backs up data/), -- latest
npm run release -- X.Y.Z # set the version (root package.json, shown under Sign Out) and start the CHANGELOG section
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
  routes-config.ts settings, providers, agents, engagement create and update (v1.7.2: `clientTools`, filtered to known tools; an optional `workflow.template` drafts a client workflow at creation)
  routes-auth.ts  sign-in, sessions, your account, people, act as
  planner.ts      Use Case Planner (offline rules and live): plannerContext (engagement, existing use cases, KB passages
                  incl. M-INTAKE), unclear input, suggestions and picks; routes-plans.ts plans API; cards.ts createCard
  control-import.ts CSV/Excel parsing for POST /engagements/:id/controls/import (preview: true saves nothing)
  routes-grc.ts   library, SoA, controls, inventory, tests, evidence, issues, traceability, evals, assessment, report, kill switch
  archive.ts      read-only guard, archive, restore, export, delete
  auth.ts         scrypt passwords, sessions (12 h idle, 7 days), permission RULES, isMe, requireDifferentPerson
  audit.ts        logAudit (hash chain, client address), verifyAudit
  context.ts      per-request client address for the audit log
  engine.ts       gate engine: picks queued cards, runs agents, fallback, spend cap, applies drafts, advance()
  exit-criteria.ts checks per stage
  agents/         risk-classifier, control-designer, drafting (the other four), prompts/, pricing, types
  agent-loop.ts   v1.6 agent loop: runLoop (tools, final tool, step limit, repair, self-check, QuestionPause), loopFor (engine agents)
  tools.ts        v1.6 read-only tools for agents and the assistant (search_knowledge, get_use_case, find_similar_use_cases, registers, evidence, ask_person)
  (shared) tools-catalog.ts v1.7.1 business tools: what each is used for, how a connector reads it (sign-in, example address, setup help), or null when mapped only
  kpis.ts         v1.7 one read of the numbers behind every page's KPI tiles (GET /engagements/:id/kpis)
  routes-workflows.ts v1.7 client workflows: list, create from a template, save (gates can't be removed), publish (rules must pass), versions, restore, retire
  retrieval.ts    v1.6 retrieval checks: fixed question set, recall@5/10 and MRR (Checking the AI > Retrieval)
  llm.ts          chatStep (one model step with tools, Anthropic/OpenAI/Ollama, v1.6); one structured-output call for Anthropic, OpenAI-compatible and Ollama; callText for evals;
                  retries on 429/5xx (Retry-After), max_completion_tokens fallback, TruncatedError and a second try
                  with twice the room, callStructuredChecked (one repair attempt for format problems, zodProblems);
                  the offline "rules" provider and demo-chatbot-v1
  library.ts      37 controls (6 for healthcare, library-health.ts), 37 obligations, eval templates, the demo chatbot
  kb.ts           knowledge base: ingest, chunk, hybrid search (full text + pgvector, rank fusion), pluggable embeddings
  routes-kb.ts    knowledge API: browse, search, upload, reindex, test embeddings
  decisions.ts    per-item human decisions on agent drafts
  verifier.ts     the Verifier (LLM-as-a-judge): claims from a draft, rules or live judge, quote check, verifyCard
  golden.ts       golden dataset and judge labels (seeded), golden runner and scoring, calibration (kappa, false passes)
  routes-testing.ts agent testing API and POST /cards/:id/verify
  assistant.ts    the assistant: context builder (page, ids it may refer to), suggestion whitelist and checks, rules and live answers
  assistant-pages.ts what each page is for (keep in step with the router)
  routes-assistant.ts conversations per person (new, list, search, rename, delete, edit a question with replaceFrom, v1.7.4); apply (replayed through the API as the person) and discard
  storage.ts      evidence files: data/evidence, plus Cloudflare R2 when R2_* is set (write-through, read-back on a wiped disk)
  extract.ts      text from PDF (unpdf), Excel (exceljs), Word (mammoth) and text files, for evidence and uploads
  routes-incidents.ts incidents, notification clocks (NOTIFY_CLOCKS in shared), timeline, closing rules
  monitoring.ts   scheduler tick (suites and connectors), checkRun: below threshold, drift, run failed
  connectors.ts   read-only evidence pulls with the private-network guard, SigV4 (S3) and SAS (Azure Blob); routes-connectors.ts
  client-steps.ts v1.7.3 client step proof per use case (read records, match the key, evaluate, file evidence)
  outbound.ts     v1.7.3 write-back targets and the dispatcher that turns audit entries into sends
  ingest.ts       v1.7.3 pipeline ingest tokens and POST /api/ingest/evidence
  harmonize.ts    v1.7.3 coverage across frameworks and library match suggestions (v1.7.4: against the complete lists)
  requirements.ts v1.7.4 every requirement per framework: status, not applicable with a reason, mapping a control to a requirement
  library-health.ts v1.7.3 FDA GMLP and HIPAA references, HLT controls and obligations (shown only where chosen)
  access.ts       visibleIds, canSee, accessGuard, engagementOfEntity; routes-access.ts (members, open or members-only)
  sso.ts          OpenID Connect scaffold: discovery, start, callback, config, passwordAllowed
  schema.sql      idempotent schema; versions append ALTER TABLE ... IF NOT EXISTS at the end
  seed.ts         demo engagement, providers, agents, library, inventory and eval suites
apps/web/src
  App.vue         shell, engagement switcher, account menu (theme, notifications), archived banner
  stores/app.ts   session, engagement, cards, permissions (can() is false for writes on archived engagements)
  pages/          one file per page; components/CardDrawer.vue is the use case side panel
  markdown.ts     safe Markdown for model text (escape first; internal links and record keys only, v1.7); lib/links.ts keyLink and ?focus= row highlighting;
  pages/WorkflowsPage.vue, WorkflowBuilderPage.vue  client workflows list and builder (icon rail, canvas, inspector); lib/unsaved.ts useUnsaved (Save disabled until a change)
  components/     KpiStrip (v1.7 KPI tiles per page), Icon (inline line icons for menus and buttons), FilterPill (board filters), ControlUpload, AssistantPanel (Ask), StandardsTab (plain-English framework coverage), ProviderForm (presets), VerifierBar, DraftItem, ConnectorForm (v1.7.2: the connector modal, used in Settings > Connected tools and in place in the workflow builder), ConnectorsTab (manage mode in Settings, read-only view in Tests and Evidence)
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

The owner's working copy is a git repository with one tag per release (v0.3 ... v1.4). The version shown in the app comes from the root `package.json` (`npm run release`); changes are listed in `CHANGELOG.md`. Work happens on a release branch (`release/vX.Y`), never on `main`; the owner merges and tags. Remote: https://github.com/Alaws-github/argus (the owner pushes with his own sign-in; never ask for a token). Tag each release: `git tag -a vX.Y -m "vX.Y: ..."`. Runbook: `docs/runbooks/versions-and-github.md`.

## Delivering to the owner's computer

The working copy lives in `~/Documents/Governance and Risk - AI/governance-harness` on the owner's Windows machine (open in VS Code). When working from a cloud session:

- Check the device copy hasn't changed since the last delivery (compare md5 sums) before overwriting.
- The connected folder doesn't allow deletes, so `tar x` must use `--overwrite`; archives go into `_to_delete/` for the owner to remove.
- Never stage files just to read them; never stage the live `data/` folder while the app may be running.

## What v1.6 simplified from its plan

- A paused run is not resumed mid-conversation: answering queues the card again and the new run gets every answer (`<answers_to_your_questions>`). Simpler and survives restarts; costs one more brief.
- The step trail lives in `run_events` (no separate `run_steps` table); runs store `mode` and `steps`.
- `find_similar_use_cases` is SQL word overlap over cards, not a separate records index. Use cases are also indexed as kind `use_case` for search.
- No reranker and no HNSW index yet: the vector column has no fixed dimension (it holds whatever model is set), and the volumes are small enough for a scan.
- Card status is `question` (label "Question for You"), not `waiting_for_answer`.

## Not built yet

Client workflows moving cards (steps are checked and shown, but the gates are still decided by people); editing or closing records in client tools (write-back only creates); a reranker and an HNSW index for meaning search; OCR for scanned evidence; SAML, sign-out at the provider and MFA inside the app; writing to business tools (by design: connectors only read); Google Workspace sign-in by a person (only service accounts); sign-in rate limiting; Verifier coverage of the four drafting agents; the assistant streaming answers.

The full manual is `docs/manual.md`, rendered to `docs/manual.pdf` by `scripts/build-manual.mjs` (Playwright). Rebuild the PDF after changing the manual or its screenshots.
