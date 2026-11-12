# Changelog

What changed in each release of ARGUS, newest first. The version shown under Sign Out comes from package.json. Start a new release with `npm run release -- X.Y.Z`.

## v1.7.4 (2026-11-11)

Frameworks fully accounted for, clearer sources, and client steps that fit how each team works.

- **Every Requirement** (Controls). The complete requirement list for each framework, by its official number with ARGUS's own short titles: all 72 NIST AI RMF subcategories; ISO/IEC 42001 clauses 4 to 10 and all 38 Annex A controls; the 33 EU AI Act articles that place duties on organisations; the Jamaica DPA's eight standards and five other duties; the 22 NIST CSF 2.0 categories; the 17 COSO principles; the OWASP LLM and Agentic Top 10s; the FDA GMLP principles and change control plan; and the HIPAA Security, Privacy and Breach rules with the HHS decision support rule. Each requirement is proven, in progress, a gap or not applicable (with a reason, audited). A framework shows as **fully met** only when every requirement is proven or not applicable. Map any control to a requirement to close a gap. Across Frameworks now counts against the complete lists, and Standards says its cards are the key requirements only.
- **Sources say what they are.** On a draft, **Based on** lists each source as what it is (framework requirement, library control, ARGUS method, client document) with the frameworks it draws on, not just a K-number. The Verifier says "Backed by what it cites" and what to do, quotes the passage, and no longer shows word stems. The model line says "the built-in rules (no AI model)" instead of rules-v1.
- **Follow no client workflow.** A use case's **Follows** list has **No client workflow**, which shrinks Client steps to one line. **Settings > General > Client steps on use cases** sets the engagement default.
- **Quieter client steps.** Only steps with a proof are tracked and counted; the rest are context. **Confirm** is offered only on "A person confirms it" steps (the server refuses the others).
- **Scheduled checks.** Steps checked through a daily or weekly connector are checked on that schedule.
- **Require client steps before sign-off** (per workflow, versioned with each publish): an exit criterion on sign-off. A person still signs off.
- **Client tools and workflows is a module** (it replaces Evidence connectors). Off for new engagements unless a workflow or tools are picked when adding one. Hides Client workflows, Connected tools, From Client Tools and Client steps; nothing is deleted.
- **Demo data:** Northshore has a published workflow with proof (two steps confirmed on AI-1), a pipeline push, a write-back target (off), two of its own controls (one mapped) and three EU AI Act articles scoped out; Palmcrest has HIPAA and FDA GMLP.
- **Edit and delete your assistant chats.** In the conversation list, rename or delete a conversation (deleting removes its messages; the audit log keeps its own record of each question asked). Edit one of your questions: sending replaces it and every answer after it, audited.
- **`npm run demo:topup`** adds these demo pieces to a site whose demo was built before v1.7.3 (the live site), without changing or removing anything; safe to run again.
- New checks in `npm run test:v174` (35) and in `npm run test:agents` (sign-off blocked by a client step).


## v1.7.3 (2026-11-11)

Client workflows that do something, write-back, evidence from pipelines, healthcare frameworks and one control for many frameworks.

