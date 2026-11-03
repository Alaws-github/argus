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

![Reviewing a proposed classification](images/review-classification.png)

![Reviewing proposed controls](images/review-control-design.png)

## Risks

The risk register with heat maps (inherent and residual), the risk appetite, and each risk's owner, treatment, residual score and acceptance. Download it as CSV.

## Controls

Four tabs:

- **Register**: the controls in place for each use case, their owner, status, tests, evidence and open issues.
- **Library**: 31 reusable controls, each mapped to the standards it helps meet.
- **Statement of Applicability**: for each library control, whether it applies to this engagement and why.
- **Traceability**: from each obligation to the evidence that it's met, with gaps marked.

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

## More: Runs, Settings, Models

- **Runs**: every agent run, with the model used, cost and a step-by-step log.
- **Settings**: General (details, pause, archive or delete), Workflow & gates, Agents (model, limits, instructions, kill switch).
- **Models**: the AI providers, their keys (stored encrypted, shown masked), models, prices and the monthly spending limit.

![Agent settings](images/settings-agents.png)
