# Test the agents

**Who:** an admin. **When:** before switching an agent to a new model, after changing an agent's rules, and before relying on the Verifier.

## Run the golden set

1. Open **More > Agent testing > Golden dataset**.
2. Choose the agent: **Risk Classifier** or **Control Designer**.
3. Choose the provider and model you want to test. It starts on the one this engagement's agent uses.
4. Leave **Also ask the Verifier** ticked if you want its view on each draft as well.
5. Click **Run the golden set**. Each case runs on its own, with no client material, and the table fills in as it goes.
6. Read the result:
   - **Cases passed**: cases where every check was right.
   - **Checks passed**: the individual checks, such as "Tier is high" or "Raises a privacy risk".
   - **Regressions**: cases that passed last time and fail now. Any regression is a reason not to switch yet.
7. For a failed case, the row shows what the agent produced and which checks failed.

Live model runs cost money on billed providers and count towards the monthly spend cap.

## Add your own case

Click **Add a case**, describe a fictional use case, and give the answer an experienced assessor would: the tier and the risks it must (or must not) raise, or for the Control Designer, the approved risks and the library controls it must propose. Built-in cases can't be removed, so runs stay comparable over time.

## Set up and measure the Verifier

1. Open **More > Agent testing > Verifier**.
2. Under **How the Verifier checks**, choose a model. Pick one from a different company than the drafting agents use. Save.
3. Click **Measure the Verifier**. It judges every labelled example and compares its verdicts with people's.
4. Read **Can you trust it?** It is marked trusted only with at least 10 examples, kappa of 0.6 or more and false passes of 10% or less. **Where it disagreed with people** lists each miss and the Verifier's reasoning.
5. Add more examples over time:
   - **Add from reviewers' decisions** turns items reviewers accepted (good) or rejected (bad) on real drafts into examples. Edited items are skipped.
   - **Add an example** lets you write one by hand, citing passages by K-number from the Knowledge base page.
6. Only when it is trusted, and only if you want it, turn on **Check every new classification and control design automatically**.

The Verifier is advisory either way. A person still accepts, edits or rejects every item, and the audit log records the Verifier's checks as advisory.
