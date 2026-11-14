// Helpers for building demo engagements through the real API. Everything a
// scenario does goes through the same routes, permissions, segregation of
// duties and audit log as a person clicking in the app, so the demo records
// are genuine. See README.md in this folder for how to add a scenario.
export const B = (process.env.BASE_URL || 'http://localhost:4300') + '/api';
export const PW = process.env.DEMO_PASSWORD || 'correct-horse-9';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const step = (s) => console.log(`  - ${s}`);

export function client() {
  let cookie = '';
  return async (m, p, b) => {
    // A hosted server may be waking up (502/503/504) or briefly unreachable: retry a few times.
    for (let attempt = 1; ; attempt++) {
      let r;
      try {
        r = await fetch(B + p, {
          method: m,
          headers: { 'content-type': 'application/json', cookie },
          body: b ? JSON.stringify(b) : undefined,
        });
      } catch (e) {
        if (attempt < 6) {
          await sleep(3000 * attempt);
          continue;
        }
        throw new Error(`${m} ${p}: can't reach ${B} (${e.cause?.code ?? e.message})`);
      }
      if ([502, 503, 504].includes(r.status) && attempt < 6) {
        await sleep(3000 * attempt);
        continue;
      }
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
        throw e;
      }
      return j;
    }
  };
}

// The five demo people. Andrew is the admin; the others sign in as themselves.
export const PEOPLE = [
  ['Jordan Clarke', 'jordan@example.com', 'lead'],
  ['Riley Morgan', 'riley@example.com', 'reviewer'],
  ['Sam Patel', 'sam@example.com', 'preparer'],
  ['Dana Reid', 'dana@example.com', 'viewer'],
];

// A scenario gets one of these for its engagement.
export function engagementCtx(E, people) {
  const { andrew, jordan, riley, sam } = people;
  const card = async (key) => andrew('GET', `/cards/${key}`);
  // Hosted servers are slower than a laptop, so wait up to two minutes for an agent.
  const waitFor = async (key, pred, label, ms = Number(process.env.DEMO_WAIT_MS || 120000)) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const d = await card(key);
      if (pred(d.card)) return d;
      await sleep(300);
    }
    const d = await card(key);
    throw new Error(
      `Timed out waiting for ${key} (${label}): ${d.card.stage}/${d.card.status} ${d.card.statusNote ?? ''}`,
    );
  };
  const ctx = {
    E,
    ...people,
    card,
    waitFor,

    // Engagement details, modules and risk appetite.
    async configure({ modules, framework, appetite, about, access } = {}) {
      await andrew('PATCH', `/engagements/${E}`, {
        ...(modules ? { modules } : {}),
        ...(framework ? { framework } : {}),
        ...(appetite ? { appetite } : {}),
        ...(about ? { about } : {}),
      });
      if (access) await jordan('PUT', `/engagements/${E}/access`, { access });
    },
    // Turn on every built agent (the Planner, Risk Classifier and Control Designer are on already).
    async allAgentsOn() {
      for (const a of await andrew('GET', `/engagements/${E}/agents`))
        if (!a.enabled && a.built) await andrew('PATCH', `/agents/${a.id}`, { enabled: true });
    },
    // A client document the AI agents may cite.
    async knowledge(title, paragraphs, by = sam) {
      return by('POST', `/engagements/${E}/knowledge`, { title, text: paragraphs.join('\n\n') });
    },
    // A use case typed straight in (quick add). Returns the card.
    async useCase(spec, by = sam) {
      return by('POST', `/engagements/${E}/cards`, {
        autonomy: 'human_in_loop',
        vendor: '',
        category: 'other',
        priority: 'p2',
        ...spec,
      });
    },
    // A use case raised with the Use Case Planner: each message is one turn.
    // With add: true the person then adds it to Intake (by typing anything the Planner left empty).
    async plan(messages, { by = sam, fill = {}, add = false } = {}) {
      let p = await by('POST', `/engagements/${E}/plans`, {});
      for (const text of messages) p = await by('POST', `/plans/${p.id}/messages`, { text });
      if (Object.keys(fill).length) p = await by('PATCH', `/plans/${p.id}`, { brief: fill });
      if (add) return (await by('POST', `/plans/${p.id}/add`)).card;
      return p;
    },
    // Intake -> the Risk Classifier's draft, waiting for decisions.
    async toClassification(key, by = riley) {
      const { card: c } = await card(key);
      await by('POST', `/cards/${c.id}/actions`, { action: 'approve' });
      return waitFor(key, (x) => x.stage === 'classify' && x.status === 'needs_approval', 'classification');
    },
    // Decide the classification (optionally item by item first), then approve -> the control design draft.
    async approveClassification(
      key,
      { decide, by = riley, note = 'Tier and risks agreed with the business owner' } = {},
    ) {
      const { card: c } = await card(key);
      if (decide) await decide(c.id, c);
      await by('POST', `/cards/${c.id}/decisions`, { rest: 'accept' });
      await by('POST', `/cards/${c.id}/actions`, { action: 'approve', note });
      return waitFor(key, (x) => x.stage === 'design' && x.status === 'needs_approval', 'design');
    },
    async approveDesign(key, { by = riley } = {}) {
      const { card: c } = await card(key);
      await by('POST', `/cards/${c.id}/decisions`, { rest: 'accept' });
      await by('POST', `/cards/${c.id}/actions`, { action: 'approve' });
      return waitFor(key, (x) => x.stage === 'evidence' && x.status === 'needs_approval', 'evidence plan');
    },
    // Ask the Verifier to check the draft on a card.
    async verify(key) {
      const { card: c } = await card(key);
      return andrew('POST', `/cards/${c.id}/verify`, {});
    },
    // Edit one item of a draft, with the reason the audit log keeps.
    async edit(cardId, item, edit, reason, by = riley) {
      return by('POST', `/cards/${cardId}/decisions`, { item, decision: 'edit', edit, reason });
    },
    async reject(cardId, item, reason, by = riley) {
      return by('POST', `/cards/${cardId}/decisions`, { item, decision: 'reject', reason });
    },
    async issue(spec, by = sam) {
      return by('POST', `/engagements/${E}/issues`, spec);
    },
  };
  return ctx;
}
