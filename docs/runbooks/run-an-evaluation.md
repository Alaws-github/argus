# Run an evaluation or red team

**Who:** preparers. **You need:** the AI system under test reachable as a model provider, or use the demo chatbot.

1. Make sure the system is in the **Inventory** and linked to its use case.
2. **Evals, New suite**. Choose **Red team** (attacks) or **Quality** (correct answers).
3. Pick the system under test, the provider and model, and the system prompt it runs with. Start from the template cases, and set a pass threshold (red teams usually 100%).
4. Optionally choose a judge model, for cases where a simple check can't decide.
5. Open the suite and **Add case** for anything specific to this client. A check can be: the answer contains, must not contain or matches a pattern; the model refuses; the answer is under a length; or a judge model decides.
6. **Run suite**. Results appear case by case.
7. If cases failed, click **Raise issues from failed cases**. Each gets a due date by severity (critical 14 days, high 30, medium 60, low 90).

The run is stored as fingerprinted evidence against the use case's controls automatically.

**To try it without a key:** the built-in rules include `demo-chatbot-v1`, a deliberately imperfect bank chatbot. Client Zero has two suites set up against it.
