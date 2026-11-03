# Connect a client system for evidence

**Who:** a lead or admin sets up connectors; anyone preparing work can pull. **You need:** a report or export link from the client's system (for example a CSV export or a PDF report), and a token or key if it needs one. Agree read-only access with the client first.

1. Go to **Testing > Connectors** and click **Add connector**.
2. Give it a name, paste the address, and choose how it signs in: none, a bearer token, an API key in a header, or a user and password. Paste the credential. It is encrypted and never shown again, including in the audit log.
3. Choose the control the evidence belongs to, and whether to pull on request, daily or weekly.
4. Click **Pull now** to test it. A successful pull adds a fingerprinted file to the Evidence vault, reads its text so agents can use it, and links it to the control. If the content hasn't changed since the last pull, nothing new is added.
5. If it says the address is on a private network, the client system is inside a network the harness won't reach by default. An admin can allow it with the switch at the bottom of the page, for systems on your own network only.

Connectors only ever read. They never send changes back to the client's system.
