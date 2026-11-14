# Code structure backlog

What is left of splitting long code into named, single-purpose pieces. v1.7.6 split `runCard` and engagement creation; v1.7.7 split every other long server function (the four drafting agents now have a file each). Split one at a time, with the checks that cover it run before and after.

Route registration functions (`xxxRoutes`) are long because they list many short handlers, which is the usual Express pattern; split those only when a single handler inside is long.

## Server

Done in v1.7.7: no server function outside the route registration lists is over 120 lines (blank lines and comments not counted).

## Web (planned for 1.7.8)

| File | About | Split into | Covered by |
|---|---|---|---|
| `features/engagements/SettingsPage.vue` | 1,100 lines | one component per Settings tab | browser check of every tab, `test:v12`, `test:v174` |
| `features/integrations/WorkflowBuilderPage.vue` | 960 | canvas, inspector, icon rail | browser check, `test:v17` |
| `features/agent-testing/AgentTestingPage.vue` | 950 | one component per tab | browser check, `test:verifier` |
| `features/assistant/AssistantPanel.vue` | 940 | conversation list, message, composer | browser check, `test:assistant` |
| `features/board/CardDrawer.vue` | 890 | one component per drawer section | browser check |
| `components/KpiStrip.vue` | 280-line computed | one tile builder per page | browser check of every page |
