# Code structure backlog

Long functions still to split into named, single-purpose steps (v1.7.6 split `runCard` and engagement creation). Line counts are from v1.7.6, without blank lines and comments. Split one at a time, with the suites that cover it run before and after.

Route registration functions (`xxxRoutes`) are long because they list many short handlers, which is the usual Express pattern; split those only when a single handler inside is long.

| Function | File | Lines | Covered by |
|---|---|---|---|
| `runReviewAssistant` | `apps/server/src/agents/drafting.ts` | 238 | `test:agents`, `test:v16` |
| `startGoldenRun` | `apps/server/src/agent-testing/golden.ts` | 163 | `test:verifier` |
| `runControlTester` | `apps/server/src/agents/drafting.ts` | 155 | `test:agents` |
| `runReportWriter` | `apps/server/src/agents/drafting.ts` | 151 | `test:agents` |
| `runLoop` | `apps/server/src/agents/agent-loop.ts` | 150 | `test:v16` |
| `chatOnce` | `apps/server/src/ai/llm.ts` | 148 | `test:v15`, `test:v16` |
| the evidence push handler in `ingestRouter` | `apps/server/src/integrations/ingest.ts` | 133 | `test:v173` |
| `runControlDesigner` | `apps/server/src/agents/control-designer.ts` | 131 | `test:agents` |
| `runEvidenceCollector` | `apps/server/src/agents/drafting.ts` | 128 | `test:agents` |
| the tiles computed for every page | `apps/web/src/components/KpiStrip.vue` | 281 | browser check of every page |

Large Vue files to split into components per tab or panel: `features/engagements/SettingsPage.vue` (about 1,100 lines), `features/integrations/WorkflowBuilderPage.vue`, `features/agent-testing/AgentTestingPage.vue`, `features/assistant/AssistantPanel.vue`, `features/board/CardDrawer.vue` (each about 900).
