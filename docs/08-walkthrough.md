# Walkthrough: one engagement, start to finish

This walks through a whole engagement using the demo data, page by page. Read it once with the app open beside you and you will know where everything is and why it is there. For a timed demo, use the [demo scripts](09-demo-script.md).

To load the demo data, see [Load the demo data](runbooks/load-the-demo-data.md). Sign in as **andrew@example.com**.

## The story

**Northshore Financial Group** (fictional) is a regional bank and insurer rolling out AI. Its board wants to know: which AI do we use, what could go wrong, what stops it going wrong, and can we prove it? The assurance team runs this as one engagement, **Client Zero**.

The team:

| Person | Role | What they do in the story |
| --- | --- | --- |
| Andrew Lawrence | Admin | Runs the harness and scores the assessment |
| Jordan Clarke | Lead | Accepts risks above appetite and signs the report |
| Riley Morgan | Reviewer | Decides on AI drafts, reviews tests, closes issues |
| Sam Patel | Preparer | Adds use cases, collects evidence, prepares tests |
| Dana Reid | Viewer | A board member who can read everything and change nothing |

Five AI use cases sit at different stages, so every part of the process has something to show:

| Use case | Where it is | What it shows |
| --- | --- | --- |
| AI-4 Expense receipt categoriser | Intake | A new request, waiting for someone to take it forward |
| AI-3 Board paper summariser | Classify risk | An AI draft waiting for decisions, already checked by the Verifier |
| AI-5 Motor claims triage | Design controls | Proposed controls waiting for decisions |
| AI-1 Loan pre-approval scoring | Validate | Tested; the Review assistant has challenges before sign-off |
| AI-2 Customer service chatbot | Closed | The whole journey: a failed control, an issue being fixed, an approved board summary |

## 1. Overview: where the engagement stands

![Overview](images/walkthrough/01-overview.png)

The first screen a lead or partner looks at. **Classification coverage** is how many use cases have an agreed risk tier. **Open high risks** links to the register. **Needs you** lists the use cases waiting for a person. **This month** is AI spend against the cap. Below are use cases by tier and the flow of work across the eight stages.

What to notice: the harness separates what the AI has drafted from what people have decided. "Needs you" is the second kind.

## 2. Board: every use case and its stage

![Board](images/walkthrough/02-board.png)

Each card is one AI use case, moving left to right through eight stages: Intake, Classify risk, Design controls, Collect evidence, Test controls, Remediate, Validate, Board report. An **AI** line on a card says what the agent proposed and how many items people have decided (for example "AI proposes limited risk · 4 risks, 0/5").

A yellow **You approve** label on a column means it has a gate: work stops there until a person approves. Drafting stages always stop for a person, whatever the gate settings.

## 3. Intake: should this go forward?

![Intake](images/walkthrough/03-intake.png)

Click **AI-4**. The business described what the AI does, what data it uses, who it affects and how much it acts on its own. A reviewer decides whether to take it forward. **Send to classification** passes it to the Risk Classifier agent. Whoever added a use case can't approve it themselves.

## 4. Classification: the AI drafts, a person decides

![Classification](images/walkthrough/04-classification.png)

Click **AI-3**. The **Risk Classifier** proposes a tier (here, limited risk with a person in the loop) and four starting risks. For each item it shows:

- **Why**: its reasoning, written before its answer.
- **Sources**: the knowledge-base passages it relied on (K-numbers). Click one to read exactly what it saw. If it cites nothing, the item says **No source cited**.
- **Verifier**: a second AI's view on whether those sources back the item up, with the quote it rests on. Advisory only.

**What you decide** says it plainly: accept, edit or reject each item. Approval is blocked until every item has a decision.

![Editing an item](images/walkthrough/05-edit-an-item.png)

**Edit** opens the item's fields. A reason is required, and it goes in the audit trail next to what the AI originally proposed. **Reject** also needs a reason. Only kept items, as edited, enter the risk register.

## 5. Control design

![Control design](images/walkthrough/06-control-design.png)

Click **AI-5**. The **Control Designer** proposes controls from the 31-control library for each approved risk, with an owner, an objective and a test approach. Same pattern: decide each one. The exit criteria stop approval if a high risk would be left with no control.

## 6. Evidence and testing (AI-1 and AI-2 have been through these)

![Testing](images/walkthrough/12-testing.png)

Each control gets a test: a procedure, a sample, an expected and an actual result, like testing software. The **Control Tester** agent drafts a result from the evidence, but a person (the preparer) concludes each test, and someone else reviews it. T-1 failed: 2 of 25 escalated chats reached an agent without the transcript.

![Evidence vault](images/walkthrough/13-evidence.png)

Evidence is fingerprinted (SHA-256) when collected. **Verify** recomputes the fingerprint, so you can show a file hasn't changed since it was collected.

## 7. Issues: findings handled like defects

![Issues](images/walkthrough/14-issues.png)

