# Add a model provider

**Who:** admins. **You need:** an API key from the provider (not needed for a model on your own server).

1. Go to **More, Models**.
2. For Claude: edit the **Anthropic** card and paste your key. For anything else: **+ Add provider** and pick a type.

   | Type | Address | Key |
   | --- | --- | --- |
   | Anthropic | https://api.anthropic.com | From console.anthropic.com |
   | Ollama Cloud | https://ollama.com | From ollama.com |
   | OpenAI-compatible | Usually ends in `/v1` | From the service; optional for a local server |

3. Click **Test and find models**. The harness lists the models it finds. Add any it misses by name.
4. If the provider charges, leave **Billed** on and enter each model's price per million tokens (Anthropic's are filled in).
5. Save.
6. Point agents at it: **More, Settings, Agents**, pick an agent, choose the provider and model, optionally a fallback, and **Save agent**. Repeat for each agent. The badge at the top changes from **Dry run** to **Live agents**.

## Notes

- Keys are encrypted and shown only as their last four characters.
- A provider in use by an agent can't be removed. Move the agents first.
- When the monthly spending cap is reached and **pause at the cap** is on, billed runs stop with a note on the use case.
