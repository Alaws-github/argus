# Changelog

What changed in each release of ARGUS, newest first. The version shown under Sign Out comes from package.json. Start a new release with `npm run release -- X.Y.Z`.

## v1.7.0 (2026-11-09)

The dashboard look, client workflows, and an assistant that works in the open. The last two-part version: releases from here are 1.7.1, 1.7.2 and so on.

- **Dashboard look on every page.** Each working page opens with a row of KPI tiles (big numbers, an icon, a line of context, one accent tile), from one new read, `GET /engagements/:id/kpis`: the board, risks, controls, testing, issues, incidents, inventory, evaluations, knowledge base, runs, audit log and report. Tiles link to where the number comes from. Cards are rounder and softer, tabs and segmented choices are pill selectors, and Overview's first tile is the accent tile.
- **Client workflows** (Settings menu > Client Workflows). Draw how a client takes an AI use case from idea to live: triggers, agent steps, person decisions, client steps, conditions, notifications and ends, around ARGUS's five governance gates. A builder with an icon rail (add a step, fit, undo, versions), a canvas (drag steps, drag from a step's dot to draw an arrow, zoom) and an inspector. The gates and the trigger can be moved, never removed; every path must pass every gate in order; after an agent step a person or a gate decides; conditions need labelled ways out. Problems show as you draw and on the step. Drafts save with problems; only a workflow with none can be published. Each publish keeps a numbered version with a note; any version can be viewed or made the draft again; a workflow can be retired. Every change is in the audit log. Leads and admins edit; everyone can view.
- **The assistant works in the open.** While it works you see "Working · N steps" with each look-up and its own reasoning as it happens (sent only to you). When it finishes this folds into "Worked 2.4s · N steps" above the answer, which opens to show the steps. Answers sit in an Agent card with thumbs up, thumbs down (kept and audited, so poor answers can be found) and copy.
- **Links in answers.** The assistant links to ARGUS pages (`[the risk register](/risks)`), and record keys in any answer (AI-3, R-4, C-2, T-1, E-5, I-2, INC-1) become links. A link to a register row (`/risks?focus=R-4`) scrolls to it and highlights it. Links outside ARGUS are shown as plain text. Links open without closing the assistant.
- **Tag a record with @.** Type @ in the question box to pick a use case, risk, control or issue; the assistant gets that record whatever page you're on.
- **Errors you can act on.** A refused key, unknown model, rate limit, empty quota, time-out or unreachable provider says what to do and where ("The provider refused the API key. Check or replace it on Models & Keys."), on the assistant and on failed runs.
- **Agents show their steps on the use case.** While an agent runs, the use case's side panel lists its look-ups live, as the assistant does. The model's own words between look-ups are now recorded in the run log too.
- The answer itself still arrives in one go (no word-by-word streaming), as agreed.
- Fix: the Client Workflows list asked for the workflows before the engagement had loaded on a direct visit.
- Fix: page headings and their buttons wrap on a phone instead of running off the screen (Report).
- New checks: `npm run test:v17` (28).

## v1.6.0 (2026-11-09)

Agents that reason. Plan: `docs/plans/v1.6-agentic-ai.md`.

- **Agents look things up.** The Risk Classifier, Control Designer, Evidence Collector, Control Tester, Review assistant and Report Writer work in steps: they search the knowledge base again with better words, open a use case, find similar use cases and how reviewers decided them, read the registers and evidence, then hand in their draft. Every look-up is written to the run log, and runs show how many steps they took. All tools only read; a tool an agent may not use is refused and logged, and members-only engagements are never searched from another engagement.
- **Agents can ask you.** When something essential is missing, an agent asks a person. The run pauses, the use case shows **Question for You** (blinking, like Needs Your Approval), and the question appears in its side panel with why it is asked and who is best placed to answer. Anyone who can prepare work answers or skips it under their own name; the agent picks the work up again with every answer for that stage. At most two questions per stage; an answer informs the draft and never approves anything. Audited as `agent.asked`, `agent.answered` and `agent.question_skipped`.
- **Agents check their own work.** Before handing in, an agent checks its draft once against a short rubric for its role (`prompts/*.critique.md`) and fixes what it finds. The strict checks (schema, citations, keys, figures) still run on the result.
- **Per-agent settings** (Settings > AI Agents): Agentic or Single call, most steps per run (2 to 20, default 8; the last step must hand in the draft), self-check on or off, and the tools it may use, with plain descriptions. Agents start agentic. The offline rules, and models that don't take tool calls, run as one call.
- **The assistant looks things up too,** and shows what each answer was based on (this page, ARGUS records, the knowledge base), its sources grouped by kind (frameworks, controls, method guidance, client documents) and "How I got here". A question about the page is answered from the page, not the knowledge base, and the engagement summary is no longer shown as a source.
- **The Use Case Planner** can search the knowledge base and look at similar use cases before it replies.
- **Better retrieval (RAG v2).** Uploaded documents are split at their headings (Markdown headings, numbered clauses, "Article 14", headings in capitals); each passage keeps its section ("Model Risk Policy › 2. Human oversight"), a passage cut mid-section starts with the sentence before it, and long paragraphs split between sentences. No more than two passages from one document unless nothing else matches. A document just uploaded is no longer pushed down while it waits to be embedded.
- **Checking the AI > Retrieval** (new tab): 23 questions with the passages a good answer needs, scored as recall at 5 and 10 and MRR, per kind, with keyword search and with meaning search, so embedding models can be compared. `npm run test:rag`.
- **Golden runs** can run agentic or single call on the same model, so you can see whether looking things up is worth its cost.
- The Report Writer may quote a figure from a record it looked up, as well as from the data it was given; any other figure is still a hard failure.
- Fix: Gemini models (OpenAI-compatible endpoint) failed after their first tool call with "missing a thought_signature". ARGUS now sends each tool call's thought signature back, and if a provider still refuses a tool step, the run finishes as a single call instead of failing.
- New governance rules 23 to 27 in CLAUDE.md. New checks: `npm run test:v16` (34) and `npm run test:rag` (8).

