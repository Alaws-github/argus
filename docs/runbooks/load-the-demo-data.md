# Load the demo, and build your own

**Who:** anyone giving a demo or learning ARGUS. **You need:** the app installed. No AI keys: the demo runs on the offline rules.

## Load it

1. Stop the app.
2. Run `npm run db:reset`.
3. Start the app (`npm run dev`).
4. In a second terminal, run `npm run demo`. It takes about a minute and prints what it built.
5. Sign in as **andrew@example.com**, password `correct-horse-9` (or the `DEMO_PASSWORD` you set). Andrew is the admin; **Act as** in the account menu is on, so you can work as the others without signing out.

## What it builds

Five people: Andrew (admin), Jordan Clarke (lead), Riley Morgan (reviewer), Sam Patel (preparer) and Dana Reid (viewer), all `@example.com`. Then five engagements, each a fictional client facing real kinds of AI risk:

| Engagement | Client | What's in it | Modules on |
| --- | --- | --- | --- |
| AI assurance 2026 | Northshore Financial Group, bank and insurer | **The full app.** Five use cases at every step: a chatbot taken all the way to the board report with a failed control and its issue; a loan model waiting for sign-off; a summariser and a claims model waiting for decisions; one in Intake. Evals and red teaming, weekly monitoring, an incident, the inventory, a connector, a second classifier for chatbots, golden runs, the Verifier, an assistant conversation and a plan in progress | All |
| Customer AI readiness review | Kestrel Bay Telecom | A WhatsApp refund agent that can credit bills (the airline-chatbot liability case is the worry), SIM-swap fraud scoring, churn offers that may use location as a stand-in for income, and a plan for a voice-cloned Patois care line | AI testing, inventory |
| Clinical AI governance | Palmcrest Health Network | A vendor sepsis alert that needs local validation, an ambient scribe pilot with an incident (a wrong insulin dose caught before signing), and no-show prediction that overbooks some communities. Members only | Incidents |
| Operations and people AI review | Corallis Port Services | Container inspection targeting, an autonomous crane scheduling agent, gate cameras matching faces for discipline, and CV ranking for graduates raised with the Use Case Planner | Inventory |
| Public sector AI review | National Social Support Agency | Benefit fraud scoring (with the overseas benefit scandals as the warning), a helpline chatbot, and letter drafting. Members only, with an issue on missing reasons for suspensions | Applicability, incidents |

Everything is created through the app's own API as these people, so each approval, decision and audit entry is genuine and **Verify the chain** passes.

## Build your own

Each engagement is one file in `scripts/demo/engagements/`. To add one:

1. Copy `scripts/demo/engagements/_template.mjs` to a new name, for example `06-my-client.mjs`. Files are run in name order; files starting with `_` are skipped.
2. Fill in the client, its sector, frameworks, risk appetite and a description (every AI agent reads it).
3. In `build`, add use cases and take them as far as you want with the helpers listed at the top of the template: raise one with the Use Case Planner, send it to the AI for classification, decide items, approve the controls, raise issues.
4. Run just yours: stop the app, `npm run db:reset`, start it, then `npm run demo -- --only=my-client`. (Northshore always runs too, because it uses the engagement the database starts with.)
5. `npm run demo -- --list` shows every engagement the demo will build.

If a step times out, the message says which use case and where it stopped; usually an agent for that step is switched off, or the card is waiting for a decision you didn't make.
