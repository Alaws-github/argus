# Governance Harness

An AI governance, risk and assurance workbench. AI use cases move across a board from Intake to Board report. Agents draft the work at each stage; a named person approves at each gate; every action lands in a hash-chained audit trail.

v0.3 adds the assurance layer: sign-in with roles and segregation of duties, a control library mapped to public standards, a Statement of Applicability, a requirements traceability matrix, control testing with a reviewer sign-off, a hashed evidence vault, issues handled like defects, evaluation and red-team suites, an AI inventory with an agent register, residual risk against appetite, and a readiness report scored on a maturity scale.

Built on the structure of GoldenEye (the delivery harness): same board-and-gate engine, run log, Models & keys page, tabbed Settings, spend cap and design system, with a governance domain in place of software delivery.

## Run it

Needs Node 20.12 or later. No database or Docker needed: it uses an embedded Postgres (PGlite) stored in `data/`.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The API runs on port 4300.

On first open you create the **admin account** (name, email, password). Your name is how your approvals appear in the audit trail. Add colleagues under **More > People and roles**: segregation of duties means you'll want at least one other approver to take a use case all the way through.

The first start also creates a demo engagement, **Client Zero**, with four use cases in Intake, an AI inventory (including two agents) and two evaluation suites. Out of the box the agents run on the **built-in rules** (offline, free), and the eval suites target `demo-chatbot-v1`, a deliberately imperfect bank chatbot, so the whole flow works with no API key.

A walk-through that touches everything:

1. **Board**: open AI-2, send it to classification, approve the classification, then approve the proposed controls.
2. **Controls**: see the new controls in the register, decide a few Statement of Applicability rows, and watch the traceability matrix show what's still a gap.
3. **Testing**: as a preparer, record a result and attach a file; as someone else, review it. Raise an issue from a failed test.
4. **Evals**: run the red-team suite and raise issues from the failed cases.
5. **Risks**: set residual likelihood and impact, accept what's within appetite.
6. **Report**: score the seven areas, then have a different lead sign it off.

### Connect a model

1. Open **Models** in the top bar.
2. Either edit the **Anthropic** card and paste a key, or click **+ Add provider** and pick a type:

   | Type | Base URL | Key | Use it for |
   | --- | --- | --- | --- |
   | Anthropic API | `https://api.anthropic.com` | From console.anthropic.com | Claude models |
   | Ollama Cloud | `https://ollama.com` (no `/v1`) | From ollama.com/settings/keys | Hosted open models |
   | OpenAI-compatible | Usually ends in `/v1` | Optional for local servers | OpenAI, Azure OpenAI, OpenRouter, LM Studio, vLLM, llama.cpp |

3. Click **Test and find models**. The harness lists the provider's models; add any it doesn't list by ID.
4. If the provider is **billed**, give each model a price (USD per million input, cached and output tokens). Anthropic's current models have default prices built in.
5. Open **Settings > Agents**, pick the Risk Classifier, choose the provider and model, optionally a fallback, and save. The top bar badge changes from **Dry run** to **Live agents**.

Setting `ANTHROPIC_API_KEY` in `.env` still works: the Anthropic provider uses it when it has no key of its own.

### Other commands

| Command | What it does |
| --- | --- |
| `npm run db:reset` | Drops everything and reseeds Client Zero (keeps `data/secret.key`) |
| `npm run build` then `npm start` | Builds the web app and serves it from the API on port 4300 |
| `npm run typecheck` | Type-checks server and web |
| `npm run smoke` | API smoke test (37 checks) against a running server on a **fresh** database |

To use a real Postgres instead of PGlite, set `DATABASE_URL` in `.env`.

## Pages