## v1.5.0 (2026-11-06)

AI that bends instead of breaking.

- Every model call retries when a provider is busy (rate limits, 5xx), with growing waits that respect Retry-After. A rate-limited key gets a clear message.
- An answer cut off at the output limit is asked again with twice the room, and if it is still cut off the error says so plainly.
- Newer models that refuse `max_tokens` are sent `max_completion_tokens` instead.
- A format slip (a value out of range, a misspelt option, broken JSON) gets one repair attempt: the model sees its answer and the problems and corrects them. The run log says so. Citations it wasn't given and invented figures are still hard failures.
- The offline rules are offered first as an agent's fallback, so a failed model can still leave a cautious draft for a person.
- The Use Case Planner now sees the client, the engagement description, the use cases already on the board and matching knowledge-base passages (the client's documents and new intake guidance), and follows its instructions box. It recognises test or unclear messages, suggests use cases when asked ("recommend one", "give me an example") and fills the brief only once you pick one, and flags likely duplicates. Its replies are formatted.
- The assistant gets the engagement description and an Instructions box on Models & Keys. "Workspace default" replaces "Offline assistant" in its model list.
- The Evidence Collector, Control Tester and Review assistant also search the client's own documents and can cite them.
- Golden runs can use an engagement's description and agent instructions.
- The "refuses" check in AI Testing recognises more ways of refusing.
- The Plan with AI and Fill it in myself switch sits on one line.
- Fix: agents now find documents uploaded to the Knowledge Base. Searches looked only at the engagement summary, so uploaded policies were never used.

## v1.4.1 (2026-11-06)

- The assistant is a chat panel: your messages on the right, answers in cards with proper formatting (no stray asterisks), starters when a conversation is empty, a question box that grows, a wider view, and a thinking indicator.
- Cards on the board show the initials of the person who added or last changed them.
- Board filters look like GoldenEye's: Show, Kind, Priority, Person, Created and Updated, centred beside the title, with counts.
- The page you're on is highlighted light blue in the top menu.
- The version and commit show under Sign Out. `npm run release` sets the version and starts the changelog.
- Manual v1.2.3, written for the live site.

## v1.4

- The assistant sees the page you're on, keeps your conversations (new, search, carry on) and uses the workspace default model when none is picked for it.
- AGENTS.md, lessons and project history for anyone working on ARGUS. Dark mode by default. A reset refuses a hosted database.

## v1.3

- Cloudflare hosting: the server in a Container, Postgres on Neon, evidence in R2. The demo loads against a live site.

## v1.2.2

- Controls and Knowledge Base menus, icons on every menu item, Title Case, Upload Controls (CSV or Excel), the manual's "Start Here" path.

## v1.2.1

- All demo clients in one switchable demo, plus a saved copy per client.

## v1.2

- Renamed ARGUS with the pheasant logo, five steps on the board, AI as one menu, modules, responsive layout, five demo engagements from scenario files, the versions script.

## v1.1

- Use Case Planner, drag and drop, more agents per stage with routing, Act As, engagement and workspace settings, Overview charts.

## v1.0

- PDF, Excel and Word evidence, incidents, scheduled monitoring and drift, connectors, members-only engagements, single sign-on, the full manual.

## v0.3 to v0.9

- v0.9 demo data and scripts; v0.8 the assistant; v0.7 the Verifier and golden dataset; v0.6 knowledge base and grounding; v0.5 the drafting agents; v0.4 engagements and archiving; v0.3 the assurance layer.
