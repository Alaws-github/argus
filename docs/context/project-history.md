# Project history and context

Background an agent needs before working on ARGUS: who it is for, what it has to show, how the owner works, what was decided and why, and where things stand. Product rules are in [`CLAUDE.md`](../../CLAUDE.md), working practice in [`AGENTS.md`](../../AGENTS.md) and pitfalls in [`LESSONS.md`](../LESSONS.md). Update this file when a release ships or a decision changes.

## Who and why

- **Owner:** Andrew Lawrence, a QA engineer at a consulting firm in Jamaica, who leads QA across several client engagements. He holds ISTQB Foundation, CT-AI and CT-GenAI.
- **Purpose:** ARGUS is his showcase for a Governance, Risk & Assurance Lead role at an accounting and advisory firm. It has to show that AI can do real governance work under human control, in a way a non-technical partner can follow in a demo.
- **Origin:** rebuilt from GoldenEye, his own AI delivery harness (board, gates, Models page, settings, account menu and look). GoldenEye is a reference only and must never be changed.
- **Audience for the app:** assurance teams (leads, reviewers, preparers, viewers) running client engagements, and the partners and boards who read the results.

## How the owner works

- Windows PC, VS Code, PowerShell. Working copy in `Documents\Governance and Risk - AI\governance-harness`. Node 22 is the target (he has had newer versions installed).
- Git with a release branch per version (`release/vX.Y`), merged to `main` and tagged. Remote on GitHub (`Alaws-github/argus`), pushed with his own sign-in.
- Cloud sessions deliver into his folder; he commits. The folder doesn't allow deletes from a session.
- He watches usage: keep changes proportionate, and explain before doing big rebuilds.
- He wants plain English, Title Case on menus and main options, and explanations rather than jargon. When he asks for an explanation, he wants the explanation, not a new feature.

## What has been decided, and why

| Decision | Why |
| --- | --- |
| Agents draft, named people decide; every change is in a hash-chained audit log | The core claim of the product: AI does the work, people stay accountable, and the record proves it |
| QA framing (preparer and reviewer, defect-style issues, evals as test suites) | The owner's background and the angle he pitches |
| Five steps shown, eight stages underneath | Simpler for a partner to follow; the engine and checks stay precise |
| Grounding: agents cite knowledge-base passages by K-number; the Verifier checks them | So any drafted claim can be traced and challenged |
| Modules per engagement, off by default, hide only | A small engagement looks simple; turning a module off never loses data |
| Name ARGUS, pheasant logo | The owner's choice: the Argus pheasant's "hundred eyes" fit assurance |
| Controls and Knowledge Base as top-level menus; icons on every menu item | They are central to the work and users must fill the knowledge base in |
| Dark mode by default | The owner's preference for the demo |
| Demo data from one scenario file per client; saved copies to switch between | Realistic, non-generic demos that can be rebuilt and switched in seconds |
| Hosting on Cloudflare (Worker + one Container), Neon Postgres, R2 for evidence | The owner chose option B to share a live site; the container's disk is temporary so state lives outside it |
| Assistant sees the page, keeps conversations per person, uses the workspace default model if none is picked | It has to answer "what's on this page?" and feel like a real assistant (v1.4) |
| Lessons file and AGENTS.md | So every agent session starts with the project's context and doesn't repeat a mistake (v1.4) |

## Versions

| Version | What it added |
| --- | --- |
| v0.3 | The assurance layer: roles and segregation of duties, control library mapped to standards, Statement of Applicability, traceability, tests, evidence, issues, evals |
| v0.4, v0.4.1 | Add engagements from the switcher, GoldenEye-style account menu, archive and restore |
| v0.5, v0.5.1 | The four drafting agents with guardrails; plain-language docs, runbooks and screenshots |
| v0.6 | Knowledge base and grounding, temperature 0, item-by-item decisions on drafts |
| v0.7 | The Verifier (LLM-as-a-judge) and agent testing on a golden dataset |
| v0.8 | The assistant: explains and suggests, applies only under the person's own permissions |
| v0.9 | Realistic demo data, walkthrough and demo scripts |
| v1.0 | PDF, Excel and Word evidence, incidents, scheduled monitoring and drift, connectors, members-only engagements, SSO scaffold, full manual |
| v1.1 | Use Case Planner, drag and drop, more agents per stage with routing, Act As, engagement and workspace settings, Overview charts |
| v1.2 | Renamed ARGUS with the logo, five steps, AI as one menu, modules, responsive layout, five demo engagements from scenario files, versions script |
| v1.2.1 | All demo clients in one switchable demo, plus a saved copy per client |
| v1.2.2 | Controls and Knowledge Base menus, icons, Title Case, upload controls (CSV or Excel), the manual's "Start Here" path |
| v1.3 | Cloudflare hosting: Dockerfile, Worker and Container, Neon and R2, demo loading against a live site |
| v1.4 | Assistant: page awareness, conversation history with search and new conversations, workspace-default model, "Ask" label. AGENTS.md, lessons and this file. Dark mode default restored. Reset refuses a hosted database |

## Environments

- **Local:** `npm run dev` (web 5173, API 4300), PGlite in `data/pglite`, evidence in `data/evidence`, key in `data/secret.key`. Saved demo copies in `demos/` (`demo:build`, `demo:load`, `demo:save`).
- **Live:** Cloudflare Worker `argus` on workers.dev, deployed from `deploy/cloudflare` with `npm run deploy` (needs Docker Desktop). Database on Neon, evidence in the R2 bucket `argus-evidence`, secrets set with `wrangler secret put`. Runbook: `docs/runbooks/deploy-to-cloudflare.md`.

## Open threads

- Not built yet: OCR for scanned evidence; the Planner reading the knowledge base; SAML, MFA; OAuth connectors; sign-in rate limiting; Verifier coverage of the four drafting agents; streamed assistant answers.
- The owner asked for a plain explanation of the AI Testing and Monitoring and Checking the AI pages (given in chat in the v1.4 session). If those pages are reworked, make what they do obvious on the page itself.