| Page | What's on it |
| --- | --- |
| **Overview** | Classification coverage, open high risks, what needs you, spend against the cap, runs, use cases by tier |
| **Board** | Nine stages with gate badges, filters, search, agent slots. A use case opens in a drawer with its gate actions, exit criteria, risks and controls |
| **Risks** | Inherent and residual heat maps, risk appetite, residual likelihood and impact, controls per risk, acceptance (above appetite needs a lead); CSV |
| **Controls** | **Register** (controls per use case, owner, status, tests, evidence, issues), **Library** (31 controls mapped to NIST AI RMF, ISO/IEC 42001, NIST CSF 2.0, COSO, EU AI Act, Jamaica DPA, OWASP), **Statement of Applicability**, **Traceability** (obligation → library control → control → test → evidence, with gaps); CSV for each |
| **Testing** | **Tests** (design, operating, automated and retest; procedure, population, sample, expected, actual, exceptions; preparer and reviewer), **Evidence vault** (files, links and notes, SHA-256 on collection, verify and download) |
| **Issues** | Severity, owner, due date, overdue flag, management response; lifecycle open → in remediation → ready for retest → closed, or risk accepted with a reason |
| **Evals** | Quality and red-team suites against any provider and model; checks: contains, must not contain, pattern, refuses, length, judge model; results by category; raise issues from failures |
| **Inventory** | AI systems, models, agents, datasets and vendor AI with owners; the agent register checks eight conditions before an agent may act alone |
| **Report** | Readiness assessment across seven areas with suggested scores and your rationale; printable report; Markdown download; sign-off |
| More › **Runs**, **Audit trail** | Every agent run and its log; every action, with a button that verifies the hash chain |
| More › **Settings**, **Models** | Engagement settings, gates, agents (with kill switch and rules version); providers, keys, prices and the spending limit |
| More › **People and roles** | Admin only: add people, change roles, reset passwords, disable |

## How it works

```
Intake ─▶ Classify risk ─▶ Design controls ─▶ Collect evidence ─▶ Test controls ─▶ Remediate ─▶ Validate ─▶ Board report ─▶ Closed
 (gate)     (gate, agent)      (gate)                                                            (gate)        (gate)
```

- **Cards** are AI use cases. Each has a profile: owner, what it does, data used, people affected, autonomy, vendor.
- **Gates** stop a card until a person signs off. Defaults: Intake (always), Classify, Design, Validate, Report. Change them in Settings > Workflow & gates.
- **Agents** are configured per engagement, one per stage. The **Risk Classifier** and **Control Designer** are built; the others are listed with their planned role and can be set up ahead of time but not switched on.
- **Exit criteria** are checks, not reminders. A card can't leave Design until every risk scoring 12+ has a control, Evidence until every control has evidence, Test until every test has a reviewed result, Remediate until no critical or high issue is open (`exit-criteria.ts`).
- **The engine** (`apps/server/src/engine.ts`) polls every 1.5 seconds and picks up queued cards in stages with an enabled agent. It respects each agent's **runs at once**, each provider's **requests at once** and 4 slots overall. It runs the agent on its provider and model, falls back to the fallback model if the first call fails or the provider is off, records the run and its cost, then stops at the gate or moves the card on.
- **Risk Classifier** (`apps/server/src/agents/risk-classifier.ts`) returns a tier (prohibited, high, limited, minimal), an oversight model, the factors behind the tier, 2 to 6 starting risks, open questions and framework references. Every provider is asked for one structured answer that matches a JSON schema (`apps/server/src/llm.ts`); the server then validates it with Zod, and anything else fails the run.
- **Control Designer** (`agents/control-designer.ts`) picks controls from the library for each approved risk, adds the baseline controls a tier needs, and writes a test approach for each. It may only cite library codes that exist.
- **Approving** a classification writes its risks to the **risk register**; approving a design writes the controls, links them to the risks they treat and creates a draft test for each, all in one transaction. **Request changes** sends your note back to the agent.

### People, roles and segregation of duties

| Role | Can |
| --- | --- |
| Admin | Everything, including people, models and workspace settings |
| Engagement lead | Engagement settings and gates, agents, accept any risk, sign off the report |
| Reviewer | Approve gates, review tests, accept risks within appetite, close issues |
| Preparer | Add use cases, controls, tests, evidence and issues |
| Viewer | Read everything |

