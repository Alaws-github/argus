// What each page of ARGUS is for, so the assistant can answer "what's on this
// page?" and "what do I do here?". The web app sends the page's path and a
// text snapshot of what is on screen; this guide says what the page means.
// Keep it in step with the router (apps/web/src/main.ts) and the menu names.
export interface PageGuide { name: string; purpose: string; actions: string[] }

const G: [RegExp, PageGuide][] = [
  [/^\/$/, { name: 'Use Cases (the board)', purpose: 'Every AI use case in this engagement as a card, in five steps: Intake, Assess Risk, Controls, Test, and Sign-off & Report. Agents draft the work at each step; a named person decides before a card moves on. Badges show what needs a person (You Triage, You Decide, Needs Your Approval).', actions: ['Open a card to read its drafts, decide each item and approve or send it back', 'Add a use case (the Use Case Planner can draft the intake brief)', 'Drag a card to another stage (runs the same checks as the buttons)'] }],
  [/^\/plan/, { name: 'Use Case Planner', purpose: 'A chat that drafts the intake brief for a new use case: what it does, the data it uses, who it affects and who owns it. Nothing is created until a person clicks Add.', actions: ['Describe the use case in your own words', 'Edit any field the Planner filled in', 'Add it to the board'] }],
  [/^\/overview/, { name: 'Overview', purpose: 'The engagement at a glance: use cases by step, risk levels, controls and tests, open issues, agent activity and spend.', actions: ['Spot what is stuck or overdue', 'Open the area that needs attention'] }],
  [/^\/controls\/standards/, { name: 'Controls: Standards', purpose: 'Plain-English coverage of the frameworks this engagement follows (for example the EU AI Act, ISO/IEC 42001, NIST AI RMF): which obligations have controls and which are gaps.', actions: ['See uncovered obligations', 'Ask the assistant what to do first'] }],
  [/^\/controls\/register/, { name: 'Controls: Register', purpose: 'Every control in the engagement, with its owner, status, the risks it treats and its tests.', actions: ['Add a control or upload controls from CSV or Excel', 'Edit an owner or objective', 'Open the tests for a control'] }],
  [/^\/controls\/library/, { name: 'Controls: Library', purpose: 'The 31 reusable control templates the Control Designer draws from, with the obligations each one meets.', actions: ['Browse templates', 'Use one as a starting point'] }],
  [/^\/controls\/soa/, { name: 'Controls: Statement of Applicability', purpose: 'Which library controls apply to this engagement and why, or why not. Auditors ask for it.', actions: ['Mark controls applicable or not, with a reason'] }],
  [/^\/controls\/traceability/, { name: 'Controls: Traceability', purpose: 'The chain from obligation to risk to control to test to evidence, so you can see where a link is missing.', actions: ['Find risks without controls and controls without tests'] }],
  [/^\/risks/, { name: 'Risk Register', purpose: 'Every risk in the engagement with its likelihood, impact, score, residual score after controls, owner, treatment and status.', actions: ['Set owners and treatments', 'Record residual scores', 'Find high risks with no control'] }],
  [/^\/testing\/tests/, { name: 'Tests', purpose: 'Control tests, each with a preparer and a different reviewer (segregation of duties), a conclusion and the evidence behind it.', actions: ['Prepare or review a test', 'Raise an issue from a failed test'] }],
  [/^\/testing\/evidence/, { name: 'Evidence', purpose: 'Files and notes that back up tests: uploads, connector pulls, and what was extracted from them.', actions: ['Upload evidence', 'Link it to a test'] }],
  [/^\/testing\/connectors/, { name: 'Connectors', purpose: 'Read-only links to client systems that pull evidence on a schedule.', actions: ['Add or run a connector'] }],
  [/^\/issues/, { name: 'Issues', purpose: 'Findings with a defect-style lifecycle: raised, assigned, fixed, retested, closed. Severity, owner and due date on each.', actions: ['Raise, assign or close an issue', 'Find overdue or high-severity issues'] }],
  [/^\/incidents/, { name: 'Incidents', purpose: 'AI incidents with their notification clocks (for example regulator deadlines) and a timeline.', actions: ['Log an incident', 'Track the deadlines'] }],
  [/^\/inventory/, { name: 'AI Inventory', purpose: 'Every AI system the client uses, with vendor, owner, data and readiness for the agents.', actions: ['Add or update a system'] }],
  [/^\/runs\/./, { name: 'AI Run detail', purpose: 'One agent run step by step: what it was given, what it drafted, the checks applied, tokens and cost.', actions: ['See why a run failed or what it cited'] }],
  [/^\/runs/, { name: 'AI Runs', purpose: 'Every agent run: which agent, which use case, the model, how long it took, what it cost and whether it passed its checks.', actions: ['Open a run', 'Find failed runs'] }],
  [/^\/evals\/./, { name: 'AI Testing and Monitoring: suite', purpose: 'One evaluation suite: its test cases, the system it tests, its pass threshold, run history and drift.', actions: ['Run the suite', 'Add cases', 'Set a schedule'] }],
  [/^\/evals/, { name: 'AI Testing and Monitoring', purpose: "Evaluation suites that test the client's AI systems (accuracy, safety, red teaming, bias), on demand or on a schedule, with alerts when results fall below a threshold or drift.", actions: ['Create or run a suite', 'Review alerts'] }],
  [/^\/agent-testing\/golden/, { name: 'Checking the AI: Golden dataset', purpose: "Checks ARGUS's own agents against known good answers, so a new model or rules change can be compared before it is trusted.", actions: ['Run the golden set', 'Compare a model'] }],
  [/^\/agent-testing\/verifier/, { name: 'Checking the AI: Verifier', purpose: 'Settings and calibration for the Verifier, which checks whether each drafted item is backed by the passages it cites.', actions: ['Pick the Verifier model', 'Check its agreement with people'] }],
  [/^\/agent-testing\/retrieval/, { name: 'Checking the AI: Retrieval', purpose: 'Measures how well the knowledge base finds the right passage for a fixed set of questions (recall at 5 and 10, MRR), with keyword search and with meaning search, so embedding models can be compared.', actions: ['Check retrieval again', 'See the questions it missed'] }],
  [/^\/agent-testing\/history/, { name: 'Checking the AI: History', purpose: 'Past golden runs and calibrations.', actions: ['Compare runs over time'] }],
  [/^\/knowledge/, { name: 'Knowledge Base', purpose: "The client's policies, standards and documents. Agents may only cite passages from here, by K-number, so their drafts can be checked.", actions: ['Upload documents', 'Search', 'Re-index'] }],
  [/^\/report/, { name: 'Report', purpose: 'The board report built from the registers, tests and issues, signed off by a named person.', actions: ['Review and export the report'] }],
  [/^\/audit/, { name: 'Audit Log', purpose: 'Every change, who made it and when, in a hash chain that shows if anything was altered.', actions: ['Search the log', 'Verify the chain'] }],
  [/^\/settings\/general/, { name: 'Engagement Settings: General', purpose: 'Name, client, framework, risk appetite and modules for this engagement; archive, restore, export or delete.', actions: ['Turn modules on or off', 'Archive the engagement'] }],
  [/^\/settings\/workflow/, { name: 'Engagement Settings: Workflow', purpose: 'Which steps stop for a person (gates) and which agent drafts each step.', actions: ['Change gates'] }],
  [/^\/settings\/agents/, { name: 'AI Agents', purpose: 'The agents that draft each step, the model each one uses, their rules and whether they are on. Each works agentic (looks things up, can ask a person, checks its own draft) or as a single call, with a step limit and the tools it may use.', actions: ['Switch an agent on or off', 'Change its model', 'Switch between agentic and single call', 'Choose its tools', 'Add an agent for a stage'] }],
  [/^\/settings\/integrations/, { name: 'Engagement Settings: Integrations', purpose: 'Connections this engagement uses.', actions: [] }],
  [/^\/settings\/access/, { name: 'Engagement Settings: Access', purpose: 'Who can see this engagement: open to everyone or members only.', actions: ['Add or remove members'] }],
  [/^\/workspace\/models/, { name: 'Models & Keys', purpose: 'AI providers and models, their keys (stored encrypted), the workspace default, the assistant model and the spend cap.', actions: ['Add a provider', 'Pick the assistant model', 'Set the spend cap'] }],
  [/^\/workspace\/people/, { name: 'People & Roles', purpose: 'Accounts and roles (admin, lead, reviewer, preparer, viewer).', actions: ['Add a person', 'Change a role'] }],
  [/^\/workspace\/security/, { name: 'Security', purpose: 'Sign-in settings, single sign-on and Act As.', actions: [] }],
  [/^\/account/, { name: 'Your Account', purpose: 'Your name, password and sessions.', actions: [] }],
  [/^\/engagements\/new/, { name: 'Add Engagement', purpose: 'Start a new client engagement: client, framework, modules and which models the agents use.', actions: [] }],
];

export function pageGuide(path: string): PageGuide | null {
  const p = path.split(/[?#]/)[0] || '/';
  return G.find(([re]) => re.test(p))?.[1] ?? null;
}

/** True when the question is about the page itself rather than the records. */
export const asksAboutPage = (q: string) => /\b(this|the|current) (page|screen|view|tab)\b|\bwhat('?s| is) (on |here)|\bwhat (can|should|do) i do here\b|\bwhere am i\b/i.test(q);
