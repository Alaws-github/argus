// Builds the ARGUS demo: five people, then one engagement per file in
// ./engagements (in file-name order). Files starting with "_" are skipped,
// so _template.mjs is a starting point you can copy.
//
//   npm run demo                      all engagements
//   npm run demo -- --list            list them
//   npm run demo -- --only=kestrel    just the ones whose file name contains "kestrel"
//                                     (comma-separate several: --only=kestrel,palmcrest)
//
// Saved copies of the demo (all clients together, or one client alone) that
// you can switch between are made by scripts/demo/library.mjs: see
// npm run demo:build, demo:list and demo:load.
//
// Needs a FRESH database and the app running: stop the app, npm run db:reset,
// start it, then npm run demo. Uses the offline rules: free, no keys needed.
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { B, PEOPLE, PW, client, engagementCtx, sleep, step } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.slice(7).toLowerCase().split(',').filter(Boolean);
const picked = (f) => !only || only.some((o) => f.toLowerCase().includes(o));
const files = readdirSync(resolve(here, 'engagements')).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort();
const scenarios = [];
for (const f of files) scenarios.push({ file: f, ...(await import(pathToFileURL(resolve(here, 'engagements', f)).href)) });

if (args.includes('--list')) {
  for (const s of scenarios) console.log(`${s.file.padEnd(32)} ${s.engagement.client} · ${s.engagement.name}`);
  process.exit(0);
}

// A new database gets Andrew as its first admin. A database that already has
// accounts (for example a live site where you created your admin first) is
// fine too: sign in with DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD, and any
// demo client already there is skipped, so you can run it again after a stop.
let state;
for (let i = 0; i < 20; i++) {
  try { const r = await fetch(B + '/auth/state'); if (r.ok) { state = await r.json(); break; } } catch {}
  if (i === 0) console.log(`Waiting for ${B} to answer (a hosted server can take a minute to wake up)...`);
  await sleep(5000);
}
if (!state) { console.error(`Couldn't reach ${B}. Check BASE_URL, and that the site opens in your browser.`); process.exit(1); }

const andrew = client();
if (state.needsSetup) {
  await andrew('POST', '/auth/setup', { name: 'Andrew Lawrence', email: 'andrew@example.com', password: PW });
} else {
  const email = process.env.DEMO_ADMIN_EMAIL || 'andrew@example.com';
  try {
    await andrew('POST', '/auth/login', { email, password: process.env.DEMO_ADMIN_PASSWORD || PW });
  } catch {
    console.error(`This site already has accounts, and signing in as ${email} failed.\nSet the admin you created and its password, then run again, for example in PowerShell:\n  $env:DEMO_ADMIN_EMAIL="you@example.com"; $env:DEMO_ADMIN_PASSWORD="your-password"; npm run demo`);
    process.exit(1);
  }
  const me = await andrew('GET', '/auth/me');
  if (me.role !== 'admin') { console.error(`${email} is not an admin. Use an admin account.`); process.exit(1); }
  console.log(`Signed in as ${me.name} (admin)`);
}
const people = { andrew };
for (const [name, email, role] of PEOPLE) {
  await andrew('POST', '/users', { name, email, role, password: PW }).catch((e) => { if (e.status !== 409) throw e; });
  const c = client();
  try {
    await c('POST', '/auth/login', { email, password: PW });
  } catch {
    console.error(`${email} already exists with a different password. Set DEMO_PASSWORD to its password, or reset it under People & Roles.`);
    process.exit(1);
  }
  people[{ lead: 'jordan', reviewer: 'riley', preparer: 'sam', viewer: 'dana' }[role]] = c;
}
console.log('People: your admin, Jordan (lead), Riley (reviewer), Sam (preparer), Dana (viewer)');

// ---- Engagements
const rules = (await andrew('GET', '/providers')).find((p) => p.type === 'rules');
const existing = await andrew('GET', '/engagements');
// The engagement a new database starts with ("Client Zero", with Northshore's use cases).
const seeded = existing.find((e) => e.name === 'Client Zero') ?? null;
const seededId = seeded?.id ?? null;
let seededUsed = false;
for (const s of scenarios) {
  if (!picked(s.file)) continue;
  if (!s.engagement.useSeeded && existing.some((e) => e.client === s.engagement.client)) { console.log(`\n${s.engagement.client}: already on this site, skipped`); continue; }
  if (s.engagement.useSeeded && !seeded) { console.log(`\n${s.engagement.client}: skipped (already built here, or its starting engagement is gone)`); continue; }
  const t0 = Date.now();
  let E;
  if (s.engagement.useSeeded) {
    E = seededId;
    seededUsed = true;
    await andrew('PATCH', `/engagements/${E}`, { name: s.engagement.name, client: s.engagement.client });
  } else {
    const e = s.engagement;
    const created = await people.jordan('POST', '/engagements', {
      name: e.name, client: e.client, prefix: e.prefix, color: e.color ?? '#8b9dff', sector: e.sector ?? '', about: e.about ?? '',
      frameworks: e.frameworks ?? ['nistAiRmf', 'iso42001'], startSoa: true,
      appetite: e.appetite ?? { maxResidual: 8, statement: '', escalateTo: 'Board Risk Committee' },
      gates: e.gates ?? { intake: true, classify: true, design: true }, agents: {}, useCases: [],
    });
    E = created.id;
    // Everyone in the demo works on every engagement.
    for (const who of ['riley', 'sam', 'dana']) {
      const me = await people[who]('GET', '/auth/me');
      await people.jordan('POST', `/engagements/${E}/members`, { userId: me.id }).catch(() => {});
    }
  }
  console.log(`\n${s.engagement.client} · ${s.engagement.name}`);
  const ctx = engagementCtx(E, people);
  // In the demo every agent is on, so the AI drafts every step it can.
  await ctx.allAgentsOn();
  await s.build(ctx, { rules, step });
  console.log(`  (${Math.round((Date.now() - t0) / 1000)}s)`);
}

// The database starts with one engagement (Northshore's use cases). When the
// demo doesn't build Northshore, remove it so only the chosen clients remain.
// Only for the saved one-client copies (npm run demo:build passes --alone).
if (!seededUsed && seededId && args.includes('--alone')) {
  const e = (await andrew('GET', '/engagements')).find((x) => x.id === seededId);
  await andrew('POST', `/engagements/${seededId}/archive`, { reason: 'Not part of this demo' });
  await andrew('DELETE', `/engagements/${seededId}`, { confirm: e.name });
  console.log('\n(The starting engagement was removed: this demo has only the clients you picked.)');
}

// ---- Workspace: act as on, so one person can run the whole flow in a demo
await andrew('PUT', '/settings', { allowActAs: true });
const v = await andrew('GET', '/audit/verify');
console.log(`\nDone. Audit chain: ${v.message}`);
console.log(`Sign in as ${state.needsSetup ? 'andrew@example.com' : process.env.DEMO_ADMIN_EMAIL || 'andrew@example.com'} (admin) and use Act As from the account menu, or sign in as jordan@, riley@, sam@ or dana@ (all @example.com).`);
console.log(`Password for the demo people: ${process.env.DEMO_PASSWORD ? 'the DEMO_PASSWORD you set' : PW}`);