On top of roles: nobody approves a use case they added, reviews a test they prepared, closes an issue without a passed and reviewed retest, or signs off a report whose areas they scored alone. A reviewed test result is locked; a retest is a new test. Passwords are hashed with scrypt; sessions are random tokens stored hashed, in an HttpOnly cookie.

### Providers and cost

- Keys are encrypted with AES-256-GCM before they're stored. The encryption key is `SECRET_KEY` (64 hex characters) or, if unset, `data/secret.key`, generated on first run. Back that file up with the database; without it saved keys can't be read.
- The browser only ever sees `••••` plus the last four characters. Agents never see keys: the server makes the model call.
- Cost per run = input × input price + cached × cached price + output × output price, per million tokens. Unbilled providers (your own server, the built-in rules) cost $0 and don't count toward the cap.
- **Effort** sets the output budget: low 2k, medium 4k, high 8k, xhigh 12k, max 16k tokens.
- **Spending limit:** when this month's billed spend reaches the cap and **pause at the cap** is on, billed runs stop with a note on the card (an unbilled fallback still runs). The month starts in the chosen time zone.

### Governance controls built into the harness

| Control | Where |
| --- | --- |
| Agents never approve; a named person does at each gate. "Approve or sign off" is shown as a tool no agent can have | `routes.ts` card actions, Settings > Agents |
| The harness's rules for each role load from server files; an engagement's instructions are appended after them and can't replace them; the use case text is wrapped as data | `agents/prompts/`, `agents/risk-classifier.ts` |
| Agent output must pass a schema before anyone sees it | `Classification` in `packages/shared` |
| Every change and its audit row commit in one transaction; key, token, secret and password fields are redacted | `audit.ts` |
| API keys encrypted at rest and never sent to the browser or to agents | `crypto.ts`, `providers.ts` |
| Append-only run history with every step, model, provider, tokens and cost | `runs`, `run_events` tables |
| Monthly spend cap with warning threshold and pause; per-run spend limit and timeout | `engine.ts`, Models page, Settings > Agents |
| A provider in use by an agent can't be removed; an unbuilt agent can't be switched on | `routes-config.ts` |
| Runs left running by a crash are closed on startup | `engine.ts` |
| Sign-in, five roles, segregation of duties on approvals, test reviews, issue closure and report sign-off | `auth.ts`, `routes-auth.ts` |
| Audit log is hash-chained (each entry stores the previous hash) and can be verified from the Audit page | `audit.ts` |
| Every run is stamped with the sha256 of the agent's rules file, so a result can be tied to the exact rules that produced it | `runs.rules_version` |
| Each agent has a kill switch that fails running work safely; testing it records the date | Settings > Agents, `POST /agents/:id/kill` |
| Evidence is fingerprinted with SHA-256 on collection and can be re-verified; evaluation runs are filed as evidence automatically | `routes-grc.ts` |

These follow decisions recorded in the Anser repo's ADRs 022, 024, 025 and 028 (see `../docs/adr/`).

## Layout

```
packages/shared            Domain model: stages, tiers, providers, agents, schemas, labels (Zod)
apps/server/src
  index.ts                 HTTP server, Socket.IO, startup
  routes.ts                Engagements, cards, runs, risks, overview, audit
  routes-config.ts         Settings, providers, agents, engagement settings
  routes-auth.ts, auth.ts  Sign-in, sessions, people, roles, permission rules
  routes-grc.ts            Library, SoA, controls, inventory, tests, evidence, issues, traceability, evals, assessment, report, kill switch
  library.ts               Built-in control library, obligations, eval templates, offline demo chatbot
  exit-criteria.ts         Gate exit checks per stage
  engine.ts                Gate engine: picks up cards, runs agents, fallback, spend cap
  llm.ts                   One structured-output call for Anthropic, OpenAI-compatible and Ollama
  providers.ts             Provider storage, key resolution, model discovery
  crypto.ts                AES-256-GCM key encryption
  agents/                  Risk Classifier, Control Designer, their rules (prompts/), pricing
  schema.sql, seed.ts      Tables and the Client Zero demo
apps/web/src               Vue 3 + Vite + Pinia; GoldenEye design tokens in styles.css
data/                      PGlite database, secret.key and evidence/ files named by hash (gitignored)
scripts/smoke.mjs          API smoke test
```

