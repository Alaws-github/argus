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
| The AI must not be rigid: every agent gets the engagement's context, recovers from provider and format problems, and asks or suggests when input is unclear | ARGUS depends on AI; the owner found the Planner couldn't tell a test message from an answer (v1.5) |
| UI and UX are first-class; every change updates CHANGELOG, manual, CLAUDE.md and lessons | The owner judges ARGUS by its look and feel, and wants records kept in step (v1.4.1) |
| Agents reason: they look things up with read-only tools, can ask a person, and check their own work; limit what they decide, never what they may find out | The owner needed analysts, not single-shot form fillers, and corrected the earlier design (v1.6, lesson `agents-must-reason`) |
| Live site keeps ARGUS's own summaries of ISO/IEC 42001; the owner verifies them against his licensed copy | Licence terms; full ISO text never goes into code or the live site |
| v1.7 is the last two-part version; after it, 1.7.1, 1.7.2 and so on. v1.7 brings the dashboard look to every page and a governance workflow builder (client workflows as nodes, mandatory governance steps that can't be removed, versioned and audited) | The owner's numbering and design direction, given with the v1.6 go-ahead |
| The assistant should feel like a modern dashboard assistant: steps visible while it works, then folded away; links to pages; @ to tag records. No word-by-word streaming | The owner compared it with a cloud provider's Ask AI and chose these, leaving out streaming (v1.7) |
| Client workflows are option B: the client's process as nodes around ARGUS's gates, which can't be removed; versioned and audited; an icon rail only inside the builder; the top menu stays | The owner's design direction for integrating client workflows (v1.7) |
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
| v1.7.1 | Client workflows in business tools: each step names its tool (Microsoft 365, ServiceNow, Jira, Google Workspace, Slack, GRC, data and signing tools), tool templates, a Business tools panel; connectors read those tools with Entra app and Google service account sign-in; read-only, never written to (the owner's choice) |
| v1.7.2 | Structure: connectors managed in Settings > Connected tools beside the tools the client uses, added in place from a workflow step, a read-only From Client Tools view in Tests and Evidence, an optional "How does the client work?" wizard step that drafts a workflow without credentials, Settings > Workflow renamed Approval gates. The owner agreed the restructure after asking why connectors sat under Tests and Evidence |
| v1.7.3 | The owner asked what client workflows were for; the answer was to make them check the client's own paper trail. Client steps get a proof checked per use case through connectors; write-back allowed by the owner (opt-in, create-only, from the audit log, never by agents); evidence pushed from CI/CD with ingest tokens and S3, Azure Blob, GitHub, GitLab and Bitbucket reads; FDA GMLP and HIPAA; Across Frameworks. The owner said not to build anything else from the improvement review backlog (`docs/plans/improvement-review-backlog.md`) unless asked |
| v1.7.4 | The owner asked how to know each framework is fully accounted for, and wants frameworks fully met: complete requirement lists per framework and Every Requirement (fully met only when each is proven or not applicable with a reason). The owner found the sources ("K-55") and Verifier text vague: sources now say what they are and what frameworks they draw on. Also the recommended client step changes: follow no workflow and an engagement default, tracked-only steps, scheduled checks, an optional sign-off requirement, and a module for client tools and workflows |
| v1.7.6 | Phase 3 of the code standards work, after the owner saw the usage of phases 1 and 2: code organised by feature on server, web and shared; the big route files split; copied helpers moved to `core/`; the engine's `runCard` and engagement creation split into named steps. Comments on every export and generated API docs (phase 4) are still to come |
| v1.7.5 | The owner wanted code a developer can follow, since most of it was written by AI, and asked for the effort before starting. Agreed in phases: phases 1 and 2 (standards from the maintainers' guides, ESLint, Prettier, a pre-commit hook, all code formatted and lint errors fixed) first, to see the usage; a restructure by feature, comments on every export and generated API docs are later phases |
| v1.7 | Dashboard look (KPI tiles on every working page, pill tabs, softer cards); client workflows (builder around the locked governance gates, versions, audit); assistant works in the open (live steps, Worked Ns, links, @ tags, ratings, actionable errors) after reviewing a hosted cloud provider's dashboard assistant; agents' live steps on the use case. Last two-part version |
| v1.6 | Agents that reason: the agent loop with read-only tools, questions for a person (Question for You), self-check, per-agent mode, step limit and tools; assistant look-ups with "Based on" and "How I got here"; Planner look-ups; heading-aware chunks, per-document cap, Retrieval tab; golden runs by mode; rules 23 to 27 |
| v1.5 | AI that bends: retries, cut-off answers retried, one repair attempt for format slips, offline-rules fallback; Planner with engagement, board and knowledge-base context, unclear input and suggestions; assistant workspace instructions; drafting agents read client documents; golden runs with an engagement's context; broader refusal check |
| v1.4.1 | Assistant redesigned as a chat panel with formatted answers; initials on board cards; GoldenEye-style board filters; light blue active menu; version under Sign Out with `npm run release` and CHANGELOG.md; Save buttons disabled until a change; manual v1.2.3 for the live site |
| v1.4 | Assistant: page awareness, conversation history with search and new conversations, workspace-default model, "Ask" label. AGENTS.md, lessons and this file. Dark mode default restored. Reset refuses a hosted database |

## Environments

- **Local:** `npm run dev` (web 5173, API 4300), PGlite in `data/pglite`, evidence in `data/evidence`, key in `data/secret.key`. Saved demo copies in `demos/` (`demo:build`, `demo:load`, `demo:save`).
- **Live:** Cloudflare Worker `argus` on workers.dev, deployed from `deploy/cloudflare` with `npm run deploy` (needs Docker Desktop). Database on Neon, evidence in the R2 bucket `argus-evidence`, secrets set with `wrangler secret put`. Runbook: `docs/runbooks/deploy-to-cloudflare.md`.

## Open threads

- Next (1.7.x): running published client workflows on the board; the owner tests v1.7 first.
- Later (1.7.x): ISO/IEC 42001 summaries for the owner to verify; fuller public frameworks (EU AI Act, NIST AI RMF, OWASP, Jamaica DPA); a workspace-wide knowledge library; a private-source setting; the Planner naming the draft from the brief's title.
- Not built yet: OCR for scanned evidence; a reranker and HNSW index for meaning search; SAML, MFA; OAuth connectors; sign-in rate limiting; Verifier coverage of the four drafting agents; streamed assistant answers.
- The owner asked for a plain explanation of the AI Testing and Monitoring and Checking the AI pages (given in chat in the v1.4 session). If those pages are reworked, make what they do obvious on the page itself.
