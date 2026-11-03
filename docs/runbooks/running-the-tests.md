# Run the tests

**Who:** developers, before handing over a new version. The tests create accounts and data, so run them on a database you're about to reset.

1. `npm run typecheck`: checks the code for type errors.
2. Stop the app, `npm run db:reset`, then `npm start` in one terminal.
3. In another terminal, `npm run smoke`: 66 checks of the API, covering roles, segregation of duties, gates, exit criteria, evidence fingerprints, issues, risk acceptance, evaluations, sign-off, engagements, archive and delete, and the audit chain.
4. Stop the app, reset again, start it, then `npm run test:agents`: 28 checks of the drafting agents, including a mock model that tries to cheat the guardrails.
5. Stop the app and reset once more before real use.

Each test prints PASS or FAIL per check, and the accounts it created.
