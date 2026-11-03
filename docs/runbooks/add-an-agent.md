# Add an agent to a stage

**Who:** a lead or admin. **You need:** a model provider, if the agent shouldn't use the offline rules.

Use this when one kind of use case needs different handling on a stage: for example, chatbots classified with extra attention to prompt injection, or urgent cards on a faster model.

1. Go to **More > Engagement settings**, pick the engagement on the left, and open **Agents**.
2. Click **+ New agent**. It appears in the list as **Not saved yet**.
3. Choose the **Stage**. The agent does that stage's job, under the same rules and checks as the stage's built-in agent.
4. Give it a **Name** and choose what it **Takes**: a kind of AI (for example Chatbots only), P1 urgent cards only, or a risk tier.
5. Choose the **Provider** and **Model**, the **Effort** and a **fallback**. It starts with the stage agent's settings.
6. Add **Instructions** for what it should always do differently.
7. Set its **Limits per run**.
8. Click **Create agent**. Or **Discard** to throw it away.

**How cards are shared out.** A card goes to the most specific enabled agent that takes it: a kind or priority beats a tier, and a tier beats All cards. If no agent takes a card, it waits for a person, and the card says why.

**Change or remove it later.** Select it in the list. **Duplicate** copies it (switched off). **Delete agent** removes an agent you added; its past runs stay in the record. The built-in agent for a stage can only be turned off. The **Set here** line shows what differs from the stage's built-in agent, with **Reset** links.