### API

| Area | Endpoints |
| --- | --- |
| Board | `GET /api/engagements`, `GET /api/engagements/:id/board`, `POST /api/engagements/:id/cards`, `GET /api/cards/:key`, `POST /api/cards/:id/actions` (`approve`, `request_changes`, `retry`, `advance`, `reject`) |
| Runs, risks, audit | `GET /api/runs`, `GET /api/runs/:id`, `GET /api/engagements/:id/risks`, `PATCH /api/risks/:id`, `GET /api/engagements/:id/overview`, `GET /api/audit` |
| Settings | `GET /api/settings`, `PUT /api/settings`, `PATCH /api/engagements/:id` |
| Providers | `GET /api/providers`, `POST /api/providers`, `PATCH /api/providers/:id`, `DELETE /api/providers/:id`, `POST /api/providers/:id/test`, `POST /api/providers/test` |
| Agents | `GET /api/engagements/:id/agents`, `PATCH /api/agents/:id` |
| Auth and people | `GET /api/auth/state`, `POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/password`, `GET/POST /api/users`, `PATCH /api/users/:id` |
| Controls | `GET /api/library`, `POST /api/library`, `GET /api/obligations`, `GET /api/engagements/:id/soa`, `PUT /api/engagements/:id/soa/:libraryId`, `GET/POST /api/engagements/:id/controls`, `PATCH /api/controls/:id`, `GET /api/engagements/:id/traceability` |
| Inventory | `GET/POST /api/engagements/:id/inventory`, `PATCH /api/inventory/:id` |
| Testing and evidence | `GET/POST /api/engagements/:id/tests`, `PATCH /api/tests/:id`, `POST /api/tests/:id/review`, `GET /api/engagements/:id/evidence`, `POST /api/evidence`, `GET /api/evidence/:id/verify`, `GET /api/evidence/:id/download` |
| Issues | `GET/POST /api/engagements/:id/issues`, `PATCH /api/issues/:id` |
| Evals | `GET/POST /api/engagements/:id/evals`, `GET /api/evals/:id`, `POST /api/evals/:id/cases`, `DELETE /api/eval-cases/:id`, `POST /api/evals/:id/run`, `GET /api/eval-runs/:id`, `POST /api/eval-runs/:id/issues` |
| Assessment and report | `GET /api/engagements/:id/assessment`, `PUT /api/engagements/:id/assessment/:area`, `GET /api/engagements/:id/report`, `POST /api/engagements/:id/report/sign` |
| Agents and audit | `POST /api/agents/:id/kill` (`{ test: true }` to test), `GET /api/audit/verify` |
| Health | `GET /api/health` |

Realtime events: `card`, `run`, `run:event`, `risk`, `audit`, `usage`, `engagement`, `issue`, `eval`. The socket needs a signed-in session.

## Next to build

1. **Evidence Collector** agent with read-only connectors (document stores, ticketing), filing hashed evidence against controls.
2. **Control Tester** agent that drafts test results for a person to review; it can flag failures but never conclude a pass alone.
3. **Report Writer** agent that drafts the board narrative from the signed-off assessment.
4. **Monitoring**: scheduled eval runs with drift alerts, and incident records with regulator notification timelines.
5. **Multiple engagements** in the switcher, with per-engagement membership.
6. **SSO** (OIDC) alongside passwords, and MFA for admins.

## Before you put it on a server

- Put it behind HTTPS (and set `COOKIE_SECURE=true` so the session cookie is only sent over HTTPS). Set `SECRET_KEY` from a secrets manager rather than relying on `data/secret.key`.
- Back up `data/` (database, evidence files and the key) together. Evidence files are named by their hash, so a restored file that doesn't match fails verification.
- There's no rate limit on sign-in yet; put the app behind a proxy that has one, or add it before exposing it to the internet.
