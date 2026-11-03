# Governance Harness

> **New here, or not technical?** Start with the plain-language docs in [docs/](docs/README.md): what it is, how it works, a tour with screenshots, and step-by-step runbooks. This README is the developer reference. Context for Claude is in [CLAUDE.md](CLAUDE.md).

An AI governance, risk and assurance workbench. AI use cases move across a board from Intake to Board report. Agents draft the work at each stage; a named person approves at each gate; every action lands in a hash-chained audit trail.

v0.6 grounds the agents in a knowledge base (keyword and meaning search, cited sources checked by the server), runs drafting at temperature 0, and lets reviewers accept, edit or reject each item of a draft. See docs/04-ai-agents.md.

v0.5 built the four remaining agents (Evidence Collector, Control Tester, Review assistant, Report Writer) as drafting agents with guardrails; see **Drafting agents** below.

v0.4 added engagements you can add from the switcher (a five-step wizard modelled on GoldenEye's Add project), a GoldenEye-style account menu (Your account, People and roles, Audit log, theme, desktop notifications), a Your account page, and an audit log you can filter by person, action, address and date.

v0.3 added the assurance layer: sign-in with roles and segregation of duties, a control library mapped to public standards, a Statement of Applicability, a requirements traceability matrix, control testing with a reviewer sign-off, a hashed evidence vault, issues handled like defects, evaluation and red-team suites, an AI inventory with an agent register, residual risk against appetite, and a readiness report scored on a maturity scale.

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
| `npm run db:reset` | **Stop the app first.** Deletes every account and record and reseeds Client Zero; the next visit asks you to create the first admin. Also recovers a damaged embedded database. Keeps `data/secret.key` |
| `npm run build` then `npm start` | Builds the web app and serves it from the API on port 4300 |
| `npm run typecheck` | Type-checks server and web |
| `npm run smoke` | API smoke test (66 checks) against a running server on a **fresh** database. It creates test accounts (password `correct-horse-9`), so reset afterwards before real use |
| `npm run test:grounding` | Grounding tests (31 checks): knowledge base, citations, item-by-item decisions, meaning search, temperature 0. Fresh database |
| `npm run test:agents` | Drafting-agent tests (30 checks), including a mock model that tries to cheat the guardrails. Also needs a fresh database |

To use a real Postgres instead of PGlite, set `DATABASE_URL` in `.env`.

## Adding a client or project

Open the engagement switcher next to the logo and choose **+ Add engagement** (admins and leads). The wizard has five steps:

1. **Client**: client, sector, engagement name, card prefix (filled in from the client's initials, must be unique), colour, and what the client does and who regulates them. Agents read that as context.
2. **Scope**: frameworks in scope. The harness shows how many library controls and obligations they bring in, and can start the Statement of Applicability with those marked applicable for you to confirm. Set the risk appetite, and optionally paste use cases, one per line, to land in Intake.
3. **Gates**: where a reviewer or lead signs off. Intake is always gated.
4. **Models**: Claude for every agent, the workspace default, or the built-in rules, then adjust per agent.
5. **Review**: check, then add. You land on the new engagement's board.

### Archiving and deleting

In **Settings > General**, a lead can **archive** an engagement: it becomes read-only (the server refuses every change to it, and agents stop picking up its work), moves to an Archived section of the switcher, and can be **restored** at any time. Nothing is removed. **Download the full record** gives a JSON file of everything in it, including its audit entries.

Once it's archived, an admin can **delete** it permanently by typing its name. That removes its use cases, risks, controls, tests, evidence (and evidence files no other engagement uses), issues, evaluations and runs. The audit log keeps every entry about it, plus who deleted it and counts of what went. The last active engagement can't be archived.

Every page belongs to the engagement chosen in the switcher; the choice is remembered per browser. Settings changes the engagement later.

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
| More › **Runs**, **Settings**, **Models** | Agent runs and their logs; engagement settings, gates, agents (with kill switch and rules version); providers, keys, prices and the spending limit |
| Account menu › **Your account** | Display name, password, where you're signed in, sign out one session or everywhere |
| Account menu › **People and roles** | Admin only: add people, change roles, reset passwords, disable |
| Account menu › **Audit log** | Every action with the address it came from; search and filter by who, what, address and date; pages; CSV; verify the hash chain |
| Account menu › **Theme**, **Desktop notifications** | System, light or dark; a browser notification when a use case needs your approval and the tab is in the background |

## How it works

```
Intake ─▶ Classify risk ─▶ Design controls ─▶ Collect evidence ─▶ Test controls ─▶ Remediate ─▶ Validate ─▶ Board report ─▶ Closed
 (gate)     (gate, agent)      (gate)                                                            (gate)        (gate)
```

- **Cards** are AI use cases. Each has a profile: owner, what it does, data used, people affected, autonomy, vendor.
- **Gates** stop a card until a person signs off. Defaults: Intake (always), Classify, Design, Validate, Report. Change them in Settings > Workflow & gates.
- **Agents** are configured per engagement, one per stage. The **Risk Classifier** and **Control Designer** are built; the others are listed with their planned role and can be set up ahead of time but not switched on.
- **Exit criteria** are checks, not reminders. A failed test also can't leave the Test stage until an issue is raised for it. A card can't leave Design until every risk scoring 12+ has a control, Evidence until every control has evidence, Test until every test has a reviewed result, Remediate until no critical or high issue is open (`exit-criteria.ts`).
- **The engine** (`apps/server/src/engine.ts`) polls every 1.5 seconds and picks up queued cards in stages with an enabled agent. It respects each agent's **runs at once**, each provider's **requests at once** and 4 slots overall. It runs the agent on its provider and model, falls back to the fallback model if the first call fails or the provider is off, records the run and its cost, then stops at the gate or moves the card on.
- **Risk Classifier** (`apps/server/src/agents/risk-classifier.ts`) returns a tier (prohibited, high, limited, minimal), an oversight model, the factors behind the tier, 2 to 6 starting risks, open questions and framework references. Every provider is asked for one structured answer that matches a JSON schema (`apps/server/src/llm.ts`); the server then validates it with Zod, and anything else fails the run.
- **Control Designer** (`agents/control-designer.ts`) picks controls from the library for each approved risk, adds the baseline controls a tier needs, and writes a test approach for each. It may only cite library codes that exist.
- **Approving** a classification writes its risks to the **risk register**; approving a design writes the controls, links them to the risks they treat and creates a draft test for each, all in one transaction. **Request changes** sends your note back to the agent.

### Drafting agents

Four agents draft and never decide. They ship **switched off**: a lead turns each one on per engagement in Settings > Agents.

| Agent | Stage | Drafts | Guardrails |
| --- | --- | --- | --- |
| Evidence Collector | Collect evidence | An evidence request list per control, matched against what's uploaded | Only this use case's control and evidence keys are accepted |
| Control Tester | Test controls | A suggested result on each open test, citing evidence | It never concludes a test or becomes the preparer. A person starts from the draft (recorded in the audit trail), concludes as preparer, and someone else reviews. Drafts proposing a pass with exceptions, a pass without evidence, or citing evidence not attached to that test are rejected. The offline rules never propose a pass |
| Review assistant | Validate | Challenges for the person signing off: thin samples, notes-only evidence, failed tests with no issue, risks above appetite, the same person preparing and reviewing under different names | The rule-based checks always stand; a model can add findings but not remove them or call the pack ready while a high finding is open. It is not a second-line review |
| Report Writer | Board report | A board summary for the use case | Every number must appear in the data it was given, or the draft is rejected. Only a summary a person approved goes in the readiness report |

What applies to all four:

- **They always stop for a person.** Their stages stop after the agent runs, whether or not the stage has a gate, and the exit criteria still apply.
- **The output is checked before anyone sees it.** It must match a schema, and the server checks every key and figure it cites.
- **Client material is treated as data.** Evidence contents are wrapped as data, and instructions inside them are ignored.
- **The agents can't see everything.** They read notes and text files only, not PDFs, spreadsheets or links. When they can't see something, they say so.

### People, roles and segregation of duties

| Role | Can |
| --- | --- |
| Admin | Everything, including people, models and workspace settings |
| Engagement lead | Engagement settings and gates, agents, accept any risk, sign off the report |
| Reviewer | Approve gates, review tests, accept risks within appetite, close issues |
| Preparer | Add use cases, controls, tests, evidence and issues |
| Viewer | Read everything |

Renaming yourself is allowed (Your account), but your old names stay attached to you: you still can't approve work you signed under an earlier name, and nobody else can take that name. A session ends after 12 hours without use or 7 days after sign-in.

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
| Board | `GET /api/engagements`, `POST /api/engagements`, `POST /api/engagements/:id/archive`, `POST /api/engagements/:id/restore`, `GET /api/engagements/:id/export`, `DELETE /api/engagements/:id`, `GET /api/engagements/:id/board`, `POST /api/engagements/:id/cards`, `GET /api/cards/:key`, `POST /api/cards/:id/actions` (`approve`, `request_changes`, `retry`, `advance`, `reject`) |
| Runs, risks, audit | `GET /api/runs`, `GET /api/runs/:id`, `GET /api/engagements/:id/risks`, `PATCH /api/risks/:id`, `GET /api/engagements/:id/overview`, `GET /api/audit` (`q`, `actor`, `action`, `ip`, `from`, `to`, `page`, `pageSize`) |
| Settings | `GET /api/settings`, `PUT /api/settings`, `PATCH /api/engagements/:id` |
| Providers | `GET /api/providers`, `POST /api/providers`, `PATCH /api/providers/:id`, `DELETE /api/providers/:id`, `POST /api/providers/:id/test`, `POST /api/providers/test` |
| Agents | `GET /api/engagements/:id/agents`, `PATCH /api/agents/:id` |
| Auth and people | `PATCH /api/auth/me`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/sessions/end-all`, `GET /api/auth/state`, `POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/password`, `GET/POST /api/users`, `PATCH /api/users/:id` |
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

1. **Connectors for the Evidence Collector**: read-only pulls from a client's document store or ticketing system, with credentials agreed per client.
2. **Reading PDFs and spreadsheets** as evidence.
3. **Monitoring**: scheduled eval runs with drift alerts, and incident records with regulator notification timelines.
4. **Per-engagement membership**: today everyone signed in sees every engagement.
5. **SSO** (OIDC) alongside passwords, and MFA for admins.

## Before you put it on a server

- Put it behind HTTPS (and set `COOKIE_SECURE=true` so the session cookie is only sent over HTTPS). Set `SECRET_KEY` from a secrets manager rather than relying on `data/secret.key`.
- Back up `data/` (database, evidence files and the key) together. Evidence files are named by their hash, so a restored file that doesn't match fails verification.
- Behind a reverse proxy, set `TRUST_PROXY=true` so the audit log records the client's address rather than the proxy's.
- There's no rate limit on sign-in yet; put the app behind a proxy that has one, or add it before exposing it to the internet.
