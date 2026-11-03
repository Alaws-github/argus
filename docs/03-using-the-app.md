# Using the app

A tour of every page. The top bar shows the engagement switcher (left), the main pages, **+ Add use case**, and your account menu (your initials, right).

## Signing in

The first time the app opens, it asks someone to create the **first admin** account. After that, everyone signs in with their email and password. Sessions end after 12 hours without use, or 7 days after signing in.

## The account menu

Click your initials:

![The account menu](images/account-menu.png)

- **Your account**: change your display name and password; see where you're signed in and sign out of any of them.
- **People and roles** (admins): add people, change roles, reset passwords, disable accounts.
- **Audit log**: every action, searchable.
- **Theme**: System, Light or Dark.
- **Desktop notifications**: a browser notification when a use case needs your approval and the app is in the background.
- **Sign out**.

## The engagement switcher

![Switching engagements](images/engagement-switcher.png)

Pick the engagement you want to work on. Leads and admins also see **+ Add engagement** (see the [runbook](runbooks/new-engagement.md)). Archived engagements are listed separately and are read-only.

## Overview

The engagement at a glance: how many use cases are classified, open high risks, what needs you, AI spend this month, recent agent runs.

## Board

One column per stage, one card per use case. Filters show what needs you, what's running and high-risk cases. Click a card to open its panel, which shows the decision it's waiting for:

![A classification draft, item by item](images/ai-draft-classification.png)