A failed test or evaluation becomes an issue with a severity, an owner, a due date and a management response. I-1 (the missing transcripts) is **In remediation** with a fix due in December. It can only be closed after a retest passes, and not by the person who raised it.

## 8. Validate: the challenge before sign-off

![Validate](images/walkthrough/07-validate.png)

Click **AI-1**. The **Review assistant** lists challenges to the evidence pack: five tests passed on walkthrough notes only (weak evidence), and R-6 has a residual score of 12, above the appetite of 8, that nobody has accepted. The reviewer weighs each one, then signs off. The Review assistant is not a second-line review; the person is.

## 9. The assistant

![Assistant](images/walkthrough/08-assistant.png)

**Ask about this** on a use case, or **Ask AI** in the top bar, opens the assistant. It answers from the record and the knowledge base and shows its sources. It can suggest changes (a decision, a risk change, an issue), but nothing happens until a person clicks **Apply**, and then it runs under that person's own name and role. With no model connected it runs offline and reports what the harness can check by itself.

## 10. Risks: the register and appetite

![Risks](images/walkthrough/09-risks.png)

Every risk kept from a classification, scored for likelihood and impact before controls (inherent) and after (residual). The heat map outlines cells above the client's appetite. R-5 was accepted by Riley because its residual score of 6 is within appetite. R-6, at 12, needs the lead: a reviewer can't accept it.

## 11. Standards and controls

![Standards](images/walkthrough/10-standards.png)

**Standards** explains each framework in plain English and shows how much of it the engagement can prove: **Proven** means a control is in place, tested, passing and evidenced. Open a framework to see each requirement and the next step. The other tabs hold the detail: **Our controls** (the register), the **Control library**, **What applies** (the Statement of Applicability, with reasons for anything excluded) and **Traceability** from obligation to evidence.

![Our controls](images/walkthrough/11-our-controls.png)

## 12. Evals: testing the AI itself

![Evals](images/walkthrough/15-evals.png)

Separate from testing controls, evaluation suites put questions to an AI system and check its answers. The chatbot passed 4 of 5 quality checks and resisted only 3 of 8 red-team attacks (from the OWASP LLM Top 10). The failures became issues I-2 to I-6.

## 13. Inventory: what AI is in use

![Inventory](images/walkthrough/16-inventory.png)

Every AI system, model, agent, dataset and vendor in scope, with an owner. AI agents get a readiness checklist: an agent may act on its own only when all eight checks hold (a named owner, its own identity, a written mandate, limits, an approval threshold, a step limit, a tested kill switch and a recent independent review).

## 14. Report: assessment and sign-off

![Report](images/walkthrough/17-report.png)

Seven areas, each scored 1 to 5. The harness suggests a score from what it can see; the assessor decides and explains. Someone who didn't score every area must sign it off, so Andrew can't sign his own assessment; Jordan, the lead, signs. The report downloads as Markdown or prints to PDF.

## 15. How the AI is kept honest

![Knowledge base](images/walkthrough/18-knowledge.png)

**Knowledge base** (under More): everything agents ground their drafts in, including the client's own AI policy. Search it the way an agent does.

![Golden dataset](images/walkthrough/19-golden.png)

**Agent testing** (under More): run an agent over 15 use cases with known right answers before changing its model or rules, and see any regressions.

![Verifier](images/walkthrough/20-verifier.png)

The **Verifier** is measured against claims people already judged good or bad, including the reviewers' own decisions. On the offline rules it lets too many bad claims through, so it is marked **Not trusted yet**. That is the point: you see the numbers before you rely on it.

## 16. The audit log

![Audit log](images/walkthrough/21-audit.png)

Every action, by a person or an agent, with when and from where. Each entry carries a fingerprint of the one before, so changing or deleting any entry breaks the chain. **Verify the chain** checks it.

## 17. Models

![Models](images/walkthrough/22-models.png)

Which AI the harness uses. It ships with the offline rules (free, no keys). Add a service from the presets (Anthropic, OpenAI, Azure OpenAI, Google Gemini, Mistral, local Ollama and others), set a monthly spending cap, and choose models for the agents, the assistant and the Verifier.

## 18. New in v1.1: AI from the first step

![Planning a use case with the Use Case Planner](images/walkthrough/38-plan.png)

**+ Add use case** opens the Plan page. The Use Case Planner asks a few questions and fills the brief on the right; the person edits it and clicks **Add to Intake**. **Fill it in myself** does the same without the chat.

![A second agent on Classify risk](images/walkthrough/34-agents.png)

A lead can add agents to a stage and route cards between them: here a Chatbot classifier takes chatbots, and the Risk Classifier takes everything else.

![Agent activity on the Overview](images/walkthrough/42-activity.png)

The Overview charts agent runs or cost per day, by stage, agent or model.

![Acting as a reviewer, after dragging AI-4 to Classify risk](images/walkthrough/43-act-as-drag.png)

For demos, an admin can act as anyone (off by default). Dragging a card to the next column runs the same approval as the button, so the reviewer's permissions and segregation of duties still apply.
