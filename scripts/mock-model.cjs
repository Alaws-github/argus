// Mock model for the drafting agents. model 'mock-good' answers within the
// rules; 'mock-bad' tries every trick the guardrails must catch.
const http = require('http');
// Every structured request's temperature, so tests can check drafting is deterministic.
const seen = [];
// A toy embedding: hashed bag of words with a few synonyms folded together, so
// "a person reviews" lands near "human oversight". Good enough to test plumbing.
const SYN = { person: 'human', people: 'human', reviewer: 'oversight', reviews: 'oversight', review: 'oversight', check: 'oversight', checks: 'oversight', declines: 'decision', decisions: 'decision', loans: 'loan' };
function embed(text) {
  const v = new Array(128).fill(0);
  for (let w of String(text).toLowerCase().match(/[a-z]{3,}/g) || []) {
    w = SYN[w] || w;
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % 128] += 1;
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'mock-good' }, { id: 'mock-bad' }, { id: 'mock-notemp' }, { id: 'mock-embed' }, { id: 'mock-judge' }, { id: 'mock-judge-liar' }, { id: 'mock-assist' }, { id: 'mock-notools' }] }));
    if (req.url === '/__seen') return res.end(JSON.stringify(seen));
    const b = JSON.parse(body);
    if (req.url === '/v1/embeddings') {
      const input = Array.isArray(b.input) ? b.input : [b.input];
      return res.end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: embed(t) })) }));
    }
    seen.push({ model: b.model, temperature: b.temperature });
    // A model that refuses a temperature setting, like some newer reasoning models.
    if (b.model === 'mock-notemp' && b.temperature !== undefined) { res.statusCode = 400; return res.end(JSON.stringify({ error: { message: "Unsupported parameter: 'temperature'" } })); }
    // A service that refuses tool calls (like Perplexity): it only answers JSON.
    if (b.model === 'mock-notools' && b.tools) { res.statusCode = 400; return res.end(JSON.stringify({ error: { message: 'tools are not supported for this model' } })); }
    const tool = b.tools ? b.tools[0].function.name : b.response_format?.json_schema?.name;
    const user = b.messages.find((m) => m.role === 'user').content;
    const bad = b.model === 'mock-bad';
    let out;
    const given = [...user.matchAll(/<source id="(K-\d+)"/g)].map((m) => m[1]);
    if (tool === 'submit_classification') {
      out = {
        tierRationale: 'It shapes credit decisions about individuals.', tier: 'high', tierSources: bad ? ['K-99999'] : given.slice(0, 1),
        oversightRationale: 'A person must decide.', oversight: 'human_in_command', factors: ['Decides about individuals'],
        risks: [
          { title: 'Biased approvals for a protected group', category: 'fairness', rationale: 'Credit data can encode bias.', likelihood: 4, impact: 5, sources: given.slice(1, 3) },
          { title: 'Bureau data used beyond purpose', category: 'privacy', rationale: 'Mock rationale.', likelihood: 2, impact: 4, sources: [] },
        ],
        openQuestions: ['Who reviews contested decisions?'], frameworkRefs: ['NIST AI RMF MAP 1.1'],
      };
    } else if (tool === 'submit_controls') {
      const risks = [...user.matchAll(/^- (.+?) \[/gm)].map((m) => m[1]);
      out = { controls: [{ libraryCode: 'OVS-01', title: 'Human review of declines', objective: 'A person reviews every decline.', owner: 'Head of Credit', riskTitles: risks.slice(0, 2), testApproach: 'Sample 25 declines.', sources: given.slice(0, 2) }], gaps: [] };
    } else if (tool === 'submit_test_drafts') {
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
    } else if (tool === 'submit_verdicts') {
      // 'mock-judge' quotes the first cited passage word for word; 'mock-judge-liar'
      // calls everything supported with a quote that appears nowhere.
      const texts = Object.fromEntries([...user.matchAll(/<source id="(K-\d+)"[^>]*>\n([\s\S]*?)\n<\/source>/g)].map((m) => [m[1], m[2]]));
      const claims = [...user.matchAll(/<claim id="([^"]+)" cites="([^"]*)">/g)].map((m) => ({ id: m[1], cites: m[2].split(', ').filter(Boolean) }));
      // Any other model gives no verdicts at all.
      out = !b.model.startsWith('mock-judge') ? { summary: 'No verdicts.' } : {
        verdicts: claims.map((c) => ({
          item: c.id, reasoning: 'Mock reasoning.', verdict: 'supported',
          quote: b.model === 'mock-judge-liar' ? 'This sentence was never in any passage at all.' : (texts[c.cites[0]] || '').split(/\s+/).slice(0, 12).join(' '),
        })),
        summary: 'Mock verdicts.',
      };
    } else if (tool === 'submit_answer') {
      // 'mock-assist': one good suggestion, plus things the harness must drop.
      const cardId = (user.match(/<use_case id="([0-9a-f-]{36})"/) || [])[1];
      const item = ((user.match(/undecided items: ([^\n]+)/) || [])[1] || '').split(', ')[0];
      out = {
        answer: 'Mock answer about the record.', citations: [...given.slice(0, 1), 'K-99999'],
        suggestions: [
          ...(cardId && item && item !== 'none' ? [{ kind: 'decide_item', title: `Reject ${item}`, why: 'Mock reason.', cardId, item, decision: item === 'tier' ? 'edit' : 'reject', reason: 'Not supported by the profile', ...(item === 'tier' ? { edit: { tier: 'high' } } : {}) }] : []),
          ...(cardId ? [{ kind: 'rerun_agent', title: 'Ask the agent again', why: 'Mock.', cardId, note: 'Reconsider the privacy risk.' }] : []),
          { kind: 'update_risk', title: 'Change a risk that is not in the record', why: 'Mock.', riskId: '00000000-0000-4000-8000-000000000000', owner: 'Someone' },
          { kind: 'approve_stage', title: 'Approve it for them', why: 'Mock.', cardId },
        ],
      };
    } else if (tool === 'submit_plan') {
      // Tries to overwrite every field, including ones the person typed; the harness must keep theirs.
      out = {
        reply: 'Thanks. Who is accountable for it, and what data does it use?',
        brief: { title: 'Mock planned use case', description: 'Drafted by the mock planner.', businessOwner: 'Head of Mock', dataUsed: 'Mock data overwrite', affectedPeople: 'Mock customers', autonomy: 'human_on_loop', vendor: 'Mock vendor', category: 'agent', priority: 'p3' },
        ready: true,
      };
    } else out = {};
    if (!b.tools) return res.end(JSON.stringify({ choices: [{ message: { content: '```json\n' + JSON.stringify(out) + '\n```' } }], usage: { prompt_tokens: 900, completion_tokens: 300 } }));
    res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: tool, arguments: JSON.stringify(out) } }] } }], usage: { prompt_tokens: 900, completion_tokens: 300 } }));
  });
}).listen(4401, () => console.log('mock2 on 4401'));
