# The AI agents

Six agents do the drafting. Each works on one stage. None of them can approve anything, conclude a test, accept a risk, close an issue or sign off a report. A named person does all of those.

![How a draft becomes a decision](images/guardrails.png)

## The six agents

| Agent | Stage | What it drafts | On by default |
| --- | --- | --- | --- |
| Risk Classifier | Classify risk | A risk tier, how much human oversight is needed, the factors behind it, starting risks, and questions for the business owner | Yes |
| Control Designer | Design controls | Controls from the library for each approved risk, with an owner and a test approach | Yes |
| Evidence Collector | Collect evidence | What evidence to ask for, per control, and whether it has arrived | No |
| Control Tester | Test controls | A suggested result for each open test, citing the evidence it relied on | No |
| Review assistant | Validate | Challenges a sceptical reviewer would raise before sign-off | No |
| Report Writer | Board report | A board summary of the use case | No |

The last four are switched off when an engagement starts. A lead turns them on in Settings, Agents.

## Rules every agent follows

- **It drafts; a person decides.** Every agent's output waits for a person.
- **Its output is checked before anyone sees it.** It must match a fixed structure, and the harness checks every reference it makes (control keys, evidence keys, figures). A draft that breaks a rule is rejected and the run is marked failed, with the reason.
- **Client material is data, not instructions.** Use case descriptions and evidence are passed to the agent as data. Any instructions hidden in them are ignored.
- **Its rules are fixed and versioned.** Each agent's rules live in a file on the server. Every run records a fingerprint of that file, so any result can be traced to the exact rules that produced it. An engagement can add instructions, but can't replace the rules.
- **It can be stopped.** Each agent has a kill switch, and the switch can be tested without leaving the agent off.
- **It runs within limits.** Each run has a time limit and a cost limit. The workspace has a monthly spending cap.

## Agent by agent

### Evidence Collector

Lists, for each control, the specific evidence to ask for and from whom, and marks each item received, partial or missing by matching what's been uploaded.

![The evidence request list](images/evidence-request-draft.png)

It can only cite controls and evidence that belong to the use case.

### Control Tester

Reads each open test's procedure, expected result and attached evidence, then proposes **pass**, **fail** or **can't assess**, with the actual result, exceptions and the evidence it relied on.

- It never concludes a test and never counts as the preparer. The preparer starts from the draft if it holds up, concludes the test, and is recorded as the preparer. The audit log notes that they started from a draft.
- A draft that proposes a pass with exceptions, a pass without citing evidence, or that cites evidence not attached to that test, is rejected.
- On the free offline rules, it never proposes a pass. It only flags exceptions the evidence states outright.

### Review assistant

Lists challenges before the Validate sign-off: tests concluded without evidence, passes based only on walkthrough notes, small samples, failed tests with no issue raised, serious issues still open, risks above appetite with nobody accepting them, and the same person preparing and reviewing under different names.

Its built-in checks always stand: a model can add findings, but can't remove them or call the work ready while a high finding is open. It is not a second-line review; the person who signs off is.

### Report Writer

Drafts a headline, three short paragraphs, key figures, recommendations and decisions for the board. Every number it writes must appear in the data it was given, or the draft is rejected. It must say plainly when something failed. Only a summary a person approved goes in the readiness report.

## Which AI runs the agents

Each agent can run on a different model: Anthropic's Claude models, any OpenAI-compatible service (OpenAI, Azure OpenAI, OpenRouter, or a model on your own server), Ollama, or the **built-in rules**. The built-in rules run offline at no cost, using fixed logic instead of a model. They're useful for demos and dry runs, and deliberately cautious. See [Add a model provider](runbooks/add-a-model-provider.md).

## What the agents can't do yet

- Read PDFs, spreadsheets or web links. They read notes and text files, and say so when they can't see something.
- Pull evidence from a client's systems. The team uploads it.