- **Client steps on each use case.** A step in a client workflow can say what proves it was done: a record that mentions the use case key, a record with a given status ("Approved"), every record done, or a person confirming with a link. Each use case follows the latest published workflow (or one picked for it) and shows its **Client steps** in the side panel. **Check now** reads the step's connector, finds the tickets, requests or rows that mention the key (AI-3, never AI-30), and marks the step done, waiting or not done. A passed check files what proved it as fingerprinted evidence, once. Checks never move the use case: the people at the governance gates still decide.
- **Write-back** (Settings > Connected tools, off by default per engagement). ARGUS can post to a Teams or Slack channel, create a Jira ticket or ServiceNow record, or post to a webhook, when a use case is waiting for a person, an agent asks a question, a test fails, an issue or incident is raised, a client step check fails or a use case is signed off. It only sends new messages and creates new tickets; it never edits, closes or deletes anything. Events come from the audit log after the change is saved, so no agent can send. Every send is audited with a fingerprint of what was sent. An issue sent to Jira or ServiceNow remembers its ticket. Channel webhook addresses are kept secret like credentials.
- **Pipelines push evidence** (Settings > Connected tools > Pipelines). A lead creates an ingest token (shown once, stored as a hash); a CI/CD job (GitHub Actions, GitLab CI, Bitbucket Pipelines, Azure DevOps, anything with curl) posts evaluation results, fairness metrics, drift reports, test reports, model cards or an SBOM to `POST /api/ingest/evidence`. Each push is fingerprinted evidence for a control and a use case, recorded as the pipeline. A token can only add evidence to its own engagement. Examples for each CI system are on the page.
- **More places to read from:** AWS S3 (reads signed with AWS Signature Version 4), Azure Blob Storage (a read-only SAS token, kept encrypted and never shown in the address), GitHub, GitLab and Bitbucket, alongside SharePoint, OneDrive, Google Drive, Jira, ServiceNow and Confluence.
- **Healthcare frameworks:** FDA Good Machine Learning Practice (the 10 principles and change control plans) and HIPAA with the HHS rule on patient care decision support. Six new library controls (HLT-01 to HLT-06), existing controls gain GMLP and HIPAA references, 14 obligations, plain-English summaries on Standards, and a HIPAA breach notice clock (60 days). The healthcare obligations show only on engagements that choose those frameworks; picking the Healthcare sector suggests HIPAA.
- **Across Frameworks** (Controls). Map a control once and it counts for every framework: each framework's coverage, which references each control meets, and a suggested library match for the client's own uploaded controls. Accepting a match gives the control every framework reference of the library control at once, audited.
- New checks in `npm run test:v173` (58).


## v1.7.2 (2026-11-09)

Connectors and client workflows where people expect them.

- **Connected tools** (Settings > Engagement Settings, was Integrations, now always shown): tick the business tools the client uses, then add, edit, pull or remove the read-only connectors that read them. The client's tools are listed first in workflow steps and in the connector form.
- **Add a connector without leaving the builder.** On a workflow step, **Add a read-only connector for <tool>** opens the connector form in place, with the tool picked; the new connector is linked to that step. The Business tools panel does the same. No new tab.
- **Tests and Evidence > From Client Tools** (was Connectors) is now a read-only view with Pull now; adding and changing connectors moved to Connected tools.
- **New wizard step, "How does the client work?"** (Add engagement, step 4 of 6, optional): start a draft client workflow from a template (Standard, Microsoft 365, ServiceNow and Jira, Google Workspace and Slack, Gates only) or decide later, and tick the tools the client uses. Nothing connects and no credentials are asked for; connect tools later in Connected tools.
- The engagement Settings tab **Workflow** is now **Approval gates**, so it isn't confused with client workflows. Old links still work.
- Engagements keep a `clientTools` list (unknown tool ids are dropped). New checks in `npm run test:v17` (46 in all).

## v1.7.1 (2026-11-09)

Client workflows in the client's own business tools.

- **Each workflow step can say which tool it happens in**: Microsoft 365 (SharePoint, OneDrive, Teams, Outlook, Excel, Planner, Power Automate, Power BI), ServiceNow, Jira, Confluence, Google Drive, Google Sheets, Gmail, Slack, a GRC platform, Tableau, DocuSign, or another tool, and where in it ("Model Risk channel", "Control testing workbook"). Steps show the tool on the canvas.
- **ARGUS can read those tools, never change them.** A step can link to a read-only connector that pulls the document, spreadsheet, ticket list or message history in as fingerprinted evidence. Tools ARGUS doesn't read (Power Automate, Gmail, Tableau) are mapped only.
- **Business tools panel** (new icon in the builder rail): each tool the workflow uses, its steps, and whether a connector reads it and how the last pull went, with a link to set one up.
- **New templates**: Microsoft 365, ServiceNow and Jira, Google Workspace and Slack. Each is the standard workflow with its steps placed in those tools.
- **Connectors know the tools.** Pick a tool and ARGUS fills in its usual read address and sign-in and says what to set up on the client's side. New sign-ins: a Microsoft Entra app (tenant, client ID, client secret) for Microsoft 365 and Power BI, and a Google service account key for Drive and Sheets. ARGUS gets a short-lived token from Microsoft or Google; that token request is the only POST a connector makes, and it goes to the identity service, not the client's data.
- A connector following a redirect to another site (Microsoft 365 file downloads) no longer passes the credential on.
- A step naming a tool that isn't in the list, or a connector that has since been removed, blocks a publish.
- New checks in `npm run test:v17` (41 in all), with a mock Microsoft and Google sign-in.


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
