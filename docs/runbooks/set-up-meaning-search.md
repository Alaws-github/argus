# Set up meaning search

**Who:** admins. **Why:** keyword search finds exact terms; meaning search also finds passages that say the same thing in different words, so agents get better sources.

## Free, on your own computer (recommended)

1. Install Ollama from ollama.com.
2. In a terminal: `ollama pull nomic-embed-text`
3. In the harness, **More, Models, + Add provider**: type **OpenAI-compatible**, address `http://localhost:11434/v1`, no key, **Billed** off. Save.
4. On the Models page, **Meaning-based search**: choose that provider, model `nomic-embed-text`, **Test**, then **Save and index**.

## Cloud alternatives

| Provider | Address | Model |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `text-embedding-3-small` |
| Voyage | `https://api.voyageai.com/v1` | `voyage-3` |

Add the provider (OpenAI-compatible, with its key), then choose it under **Meaning-based search** as above.

## Notes

- Anthropic doesn't offer embedding models, so it can't be used here.
- **Save and index** embeds every passage. New passages (uploads, evidence, use cases) are embedded automatically a few seconds after they're added.
- Changing the embedding model re-embeds everything. Turning it off leaves keyword search working.
- Check it worked on the **Knowledge base** page: **Meaning search** shows **On**.
