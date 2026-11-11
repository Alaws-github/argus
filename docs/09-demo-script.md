# Demo scripts

Two scripts for showing the ARGUS to an assurance or risk team: one for 15 minutes, one for 30. Both use the demo data and the offline rules, so they need no internet and no AI keys. Times are a guide.

The message to land, in one line: **AI does the routine drafting; named people make every decision; and every step can be proven afterwards.**

## Before the demo

1. Stop the app if it is running.
2. `npm run db:reset`, then `npm run dev`, then in a second terminal `npm run demo`. It takes about 30 seconds. See [Load the demo data](runbooks/load-the-demo-data.md).
3. Open http://localhost:5173 and sign in as **andrew@example.com** (password `correct-horse-9`).
4. Use a laptop screen at 100% zoom, light theme (account menu, top right). Close other tabs.
5. Optional: open a second browser profile signed in as **jordan@example.com** (the lead) for the sign-off at the end of the 30-minute script.
6. Have [the walkthrough](08-walkthrough.md) open in case you lose your place.

Rehearse once. The demo data changes as you click (decisions, sign-offs), so reset and reload it before the real thing.

## 15-minute script

| Time | Where | Do | Say |
| --- | --- | --- | --- |
| 0:00 | Overview | Nothing yet | "Boards are asking: which AI do we use, what could go wrong, what stops it, and can we prove it? This is one engagement for a fictional bank and insurer, Northshore. Five AI use cases, at different stages." |
| 1:00 | Board | Point along the columns | "Each card is an AI use case. It moves through eight stages, from intake to a board report. Yellow labels are gates: work stops there until a person approves." |
| 2:30 | AI-3 | Open it | "The Risk Classifier agent has drafted a tier and four risks. Each one shows its reasoning and the sources it used." Click a K-number chip. "This is exactly what it read. It has to cite its sources, and the harness rejects any source it wasn't given." |
| 4:00 | AI-3 | Point at the Verifier line and an item's verdict | "A second AI, the Verifier, checks whether those sources actually back each item. It's advisory. It can't decide anything." |
| 5:00 | AI-3 | Edit one risk's likelihood, give a reason, save. Accept the rest. Approve. | "The person decides each item: accept, edit or reject, and an edit needs a reason. The audit log keeps what the AI said and what the person changed it to. Only what's kept goes into the register." |
| 7:00 | AI-2 | Open it, scroll to the summary | "This one went the whole way. Controls were designed and tested. One failed: 2 of 25 escalated chats lost their transcript. That became an issue with an owner and a due date, and the board summary says so plainly." |
| 8:30 | Issues | Point at I-1 and the red-team issues | "Findings are handled like defects. This one is being fixed. These came from attacking the chatbot with the OWASP LLM Top 10: it resisted 3 of 8." |
| 10:00 | Controls > Standards | Open EU AI Act | "This is the board-level answer to 'are we compliant?' Each framework in plain English: how much is proven, what's in progress, what's missing, and the next step for each gap." |
| 11:30 | Risks | Point at the heat map and appetite | "Residual risk against the client's appetite. A reviewer can accept risk within appetite. Above it, only a lead can, and it's recorded as escalated." |
| 12:30 | Audit log | Click **Verify the chain** | "Every action, by a person or an agent, is chained. Change any entry and the chain breaks. That's what makes it evidence." |
| 13:30 | Back to Board | | "So: the AI drafts, and it has to show its sources. A second AI checks it. People decide every item. And all of it is provable afterwards. Questions?" |

## 30-minute script

Use the 15-minute script as the spine, and add these.

**Part 1: Set the scene (0:00 to 3:00).** Overview and Board as above. Add the inventory: "Before you can govern AI you need to know what's in use." Open **Inventory**, point at the agent register: "An AI agent may act on its own only when all eight checks pass. The collections agent fails seven."

**Part 2: A use case arrives (3:00 to 6:00).** Click **+ Add use case**. "AI is in the work from the first step." Type one sentence about a new use case and answer two of the Use Case Planner's questions; point at the brief filling in with **AI** tags. "It drafts; I edit; and only I can add it to Intake, under my name." Then open **AI-4**, read the profile aloud, and drag it to Assess risk (or click **Send to classification**). Signed in as Andrew it's refused if Andrew added it; use **Act as** Riley from the account menu: "For a demo I can act as anyone. On client work this is off, and the audit log names me beside Riley either way." Within a few seconds it is in Assess risk with a draft. "The agent runs as soon as the gate opens. Here it's on the offline rules; on a real engagement you'd point it at Claude, GPT, Gemini or a model running on your own server."

**Part 3: Decide a draft (6:00 to 10:00).** AI-3 as in the 15-minute script. Then click **Ask about this** and pick "Which items look weakest, and why?" "The assistant can explain and suggest. Anything it suggests changes nothing until I click Apply, and then it runs under my name and my permissions. It can never approve, sign off or accept a risk."

