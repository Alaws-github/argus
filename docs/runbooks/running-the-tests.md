# Run the tests

**Who:** developers, before handing over a new version. The tests create accounts and data, so run them on a database you're about to reset.

1. `npm run typecheck`: checks the code for type errors.
2. Stop the app, `npm run db:reset`, then `npm start` in one terminal.
3. In another terminal, `npm run smoke`: 66 checks of the API, covering roles, segregation of duties, gates, exit criteria, evidence fingerprints, issues, risk acceptance, evaluations, sign-off, engagements, archive and delete, and the audit chain.
4. Stop the app, reset again, start it, then `npm run test:agents`: 30 checks of the drafting agents, including a mock model that tries to cheat the guardrails.
5. Stop the app, reset again, start it, then `npm run test:grounding`: 31 checks of the knowledge base, citations, item-by-item decisions, meaning search and temperature 0.
6. Stop the app, reset again, start it, then `npm run test:verifier`: 36 checks of the golden dataset, regressions, the Verifier's quote check, measuring it against people's labels, live checks and the spend cap.
7. Stop the app, reset again, start it, then `npm run test:assistant`: 27 checks of the assistant (offline and live), dropped citations and suggestions, applying under the person's own role, discarding, the spend cap, and providers that refuse tool calls.
8. Stop the app, reset again, start it, then `npm run test:operations`: 58 checks of evidence file reading, incidents, monitoring and drift, connectors, members-only access and single sign-on.
9. Stop the app, reset again, start it, then `npm run test:v11`: 65 checks of the Use Case Planner (offline rules and a mock model), adding agents and routing cards between them, act as, provider service names and the Overview activity charts.
10. Stop the app and reset once more before real use.

Each test prints PASS or FAIL per check, and the accounts it created.
