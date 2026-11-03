# Load the demo data

**Who:** whoever is giving a demo or learning the app. **Warning:** this starts from an empty database, so every account and record already in the harness is removed. Don't do it on a database with real work in it (see [Back up and restore](backup-and-restore.md)).

1. Stop the app (Ctrl+C in its terminal).
2. Run `npm run db:reset`.
3. Start the app: `npm run dev`.
4. In a second terminal, in the same folder, run `npm run demo`. It takes about 30 seconds and prints each step.
5. Open http://localhost:5173 and sign in as **andrew@example.com** with the password `correct-horse-9`.

To use a different password, set it before step 4: `DEMO_PASSWORD=your-password npm run demo` (on Windows PowerShell: `$env:DEMO_PASSWORD="your-password"; npm run demo`).

## What you get

Five fictional people, all `@example.com`, all with the same password:

| Sign in as | Role |
| --- | --- |
| andrew@example.com | Admin |
| jordan@example.com | Lead |
| riley@example.com | Reviewer |
| sam@example.com | Preparer |
| dana@example.com | Viewer |

And the Client Zero engagement for Northshore Financial Group (demo), with five use cases at different stages, risks above and within appetite, controls, tests (one failed), fingerprinted evidence, issues, evaluation runs of the chatbot, a scored assessment waiting for sign-off, golden runs of the agents, a Verifier measurement and an assistant conversation. Everything was done through the app by those people, so the audit log is real and verifies.

The [walkthrough](../08-walkthrough.md) tours it page by page. The [demo scripts](../09-demo-script.md) give a 15-minute and a 30-minute running order.

## If it fails

- "This database already has accounts": you skipped the reset. Stop the app, reset, start it, run the demo again.
- "fetch failed": the app isn't running. Start it first.