Each item of an AI draft has its reasons, its sources and Accept, Edit and Reject buttons. See [The AI agents](04-ai-agents.md#drafts-you-decide-on-item-by-item).

## Risks

The risk register with heat maps (inherent and residual), the risk appetite, and each risk's owner, treatment, residual score and acceptance. Download it as CSV.

## Standards and controls (Controls in the top bar)

The chain from a requirement to proof has five links: a **standard** asks for something, a **library control** is a reusable way to meet it, **our control** is that control in place for a use case with an owner, a **test** checks it worked on a sample, and **evidence** proves it. The page has five tabs:

- **Standards**: start here. One card per framework (EU AI Act, ISO/IEC 42001, NIST AI RMF, Jamaica DPA, OWASP LLM Top 10) saying in plain English what it is and why it matters, with a coverage bar: how many of its requirements are **Proven** (a control in place, tested, passing and evidenced), **In progress**, a **Gap** (no control yet) or **Not applicable**. Open a card to see each requirement and the next step to close it.
- **Our controls**: the controls in place for each use case, their owner, status, tests, evidence and open issues.
- **Control library**: 31 reusable controls, each mapped to the standards it helps meet.
- **What applies**: the Statement of Applicability. For each library control, whether it applies to this engagement and why.
- **Traceability**: the detailed matrix from each obligation to the evidence that it's met.

![Standards in plain English](images/standards.png)

![Statement of Applicability](images/statement-of-applicability.png)

![Traceability matrix](images/traceability.png)

## Testing

**Tests**: each control's tests, with procedure, population, sample size, expected and actual results, exceptions, preparer and reviewer. Open a test to record the result, attach evidence, review it or raise an issue.

![A reviewed test](images/test-reviewed.png)

When the Control Tester agent has run, a test shows its draft. The preparer can start from it, but still decides the result.

![An agent's draft on a test](images/test-draft.png)

**Evidence vault**: every file, link and note collected, with its SHA-256 fingerprint. **Verify** recomputes the fingerprint to show the evidence hasn't changed since it was collected.

![Evidence vault](images/evidence-vault.png)

## Issues

Every finding, with severity, owner, due date, overdue flag and status. Open one to add a management response or move it on.

![Issues](images/issues.png)

## Evals

Evaluation and red-team suites test the client's AI systems directly. A quality suite checks answers; a red-team suite tries attacks from the OWASP Top 10 for LLM applications (prompt injection, data leakage, unauthorised actions). Each run is stored as evidence, and failed cases can be raised as issues in one click.

![A red-team run](images/red-team-run.png)

The harness includes a deliberately imperfect demo chatbot, so you can try this without an API key.

## Inventory

Every AI system, model, agent, dataset and vendor tool in scope, each with an owner. AI agents get an eight-point readiness check before they're allowed to act on their own: a named owner, their own identity, a written mandate, limits, an approval threshold, a step limit, a kill switch tested in the last 90 days, and an independent review in the last 90 days.

![AI inventory and agent register](images/inventory.png)

## Report

Score the seven assessment areas, then read, print, download (Markdown) and sign off the readiness report.

![Readiness report](images/readiness-report.png)

## Knowledge base (More)

Everything the agents ground their drafts in: framework summaries, the control library, method guidance, and this engagement's own material. **Search as an agent would** shows which passages an agent would be given for a question. **Add a client document** uploads the client's policies and procedures (text, Markdown or CSV; paste the text of a PDF or Word file).

## The assistant (Ask)

**Ask** in the top bar opens the assistant about the page you're on (a register, or the engagement as a whole). **Ask about this** on a use case opens it about that use case and its draft. It answers in plain English from the record and the knowledge base, shows the passages it used, and may suggest changes: a decision on a draft item, a change to a risk or control, a new issue, or sending a draft back to its agent.

A suggestion changes nothing until you click **Apply**. Applying runs it under your own name and role, exactly as if you had made the change by hand: a preparer can't apply a decision only a reviewer may make, and the change gets its normal audit entry plus a note that the assistant proposed it. **Discard** sets it aside. The assistant can never approve a stage, sign off, conclude a test, accept a risk or close an issue. Anything it gets wrong (a passage it wasn't given, a record it wasn't shown) is removed and listed under "things the harness removed".

Each person has their own conversation per use case or page. With no model chosen, the offline assistant reports what the harness can check by itself. Choose its model on the Models page.

![The assistant on a use case](images/assistant-card.png)

## Incidents (Issues > Incidents)

When a live AI system causes harm, leaks data or fails: what happened, when you became aware, who must be told and by when (EU AI Act and Jamaica DPA deadlines are worked out for you), a timeline, corrective actions (raised as issues), the root cause and lessons. Closing needs a reviewer or lead who didn't report it, every notice sent and every corrective action closed. See [Report and close an incident](runbooks/report-an-incident.md).

![An incident](images/walkthrough/24-incident-detail.png)

## Monitoring (on the Evals page)

Each evaluation suite can run by itself daily or weekly. Every run is checked against its threshold and against the average of its last three runs, and a drop raises an alert at the top of the Evals page. Someone acknowledges each alert with a note, or turns it into an issue. See [Set up monitoring](runbooks/set-up-monitoring.md).

![Monitoring alerts and a trend line](images/walkthrough/25-monitoring.png)

## Evidence: files and connectors (Testing)

Evidence can be a note, a link or a file. PDFs with text, Excel (.xlsx), Word (.docx) and text files are read when collected, so agents and search can use them; the vault says what was read. Scanned PDFs need a note. **Connectors** pull a report or export from a client system over HTTPS, read-only, on request or on a schedule, and file each new version as fingerprinted evidence against a control. See [Connect a client system](runbooks/connect-a-client-system.md).

## Who can see an engagement (Settings > General)

An engagement is open to everyone signed in, or **members only**: then only its members and admins can see it, its records, audit entries and live updates. See [Make an engagement members-only](runbooks/restrict-an-engagement.md).

## Single sign-on (People and roles)

Admins can let people sign in through an identity provider (OpenID Connect). It signs in people who already have an account, matched by email. See [Set up single sign-on](runbooks/set-up-single-sign-on.md).

## Agent testing (More)

Tests for the AI agents themselves. **Golden dataset** runs an agent over use cases with known right answers and shows what it got right, what it got wrong, and any regressions since the last run. **Verifier** sets which model checks drafts and whether it checks every new draft automatically, and shows how far the Verifier agrees with people's judgement. **History** lists every run and measurement. Admins run tests; everyone can see the results. See [Test the agents](runbooks/test-the-agents.md).

On a use case's classification or control design, the Verifier's line sits above the items, with **Check with the Verifier** to ask for a check. Each item then shows its verdict and the quote it rests on.

![Agent testing: measuring the Verifier](images/verifier-trust.png)

## More: Runs, Settings, Models

- **Runs**: every agent run, with the model used, cost and a step-by-step log.
- **Settings**: General (details, pause, archive or delete), Workflow & gates, Agents (model, limits, instructions, kill switch).
- **Models**: the AI providers, their keys (stored encrypted, shown masked), models, prices, the monthly spending limit, and the embedding model for meaning search.

![Agent settings](images/settings-agents.png)
