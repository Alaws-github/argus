// Mock model for the drafting agents. model 'mock-good' answers within the
// rules; 'mock-bad' tries every trick the guardrails must catch.
const http = require('http');
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'mock-good' }, { id: 'mock-bad' }] }));
    const b = JSON.parse(body);
    const tool = b.tools[0].function.name;
    const user = b.messages.find((m) => m.role === 'user').content;
    const bad = b.model === 'mock-bad';
    let out;
    if (tool === 'submit_test_drafts') {
      const tests = [...user.matchAll(/<test key="(T-\d+)"[\s\S]*?Evidence you may cite: ([^\n]*)/g)].map((m) => ({ key: m[1], ev: m[2] === 'none' ? [] : m[2].split(', ') }));
      out = {
        results: tests.map((t, i) => bad && i === 0
          ? { testKey: t.key, proposed: 'pass', actual: 'All fine', exceptions: 3, evidenceKeys: ['E-999'], reasoning: 'trust me' }
          : { testKey: t.key, proposed: t.ev.length ? 'fail' : 'cannot_assess', actual: t.ev.length ? 'Evidence shows 2 exceptions' : '', exceptions: t.ev.length ? 2 : 0, evidenceKeys: t.ev.slice(0, 1), reasoning: 'Read the cited evidence.' }),
        summary: 'Mock drafts.',
      };
    } else if (tool === 'submit_board_summary') {
      out = {
        headline: bad ? 'Chatbot is 97% compliant with 14 controls' : 'Customer service chatbot: serious issues remain open',
        summary: bad ? 'It saved 250000 dollars last year and is broadly fine overall.' : 'The chatbot answers customer questions. Assurance found failures in testing and evaluation. Open issues need fixing before reliance.',
        keyFigures: [], recommendations: ['Fix the open issues and retest.'], decisionsNeeded: [],
      };
    } else if (tool === 'submit_evidence_plan') {
      const ctl = [...user.matchAll(/- (C-\d+) /g)].map((m) => m[1]);
      out = { requests: ctl.map((c) => ({ controlKey: bad ? 'C-999' : c, item: 'System export for the period', why: 'Shows it operates', askFrom: 'Owner', status: 'missing', evidenceKeys: [], note: '' })), summary: 'Mock plan.' };
    } else if (tool === 'submit_challenges') {
      out = { challenges: [{ severity: 'medium', area: 'evidence', finding: 'Mock: evidence is thin for the sample.', ref: '' }], readiness: 'ready', summary: 'Mock review.' };
    } else out = {};
    res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: tool, arguments: JSON.stringify(out) } }] } }], usage: { prompt_tokens: 900, completion_tokens: 300 } }));
  });
}).listen(4401, () => console.log('mock2 on 4401'));
