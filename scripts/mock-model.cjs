// Mock model for the drafting agents. model 'mock-good' answers within the
// rules; 'mock-bad' tries every trick the guardrails must catch.
const http = require('http');
// Every structured request's temperature, so tests can check drafting is deterministic.
const seen = [];
// Calls per model, for the flaky-provider mocks (v1.5).
const calls = {};
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
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'mock-good' }, { id: 'mock-bad' }, { id: 'mock-notemp' }, { id: 'mock-embed' }, { id: 'mock-judge' }, { id: 'mock-judge-liar' }, { id: 'mock-assist' }, { id: 'mock-notools' }, { id: 'mock-ratelimit' }, { id: 'mock-malformed' }, { id: 'mock-truncate' }, { id: 'mock-maxtok' }, { id: 'mock-badjson' }, { id: 'mock-echo' }, { id: 'mock-agent' }, { id: 'mock-asker' }, { id: 'mock-rogue' }, { id: 'mock-looper' }, { id: 'mock-critic' }, { id: 'mock-gemini' }] }));
    if (req.url === '/__seen') return res.end(JSON.stringify(seen));
    if (req.url === '/__calls') return res.end(JSON.stringify(calls));
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
    const system = (b.messages.find((m) => m.role === 'system') || {}).content || '';
    // v1.6: in the agent loop, problems come back as a tool message, not in the first user message.
    const repairing = b.messages.some((m) => typeof m.content === 'string' && m.content.includes('<problems>'));
    const toolMsgs = b.messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n');
    const offered = (b.tools || []).map((t) => t.function.name);
    const forced = b.tool_choice && typeof b.tool_choice === 'object';
    let nCall = 0;
    // 'mock-gemini' behaves like Gemini 3 on its OpenAI-compatible endpoint: every tool call carries a
    // thought signature in extra_content, and a later request without it is refused with a 400.
    const gemini = b.model === 'mock-gemini';
    const sig = (n) => (gemini ? { extra_content: { google: { thought_signature: `sig-${n}` } } } : {});
    if (gemini && b.messages.some((m) => m.role === 'assistant' && (m.tool_calls || []).some((t) => !t.extra_content?.google?.thought_signature))) {
      res.statusCode = 400;
      return res.end(JSON.stringify([{ error: { code: 400, message: 'Function call is missing a thought_signature in functionCall parts. This is required for tools to work correctly.', status: 'INVALID_ARGUMENT' } }]));
    }
    const callTools = (list) => res.end(JSON.stringify({ choices: [{ message: { content: '', tool_calls: list.map(([name, args]) => ({ id: `call_${++nCall}`, type: 'function', function: { name, arguments: JSON.stringify(args) }, ...sig(nCall) })) } }], usage: { prompt_tokens: 500, completion_tokens: 40 } }));
    // v1.6 loop mocks. Each looks things up first, then hands in a draft like mock-good.
    const looping = offered.includes('search_knowledge') && !forced && tool !== 'submit_self_check';
    if ((b.model === 'mock-agent' || gemini) && looping && !toolMsgs) return callTools([['search_knowledge', { query: 'human oversight of credit decisions' }], ['get_engagement', {}]]);
    if (b.model === 'mock-asker' && looping && offered.includes('ask_person') && !/<answers_to_your_questions>/.test(user)) return callTools([['ask_person', { question: 'Who signs off a declined loan application?', to: 'business_owner', why: 'It sets the oversight model' }]]);
    if (b.model === 'mock-rogue' && looping && !toolMsgs) {
      const peek = (system.match(/PEEK:([A-Z]+-\d+)/) || [])[1] || 'AI-1';
      return callTools([['delete_card', { key: peek }], ['get_use_case', { key: peek }]]);
    }
    if (b.model === 'mock-looper' && looping) return callTools([['search_knowledge', { query: `round ${b.messages.length}` }]]);
    calls[b.model] = (calls[b.model] || 0) + 1;
    // v1.5 flaky providers. Each misbehaves in one way, then answers like mock-good.
    if (b.model === 'mock-ratelimit' && calls[b.model] % 2 === 1) { res.statusCode = 429; res.setHeader('retry-after', '1'); return res.end(JSON.stringify({ error: { message: 'Rate limit reached for requests' } })); }
    if (b.model === 'mock-maxtok' && b.max_tokens !== undefined) { res.statusCode = 400; return res.end(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } })); }
    if (b.model === 'mock-truncate' && (b.max_tokens ?? b.max_completion_tokens) <= 4000) {
      return res.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '' } }], usage: { prompt_tokens: 900, completion_tokens: 4000 } }));
    }
    if (b.model === 'mock-badjson' && !repairing && b.tools) {
      return res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: tool, arguments: '{"tier": "high", "risks": [' } }] } }], usage: { prompt_tokens: 900, completion_tokens: 30 } }));
    }
    const bad = b.model === 'mock-bad';
    const malformed = b.model === 'mock-malformed' && !repairing;
    let out;
    // Passages it was given, plus (v1.6) any it found with search_knowledge, found ones first.
    const found = [...toolMsgs.matchAll(/<source id="(K-\d+)"/g)].map((m) => m[1]);
    const given = [...new Set([...found, ...[...user.matchAll(/<source id="(K-\d+)"/g)].map((m) => m[1])])];
    const answered = (user.match(/A \(([^)]+)\): ([^\n]+)/) || []);
    const rogueSaw = b.model === 'mock-rogue' ? (toolMsgs.match(/AI-\d+ ([^\n(]+)/) || [])[1] || 'nothing' : null;
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
      if (answered[2]) out.factors.push(`Answer from ${answered[1]}: ${answered[2]}`);
      if (rogueSaw) out.factors.push(`Peeked at: ${rogueSaw.trim()}`);
      if (malformed) { out.tier = 'High-risk'; out.risks[0].likelihood = 9; }
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
    } else if (tool === 'submit_self_check') {
      // 'mock-critic' finds one problem with its own draft; everyone else finds none.
      out = { problems: b.model === 'mock-critic' ? ['The privacy risk cites no passage'] : [] };
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
    } else if (tool === 'submit_answer' && b.model !== 'mock-echo') {
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
    } else if (tool === 'submit_plan' && b.model === 'mock-echo') {
      // Reports what context reached the model, so tests can check it.
      const keys = ((user.match(/<existing_use_cases>\n([\s\S]*?)\n<\/existing_use_cases>/) || [])[1] || '').match(/\b[A-Z]+-\d+\b/g) || [];
      out = {
        reply: `engagement:${/<engagement>[\s\S]*About this engagement:/.test(user) ? 'about' : /<engagement>/.test(user) ? 'yes' : 'no'} existing:${keys.join(',') || 'none'} sources:${given.length} intake:${/A good intake brief/.test(user)} upload:${/Bank AI intake policy/.test(user)} instructions:${/## Engagement instructions/.test(system)}`,
        brief: {}, ready: false,
      };
    } else if (tool === 'submit_answer' && b.model === 'mock-echo') {
      out = { answer: `about:${/About: /.test(user)} instructions:${/## Workspace instructions[\s\S]*British spelling/.test(system)}`, citations: [], suggestions: [] };
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
