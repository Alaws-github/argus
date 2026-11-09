// RAG v2 checks (v1.6): retrieval quality on the fixed question set (recall at
// 5 and 10, MRR) with keyword search and with meaning search added; documents
// split at their headings with each passage keeping its section; one long
// document can't crowd out the rest of the results.
// Needs a FRESH database and a running server: npm run db:reset, npm start, npm run test:rag.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const mock = spawn(process.execPath, [fileURLToPath(new URL('./mock-model.cjs', import.meta.url))], { stdio: 'ignore' });
process.on('exit', () => mock.kill());
await new Promise((r) => setTimeout(r, 500));

const B = (process.env.BASE_URL || 'http://localhost:4300') + '/api';
function client() { let cookie = ''; return async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', cookie }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(j)}`); return j; }; }
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const admin = client();
await admin('POST', '/auth/setup', { name: 'Andrew Lawrence', email: 'andrew@example.com', password: 'correct-horse-9' });
const [eng] = await admin('GET', '/engagements'); const E = eng.id;

console.log('\n# Retrieval quality (shared passages)');
const show = (s) => `recall@5 ${s.recall5}, recall@10 ${s.recall10}, MRR ${s.mrr}`;
let r = await admin('GET', '/agent-testing/retrieval');
const kw = r.scores.find((s) => s.mode === 'keyword');
ok(r.cases >= 20 && kw, `${r.cases} questions scored with keyword search: ${show(kw)}`);
ok(kw.recall10 >= 0.8, 'keyword search finds a right passage in the top 10 for at least 80% of questions');
for (const m of kw.misses) console.log(`  missed: "${m.query}" (wanted ${m.expect.join(' or ')}; got ${m.got.join(', ') || 'nothing'})`);

const prov = await admin('POST', '/providers', { type: 'openai', name: 'Mock', baseUrl: 'http://localhost:4401/v1', apiKey: 'x', billed: false, models: ['mock-embed'] });
await admin('PUT', '/settings', { embedProviderId: prov.id, embedModel: 'mock-embed' });
await admin('POST', '/knowledge/reindex', {});
r = await admin('GET', '/agent-testing/retrieval');
const hy = r.scores.find((s) => s.mode === 'hybrid');
ok(hy && r.embedModel === 'mock-embed', `with an embedding model, meaning search is scored too: ${hy ? show(hy) : 'not run'}`);
ok(hy && hy.recall10 >= kw.recall10 - 0.1, 'adding meaning search does not make retrieval clearly worse (a toy embedding here; compare real models on the Retrieval tab)');

console.log('\n# Documents split at their headings');
const doc = [
  'Model Risk Policy',
  '',
  '1. Purpose',
  'This policy sets how the bank governs models. It applies to every model used in credit decisions.',
  '',
  '2. Human oversight',
  'A credit officer reviews every automated decline before the customer is told. The officer can overturn the decline and must record why.',
  '',
  '3. Validation',
  'Every credit model is validated by the second line before first use and every year after. ' + 'Validation covers data, performance, stability and fairness across groups. '.repeat(18),
  '',
  'ANNEX A CONTACTS',
  'The Model Risk Committee meets monthly.',
].join('\n');
await admin('POST', `/engagements/${E}/knowledge`, { title: 'Model Risk Policy', text: doc });
const hits = await admin('GET', `/engagements/${E}/knowledge/search?q=${encodeURIComponent('credit officer reviews automated decline')}`);
const top = hits.find((h) => h.kind === 'upload');
ok(top && /Model Risk Policy › 2\. Human oversight/.test(top.title), `a passage keeps its section heading (${top?.title})`);
const val = (await admin('GET', `/engagements/${E}/knowledge/search?q=${encodeURIComponent('validation fairness stability performance data second line')}`)).filter((h) => h.kind === 'upload');
ok(val.length >= 2 && val.every((h) => /3\. Validation/.test(h.title)), `a long section becomes several passages, each with its heading (${val.length})`);
ok(val.some((h) => /^[^\n]*\.\n\n/.test(h.text)), 'a passage cut mid-section starts with the last sentence of the one before');
const many = await admin('GET', `/engagements/${E}/knowledge/search?q=${encodeURIComponent('validation fairness performance credit model policy')}`);
const fromPolicy = many.filter((h) => h.kind === 'upload').length;
ok(fromPolicy <= 2 || many.length - fromPolicy === 0, `no more than two passages from one document while others match (${fromPolicy} of ${many.length})`);

console.log('\nThis test created an account with the password correct-horse-9. Run npm run db:reset (with the app stopped) to clear it.');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
