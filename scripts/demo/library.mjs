// Saved copies of the demo, so you can switch between them in seconds.
//
//   npm run demo:build              build every copy (takes a few minutes; the app must be stopped)
//   npm run demo:build -- kestrel   build just one copy
//   npm run demo:list               list the copies, and which one is loaded
//   npm run demo:load -- all        load a copy (the app must be stopped), then start the app
//   npm run demo:save -- my-copy    save what's in the app now as a copy of its own
//
// The copies:
//   all          every client together: switch between them with the engagement switcher (top left)
//   northshore   Northshore Financial Group alone (every feature on)
//   kestrel      Kestrel Bay Telecom alone
//   palmcrest    Palmcrest Health Network alone
//   corallis     Corallis Port Services alone
//   social       National Social Support Agency alone
// Any file you add to scripts/demo/engagements gets its own copy too, named
// after the file (06-my-client.mjs becomes my-client), and joins "all".
//
// Copies live in the demos/ folder (not in git). Loading one first saves the
// database you had into data-backups/, so nothing is lost. Your secret key
// (data/secret.key) is never replaced, so saved model keys keep working.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const DATA = resolve(root, 'data');
const DEMOS = resolve(root, 'demos');
const PORT = Number(process.env.PORT || 4300);
const PARTS = ['pglite', 'evidence'];

const [cmd, ...rest] = process.argv.slice(2);
const slugOf = (f) => f.replace(/\.mjs$/, '').replace(/^\d+-/, '').split('-')[0];
const scenarioFiles = () => readdirSync(resolve(here, 'engagements')).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort();
const copies = () => (existsSync(DEMOS) ? readdirSync(DEMOS).filter((d) => existsSync(resolve(DEMOS, d, 'pglite'))) : []);
const running = () => fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
const loadedFile = resolve(DATA, 'loaded-demo.txt');
const loaded = () => (existsSync(loadedFile) ? readFileSync(loadedFile, 'utf8').trim() : null);

async function mustBeStopped() {
  if (await running()) {
    console.error(`The app is running on port ${PORT}. Stop it first (Ctrl+C in its terminal), then run this again.`);
    process.exit(1);
  }
}
function copyParts(from, to) {
  mkdirSync(to, { recursive: true });
  for (const p of PARTS) {
    rmSync(resolve(to, p), { recursive: true, force: true });
    if (existsSync(resolve(from, p))) cpSync(resolve(from, p), resolve(to, p), { recursive: true });
  }
}
function backupCurrent() {
  if (!existsSync(resolve(DATA, 'pglite'))) return;
  const to = resolve(root, 'data-backups', `data-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  copyParts(DATA, to);
  console.log(`Saved the database you had to ${to.replace(root + '/', '').replace(root + '\\', '')}`);
}
const run = (args, opts = {}) => new Promise((ok, fail) => {
  const p = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: root, stdio: opts.quiet ? 'ignore' : 'inherit', shell: process.platform === 'win32', ...opts });
  if (opts.background) return ok(p);
  p.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`npm ${args.join(' ')} failed (${code})`))));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function stop(p) {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore', shell: true });
  else { try { process.kill(-p.pid, 'SIGTERM'); } catch { p.kill('SIGTERM'); } }
}

async function build(names) {
  await mustBeStopped();
  backupCurrent();
  const targets = [
    { name: 'all', only: null, label: 'every client together' },
    ...(await Promise.all(scenarioFiles().map(async (f) => {
      const m = await import(pathToFileURL(resolve(here, 'engagements', f)).href);
      return { name: slugOf(f), only: f.replace(/\.mjs$/, ''), label: `${m.engagement.client} alone` };
    }))),
  ].filter((t) => !names.length || names.includes(t.name));
  if (!targets.length) { console.error(`No copy called ${names.join(', ')}. Copies: all, ${scenarioFiles().map(slugOf).join(', ')}`); process.exit(1); }
  for (const t of targets) {
    console.log(`\n=== Building "${t.name}" (${t.label})`);
    await run(['run', 'db:reset'], { quiet: true });
    const server = await run(['start'], { background: true, quiet: true, detached: process.platform !== 'win32' });
    try {
      for (let i = 0; i < 60 && !(await running()); i++) await sleep(1000);
      if (!(await running())) throw new Error('The app did not start');
      await run(['run', 'demo', '--', ...(t.only ? [`--only=${t.only}`, '--alone'] : [])]);
    } finally {
      stop(server);
      for (let i = 0; i < 30 && (await running()); i++) await sleep(500);
      await sleep(1500);
    }
    copyParts(DATA, resolve(DEMOS, t.name));
    writeFileSync(resolve(DEMOS, t.name, 'about.txt'), `${t.label}\nBuilt ${new Date().toISOString()}\n`);
    console.log(`Saved as demos/${t.name}`);
  }
  // Leave the "all" copy loaded (or the last one built).
  const keep = targets.find((t) => t.name === 'all') ?? targets[targets.length - 1];
  copyParts(resolve(DEMOS, keep.name), DATA);
  writeFileSync(loadedFile, keep.name);
  console.log(`\nDone. "${keep.name}" is loaded. Start the app (npm run dev) and sign in as andrew@example.com.`);
}

async function load(name) {
  if (!name) { console.error('Say which copy: npm run demo:load -- all (see npm run demo:list)'); process.exit(1); }
  if (!copies().includes(name)) { console.error(`No saved copy called "${name}". Run npm run demo:list, or build it with npm run demo:build -- ${name}`); process.exit(1); }
  await mustBeStopped();
  backupCurrent();
  copyParts(resolve(DEMOS, name), DATA);
  writeFileSync(loadedFile, name);
  console.log(`Loaded "${name}". Start the app (npm run dev) and sign in as andrew@example.com (password correct-horse-9).`);
}

async function save(name) {
  if (!name || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) { console.error('Give the copy a short name in lower case, for example: npm run demo:save -- my-copy'); process.exit(1); }
  await mustBeStopped();
  copyParts(DATA, resolve(DEMOS, name));
  writeFileSync(resolve(DEMOS, name, 'about.txt'), `Saved from the app\nSaved ${new Date().toISOString()}\n`);
  writeFileSync(loadedFile, name);
  console.log(`Saved what's in the app now as demos/${name}. Load it again any time with npm run demo:load -- ${name}`);
}

function list() {
  const have = copies();
  if (!have.length) { console.log('No saved copies yet. Stop the app and run npm run demo:build (a few minutes).'); return; }
  const cur = loaded();
  for (const d of have) {
    const about = existsSync(resolve(DEMOS, d, 'about.txt')) ? readFileSync(resolve(DEMOS, d, 'about.txt'), 'utf8').split('\n') : ['', ''];
    const when = statSync(resolve(DEMOS, d, 'pglite')).mtime.toISOString().slice(0, 16).replace('T', ' ');
    console.log(`${d === cur ? '*' : ' '} ${d.padEnd(12)} ${about[0].padEnd(34)} built ${when}`);
  }
  console.log('\nnpm run demo:load -- <name>   (stop the app first)');
}

if (cmd === 'build') await build(rest);
else if (cmd === 'load') await load(rest[0]);
else if (cmd === 'save') await save(rest[0]);
else list();