**Part 4: Controls, evidence, testing (10:00 to 15:00).**
- AI-5: "The Control Designer maps each risk to library controls. If I reject the only control for a high risk, approval is blocked."
- **Testing**: "Tests have a preparer and a separate reviewer. Same person can't do both." Point at T-1 failed.
- **Evidence vault**: click **Verify** on an item. "Fingerprinted when collected, so we can prove it hasn't changed."

**Part 5: The challenge before sign-off (15:00 to 18:00).** Open **AI-1**. "Before sign-off, the Review assistant challenges the evidence pack. Five tests rest on walkthrough notes only, which is weak evidence. And R-6 sits above appetite with nobody accepting it. The reviewer has to weigh each challenge." Open **Risks** and show R-6 at 12 against an appetite of 8.

**Part 6: Can we trust the AI? (18:00 to 23:00).**
- **AI > Knowledge base**: "Everything the agents may use, including the client's own AI policy. They can't cite anything outside this."
- **AI > Checking the AI > Golden dataset**: "Before we change an agent's model, we run it over cases with known right answers. The offline rules get 7 of 10. Any case that passed before and fails now shows as a regression."
- **Verifier** tab: "The checker is checked too. It's measured against claims people already judged, including our reviewers' real decisions. On the offline rules it lets 44% of bad claims through, so it says Not trusted yet. We'd connect a model and measure again before relying on it."

**Part 7: Sign-off and proof (23:00 to 27:00).**
- **Report**: "Seven areas scored 1 to 5, each with the reason." Click **Sign off** as Andrew: it is refused. "I scored it, so I can't sign it." Switch to Jordan's browser and sign. "Segregation of duties is enforced, not just written down."
- **Audit log**: search "draft.item" to show each decision with what the AI proposed; click **Verify the chain**.

**Part 8: Close (27:00 to 30:00).** "Three things to take away: the AI shows its sources and is checked; people make every decision and the system enforces who can make which; and the record is tamper-evident. What would you want to see on a real client?"

## Other engagements to show

The demo builds four more clients (engagement switcher, top left). Pick the one closest to your audience:

- **Kestrel Bay Telecom**: KBT-1, a WhatsApp agent that can credit bills. "A company elsewhere was held to a refund policy its chatbot made up. Riley raised the impact of a wrong promise; the AI's draft and Riley's edit are both in the record."
- **Palmcrest Health Network** (members only): PHN-2, the ambient scribe, and its incident: a wrong insulin dose caught before signing. Issues > Incidents.
- **Corallis Port Services**: CPS-3, face matching at the gates, still in Intake. "Biometrics at work: watch what the AI makes of it." Send it to Assess risk live.
- **National Social Support Agency** (members only): NSSA-1, benefit fraud scoring. "Two overseas benefit scandals are why this one gets a hard look." Show the bias risk Riley raised and the issue on missing reasons.

## Questions you'll likely get

**What if the AI is wrong?** Nothing it drafts takes effect until a person accepts it, item by item. It must cite its sources, invented citations are rejected, and the Verifier flags items its sources don't support. The golden dataset catches an agent getting worse before it's used on client work.

**Can the AI approve anything?** No. Agents and the assistant can't approve a stage, conclude a test, review, accept a risk, close an issue or sign off. The server enforces this, not just the screen.

**Does client data go to an AI company?** Only if you connect one. It runs fully offline on the built-in rules, or on a model on your own machine (Ollama or LM Studio). With a cloud model, only the use case and the passages it needs are sent. Keys are encrypted and never shown to agents.

**Which AI does it use?** Any of them: Anthropic, OpenAI, Azure OpenAI, Google Gemini, Mistral, Groq, Together, OpenRouter, DeepSeek, xAI, Perplexity, or a model on your own server. Each agent can use a different one, with a fallback and a monthly spending cap.

**Which standards does it cover?** The EU AI Act, ISO/IEC 42001, the NIST AI RMF, the Jamaica Data Protection Act 2020, the OWASP LLM Top 10 and, for healthcare clients, the FDA Good Machine Learning Practice principles and HIPAA, through a library of 37 controls. The library can be extended.

**How do you prove the record hasn't been changed?** Every audit entry carries a fingerprint of the one before it; changing one breaks the chain, and anyone can verify it. Evidence files are fingerprinted when collected.

**Can one person do everything?** Only with **Act as**, which is off by default. It exists for demos and training. Every action taken while acting records the real admin beside the name, inside the hash chain.

**What isn't built yet?** Reading scanned documents (OCR), multi-factor sign-in inside the app (it relies on the identity provider's through single sign-on), SAML, and a limit on failed sign-ins. Evidence connectors read from systems that offer a report or export link over HTTPS; deeper integrations (for example a document management system's own API) would be added per client. Say so plainly; it's a working prototype.

## If something goes wrong

- **A card sits on Running.** Wait a few seconds; the rules are fast. If it stays, open it and click **Retry**.
- **Sign-in fails after a reset.** The reset removes all accounts. Run `npm run demo` again.
- **You clicked something you didn't mean to.** Carry on; it's in the audit log, which is itself a talking point. Reset before the next demo.
