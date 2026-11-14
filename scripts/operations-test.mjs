// Operations checks: reading PDFs, spreadsheets and Word files as evidence,
// incidents and their notification deadlines, scheduled monitoring and drift
// alerts, evidence connectors (with the private-network guard), per-engagement
// access, and the single sign-on scaffold against a mock identity provider.
// Needs a FRESH database and a running server: npm run db:reset, npm start,
// npm run test:operations.
import http from 'node:http';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const B = (process.env.BASE_URL || 'http://localhost:4300') + '/api';
function client() {
  let cookie = '';
  const c = async (m, p, b) => {
    const r = await fetch(B + p, {
      method: m,
      headers: { 'content-type': 'application/json', cookie },
      body: b ? JSON.stringify(b) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const t = await r.text();
    let j;
    try {
      j = JSON.parse(t);
    } catch {
      j = t;
    }
    if (!r.ok) {
      const e = new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(j)}`);
      e.status = r.status;
      e.body = j;
      throw e;
    }
    return j;
  };
  c.setCookie = (v) => (cookie = v);
  return c;
}
let fails = 0;
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m);
  if (!c) fails++;
};
const expectErr = async (p, s, m) => {
  try {
    await p;
    ok(false, m + ' (no error)');
  } catch (e) {
    ok(e.status === s, `${m} -> ${e.status} ${e.body?.error ?? ''}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (buf) => Buffer.from(buf).toString('base64');

// ---- Fixtures
function makePdf(lines) {
  const content = lines.length
    ? `BT /F1 12 Tf 72 720 Td 16 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, '')}) Tj T*`).join(' ')} ET`
    : '';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
async function makeXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Q3 sample');
  ws.addRow(['loan_id', 'decision', 'officer_signed']);
  for (let i = 1; i <= 25; i++)
    ws.addRow([`LN-${1000 + i}`, i % 3 ? 'approve' : 'decline', i === 7 || i === 19 ? 'no' : 'yes']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function makeDocx(text) {
  const z = new JSZip();
  z.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  z.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  z.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return z.generateAsync({ type: 'nodebuffer' });
}

// ---- Mock client system (for connectors) and identity provider (for SSO)
let exportBody = 'loan_id,signed\nLN-1,yes\nLN-2,no\n';
const sys = http
  .createServer((req, res) => {
    if (req.url === '/export.csv') {
      if (req.headers.authorization !== 'Bearer t0ken-abc') {
        res.statusCode = 401;
        return res.end('no');
      }
      res.setHeader('content-type', 'text/csv');
      return res.end(exportBody);
    }
    res.statusCode = 404;
    res.end();
  })
  .listen(4403);

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const ISS = 'http://localhost:4402';
const codes = new Map();
let audience = 'gh-client';
const idp = http
  .createServer(async (req, res) => {
    const u = new URL(req.url, ISS);
    const json = (o) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(o));
    };
    if (u.pathname === '/.well-known/openid-configuration')
      return json({
        issuer: ISS,
        authorization_endpoint: `${ISS}/authorize`,
        token_endpoint: `${ISS}/token`,
        jwks_uri: `${ISS}/jwks`,
      });
    if (u.pathname === '/jwks') return json({ keys: [jwk] });
    if (u.pathname === '/authorize') {
      // The test says who signs in with login_hint-like control: ?as= on the redirect we follow.
      const code = Math.random().toString(36).slice(2);
      codes.set(code, {
        nonce: u.searchParams.get('nonce'),
        email: currentEmail,
        challenge: u.searchParams.get('code_challenge'),
      });
      res.statusCode = 302;
      res.setHeader(
        'location',
        `${u.searchParams.get('redirect_uri')}?code=${code}&state=${u.searchParams.get('state')}`,
      );
      return res.end();
    }
    if (u.pathname === '/token') {
      let body = '';
      for await (const ch of req) body += ch;
      const f = new URLSearchParams(body);
      const c = codes.get(f.get('code'));
      if (!c || f.get('client_secret') !== 's3cret' || !f.get('code_verifier')) {
        res.statusCode = 400;
        return json({ error: 'invalid_grant' });
      }
      const id = await new SignJWT({
        email: c.email,
        email_verified: true,
        nonce: c.email.startsWith('badnonce') ? 'wrong' : c.nonce,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(ISS)
        .setAudience(audience)
        .setSubject(c.email)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      return json({ id_token: id, access_token: 'x', token_type: 'Bearer' });
    }
    res.statusCode = 404;
    res.end();
  })
  .listen(4402);
let currentEmail = '';
process.on('exit', () => {
  sys.close();
  idp.close();
});

// ---- People
const admin = client();
await admin('POST', '/auth/setup', {
  name: 'Andrew Lawrence',
  email: 'andrew@example.com',
  password: 'correct-horse-9',
});
for (const [n, e, r] of [
  ['Riley Reviewer', 'riley@example.com', 'reviewer'],
  ['Pat Preparer', 'pat@example.com', 'preparer'],
  ['Lee Lead', 'lee@example.com', 'lead'],
])
  await admin('POST', '/users', { name: n, email: e, role: r, password: 'correct-horse-9' });
const login = async (email) => {
  const c = client();
  await c('POST', '/auth/login', { email, password: 'correct-horse-9' });
  return c;
};
const riley = await login('riley@example.com');
const pat = await login('pat@example.com');
const lee = await login('lee@example.com');
const [eng] = await admin('GET', '/engagements');
const E = eng.id;

// ---- Reading files as evidence
const pdf = await pat('POST', '/evidence', {
  engagementId: E,
  title: 'Loan file review (PDF)',
  kind: 'file',
  filename: 'review.pdf',
  mime: 'application/pdf',
  dataBase64: b64(makePdf(['Sampled 25 loan files from Q3.', '2 of 25 were missing the officer sign-off.'])),
});
ok(pdf.readable && /PDF, 1 page read/.test(pdf.readNote), `a PDF's text is read (${pdf.readNote})`);
const xl = await pat('POST', '/evidence', {
  engagementId: E,
  title: 'Q3 sample (Excel)',
  kind: 'file',
  filename: 'sample.xlsx',
  mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  dataBase64: b64(await makeXlsx()),
});
ok(xl.readable && /1 sheet, 26 rows/.test(xl.readNote), `a spreadsheet is read (${xl.readNote})`);
const doc = await pat('POST', '/evidence', {
  engagementId: E,
  title: 'Policy (Word)',
  kind: 'file',
  filename: 'policy.docx',
  mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  dataBase64: b64(await makeDocx('Every credit decline is reviewed by an officer before it is sent.')),
});
ok(doc.readable && /Word document/.test(doc.readNote), `a Word document is read (${doc.readNote})`);
const scan = await pat('POST', '/evidence', {
  engagementId: E,
  title: 'Scanned form',
  kind: 'file',
  filename: 'scan.pdf',
  mime: 'application/pdf',
  dataBase64: b64(makePdf([])),
});
ok(!scan.readable && /OCR/.test(scan.readNote), 'a PDF with no text layer is reported, not guessed at');
const kbUp = await pat('POST', `/engagements/${E}/knowledge`, {
  title: 'Credit policy (PDF)',
  filename: 'credit-policy.pdf',
  dataBase64: b64(makePdf(['Every credit decline over 500000 must be reviewed by the Credit Committee.'])),
});
ok(kbUp.chunks > 0, 'a PDF can be added to the knowledge base');
const hits = await admin(
  'GET',
  `/engagements/${E}/knowledge/search?q=${encodeURIComponent('Credit Committee decline review')}`,
);
ok(
  hits.some((h) => /Credit Committee/.test(h.text)),
  'and agents can find it',
);
ok(
  (
    await admin(
      'GET',
      `/engagements/${E}/knowledge/search?q=${encodeURIComponent('officer sign-off missing loan files')}`,
    )
  ).some((h) => h.kind === 'evidence'),
  'evidence text from a PDF is searchable',
);

// ---- Incidents
const inv = await admin('GET', `/engagements/${E}/inventory`);
const bot = inv.find((i) => /chatbot/i.test(i.name));
const aware = new Date(Date.now() - 2 * 3600_000).toISOString();
const inc = await pat('POST', `/engagements/${E}/incidents`, {
  title: "Chatbot showed one customer another customer's balance",
  severity: 'critical',
  awareAt: aware,
  inventoryId: bot.id,
  owner: 'Head of Digital',
  clocks: ['jdpa_breach', 'ai_act_serious'],
});
const dp = inc.notices.find((n) => n.clock === 'jdpa_breach');
ok(
  inc.key.startsWith('INC-') && Math.round((new Date(dp.due) - new Date(aware)) / 3600_000) === 72,
  'a personal data breach is due to the Information Commissioner within 72 hours',
);
ok(
  Math.round((new Date(inc.notices.find((n) => n.clock === 'ai_act_serious').due) - new Date(aware)) / 864e5) === 15,
  'an EU AI Act serious incident is due within 15 days',
);
await expectErr(pat('PATCH', `/incidents/${inc.id}`, { status: 'closed' }), 403, 'a preparer cannot close an incident');
await expectErr(
  riley('PATCH', `/incidents/${inc.id}`, { status: 'closed' }),
  409,
  'closing needs a root cause and lessons',
);
await expectErr(
  riley('PATCH', `/incidents/${inc.id}`, {
    status: 'closed',
    rootCause: 'Session cache keyed on account type, not customer',
    lessons: 'Cache keys include the customer id; added a red-team case',
  }),
  409,
  'closing needs every notice recorded as sent',
);
await pat('PATCH', `/incidents/${inc.id}`, {
  sent: { clock: 'jdpa_breach', reference: 'Email to the OIC, ref 2026-114' },
});
await pat('PATCH', `/incidents/${inc.id}`, { sent: { clock: 'ai_act_serious', reference: 'Portal submission 88812' } });
const act = await pat('POST', `/engagements/${E}/issues`, {
  title: 'Fix the session cache key',
  severity: 'critical',
  incidentId: inc.id,
  owner: 'Head of Digital',
});
const incs = await admin('GET', `/engagements/${E}/incidents`);
ok(
  incs[0].issueKeys.includes(act.key) && incs[0].timeline.some((t) => /Notified Information Commissioner/.test(t.text)),
  'corrective actions and notices show on the incident',
);
await expectErr(
  riley('PATCH', `/incidents/${inc.id}`, {
    status: 'closed',
    rootCause: 'Session cache keyed on account type, not customer',
    lessons: 'Cache keys include the customer id; added a red-team case',
  }),
  409,
  'closing waits for corrective actions',
);
await admin('PATCH', `/issues/${act.id}`, { status: 'risk_accepted', note: 'Fix deployed and verified in production' });
const closed = await riley('PATCH', `/incidents/${inc.id}`, {
  status: 'closed',
  rootCause: 'Session cache keyed on account type, not customer',
  lessons: 'Cache keys include the customer id; added a red-team case',
});
ok(
  closed.status === 'closed' && closed.closedBy === 'Riley Reviewer',
  'a reviewer closes it once everything is in place',
);
const inc2 = await riley('POST', `/engagements/${E}/incidents`, {
  title: 'Wrong fee quoted',
  severity: 'low',
  awareAt: new Date().toISOString(),
});
await expectErr(
  riley('PATCH', `/incidents/${inc2.id}`, {
    status: 'closed',
    rootCause: 'Fee table out of date',
    lessons: 'Fee table synced daily',
  }),
  403,
  'whoever reported an incident cannot close it',
);

// ---- Monitoring
const suites = await admin('GET', `/engagements/${E}/evals`);
const red = suites.find((s) => s.kind === 'red_team');
const qual = suites.find((s) => s.kind === 'quality');
await expectErr(
  pat('PATCH', `/evals/${red.id}/schedule`, { schedule: 'daily' }),
  403,
  'a preparer cannot schedule monitoring',
);
const sch = await lee('PATCH', `/evals/${red.id}/schedule`, { schedule: 'daily' });
ok(sch.schedule === 'daily' && sch.nextRunAt, 'a lead schedules a suite daily');
let scheduled = null;
for (let i = 0; i < 40 && !scheduled; i++) {
  await sleep(1000);
  scheduled = (await admin('GET', `/engagements/${E}/evals`)).find(
    (s) => s.id === red.id && s.lastRun?.status === 'completed',
  );
}
ok(
  scheduled && new Date(scheduled.nextRunAt) > new Date(Date.now() + 20 * 3600_000),
  'the scheduler ran it and set the next run a day later',
);
const runs = await admin('GET', `/audit?q=${encodeURIComponent('eval.started')}`);
ok(
  runs.rows.some((r) => r.actor === 'Monitoring' && r.detail.scheduled === 'daily'),
  'the scheduled run is in the audit log as Monitoring',
);
let alerts = await admin('GET', `/engagements/${E}/alerts`);
ok(
  alerts.some((a) => a.kind === 'below_threshold' && a.suiteId === red.id),
  'a run below its threshold raises an alert',
);
// Drift: three runs at the usual level, then a worse one.
const runOnce = async (s) => {
  const r = await pat('POST', `/evals/${s.id}/run`, {});
  for (let i = 0; i < 60; i++) {
    const x = await admin('GET', `/eval-runs/${r.runId}`);
    if (x.status !== 'running') return x;
    await sleep(300);
  }
};
for (let i = 0; i < 3; i++) await runOnce(qual);
for (let i = 0; i < 3; i++)
  await pat('POST', `/evals/${qual.id}/cases`, {
    name: `Impossible check ${i}`,
    input: 'What are your branch hours?',
    check: 'contains',
    expected: 'zzz-never-says-this',
    severity: 'medium',
  });
const worse = await runOnce(qual);
alerts = await admin('GET', `/engagements/${E}/alerts`);
const drift = alerts.find((a) => a.kind === 'drift' && a.runId === worse.id);
ok(
  drift && drift.baselinePct > drift.passPct,
  `a drop against the recent average raises a drift alert (${drift?.message})`,
);
await expectErr(
  pat('POST', `/alerts/${drift.id}/acknowledge`, { note: 'seen' }),
  403,
  'a preparer cannot acknowledge an alert',
);
await expectErr(riley('POST', `/alerts/${drift.id}/acknowledge`, {}), 400, 'acknowledging needs a note');
const iss = await pat('POST', `/alerts/${drift.id}/issue`, {});
await riley('POST', `/alerts/${drift.id}/acknowledge`, { note: 'New cases added on purpose; tracked as an issue' });
alerts = await admin('GET', `/engagements/${E}/alerts`);
ok(
  alerts.find((a) => a.id === drift.id).status === 'acknowledged' &&
    alerts.find((a) => a.id === drift.id).issueKey === iss.issueKey,
  'an alert can become an issue and is acknowledged with a note',
);
await lee('PATCH', `/evals/${red.id}/schedule`, { schedule: 'off' });

// ---- Evidence connectors
const ctl = await admin('POST', `/engagements/${E}/controls`, {
  title: 'Officer sign-off on declines',
  owner: 'Head of Retail Credit',
  status: 'designed',
});
await expectErr(
  pat('POST', `/engagements/${E}/connectors`, { name: 'Export', url: 'http://localhost:4403/export.csv' }),
  403,
  'a preparer cannot set up a connector',
);
const cn = await lee('POST', `/engagements/${E}/connectors`, {
  name: 'Loan decisions export',
  url: 'http://localhost:4403/export.csv',
  auth: 'bearer',
  secret: 't0ken-abc',
  controlId: ctl.id,
});
ok(cn.secretSet && !JSON.stringify(cn).includes('t0ken-abc'), 'the credential is saved but never sent back');
let p1 = await pat('POST', `/connectors/${cn.id}/pull`, {});
ok(
  p1.lastStatus === 'failed' && /private network/.test(p1.lastMessage),
  'by default a connector cannot reach this machine or a private network',
);
await expectErr(
  lee('PUT', '/settings', { connectorsAllowPrivate: true }),
  403,
  'only an admin can allow private addresses',
);
await admin('PUT', '/settings', { connectorsAllowPrivate: true });
p1 = await pat('POST', `/connectors/${cn.id}/pull`, {});
ok(p1.lastStatus === 'added', `a pull files new evidence (${p1.lastMessage})`);
const ev = (await admin('GET', `/engagements/${E}/evidence`)).filter((e) => e.source.startsWith(cn.key));
ok(
  ev.length === 1 && ev[0].controlId === ctl.id && ev[0].readable && ev[0].collectedBy.startsWith(cn.key),
  'it is fingerprinted, readable and filed against the control',
);
ok((await admin('GET', `/evidence/${ev[0].id}/verify`)).ok, 'its fingerprint verifies');
const p2 = await pat('POST', `/connectors/${cn.id}/pull`, {});
ok(p2.lastStatus === 'unchanged', 'pulling the same content again adds nothing');
exportBody += 'LN-3,yes\n';
const p3 = await pat('POST', `/connectors/${cn.id}/pull`, {});
ok(
  p3.lastStatus === 'added' &&
    (await admin('GET', `/engagements/${E}/evidence`)).filter((e) => e.source.startsWith(cn.key)).length === 2,
  'changed content becomes new evidence',
);
await lee('PATCH', `/connectors/${cn.id}`, { secret: 'wrong' });
const p4 = await pat('POST', `/connectors/${cn.id}/pull`, {});
ok(p4.lastStatus === 'failed' && /401/.test(p4.lastMessage), 'a refused credential is reported');
const leak = await admin('GET', `/audit?q=${encodeURIComponent('t0ken-abc')}`);
ok(leak.total === 0, 'the credential never appears in the audit log');
await admin('PUT', '/settings', { connectorsAllowPrivate: false });

// ---- Per-engagement access
await expectErr(
  pat('PUT', `/engagements/${E}/access`, { access: 'members' }),
  403,
  'a preparer cannot change who sees an engagement',
);
await lee('PUT', `/engagements/${E}/access`, { access: 'members' });
const riley2 = (await lee('GET', `/engagements/${E}/members`)).people.find((p) => p.name === 'Riley Reviewer');
await lee('POST', `/engagements/${E}/members`, { userId: riley2.id });
ok((await pat('GET', '/engagements')).length === 0, 'members only: a non-member no longer sees it');
await expectErr(pat('GET', '/cards/AI-1'), 404, 'its use cases answer "not found" to a non-member');
await expectErr(pat('GET', `/engagements/${E}/evidence`), 404, 'nor its evidence');
await expectErr(pat('GET', `/engagements/${E}/incidents`), 404, 'nor its incidents');
ok(
  (await pat('GET', `/audit?q=${encodeURIComponent('INC-')}`)).total === 0,
  'its audit entries are hidden from non-members',
);
ok(
  (await riley('GET', '/engagements')).length === 1 && (await riley('GET', '/cards/AI-1')).card,
  'a member still sees it',
);
ok((await admin('GET', '/engagements')).length === 1, 'an admin always sees it');
const lid = (await lee('GET', `/engagements/${E}/members`)).members.map((m) => m.id);
await lee('DELETE', `/engagements/${E}/members/${riley2.id}`);
await expectErr(
  lee('DELETE', `/engagements/${E}/members/${lid.find((x) => x !== riley2.id)}`),
  409,
  'the last member cannot be removed',
);
await lee('PUT', `/engagements/${E}/access`, { access: 'open' });
ok((await pat('GET', '/engagements')).length === 1, 'open again: everyone signed in sees it');

// ---- Single sign-on (scaffold)
await expectErr(
  lee('PUT', '/sso/config', { enabled: true, issuer: ISS, clientId: 'gh-client' }),
  403,
  'only an admin sets up single sign-on',
);
const cfg = await admin('PUT', '/sso/config', {
  enabled: true,
  label: 'Test IdP',
  issuer: ISS,
  clientId: 'gh-client',
  clientSecret: 's3cret',
});
ok(/\/api\/auth\/sso\/callback$/.test(cfg.redirectUri), 'the redirect address to register is shown');
ok(!JSON.stringify(await admin('GET', '/sso/config')).includes('s3cret'), 'the client secret is never sent back');
ok((await (await fetch(B + '/auth/sso')).json()).enabled, 'the sign-in page can see that SSO is on');
async function ssoAs(email) {
  currentEmail = email;
  const r1 = await fetch(B + '/auth/sso/start', { redirect: 'manual' });
  const r2 = await fetch(r1.headers.get('location'), { redirect: 'manual' });
  const r3 = await fetch(r2.headers.get('location'), { redirect: 'manual' });
  return {
    location: r3.headers.get('location'),
    cookie: (r3.headers.get('set-cookie') ?? '').split(';')[0],
    callback: r2.headers.get('location'),
  };
}
const s1 = await ssoAs('riley@example.com');
const viaSso = client();
viaSso.setCookie(s1.cookie);
ok(
  s1.location === '/' && (await viaSso('GET', '/auth/me')).name === 'Riley Reviewer',
  'an existing person signs in through the provider',
);
const s2 = await ssoAs('stranger@example.com');
ok(
  /sso_error=.*no%20active%20account/i.test(s2.location) && !s2.cookie,
  'someone without an account is refused, not created',
);
const s3 = await ssoAs('badnonce@example.com');
ok(/sso_error/.test(s3.location) && !s3.cookie, 'a token for a different sign-in attempt is refused');
const replay = await fetch(s1.callback, { redirect: 'manual' });
ok(/sso_error=.*expired/i.test(replay.headers.get('location')), 'a sign-in link cannot be used twice');
audience = 'someone-else';
const s4 = await ssoAs('riley@example.com');
ok(/sso_error=.*verified/i.test(s4.location), 'a token meant for another application is refused');
audience = 'gh-client';
await admin('PUT', '/sso/config', {
  enabled: true,
  label: 'Test IdP',
  issuer: ISS,
  clientId: 'gh-client',
  passwordsForNonAdmins: false,
});
await expectErr(
  client()('POST', '/auth/login', { email: 'pat@example.com', password: 'correct-horse-9' }),
  403,
  'passwords can be turned off for non-admins',
);
ok(
  (await client()('POST', '/auth/login', { email: 'andrew@example.com', password: 'correct-horse-9' })).ok,
  'an admin can always use a password, so a broken provider cannot lock everyone out',
);
await admin('PUT', '/sso/config', { enabled: false, label: 'Test IdP', issuer: ISS, clientId: 'gh-client' });

const v = await admin('GET', '/audit/verify');
ok(v.ok, v.message);
console.log('\nThis test created these accounts, all with the password correct-horse-9:');
console.log('  andrew@example.com (admin), riley@ (reviewer), pat@ (preparer), lee@ (lead), all @example.com');
console.log('Run npm run db:reset (with the app stopped) to clear them and start again.');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
