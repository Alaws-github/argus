# Code structure backlog

What is left of splitting long code into named, single-purpose pieces. v1.7.6 split `runCard` and engagement creation; v1.7.7 split every other long server function; v1.7.8 split the large screens.

Route registration functions (`xxxRoutes`) are long because they list many short handlers, which is the usual Express pattern; split those only when a single handler inside is long.

## Server

Done in v1.7.7: no server function outside the route registration lists is over 120 lines (blank lines and comments not counted).

## Web

Done in v1.7.8: Settings, Agent testing, the card drawer, the workflow builder and the KPI tiles. Still over 600 lines, each one page with one job, to split if they grow:

| File | Lines | Note |
|---|---|---|
| `features/assistant/AssistantPanel.vue` | 719 | Its tables and tag picker moved out in v1.7.8; the markup stays together because its styles are scoped to it. Splitting it means moving those styles with each piece. |
| `features/testing/TestingPage.vue` | 703 | Tests and evidence tabs: could follow the Settings pattern (one component per tab). |
| `features/controls/ControlsPage.vue` | 668 | Several tabs are components already; the register and library tabs could follow. |
| `features/engagements/AddEngagementPage.vue` | 652 | The wizard: one component per step would follow the same pattern. |
| `features/engagements/SettingsAgentsTab.vue` | 606 | One tab with one job (an agent's settings); the agent list and the form could be split. |
