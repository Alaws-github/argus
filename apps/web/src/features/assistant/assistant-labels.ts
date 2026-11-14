// What the assistant panel shows that doesn't change: starting questions for an empty conversation, and the
// words for what an answer drew on, source kinds, suggestion kinds and their status. Split out of AssistantPanel.vue in v1.7.8.

// Starting points for an empty conversation, by what the person is looking at.
export type Starter = { icon: string; title: string; sub: string; q: string };
/** The starting question about the page itself, offered everywhere. */
export const PAGE: Starter = {
  icon: 'overview',
  title: 'Explain this page',
  sub: "What's on it and what I can do here",
  q: "What's on this page, and what can I do here?",
};
/** Starting questions for an empty conversation, by what the person is looking at. */
export const STARTERS: Record<string, Starter[]> = {
  card: [
    {
      icon: 'usecases',
      title: 'Explain this draft',
      sub: 'In plain English',
      q: 'Explain this draft in plain English',
    },
    {
      icon: 'controls',
      title: 'Before I approve',
      sub: 'What should I check first?',
      q: 'What should I check before approving?',
    },
    {
      icon: 'risks',
      title: 'Weakest items',
      sub: 'Which look weakest, and why',
      q: 'Which items look weakest, and why?',
    },
  ],
  risks: [
    PAGE,
    {
      icon: 'risks',
      title: 'Needs attention',
      sub: 'Which risks to look at first',
      q: 'Which risks need attention first?',
    },
    {
      icon: 'controls',
      title: 'Uncovered risks',
      sub: 'High risks with no control',
      q: 'Which high risks have no control?',
    },
    { icon: 'people', title: 'Missing owners', sub: 'Risks nobody owns yet', q: 'Which risks have no owner?' },
  ],
  controls: [
    PAGE,
    {
      icon: 'tests',
      title: 'Untested controls',
      sub: 'Controls with no test yet',
      q: 'Which controls have no test yet?',
    },
    { icon: 'people', title: 'Missing owners', sub: 'Controls nobody owns yet', q: 'Which controls have no owner?' },
    {
      icon: 'report',
      title: 'Summary for a director',
      sub: 'The control register in brief',
      q: 'Summarise the control register for a director',
    },
  ],
  issues: [
    PAGE,
    {
      icon: 'issues',
      title: 'Overdue or severe',
      sub: 'Issues to chase first',
      q: 'Which issues are overdue or high severity?',
    },
    { icon: 'report', title: 'Board summary', sub: 'Open issues in brief', q: 'Summarise open issues for the board' },
  ],
  engagement: [
    PAGE,
    {
      icon: 'engagement',
      title: 'Where we stand',
      sub: 'This engagement at a glance',
      q: 'Where does this engagement stand?',
    },
    { icon: 'runs', title: 'Next steps', sub: 'What the team should do next', q: 'What should the team do next?' },
    {
      icon: 'knowledge',
      title: 'EU AI Act tiers',
      sub: 'Explained in plain English',
      q: 'Explain the EU AI Act risk tiers in plain English',
    },
  ],
};

// v1.6: what an answer drew on, and its sources grouped by kind.
export const BASIS: Record<string, string> = {
  page: 'This page',
  records: 'ARGUS records',
  knowledge: 'Knowledge base',
};
/** Each knowledge base source kind in words, for grouping an answer's sources. */
export const SOURCE_KIND: Record<string, string> = {
  framework: 'Frameworks',
  control: 'Control library',
  methodology: 'Method guidance',
  upload: 'Client documents',
  client: 'Client documents',
  use_case: 'Use cases',
  evidence: 'Evidence',
};

/** Each suggestion kind in words (the whitelist is AssistantSuggestion in shared, rule 15). */
export const KIND: Record<string, string> = {
  decide_item: 'Decision on a draft item',
  update_risk: 'Change a risk',
  update_control: 'Change a control',
  raise_issue: 'Raise an issue',
  rerun_agent: 'Send back to the agent',
};
/** What a suggestion would change, in one line. */
export function detail(s: any): string {
  switch (s.kind) {
    case 'decide_item':
      return `${s.decision} ${s.item}${
        s.edit
          ? `: ${Object.entries(s.edit)
              .map(([k, v]) => `${k} → ${v}`)
              .join(', ')}`
          : ''
      }${s.reason ? `. Reason: ${s.reason}` : ''}`;
    case 'update_risk':
      return ['owner', 'treatment', 'likelihood', 'impact', 'residual_likelihood', 'residual_impact']
        .filter((k) => s[k] !== undefined)
        .map((k) => `${k.replace('_', ' ')} → ${s[k]}`)
        .join(', ');
    case 'update_control':
      return [
        s.newTitle && `title → ${s.newTitle}`,
        s.owner && `owner → ${s.owner}`,
        s.objective && `objective → ${s.objective}`,
      ]
        .filter(Boolean)
        .join(', ');
    case 'raise_issue':
      return `${s.severity}: ${s.issueTitle}${s.description ? `. ${s.description}` : ''}`;
    case 'rerun_agent':
      return `Note to the agent: ${s.note}`;
  }
  return '';
}
/** A suggestion's outcome in words. */
export const STATUS: Record<string, string> = { applied: 'Applied', discarded: 'Discarded', failed: 'Refused' };

/** A duration in seconds: one decimal under 10 seconds. */
export const secs = (ms?: number | null) =>
  ms == null ? '' : ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
