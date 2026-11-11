# Glossary

| Term | Meaning |
| --- | --- |
| Agent | An AI helper that drafts one kind of work, such as a risk classification or a test result. It never decides |
| Appetite (risk appetite) | The highest residual risk score the client accepts without escalating to a lead and the board committee |
| Archive | Make an engagement read-only and move it out of the main list. It can be restored |
| Audit log | The record of every action, who did it, when and from where. Tamper-evident |
| Built-in rules | A free, offline stand-in for an AI model, using fixed logic. Cautious by design |
| Card | A use case on the board |
| Control | Something in place to reduce a risk, such as "a person reviews every loan decline before it's sent" |
| Control library | 37 reusable controls mapped to standards, used as a starting point |
| Draft | An agent's suggestion. It has no effect until a person acts on it. A person accepts, edits or rejects each item |
| Embedding | A list of numbers representing what a passage means, used for meaning search |
| Assistant | The AI you can ask about a use case or page. It explains and suggests; people apply or discard every suggestion |
| Suggestion | A change the assistant proposes. Nothing happens until a person clicks Apply, and then it runs under their name and role |
| Proven, In progress, Gap | How far a requirement is met: a control in place, tested, passing and evidenced; a control still missing a test or evidence; or no control yet |
| Golden dataset | Use cases with known right answers, used to test the agents before a model or rules change |
| Regression | A golden case that passed on the previous run and fails now |
| Verifier | An AI that checks each item of a draft against the passages it cites. Advisory only. Also called LLM-as-a-judge |
| Labelled example | A claim and its sources that a person judged good or bad, used to measure the Verifier |
| Kappa | How far two judges (here the Verifier and people) agree beyond what chance would give. 0 is chance, 1 is perfect |
| False pass | The Verifier calling a claim supported when a person judged it bad. The dangerous kind of mistake |
| Grounding | Giving an agent trusted passages to work from, and making it cite them |
| Knowledge base | The passages agents draw on: framework summaries, the control library, method guidance and the client's own material |
| Passage (K-number) | One piece of the knowledge base, cited by agents as K-12 and so on |
| Engagement | One piece of work for one client |
| Evaluation (eval) | A set of test questions put to an AI system, with checks on its answers |
| Evidence | A file, link or note that shows a control works. Fingerprinted when collected |
| Exceptions | Items in a test sample where the control didn't work |
| Exit criteria | Checks a use case must meet before it leaves a stage |
| Gate | A stage where a named person must act before the use case moves on |
| Inherent risk | A risk's score before controls |
| Inventory | The list of AI systems, models, agents, datasets and vendor tools in scope |
| Issue | A finding that needs fixing, with an owner and a due date |
| Kill switch | Stops an agent at once |
| Maturity | How established a practice is, on a scale of 1 (Initial) to 5 (Optimising) |
| Obligation | A specific requirement from a law or standard |
| Preparer | The person who performs and concludes a test |
| Red team | Deliberately attacking an AI system to find weaknesses |
| Residual risk | A risk's score after controls |
| Retest | A new test of a control after a fix |
| Reviewer | The person who checks a test someone else prepared |
| Segregation of duties | The rule that the person who did something can't also approve it |
| SHA-256 fingerprint | A code calculated from a file's contents. If the file changes, the code changes |
| Statement of Applicability (SoA) | The list of controls with whether each applies and why |
| Tier | The risk level of a use case: prohibited, high, limited or minimal (after the EU AI Act) |
| Traceability matrix | The link from each obligation to the controls, tests and evidence that meet it |
| Use case | One way the client uses AI |
