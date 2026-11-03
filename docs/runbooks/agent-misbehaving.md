# An agent is misbehaving

For example: drafts that are wrong, a run that won't stop, or costs climbing.

## Stop it now

1. **More, Settings, Agents**, pick the agent.
2. **Stop this agent now** (leads and admins). Running work fails safely with a note; queued work waits for a person. The agent stays off until someone turns it back on.

## Find out what happened

1. **More, Runs**: open the run. The log shows each step, the model, cost and any error.
2. The run records the version of the agent's rules it used.
3. **Audit log**: filter by the agent's name to see everything it did.

## Fix and restart

- Wrong drafts: try a stronger model, or add engagement instructions on the agent (they add to its rules, never replace them). On the use case, **Run it again** with a note saying what to look at.
- Cost: lower the agent's max spend per run, or the monthly cap on the Models page.
- Turn the agent back on in Settings, Agents.

## Test the kill switch regularly

**Test the kill switch** turns the agent off and back on, and records the date. The inventory's agent register expects a test within the last 90 days.
