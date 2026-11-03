# Set up monitoring and handle alerts

**Who:** a lead or admin sets schedules; a reviewer or lead acknowledges alerts.

1. Go to **Evals**. Each suite card has a **Monitoring** setting: Off, Daily or Weekly.
2. Choose Daily or Weekly. The first run starts within a minute, then on that schedule. Scheduled runs appear in the audit log as **Monitoring**, skip paused or archived engagements, and stop at the monthly spending cap for paid models.
3. Every run, scheduled or not, is checked:
   - **Below threshold**: the pass rate is under the suite's threshold.
   - **Drift**: the pass rate dropped by 10 points or more against the average of the last three runs.
   - **Run failed**: the run didn't finish.
4. Alerts show at the top of the Evals page. For each one, either click **Raise an issue** to track a fix, or write what was done (or why it's acceptable) and click **Acknowledge**.
5. The line under each suite shows its pass rate over the last ten runs against its threshold (dotted).
